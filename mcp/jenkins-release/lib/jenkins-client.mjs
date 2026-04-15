import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR_ENV = "JENKINS_RELEASE_MCP_CONFIG_DIR";
const URL_ENV = "JENKINS_RELEASE_MCP_URL";
const USER_ENV = "JENKINS_RELEASE_MCP_USER";
const DEFAULT_TOKEN_ENV = "JENKINS_API_KEY";
const DEFAULT_URL = "https://jenkins.dev.micun.cn";
const CONFIG_FILE_NAME = "config.json";

function fail(message) {
  throw new Error(message);
}

export function normalizeUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

export function buildJobPath(jobName) {
  const parts = String(jobName ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    fail("Missing Jenkins job name.");
  }

  return parts.map((part) => `job/${encodeURIComponent(part)}`).join("/");
}

export function sanitizeParameters(parameters = {}) {
  if (parameters == null || typeof parameters !== "object" || Array.isArray(parameters)) {
    fail("Parameters must be an object.");
  }

  const entries = Object.entries(parameters).map(([key, value]) => {
    if (!String(key).trim()) {
      fail("Parameter names cannot be empty.");
    }
    if (["string", "number", "boolean"].includes(typeof value)) {
      return [String(key), value];
    }
    fail(`Unsupported parameter value for "${key}". Use string, number, or boolean.`);
  });

  return Object.fromEntries(entries);
}

export function resolveConfigDir() {
  const explicitDir = process.env[CONFIG_DIR_ENV];
  if (explicitDir?.trim()) {
    return explicitDir.trim();
  }
  return path.join(os.homedir(), ".agent-plugin", "mcp", "jenkins-release");
}

function resolveConfigPath() {
  return path.join(resolveConfigDir(), CONFIG_FILE_NAME);
}

function ensureConfigDir() {
  fs.mkdirSync(resolveConfigDir(), { recursive: true });
}

