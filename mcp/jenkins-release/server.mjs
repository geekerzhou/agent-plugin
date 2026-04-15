#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  clearStoredConfig,
  getEffectiveConfig,
  getJobInfo,
  getStoredConfig,
  maskSecret,
  previewRebuildLast,
  requestJson,
  requireConfig,
  setStoredConfig,
  triggerJob,
  triggerRebuildLast
} from "./lib/jenkins-client.mjs";

const server = new McpServer({
  name: "jenkins-release-mcp",
  version: "0.1.0"
});

const parametersSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

function textResult(text, structuredContent) {
  return structuredContent
    ? {
        content: [{ type: "text", text }],
        structuredContent
      }
    : {
        content: [{ type: "text", text }]
      };
}

function errorResult(message, structuredContent) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    structuredContent,
    isError: true
  };
}

function formatParameters(parameters) {
  const entries = Object.entries(parameters || {});
  if (entries.length === 0) {
    return "- (none)";
  }
  return entries.map(([key, value]) => `- ${key}=${value}`).join("\n");
}

function formatConfig(config, storedConfig) {
  return [
    "# Jenkins Config",
    "",
    `- URL: ${config.url || "(not set)"}`,
    `- User: ${config.user || "(not set)"}`,
    `- Token source: ${config.tokenSource}`,
    `- Token env var: ${config.tokenEnvVar}`,
    `- Saved token: ${storedConfig.token ? maskSecret(storedConfig.token) : "(not set)"}`,
    `- Effective token: ${config.token ? maskSecret(config.token) : "(not set)"}`
  ].join("\n");
}

