# Changelog

本项目采用手工维护的变更记录。

## Unreleased

- README 首页补充 License / CI / 文档入口
- 新增 `ROADMAP.md`
- 新增 `CONTRIBUTING.md`
- 新增 Issue / PR / Release 模板
- 公开仓库脱敏：Claude Code 本地绝对路径改为环境变量配置
- 新增 `.env.example`
- `reports/` 改为本地生成产物并默认从 Git 忽略
- 两份中文过程文档已替换为占位路径与环境变量说明

## 0.1.0 - 2026-04-08

首次发布，包含以下内容：

- 基于 Anthropic eval 思路实现的核心 harness
- `task / trial / transcript / outcome / grader / suite / matrix` 结构
- `module` / `stdio_rpc` / `http` / `claude_code_cli` 四类 agent 接入
- capability、regression、repo-grounded 三类 suite 示例
- `inspect` 失败样本复盘命令
- matrix 批量运行与 `--fail-on-gate`
- 针对 Claude Code 2.1.88 的真实评测配置与报告
- 中文过程文档两篇
