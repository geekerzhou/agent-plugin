---
description: Delegate investigation or fix request to the Gemini rescue subagent
argument-hint: "[--background|--wait] [--model <model>] [what Gemini should investigate or fix]"
context: fork
allowed-tools: Bash(node:*)
---

Route this request to the `gemini:gemini-rescue` subagent.
The final user-visible response must be the Gemini CLI's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `gemini:gemini-rescue` subagent in the background.
- If the request includes `--wait`, run the `gemini:gemini-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to the run command, and do not treat them as part of the natural-language task text.
- `--model` is a runtime-selection flag. Preserve it for the forwarded run call, but do not treat it as part of the natural-language task text.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" run ...` and return that command's stdout as-is.
- Return the Gemini CLI stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/gemini:status`, fetch `/gemini:result`, call `/gemini:cancel`, summarize output, or do follow-up work of its own.
- If the agent reports that Gemini CLI is missing or unauthenticated, stop and tell the user to run `/gemini:setup`.
- If the user did not supply a request, ask what Gemini should investigate or fix.
