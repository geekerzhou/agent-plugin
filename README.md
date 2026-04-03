# agent-plugin

个人 **Claude Code 插件市场** 仓库：在根目录用 `.claude-plugin/marketplace.json` 描述多个插件，每个插件放在 `plugins/<id>/` 下。

## 目录约定

```text
agent-plugin/
├── .claude-plugin/
│   └── marketplace.json    # 市场清单
├── plugins/
│   └── <plugin-id>/
│       ├── .claude-plugin/
│       │   └── plugin.json # 插件元数据
│       ├── commands/       # 斜杠命令（*.md，YAML frontmatter）
│       ├── hooks/          # 生命周期钩子（hooks.json）
│       ├── agents/         # 子 Agent（rescue 委托）
│       ├── prompts/        # Prompt 模板（审查、停止门禁）
│       ├── schemas/        # JSON Schema（结构化审查输出）
│       ├── skills/         # 内部行为合约（非用户可调用）
│       └── scripts/        # Node.js 脚本
└── README.md
```

## 功能概览

两个插件（cursor、gemini）均支持以下能力：

| 能力 | 说明 |
|------|------|
| **任务委托** | 将编码任务委托给 Cursor / Gemini CLI（headless 模式）|
| **后台任务** | 使用 `--background` 在后台执行，通过 `status`/`result`/`cancel` 管理 |
| **代码审查** | `/cursor:review` / `/gemini:review` — 收集 git diff，发送结构化审查请求 |
| **对抗性审查** | `/cursor:adversarial-review` / `/gemini:adversarial-review` — 以质疑视角审查 |
| **Rescue 子 Agent** | 当 Claude 遇到困难时自动委托给 Cursor / Gemini |
| **会话生命周期** | SessionStart/SessionEnd Hook，自动清理僵尸进程 |
| **停止审查门禁** | Stop Hook，会话结束前可选的自动审查门禁（可通过 setup 启停）|
| **Skills 合约** | 内部行为约束：结果处理、CLI 运行时、Prompt 工程 |

## 命令列表

### Cursor 插件

| 命令 | 说明 |
|------|------|
| `/cursor:setup` | 检查 CLI 可用性和认证，可选安装，配置审查门禁 |
| `/cursor:run` | 运行 Cursor agent（headless `-p` 模式）|
| `/cursor:review` | 对本地 git 变更运行代码审查 |
| `/cursor:adversarial-review` | 对抗性审查，质疑实现方案和设计选择 |
| `/cursor:status` | 查看任务队列和进度 |
| `/cursor:result` | 获取已完成任务的输出 |
| `/cursor:cancel` | 取消排队或运行中的任务 |

### Gemini 插件

| 命令 | 说明 |
|------|------|
| `/gemini:setup` | 检查 CLI 可用性和认证，可选安装，配置审查门禁 |
| `/gemini:run` | 运行 Gemini CLI（headless `-p` 模式）|
| `/gemini:review` | 对本地 git 变更运行代码审查 |
| `/gemini:adversarial-review` | 对抗性审查，质疑实现方案和设计选择 |
| `/gemini:status` | 查看任务队列和进度 |
| `/gemini:result` | 获取已完成任务的输出 |
| `/gemini:cancel` | 取消排队或运行中的任务 |

## 安装使用

```bash
/plugin marketplace add geekerzhou/agent-plugin
/plugin install cursor@agent-plugin
/plugin install gemini@agent-plugin
/reload-plugins
/cursor:setup
/gemini:setup
```

## 环境要求

- **Cursor 插件**：需要本机 Cursor CLI（`agent`），见 [Cursor CLI 文档](https://cursor.com/docs/cli/installation)
- **Gemini 插件**：需要本机 Gemini CLI（`gemini`），通过 `npm i -g @google/gemini-cli` 安装，见 [Gemini CLI 文档](https://google-gemini.github.io/gemini-cli/docs/get-started/)

## 审查门禁

两个插件都支持可选的 **停止时审查门禁**（Stop Review Gate）：

```bash
/cursor:setup --enable-review-gate   # 启用
/cursor:setup --disable-review-gate  # 停用
```

启用后，每次 Claude 会话结束时，会自动用 Cursor / Gemini CLI 审查最后一轮改动。如果发现问题，会阻止会话结束直到问题修复。

## 架构说明

每个插件使用以下关键技术：

- **命令即 Prompt**：每个斜杠命令是一个 Markdown 文件，通过 YAML frontmatter 控制工具权限和执行模式
- **`disable-model-invocation`**：简单直通命令（status/result/cancel）直接执行，无需 LLM 推理
- **`!` 直接执行**：使用 `!` 前缀跳过模型中间处理
- **行为约束**：明确的"不要改写、不要总结、原样返回"等规则
- **后台任务**：通过 detached 子进程实现，支持进度查询和取消
- **结构化审查**：使用 JSON Schema 确保审查输出的一致性和可解析性
- **Session Hook**：注入 session ID，会话结束时自动清理
