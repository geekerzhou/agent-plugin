# agent-plugin

个人 **Claude Code 插件市场** 仓库：在根目录用 `.claude-plugin/marketplace.json` 描述多个插件，每个插件放在 `plugins/<id>/` 下。

## 目录约定

```text
agent-plugin/
├── .claude-plugin/
│   └── marketplace.json    # 市场清单：name、owner、plugins[]（每项指向 ./plugins/...）
├── plugins/
│   └── <plugin-id>/
│       ├── .claude-plugin/
│       │   └── plugin.json # 单个插件元数据（name 与 marketplace 里 plugins[].name 一致）
│       ├── commands/       # 可选：斜杠命令，*.md 前置 YAML
│       ├── scripts/        # 可选：node 脚本等
│       └── ...
└── README.md
```

新增插件时：

1. 在 `plugins/` 下新建目录，并放入 `.claude-plugin/plugin.json`（及 `commands/`、`scripts/` 等）。
2. 在 `.claude-plugin/marketplace.json` 的 `plugins` 数组中增加一项，`source` 写相对路径，例如 `"./plugins/my-plugin"`。
3. 酌情提高 `metadata.version`，提交并推送到 GitHub。

## Claude Code 使用方式

把本仓库加入市场并安装 **cursor** 插件（市场名为 `agent-plugin`，与 `marketplace.json` 顶层 `name` 一致）：

```bash
/plugin marketplace add geekerzhou/agent-plugin
/plugin install cursor@agent-plugin
/plugin install gemini@agent-plugin
/reload-plugins
/cursor:setup
/gemini:setup
```

说明：

- **cursor**：依赖本机 Cursor CLI（`agent`），见插件内 `commands/setup.md`。
- **gemini**：依赖本机 Gemini CLI（`gemini`，通常 `npm i -g @google/gemini-cli`），见 [官方文档](https://google-gemini.github.io/gemini-cli/docs/get-started/)。

## 当前插件

| 插件 ID | 说明 |
|--------|------|
| `cursor` | 调用 Cursor CLI 的 headless `agent -p`，支持后台任务与 `status` / `result` / `cancel`。 |
| `gemini` | 调用 Google Gemini CLI 的 headless `gemini -p`，`--write`/`--yolo` 映射为 `--yolo`；支持 `text`/`json` 输出与后台任务。 |
