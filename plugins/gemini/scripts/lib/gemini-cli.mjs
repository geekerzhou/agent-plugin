import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { binaryAvailable } from "./process.mjs";
import { readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./state.mjs";

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveGeminiBinary(env = process.env) {
  const override = String(env.GEMINI_CLI_BIN ?? "").trim();
  return override || "gemini";
}

export function getGeminiAvailability(cwd) {
  const bin = resolveGeminiBinary();
  return binaryAvailable(bin, ["--version"], { cwd });
}

/**
 * Heuristic: env-based auth for headless / CI. Cached OAuth from interactive `gemini` is not detectable here.
 * @param {NodeJS.ProcessEnv} [env]
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
 * Headless Gemini CLI: `gemini -p "..."` (see https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)
 * @param {{
 *   cwd: string,
 *   prompt: string,
 *   yolo?: boolean,
 *   model?: string | null,
 *   outputFormat?: 'text' | 'json',
 *   onProgress?: ((msg: string) => void) | null,
 *   workspaceRoot?: string,
 *   jobId?: string | null
 * }} options
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
