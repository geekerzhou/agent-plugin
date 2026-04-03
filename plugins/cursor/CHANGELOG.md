# Changelog

## 0.2.1

- 增强 JSDoc 类型定义，提取顶层 `@typedef` 声明
- 补充函数返回值类型注解
- 改善代码可维护性和 IDE 提示体验

## 0.2.0

- Upgraded plugin to align with Codex official quality standards
- Added adversarial review command and prompts
- Added stop review gate hook
- Added session lifecycle hook
- Improved job control and tracked job infrastructure
- Expanded skill documentation (agent-prompting, cursor-cli-runtime, cursor-result-handling)

## 0.1.0

- Initial version of the Cursor plugin for Claude Code
- Core commands: run, status, result, cancel, rescue, review, setup
- Background job queue with detached process support
- Headless Cursor CLI integration (`agent -p`)
