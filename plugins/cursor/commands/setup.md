---
description: Check whether the local Cursor CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" setup --json $ARGUMENTS
```

If the result says the agent CLI is unavailable:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Cursor CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Cursor CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
curl -fsS https://cursor.com/install | bash
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" setup --json $ARGUMENTS
```

If the agent CLI is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If the CLI is installed but not authenticated, preserve the guidance to run `!agent login`.
- Do not paraphrase, summarize, rewrite, or add commentary.
