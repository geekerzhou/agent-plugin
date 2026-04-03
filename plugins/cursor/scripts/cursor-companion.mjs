#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getAgentAuthStatus,
  getAgentAvailability,
  getCursorRuntimeSummary,
  resolveAgentBinary,
  runAgentPrint
} from "./lib/cursor-agent.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderQueuedTaskLaunch,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/cursor-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/cursor-companion.mjs run [--background] [--write|--force] [--model <id>] [--output-format text|json|stream-json] [--prompt-file <path>] [prompt]",
      "  node scripts/cursor-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/cursor-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]",
      "  node scripts/cursor-companion.mjs status [job-id] [--all] [--json] [--wait] [--timeout-ms <n>] [--poll-interval-ms <n>]",
      "  node scripts/cursor-companion.mjs result [job-id] [--json]",
      "  node scripts/cursor-companion.mjs cancel [job-id] [--json]",
      "  node scripts/cursor-companion.mjs task-resume-candidate [--json]",
      "",
      "Environment:",
      "  CURSOR_AGENT_BIN   Override CLI binary (default: agent)",
      "  CURSOR_API_KEY     API key for headless runs (optional if `agent login` is done)"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function readOutputSchema(schemaPath) {
  if (!fs.existsSync(schemaPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function parseStructuredOutput(rawText, fallback = {}) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return {
      parsed: null,
      rawOutput: text,
      parseError: fallback.failureMessage || "No output from agent."
    };
  }

  const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = jsonMatch ? jsonMatch[1].trim() : text;

  try {
    const parsed = JSON.parse(candidate);
    return { parsed, rawOutput: text, parseError: null };
  } catch (error) {
    return {
      parsed: null,
      rawOutput: text,
      parseError: `JSON parse error: ${error.message}`
    };
  }
}

function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const bin = resolveAgentBinary();
  const agentStatus = getAgentAvailability(cwd);
  const authStatus = getAgentAuthStatus(cwd);
  const cursorRuntime = getCursorRuntimeSummary();
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (!agentStatus.available) {
    nextSteps.push("Install Cursor CLI: https://cursor.com/docs/cli/installation");
    nextSteps.push('Or run: curl https://cursor.com/install -fsS | bash');
  }
  if (agentStatus.available && !authStatus.authenticated) {
    nextSteps.push("Run `!agent login` in the terminal, or set CURSOR_API_KEY for automation.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/cursor:setup --enable-review-gate` to require a fresh review before stop.");
  }

  return {
    ready: nodeStatus.available && agentStatus.available && authStatus.authenticated,
    node: nodeStatus,
    agent: {
      binary: bin,
      ...agentStatus
    },
    auth: {
      detail: authStatus.detail,
      authenticated: authStatus.authenticated
    },
    cursorRuntime,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function ensureAgentReady(cwd) {
  const availability = getAgentAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Cursor CLI (`agent`) is not available. Install from https://cursor.com/docs/cli/installation then rerun `/cursor:setup`."
    );
  }
  const auth = getAgentAuthStatus(cwd);
  if (!auth.authenticated) {
    throw new Error("Cursor CLI is not authenticated. Run `!agent login` or set CURSOR_API_KEY.");
  }
}

function parseOutputFormat(value) {
  if (value == null) {
    return "text";
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "text") {
    return "text";
  }
  if (normalized === "json" || normalized === "stream-json") {
    return normalized;
  }
  throw new Error(`Unsupported --output-format "${value}". Use text, json, or stream-json.`);
}

async function executeAgentRun(request) {
  const outputFormat = parseOutputFormat(request.outputFormat);
  const result = await runAgentPrint({
    cwd: request.cwd,
    prompt: request.prompt,
    force: Boolean(request.write),
    model: request.model,
    outputFormat,
    workspaceRoot: request.workspaceRoot,
    jobId: request.jobId,
    onProgress: request.onProgress ?? null
  });

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "").trim();
  const rawOutput = stdout.trimEnd();
  const failureMessage = result.status !== 0 ? stderr || `agent exited with code ${result.status}` : "";

  const displayOutput =
    rawOutput || (stderr && result.status === 0 ? stderr : "");

  return {
    exitStatus: result.status,
    payload: {
      status: result.status,
      rawOutput,
      stderr
    },
    rendered: renderTaskResult(
      { rawOutput: displayOutput, failureMessage },
      { title: request.title, jobId: request.jobId ?? null, write: Boolean(request.write) }
    ),
    summary: firstMeaningfulLine(rawOutput || stderr, "Cursor agent run finished.")
  };
}

function buildAdversarialReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.content
  });
}

async function executeReviewRun(request) {
  ensureAgentReady(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const context = collectReviewContext(request.cwd, target);

  let prompt;
  if (reviewName === "Adversarial Review") {
    prompt = buildAdversarialReviewPrompt(context, focusText);
  } else {
    const template = loadPromptTemplate(ROOT_DIR, "review");
    prompt = interpolateTemplate(template, {
      TARGET_LABEL: context.target.label,
      REVIEW_INPUT: context.content
    });
  }

  const schemaText = readOutputSchema(REVIEW_SCHEMA);
  const schemaInstruction = schemaText
    ? `\n\nReturn your response as valid JSON matching this schema:\n${JSON.stringify(schemaText, null, 2)}`
    : "";

  const result = await runAgentPrint({
    cwd: context.repoRoot,
    prompt: prompt + schemaInstruction,
    force: false,
    model: request.model ?? null,
    outputFormat: "text",
    workspaceRoot: context.repoRoot,
    jobId: request.jobId,
    onProgress: request.onProgress ?? null
  });

  const rawOutput = String(result.stdout ?? "").trimEnd();
  const stderr = String(result.stderr ?? "").trim();
  const parsed = parseStructuredOutput(rawOutput, {
    status: result.status,
    failureMessage: stderr
  });

  const payload = {
    review: reviewName,
    target,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };

  return {
    exitStatus: result.status,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label,
      reasoningSummary: null
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(rawOutput, `${reviewName} finished.`),
    jobTitle: `Cursor ${reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Cursor Review" : `Cursor ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function getJobKindLabel(kind, jobClass) {
  if (kind === "adversarial-review") {
    return "adversarial-review";
  }
  return jobClass === "review" ? "review" : "task";
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

function readRunPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }

  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(SCRIPT_DIR, "cursor-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd, job, request) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function handleRun(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "prompt-file", "output-format"],
    booleanOptions: ["json", "write", "force", "background"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const prompt = readRunPrompt(cwd, options, positionals);
  const write = Boolean(options.write || options.force);
  const model = options.model ? String(options.model).trim() : null;
  const outputFormat = options["output-format"] ?? "text";

  if (!prompt.trim()) {
    throw new Error("Provide a prompt, use --prompt-file, or pipe stdin.");
  }

  const title = "Cursor Agent";
  const summary = shorten(prompt);
  const job = createCompanionJob({
    prefix: "task",
    kind: "task",
    title,
    workspaceRoot,
    jobClass: "task",
    summary,
    write
  });

  if (options.background) {
    ensureAgentReady(cwd);
    const request = {
      cwd,
      workspaceRoot,
      prompt,
      write,
      model,
      outputFormat,
      jobId: job.id,
      title
    };
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch({ ...payload, title }), options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) =>
      executeAgentRun({
        cwd,
        workspaceRoot,
        prompt,
        write,
        model,
        outputFormat,
        jobId: job.id,
        title,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope
  });

  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        model: options.model,
        focusText,
        reviewName: config.reviewName,
        jobId: job.id,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Review"
  });
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for task-worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its request payload.`);
  }

  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    },
    {
      logFile: storedJob.logFile ?? null
    }
  );

  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    },
    () =>
      executeAgentRun({
        ...request,
        onProgress: progress
      }),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const payload = {
    available: false,
    reason: "Cursor CLI does not support thread resumption."
  };
  const rendered = "No resumable task available. Cursor CLI does not support threads.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  const childPid = existing.childPid ?? job.childPid ?? null;
  const workerPid = existing.pid ?? job.pid ?? null;

  if (Number.isFinite(childPid)) {
    terminateProcessTree(childPid);
  }
  if (Number.isFinite(workerPid) && workerPid !== childPid) {
    terminateProcessTree(workerPid);
  }

  appendLogLine(job.logFile, "Cancelled by user.");

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    childPid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    childPid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "run":
      await handleRun(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
