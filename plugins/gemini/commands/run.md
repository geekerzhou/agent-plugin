---
description: Run Gemini CLI in headless mode (-p) from this repo
argument-hint: '[--background] [--write|--force|--yolo] [--model <id>] [--output-format text|json] [prompt]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" run --json "$ARGUMENTS"
```

Notes:

- Wraps official **headless** usage: `gemini -p "..."`. See https://google-gemini.github.io/gemini-cli/docs/cli/headless.html
- Use **`--write`**, **`--force`**, or **`--yolo`** when the user wants tool actions auto-approved (`gemini --yolo`).
- **`--output-format`** supports **`text`** or **`json`** only (JSON is passed through; human-facing output uses the `response` field when present).
- Omit `--json` if the user asked for markdown-only output.

Output rules:

- Do not paraphrase, summarize, rewrite, or add commentary.
- Show the CLI result to the user exactly as returned.
- If `--background` was used, mention job id and `/gemini:status` / `/gemini:result`.