server.tool(
  "jenkins_set_config",
  {
    url: z.string().url().optional().describe("Jenkins base URL. Defaults to https://jenkins.dev.micun.cn."),
    user: z.string().min(1).optional().describe("Jenkins username."),
    token: z.string().optional().describe("Optional Jenkins API token to save locally."),
    tokenEnvVar: z.string().optional().describe("Environment variable name to read the token from. Defaults to JENKINS_API_KEY.")
  },
  async ({ url, user, token, tokenEnvVar }) => {
    try {
      const stored = setStoredConfig({ url, user, token, tokenEnvVar });
      const effective = getEffectiveConfig();
      return textResult(formatConfig(effective, stored), {
        storedConfig: {
          url: stored.url,
          user: stored.user,
          tokenSaved: Boolean(stored.token),
          tokenEnvVar: stored.tokenEnvVar || "JENKINS_API_KEY"
        },
        effectiveConfig: {
          url: effective.url,
          user: effective.user,
          tokenSource: effective.tokenSource,
          tokenEnvVar: effective.tokenEnvVar
        }
      });
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

server.tool("jenkins_get_config", {}, async () => {
  try {
    const stored = getStoredConfig();
    const effective = getEffectiveConfig();
    return textResult(formatConfig(effective, stored), {
      storedConfig: {
        url: stored.url || null,
        user: stored.user || null,
        tokenSaved: Boolean(stored.token),
        tokenEnvVar: stored.tokenEnvVar || "JENKINS_API_KEY"
      },
      effectiveConfig: {
        url: effective.url || null,
        user: effective.user || null,
        tokenSource: effective.tokenSource,
        tokenEnvVar: effective.tokenEnvVar
      }
    });
  } catch (error) {
    return errorResult(error.message);
  }
});

server.tool("jenkins_clear_config", {}, async () => {
  try {
    clearStoredConfig();
    return textResult("# Jenkins Config Cleared");
  } catch (error) {
    return errorResult(error.message);
  }
});

server.tool("jenkins_test_config", {}, async () => {
  try {
    const config = requireConfig();
    const data = await requestJson(config, "whoAmI/api/json");
    const payload = {
      url: config.url,
      user: config.user,
      tokenSource: config.tokenSource,
      authenticatedAs: data?.name || config.user,
      anonymous: Boolean(data?.anonymous)
    };
    return textResult(
      [
        "# Jenkins Config Test",
        "",
        `- URL: ${payload.url}`,
        `- User: ${payload.user}`,
        `- Token source: ${payload.tokenSource}`,
        `- Authenticated as: ${payload.authenticatedAs}`,
        `- Anonymous: ${payload.anonymous}`
      ].join("\n"),
      payload
    );
  } catch (error) {
    return errorResult(error.message);
  }
});

server.tool(
  "jenkins_get_job_info",
  {
    job: z.string().min(1).describe("Jenkins job name. Folder jobs use slash syntax, for example team/service/deploy.")
  },
  async ({ job }) => {
    try {
      const config = requireConfig();
      const info = await getJobInfo(config, job);
      return textResult(
        [
          "# Jenkins Job",
          "",
          `- Job: ${info.job}`,
          `- URL: ${info.url || "(not returned)"}`,
          `- Buildable: ${info.buildable}`,
          `- Last build: ${info.lastBuild?.number || "(none)"}`,
          `- Last completed build: ${info.lastCompletedBuild?.number || "(none)"}`,
          `- Last completed result: ${info.lastCompletedBuild?.result || "(none)"}`,
          "- Parameters:",
          ...(info.parameterDefinitions.length
            ? info.parameterDefinitions.map((parameter) => `- ${parameter.name} (${parameter.type})`)
            : ["- (none)"])
        ].join("\n"),
        info
      );
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

server.tool(
  "jenkins_preview_job",
  {
    job: z.string().min(1).describe("Jenkins job name."),
    parameters: parametersSchema.describe("Parameters to pass to the job.")
  },
  async ({ job, parameters }) => {
    try {
      const config = requireConfig();
      const info = await getJobInfo(config, job);
      const preview = {
        url: config.url,
        user: config.user,
        tokenSource: config.tokenSource,
        job: info.job,
        parameters: parameters || {}
      };
      return textResult(
        [
          "# Jenkins Task Preview",
          "",
          `- URL: ${preview.url}`,
          `- User: ${preview.user}`,
          `- Token source: ${preview.tokenSource}`,
          `- Job: ${preview.job}`,
          "- Parameters:",
          formatParameters(preview.parameters),
          "",
          "Execution is not started yet.",
          "Call jenkins_trigger_job with confirmed=true to execute."
        ].join("\n"),
        preview
      );
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

server.tool(
  "jenkins_trigger_job",
  {
    job: z.string().min(1).describe("Jenkins job name."),
    parameters: parametersSchema.describe("Parameters to pass to the job."),
    confirmed: z.boolean().default(false).describe("Must be true to execute the job.")
  },
  async ({ job, parameters, confirmed }) => {
    try {
      if (!confirmed) {
        return errorResult("Execution requires confirmed=true. Preview first, then call again with confirmation.");
      }
      const config = requireConfig();
      const result = await triggerJob(config, job, parameters || {});
      return textResult(
        [
          "# Jenkins Task Triggered",
          "",
          `- Job: ${result.job}`,
          `- Endpoint: ${result.endpoint}`,
          `- Token source: ${result.tokenSource}`,
          `- Queue URL: ${result.queueUrl || "(not returned)"}`,
          `- Build URL: ${result.buildUrl || "(not available yet)"}`,
          `- Build number: ${result.buildNumber || "(not available yet)"}`
        ].join("\n"),
        result
      );
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

server.tool(
  "jenkins_preview_rebuild_last",
  {
    job: z.string().min(1).describe("Jenkins job name.")
  },
  async ({ job }) => {
    try {
      const config = requireConfig();
      const preview = await previewRebuildLast(config, job);
      return textResult(
        [
          "# Jenkins Rebuild Preview",
          "",
          `- Job: ${preview.job}`,
          `- Last build: #${preview.lastBuildNumber}`,
          `- Last build result: ${preview.lastBuildResult || "(unknown)"}`,
          `- Last build URL: ${preview.lastBuildUrl || "(not returned)"}`,
          "- Parameters:",
          formatParameters(preview.parameters),
          "",
          "Execution is not started yet.",
          "Call jenkins_trigger_rebuild_last with confirmed=true to execute."
        ].join("\n"),
        preview
      );
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

server.tool(
  "jenkins_trigger_rebuild_last",
  {
    job: z.string().min(1).describe("Jenkins job name."),
    confirmed: z.boolean().default(false).describe("Must be true to execute the rebuild.")
  },
  async ({ job, confirmed }) => {
    try {
      if (!confirmed) {
        return errorResult("Execution requires confirmed=true. Preview first, then call again with confirmation.");
      }
      const config = requireConfig();
      const result = await triggerRebuildLast(config, job);
      return textResult(
        [
          "# Jenkins Rebuild Triggered",
          "",
          `- Job: ${result.preview.job}`,
          `- Rebuilt from last build: #${result.preview.lastBuildNumber}`,
          `- Queue URL: ${result.trigger.queueUrl || "(not returned)"}`,
          `- Build URL: ${result.trigger.buildUrl || "(not available yet)"}`,
          `- Build number: ${result.trigger.buildNumber || "(not available yet)"}`,
          "- Parameters:",
          formatParameters(result.preview.parameters)
        ].join("\n"),
        result
      );
    } catch (error) {
      return errorResult(error.message);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
