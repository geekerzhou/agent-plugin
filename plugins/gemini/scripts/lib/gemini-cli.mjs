import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { binaryAvailable } from "./process.mjs";
import { readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./state.mjs";

/**
 * @typedef {Object} GeminiRunResult
 * @property {number} status The exit code of the Gemini process.
 * @property {string} stdout The standard output of the process.
 * @property {string} stderr The standard error of the process.
 */

/**
 * @typedef {Object} GeminiAvailability
 * @property {boolean} available Whether the Gemini binary is available.
 * @property {string} [detail] Optional detail message about the availability.
 */

/**
 * @typedef {Object} GeminiAuthSummary
 * @property {boolean} configured Whether the authentication is configured via environment variables.
 * @property {string} detail Detailed information about the authentication configuration.
 */

/**
 * @typedef {Object} GeminiAuthStatus
 * @property {boolean} available Whether the Gemini binary is available.
 * @property {boolean} authenticated Whether the user is authenticated (or configured).
 * @property {string} [detail] Detailed information about the status.
 */

/**
 * @typedef {Object} GeminiRuntimeSummary
 * @property {string} label The summary label indicating the type of runtime or auth.
 * @property {string} detail Detailed information about the runtime configuration.
 */

/**
 * Resolves the Gemini CLI binary path from the environment.
 * @param {NodeJS.ProcessEnv} [env=process.env] The environment variables object.
 * @returns {string} The resolved Gemini binary name or path.
 */
export function resolveGeminiBinary(env = process.env) {
  const override = String(env.GEMINI_CLI_BIN ?? "").trim();
  return override || "gemini";
}

/**
 * Checks if the Gemini CLI binary is available in the given working directory.
 * @param {string} [cwd] The current working directory to check from.
 * @returns {GeminiAvailability} An object describing the availability of the Gemini binary.
 */
export function getGeminiAvailability(cwd) {
  const bin = resolveGeminiBinary();
  return binaryAvailable(bin, ["--version"], { cwd });
}

/**
 * Heuristic: env-based auth for headless / CI. Cached OAuth from interactive `gemini` is not detectable here.
 * @param {NodeJS.ProcessEnv} [env=process.env] The environment variables object.
 * @returns {GeminiAuthSummary} An object summarizing the configured authentication.
 */
export function getConfiguredAuthSummary(env = process.env) {
  if (String(env.GEMINI_API_KEY ?? "").trim()) {
    return { configured: true, detail: "GEMINI_API_KEY is set" };
  }

  const vertex = String(env.GOOGLE_GENAI_USE_VERTEXAI ?? "").toLowerCase() === "true";
  if (vertex && String(env.GOOGLE_API_KEY ?? "").trim()) {
    return { configured: true, detail: "Vertex AI: GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_API_KEY" };
  }
  if (vertex && String(env.GOOGLE_CLOUD_PROJECT ?? "").trim() && String(env.GOOGLE_CLOUD_LOCATION ?? "").trim()) {
    return {
      configured: true,
      detail: "Vertex AI: GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT/LOCATION (ADC or service account)"
    };
  }

  if (String(env.GOOGLE_APPLICATION_CREDENTIALS ?? "").trim()) {
    return { configured: true, detail: "GOOGLE_APPLICATION_CREDENTIALS is set" };
  }

  return {
    configured: false,
    detail:
      "No GEMINI_API_KEY or Vertex env detected. Interactive Google login may still work if you already ran `gemini` once (cached credentials)."
  };
}

/**
 * Gets the overall Gemini authentication status.
 * @param {string} [cwd] The current working directory.
 * @returns {GeminiAuthStatus} An object representing the overall authentication and availability status.
 */
export function getGeminiAuthStatus(cwd) {
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      authenticated: false,
      detail: availability.detail
    };
  }

  const summary = getConfiguredAuthSummary();
  return {
    available: true,
    authenticated: summary.configured,
    detail: summary.detail
  };
}

/**
 * Gets a runtime summary for the Gemini CLI based on the environment.
 * @param {NodeJS.ProcessEnv} [env=process.env] The environment variables object.
 * @returns {GeminiRuntimeSummary} An object containing the runtime summary label and details.
 */
export function getGeminiRuntimeSummary(env = process.env) {
  const summary = getConfiguredAuthSummary(env);
  if (summary.configured) {
    return {
      label: "env / vertex",
      detail: summary.detail
    };
  }
  return {
    label: "interactive or cached",
    detail: summary.detail
  };
}

/**
 * Persists the child process ID associated with a job to the workspace job state.
 * @param {string} [workspaceRoot] The root directory of the workspace.
 * @param {string} [jobId] The unique identifier for the job.
 * @param {number} [pid] The process ID to persist.
 * @returns {void}
 */
function persistChildPid(workspaceRoot, jobId, pid) {
  if (!workspaceRoot || !jobId || !Number.isFinite(pid)) {
    return;
  }
  try {
    upsertJob(workspaceRoot, { id: jobId, childPid: pid });
    const jobFile = resolveJobFile(workspaceRoot, jobId);
    if (fs.existsSync(jobFile)) {
      const stored = readJobFile(jobFile);
      writeJobFile(workspaceRoot, jobId, { ...stored, childPid: pid });
    }
  } catch {
    // best-effort for cancel
  }
}

/**
 * Options for running Gemini print command.
 * @typedef {Object} GeminiPrintOptions
 * @property {string} cwd The current working directory.
 * @property {string} prompt The prompt to pass to Gemini.
 * @property {boolean} [yolo] Whether to bypass confirmations.
 * @property {string|null} [model] The model to use.
 * @property {'text'|'json'} [outputFormat] The expected output format.
 * @property {((msg: string) => void)|null} [onProgress] Callback for progress updates.
 * @property {string} [workspaceRoot] The workspace root directory.
 * @property {string|null} [jobId] The job identifier.
 */

/**
 * Headless Gemini CLI: `gemini -p "..."` (see https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)
 * @param {GeminiPrintOptions} options The options for running Gemini.
 * @returns {Promise<GeminiRunResult>} A promise that resolves to the result of the run.
 */
export function runGeminiPrint(options) {
  const {
    cwd,
    prompt,
    yolo = false,
    model = null,
    outputFormat = "text",
    onProgress = null,
    workspaceRoot,
    jobId
  } = options;

  const bin = resolveGeminiBinary();
  const args = ["-p", prompt];
  if (outputFormat === "json") {
    args.push("--output-format", "json");
  }
  if (model && String(model).trim()) {
    args.push("-m", String(model).trim());
  }
  if (yolo) {
    args.push("--yolo");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    if (typeof child.pid === "number" && Number.isFinite(child.pid)) {
      persistChildPid(workspaceRoot ?? "", jobId ?? "", child.pid);
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      const text = String(chunk).trimEnd();
      if (text && onProgress) {
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          onProgress(line);
        }
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      const exitStatus = typeof code === "number" ? code : signal ? 1 : 0;
      resolve({
        status: exitStatus,
        stdout,
        stderr
      });
    });
  });
}
