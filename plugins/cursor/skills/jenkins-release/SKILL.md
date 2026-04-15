---
name: jenkins-release
description: Configure a Jenkins base URL and user credentials, preview a Jenkins job with parameters, ask the user for explicit confirmation, then trigger the job only after confirmation
user-invocable: true
---

# Jenkins Release

Use this skill when the user wants to configure Jenkins access or trigger a Jenkins job.

Helper script:

- `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" ...`

What this skill supports:

- Save Jenkins base URL and username locally.
- Read Jenkins API token from saved config or the `JENKINS_API_KEY` environment variable.
- Show the current saved config with the token masked.
- Preview the job name and parameters before execution.
- Trigger a Jenkins job only after the user explicitly confirms.

Commands:

- Configure credentials:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" config set --url "<jenkins-url>" --user "<username>" --token "<api-token>"`
- Configure without storing the token and use `JENKINS_API_KEY` instead:
  `source ~/.bash_profile && node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" config set --url "https://jenkins.dev.micun.cn" --user "<username>"`
- Show current config:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" config show`
- Clear saved config:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" config clear`
- Test saved config:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" config test`
- Preview a job:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" preview --job "<job-name>" --param KEY=VALUE --param KEY2=VALUE2`
- Run a job after confirmation:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/jenkins-release/scripts/jenkins-release.mjs" run --confirmed --job "<job-name>" --param KEY=VALUE`

Working rules:

- Do not trigger Jenkins directly on the first request.
- Always collect or confirm these fields before execution:
  - Jenkins base URL
  - Jenkins username
  - Jenkins API token source
    Use saved token or `JENKINS_API_KEY`.
  - Jenkins base URL
  - Jenkins job name
  - Jenkins job parameters
- If config is missing, ask the user for the missing fields or run `config set`.
- Prefer `https://jenkins.dev.micun.cn` when the user did not provide another Jenkins address.
- If the environment token is expected, run commands under `source ~/.bash_profile && ...` so `JENKINS_API_KEY` is available in the current shell.
- Before execution, call `preview` and show the user:
  - Jenkins address
  - Jenkins user
  - Token source
  - Job name
  - Parameter list
- After preview, explicitly ask whether to execute the job.
- Only call `run --confirmed` after the user clearly confirms.
- If the user changes the job name or parameters after preview, preview again before running.
- Never echo the raw token back to the user.

Response style:

- Be direct and compact.
- For preview, show the exact job name and each parameter on its own line.
- For execution, return the queue URL and any build URL if Jenkins returns one.
