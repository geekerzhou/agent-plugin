---
description: Check whether the local Gemini CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

If the result says Gemini CLI is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Gemini CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Gemini CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @google/gemini-cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

If Gemini CLI is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Gemini CLI is installed but auth is not detected via environment variables, preserve the guidance about setting GEMINI_API_KEY or running `gemini` once interactively for Google login.
