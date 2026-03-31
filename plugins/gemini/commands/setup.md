---
description: Check whether Gemini CLI is installed and auth is configured (env-based detection)
argument-hint: '[--json]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Output rules:

- Summarize checks for the user.
- If `gemini` is missing, suggest `npm install -g @google/gemini-cli` and https://google-gemini.github.io/gemini-cli/docs/get-started/
- If auth is not detected via env vars, explain that **Google login** may still work after running `gemini` interactively once (cached credentials for headless). Link: https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html
