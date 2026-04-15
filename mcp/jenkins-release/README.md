# jenkins-release-mcp

Minimal MCP server for Jenkins release and rebuild workflows.

## What It Exposes

- `jenkins_set_config`
- `jenkins_get_config`
- `jenkins_clear_config`
- `jenkins_test_config`
- `jenkins_get_job_info`
- `jenkins_preview_job`
- `jenkins_trigger_job`
- `jenkins_preview_rebuild_last`
- `jenkins_trigger_rebuild_last`

The execution contract is confirmation-first:

- preview tools only inspect and summarize
- trigger tools require `confirmed=true`

## Local Run

```bash
cd mcp/jenkins-release
npm install
node server.mjs
```

## Config Sources

Saved config:

- `url`
- `user`
- optional saved `token`
- optional `tokenEnvVar`

Environment overrides:

- `JENKINS_RELEASE_MCP_URL`
- `JENKINS_RELEASE_MCP_USER`
- `JENKINS_API_KEY` by default

## Example MCP Client Config

```json
{
  "mcpServers": {
    "jenkins-release": {
      "command": "npx",
      "args": ["-y", "jenkins-release-mcp"],
      "env": {
        "JENKINS_RELEASE_MCP_URL": "https://jenkins.dev.micun.cn",
        "JENKINS_RELEASE_MCP_USER": "zhouliyuan1",
        "JENKINS_API_KEY": "your-token"
      }
    }
  }
}
```

## Publish

If you want others to install it by package name:

```bash
cd mcp/jenkins-release
npm publish
```

If you do not want to publish yet, users can also point their MCP client directly at:

```bash
node /absolute/path/to/mcp/jenkins-release/server.mjs
```