function readStoredConfig() {
  const filePath = resolveConfigPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(resolveConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export function clearStoredConfig() {
  const filePath = resolveConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function maskSecret(value) {
  const text = String(value ?? "");
  if (!text) {
    return "(not set)";
  }
  if (text.length <= 4) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, 2)}${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-2)}`;
}

export function getEffectiveConfig() {
  const stored = readStoredConfig();
  const tokenEnvVar = String(stored.tokenEnvVar || DEFAULT_TOKEN_ENV).trim() || DEFAULT_TOKEN_ENV;
  const envToken = process.env[tokenEnvVar];

  return {
    url: normalizeUrl(process.env[URL_ENV] || stored.url || DEFAULT_URL),
    user: String(process.env[USER_ENV] || stored.user || "").trim(),
    token: String(process.env[tokenEnvVar] || stored.token || "").trim(),
    tokenEnvVar,
    tokenSource: process.env[tokenEnvVar] ? `env:${tokenEnvVar}` : stored.token ? "saved-config" : "missing"
  };
}

export function getStoredConfig() {
  return readStoredConfig();
}

export function setStoredConfig(input) {
  const current = readStoredConfig();
  const next = {
    ...current
  };

  if (input.url !== undefined) {
    next.url = normalizeUrl(input.url || DEFAULT_URL);
  }
  if (input.user !== undefined) {
    next.user = String(input.user ?? "").trim();
  }
  if (input.token !== undefined) {
    next.token = String(input.token ?? "").trim();
  }
  if (input.tokenEnvVar !== undefined) {
    next.tokenEnvVar = String(input.tokenEnvVar ?? "").trim() || DEFAULT_TOKEN_ENV;
  }

  if (!next.url) {
    next.url = DEFAULT_URL;
  }
  writeStoredConfig(next);
  return next;
}

export function requireConfig() {
  const config = getEffectiveConfig();
  if (!config.url || !config.user || !config.token) {
    fail(
      "Jenkins config is incomplete. Set URL/user via jenkins_set_config and provide a token either in saved config or via the configured token env var."
    );
  }
  return config;
}

function basicAuthHeader(config) {
  return `Basic ${Buffer.from(`${config.user}:${config.token}`).toString("base64")}`;
}

export async function request(config, requestPath, options = {}) {
  const response = await fetch(`${config.url}/${requestPath.replace(/^\/+/, "")}`, {
    method: options.method || "GET",
    headers: {
      Authorization: basicAuthHeader(config),
      ...(options.headers || {})
    },
    body: options.body
  });

  return response;
}

export async function requestJson(config, requestPath, options = {}) {
  const response = await request(config, requestPath, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    fail(`Jenkins request failed (${response.status} ${response.statusText}).`);
  }

  return data;
}

export async function getCrumb(config) {
  const response = await request(config, "crumbIssuer/api/json", {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404 || response.status === 403) {
    return null;
  }

  const text = await response.text();
  if (!response.ok) {
    fail(`Failed to obtain Jenkins crumb (${response.status} ${response.statusText}).`);
  }

  return text.trim() ? JSON.parse(text) : null;
}

function extractParameterDefinitions(jobData) {
  const propertyList = Array.isArray(jobData?.property) ? jobData.property : [];
  const parameterProperty = propertyList.find((entry) => Array.isArray(entry?.parameterDefinitions));
  return (parameterProperty?.parameterDefinitions || []).map((definition) => ({
    name: definition?.name,
    type: definition?._class || "unknown",
    description: definition?.description || "",
    defaultValue: definition?.defaultParameterValue?.value,
    choices: Array.isArray(definition?.choices) ? definition.choices : undefined
  }));
}

export async function getJobInfo(config, job) {
  const requestPath =
    `${buildJobPath(job)}/api/json?tree=` +
    "name,fullName,url,buildable,lastBuild[number,url],lastCompletedBuild[number,url,result],property[parameterDefinitions[name,description,choices,defaultParameterValue[value],_class]]";

  const data = await requestJson(config, requestPath);
  return {
    job: data?.fullName || data?.name || job,
    url: data?.url || null,
    buildable: Boolean(data?.buildable),
    lastBuild: data?.lastBuild || null,
    lastCompletedBuild: data?.lastCompletedBuild || null,
    parameterDefinitions: extractParameterDefinitions(data)
  };
}

export async function getBuildInfo(config, job, buildSelector = "lastBuild") {
  const requestPath =
    `${buildJobPath(job)}/${buildSelector}/api/json?tree=` +
    "number,url,result,building,actions[parameters[name,value]]";

  const data = await requestJson(config, requestPath);
  const parametersAction = (Array.isArray(data?.actions) ? data.actions : []).find((action) =>
    Array.isArray(action?.parameters)
  );

  return {
    number: data?.number,
    url: data?.url || null,
    result: data?.result || null,
    building: Boolean(data?.building),
    parameters: Object.fromEntries(
      (parametersAction?.parameters || []).map((entry) => [entry.name, entry.value])
    )
  };
}

async function resolveQueueExecutable(config, queueUrl, attempts = 8, sleepMs = 750) {
  if (!queueUrl) {
    return null;
  }

  const apiUrl = queueUrl.replace(/\/+$/, "") + "/api/json?tree=id,why,blocked,buildable,stuck,task[name,url],executable[number,url]";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request(config, apiUrl.replace(config.url, ""));
    const text = await response.text();
    if (!response.ok || !text.trim()) {
      return null;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }

    if (data?.executable?.number) {
      return {
        queueId: data.id,
        buildNumber: data.executable.number,
        buildUrl: data.executable.url || null
      };
    }

    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  return null;
}

export async function triggerJob(config, job, parameters = {}) {
  const cleanParams = sanitizeParameters(parameters);
  const crumb = await getCrumb(config);
  const hasParameters = Object.keys(cleanParams).length > 0;
  const endpoint = hasParameters ? `${buildJobPath(job)}/buildWithParameters` : `${buildJobPath(job)}/build`;
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(cleanParams)) {
    body.append(key, String(value));
  }

  const headers = {};
  if (crumb?.crumbRequestField && crumb?.crumb) {
    headers[crumb.crumbRequestField] = crumb.crumb;
  }

  const response = await request(config, endpoint, {
    method: "POST",
    headers,
    body: hasParameters ? body : undefined
  });

  if (!response.ok) {
    fail(`Failed to trigger Jenkins job (${response.status} ${response.statusText}).`);
  }

  const queueUrl = response.headers.get("location");
  const executable = await resolveQueueExecutable(config, queueUrl);

  return {
    job,
    endpoint: `${config.url}/${endpoint}`,
    queueUrl,
    buildNumber: executable?.buildNumber || null,
    buildUrl: executable?.buildUrl || null,
    tokenSource: config.tokenSource
  };
}

export async function previewRebuildLast(config, job) {
  const jobInfo = await getJobInfo(config, job);
  const lastBuild = await getBuildInfo(config, job, "lastBuild");

  return {
    job: jobInfo.job,
    jobUrl: jobInfo.url,
    lastBuildNumber: lastBuild.number,
    lastBuildUrl: lastBuild.url,
    lastBuildResult: lastBuild.result,
    parameters: lastBuild.parameters
  };
}

export async function triggerRebuildLast(config, job) {
  const preview = await previewRebuildLast(config, job);
  return {
    preview,
    trigger: await triggerJob(config, job, preview.parameters)
  };
}
