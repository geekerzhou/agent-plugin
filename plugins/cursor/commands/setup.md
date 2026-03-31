---
description: Check whether the Cursor CLI (agent) is installed and authenticated
argument-hint: '[--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" setup --json $ARGUMENTS
```

Output rules:

- Present the setup summary to the user.
- If the CLI is missing, point them to https://cursor.com/docs/cli/installation
- If the CLI is present but not authenticated, tell them to run `!agent login` or set `CURSOR_API_KEY` (see Cursor CLI authentication docs).
