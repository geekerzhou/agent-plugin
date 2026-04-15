#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const DATA_ENV = "CLAUDE_PLUGIN_DATA";
const CONFIG_DIR_NAME = "jenkins-release";
const CONFIG_FILE_NAME = "config.json";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node jenkins-release.mjs config set --url <url> --user <user> --token <token>",
      "  node jenkins-release.mjs config show",
      "  node jenkins-release.mjs config clear",
      "  node jenkins-release.mjs config test",
      "  node jenkins-release.mjs preview --job <job-name> [--param KEY=VALUE ...] [--json]",
      "  node jenkins-release.mjs run --confirmed --job <job-name> [--param KEY=VALUE ...] [--json]",
      "",
      "Notes:",
      "  - Job names can use Jenkins folder syntax, for example: team/service/deploy-prod",
      "  - Repeat --param for multiple parameters.",
      "  - `run` refuses to execute unless --confirmed is present."
    ].join("\n")
  );
}

function fail(message) {
  throw new Error(message);
}

function resolveConfigDir() {
  if (process.env[DATA_ENV]) {
    return path.join(process.env[DATA_ENV], CONFIG_DIR_NAME);
  }
  return path.join(os.homedir(), ".agent-plugin", CONFIG_DIR_NAME);
}

function resolveConfigPath() {
  return path.join(resolveConfigDir(), CONFIG_FILE_NAME);
}

function ensureConfigDir() {
  fs.mkdirSync(resolveConfigDir(), { recursive: true });
}

