---
description: Cancel a queued or running Gemini CLI job
argument-hint: '[job-id] [--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" cancel --json $ARGUMENTS
```

Omit `--json` when the user asked for a short confirmation only.
