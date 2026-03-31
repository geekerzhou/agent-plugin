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
/reload-plugins
/cursor:setup
```

说明：`cursor` 插件依赖本机已安装 Cursor CLI（文档中的 `agent` 命令），详见插件内 `commands/setup.md`。

## 当前插件

| 插件 ID | 说明 |
|--------|------|
| `cursor` | 在 Claude Code 中调用 Cursor CLI 的 headless `agent -p` 流程，支持后台任务与 `status` / `result` / `cancel`。 |
