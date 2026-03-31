---
description: Show the stored output for a finished Gemini CLI job
argument-hint: '[job-id] [--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result --json $ARGUMENTS
```

Omit `--json` when the user asked for raw output only.