function maskSecret(value) {
  const text = String(value ?? "");
  if (!text) {
    return "(not set)";
  }
  if (text.length <= 4) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, 2)}${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-2)}`;
}

function resolveEnvToken() {
  const value = process.env.JENKINS_API_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

function loadConfig() {
  const filePath = resolveConfigPath();
  if (!fs.existsSync(filePath)) {
    return {
      version: STATE_VERSION,
      profile: null
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      version: STATE_VERSION,
      profile: parsed?.profile ?? null
    };
  } catch {
    return {
      version: STATE_VERSION,
      profile: null
    };
  }
}

function saveConfig(profile) {
  ensureConfigDir();
  const payload = {
    version: STATE_VERSION,
    profile
  };
  fs.writeFileSync(resolveConfigPath(), `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function clearConfig() {
  const filePath = resolveConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function parseCli(argv) {
  const positionals = [];
  const options = {
    params: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [key, inlineValue] = token.slice(2).split("=", 2);

    if (key === "json" || key === "confirmed") {
      options[key] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined) {
      fail(`Missing value for --${key}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    if (key === "param") {
      options.params.push(value);
      continue;
    }

    options[key] = value;
  }

  return { positionals, options };
}

function parseJobName(positionals, options) {
  return String(options.job ?? positionals[0] ?? "").trim();
}

function parseParams(rawParams) {
  const entries = [];
  for (const raw of rawParams ?? []) {
    const source = String(raw ?? "");
    const splitIndex = source.indexOf("=");
    if (splitIndex <= 0) {
      fail(`Invalid parameter "${source}". Expected KEY=VALUE.`);
    }
    const key = source.slice(0, splitIndex).trim();
    const value = source.slice(splitIndex + 1);
    if (!key) {
      fail(`Invalid parameter "${source}". Expected KEY=VALUE.`);
    }
    entries.push([key, value]);
  }
  return entries;
}

function requireProfile() {
  const profile = loadConfig().profile;
  const envToken = resolveEnvToken();
  const token = String(profile?.token ?? "").trim() || envToken;
  if (!profile?.url || !profile?.user || !token) {
    fail(
      "Jenkins config is incomplete. Run `config set --url <url> --user <user> [--token <token>]` first, or expose JENKINS_API_KEY in the current shell."
    );
  }
  return {
    url: normalizeUrl(profile.url),
    user: String(profile.user).trim(),
    token
  };
}

function basicAuthHeader(profile) {
  return `Basic ${Buffer.from(`${profile.user}:${profile.token}`).toString("base64")}`;
}

function buildJobPath(jobName) {
  const parts = String(jobName)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    fail("Missing Jenkins job name.");
  }

  return parts.map((part) => `job/${encodeURIComponent(part)}`).join("/");
}

async function request(profile, requestPath, options = {}) {
  const url = `${profile.url}/${requestPath.replace(/^\/+/, "")}`;
  const headers = {
    Authorization: basicAuthHeader(profile),
    ...(options.headers ?? {})
  };

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body
  });

  return response;
}

async function requestJson(profile, requestPath, options = {}) {
  const response = await request(profile, requestPath, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {})
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
    fail(`Jenkins request failed (${response.status} ${response.statusText}). ${typeof data === "string" ? data : ""}`.trim());
  }

  return data;
}

async function getCrumb(profile) {
  const response = await request(profile, "crumbIssuer/api/json", {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      return null;
    }
    fail(`Failed to obtain Jenkins crumb (${response.status} ${response.statusText}). ${text}`.trim());
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatParams(entries) {
  if (entries.length === 0) {
    return ["- (none)"];
  }
  return entries.map(([key, value]) => `- ${key}=${value}`);
}

function output(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  process.stdout.write(payload);
}

function renderConfig(profile) {
  const envToken = resolveEnvToken();
  if (!profile) {
    return "# Jenkins Config\n\nNo saved Jenkins config.\n";
  }

  return [
    "# Jenkins Config",
    "",
    `- URL: ${profile.url}`,
    `- User: ${profile.user}`,
    `- Token (saved): ${profile.token ? maskSecret(profile.token) : "(not set)"}`,
    `- Token (env JENKINS_API_KEY): ${envToken ? maskSecret(envToken) : "(not set)"}`
  ].join("\n") + "\n";
}

function renderPreview(summary) {
  return [
    "# Jenkins Task Preview",
    "",
    `- URL: ${summary.url}`,
    `- User: ${summary.user}`,
    `- Token source: ${summary.tokenSource}`,
    `- Job: ${summary.job}`,
    "- Parameters:",
    ...formatParams(summary.params),
    "",
    "Execution is not started yet.",
    "Ask the user to confirm before running."
  ].join("\n") + "\n";
}

function renderRunResult(result) {
  return [
    "# Jenkins Task Triggered",
    "",
    `- URL: ${result.url}`,
    `- User: ${result.user}`,
    `- Token source: ${result.tokenSource}`,
    `- Job: ${result.job}`,
    `- Trigger endpoint: ${result.endpoint}`,
    `- HTTP status: ${result.status}`,
    `- Queue URL: ${result.queueUrl ?? "(not returned)"}`,
    `- Build URL: ${result.buildUrl ?? "(not available yet)"}`
  ].join("\n") + "\n";
}

async function handleConfig(positionals, options) {
  const action = positionals[1];

  if (action === "set") {
    const url = normalizeUrl(options.url || "https://jenkins.dev.micun.cn");
    const user = String(options.user ?? "").trim();
    const token = String(options.token ?? "").trim();

    if (!url || !user) {
      fail("`config set` requires --user and optionally --url/--token.");
    }

    saveConfig({ url, user, token });
    output(
      options.json
        ? {
            ok: true,
            url,
            user,
            tokenSaved: Boolean(token),
            tokenFromEnvAvailable: Boolean(resolveEnvToken())
          }
        : `# Jenkins Config Saved\n\n- URL: ${url}\n- User: ${user}\n- Token (saved): ${token ? maskSecret(token) : "(not set)"}\n- Token (env JENKINS_API_KEY): ${resolveEnvToken() ? "available" : "(not set)"}\n`,
      options.json
    );
    return;
  }

  if (action === "show") {
    const profile = loadConfig().profile;
    output(options.json ? { profile } : renderConfig(profile), options.json);
    return;
  }

  if (action === "clear") {
    clearConfig();
    output("# Jenkins Config Cleared\n", options.json);
    return;
  }

  if (action === "test") {
    const profile = requireProfile();
    const envToken = resolveEnvToken();
    const data = await requestJson(profile, "whoAmI/api/json");
    const payload = {
      ok: true,
      url: profile.url,
      user: profile.user,
      tokenSource: loadConfig().profile?.token ? "saved-config" : envToken ? "env:JENKINS_API_KEY" : "unknown",
      authenticatedAs: data?.name ?? profile.user,
      anonymous: Boolean(data?.anonymous)
    };
    output(
      options.json
        ? payload
        : `# Jenkins Config Test\n\n- URL: ${payload.url}\n- User: ${payload.user}\n- Token source: ${payload.tokenSource}\n- Authenticated as: ${payload.authenticatedAs}\n- Anonymous: ${payload.anonymous}\n`,
      options.json
    );
    return;
  }

  fail("Unknown config action. Use set, show, clear, or test.");
}

async function handlePreview(positionals, options) {
  const profile = requireProfile();
  const savedProfile = loadConfig().profile;
  const job = parseJobName(positionals.slice(1), options);
  const params = parseParams(options.params);
  const summary = {
    url: profile.url,
    user: profile.user,
    tokenSource: savedProfile?.token ? "saved-config" : "env:JENKINS_API_KEY",
    job,
    params: params.map(([key, value]) => ({ key, value }))
  };

  output(
    options.json
      ? summary
      : renderPreview({
          ...summary,
          params
        }),
    options.json
  );
}

async function handleRun(positionals, options) {
  if (!options.confirmed) {
    fail("`run` requires --confirmed. Preview first, ask the user, then rerun with explicit confirmation.");
  }

  const profile = requireProfile();
  const savedProfile = loadConfig().profile;
  const job = parseJobName(positionals.slice(1), options);
  const params = parseParams(options.params);
  const endpoint = params.length > 0 ? `${buildJobPath(job)}/buildWithParameters` : `${buildJobPath(job)}/build`;
  const crumb = await getCrumb(profile);
  const body = new URLSearchParams();
  for (const [key, value] of params) {
    body.append(key, value);
  }

  const headers = {};
  if (crumb?.crumbRequestField && crumb?.crumb) {
    headers[crumb.crumbRequestField] = crumb.crumb;
  }

  const response = await request(profile, endpoint, {
    method: "POST",
    headers,
    body: params.length > 0 ? body : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    fail(`Failed to trigger Jenkins job (${response.status} ${response.statusText}). ${text}`.trim());
  }

  const queueUrl = response.headers.get("location");
  const payload = {
    ok: true,
    url: profile.url,
    user: profile.user,
    tokenSource: savedProfile?.token ? "saved-config" : "env:JENKINS_API_KEY",
    job,
    endpoint: `${profile.url}/${endpoint}`,
    status: response.status,
    queueUrl,
    buildUrl: null
  };

  output(options.json ? payload : renderRunResult(payload), options.json);
}

async function main() {
  const { positionals, options } = parseCli(process.argv.slice(2));
  const command = positionals[0];

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "config") {
    await handleConfig(positionals, options);
    return;
  }

  if (command === "preview") {
    await handlePreview(positionals, options);
    return;
  }

  if (command === "run") {
    await handleRun(positionals, options);
    return;
  }

  fail(`Unknown command "${command}".`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
