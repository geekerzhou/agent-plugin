---
description: Show Cursor agent job queue and progress for this repository
argument-hint: '[job-id] [--all] [--wait] [--timeout-ms <n>] [--poll-interval-ms <n>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" status --json $ARGUMENTS
```

Omit `--json` when the user asked for a human-readable report only.
