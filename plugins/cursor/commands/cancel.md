---
description: Cancel a queued or running Cursor agent job
argument-hint: '[job-id] [--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" cancel --json $ARGUMENTS
```

Omit `--json` when the user asked for a short confirmation only.
