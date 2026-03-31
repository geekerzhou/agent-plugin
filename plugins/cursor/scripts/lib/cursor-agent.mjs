import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { binaryAvailable, runCommand } from "./process.mjs";
import { readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./state.mjs";

function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\u001b\[[\d;]*[A-Za-z]/g, "")
    .replace(/\u001b\[\d*[A-JKSTfm]/g, "")
    .replace(/\u001b\[?[?0-9;]*[hl]/g, "")
    .replace(/\r/g, "")
    .trim();
}

/**
 * Resolve the Cursor CLI binary. Official docs use `agent`; override with CURSOR_AGENT_BIN.
 * @returns {string}
 */
export function resolveAgentBinary() {
  const override = String(process.env.CURSOR_AGENT_BIN ?? "").trim();
  return override || "agent";
}

export function getAgentAvailability(cwd) {
  const bin = resolveAgentBinary();
  return binaryAvailable(bin, ["--version"], { cwd });
}

export function hasApiKeyInEnv(env = process.env) {
  return Boolean(String(env.CURSOR_API_KEY ?? "").trim());
}

/**
 * Uses `agent status` when available (see Cursor CLI auth docs).
 * @param {string} cwd
 */
export function getAgentAuthStatus(cwd) {
  const availability = getAgentAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      authenticated: false,
      detail: availability.detail
    };
  }

  if (hasApiKeyInEnv()) {
    return {
      available: true,
      authenticated: true,
      detail: "CURSOR_API_KEY is set"
    };
  }

  const bin = resolveAgentBinary();
  const result = runCommand(bin, ["status"], { cwd });
  if (result.error) {
    return {
      available: true,
      authenticated: false,
      detail: result.error.message
    };
  }

  if (result.status === 0) {
    const combined = stripAnsi(`${result.stdout}\n${result.stderr}`);
    return {
      available: true,
      authenticated: true,
      detail: combined || "authenticated"
    };
  }

  const failureDetail = stripAnsi(`${result.stderr}\n${result.stdout}`) || "not authenticated";
  return {
    available: true,
    authenticated: false,
    detail: failureDetail
  };
}

export function getCursorRuntimeSummary(env = process.env) {
  if (hasApiKeyInEnv(env)) {
    return {
      label: "api key",
      detail: "CURSOR_API_KEY is present in the environment."
    };
  }
  return {
    label: "local login",
    detail: "Using stored credentials from `agent login` when no API key is set."
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
 * Run Cursor CLI in print (headless) mode.
 * @param {{
 *   cwd: string,
 *   prompt: string,
 *   force?: boolean,
 *   model?: string | null,
 *   outputFormat?: 'text' | 'json' | 'stream-json',
 *   onProgress?: ((msg: string) => void) | null,
 *   workspaceRoot?: string,
 *   jobId?: string | null
 * }} options
 */
export function runAgentPrint(options) {
  const {
    cwd,
    prompt,
    force = false,
    model = null,
    outputFormat = "text",
    onProgress = null,
    workspaceRoot,
    jobId
  } = options;

  const bin = resolveAgentBinary();
  const args = ["-p"];
  if (force) {
    args.push("--force");
  }
  if (outputFormat && outputFormat !== "text") {
    args.push("--output-format", outputFormat);
  }
  if (model && String(model).trim()) {
    args.push("--model", String(model).trim());
  }
  args.push(prompt);

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
