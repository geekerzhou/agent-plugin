---
description: Run Cursor CLI agent in headless print mode (-p) from this repo
argument-hint: '[--background] [--write|--force] [--model <id>] [--output-format text|json|stream-json] [prompt]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" run --json "$ARGUMENTS"
```

Notes:

- This wraps the official Cursor CLI **print mode** (`agent -p`). See https://cursor.com/docs/cli/headless
- Use `--write` or `--force` when the user wants the agent to apply file changes (`agent -p --force`).
- Omit `--json` if the user asked for raw markdown-only output.

Output rules:

- Show the agent stdout result to the user.
- Mention the job id when `--background` was used (`/cursor:status`, `/cursor:result`, `/cursor:cancel`).
- Do not paraphrase, summarize, rewrite, or add commentary.
