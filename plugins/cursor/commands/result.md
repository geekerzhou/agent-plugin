---
description: Show the stored output for a finished Cursor agent job
argument-hint: '[job-id] [--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" result --json $ARGUMENTS
```

Omit `--json` when the user asked for raw output only.
