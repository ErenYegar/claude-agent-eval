# Contributing

欢迎为 `claude-agent-eval` 提交 issue、PR 或改进建议。

## 贡献方向

当前最欢迎的贡献包括：

- 新的 grader
- 新的 suite 示例
- 更好的 report 渲染
- CI / self-hosted workflow 改进
- repo-grounded eval 任务扩充
- 文档修订与中英文说明补充

## 开始之前

建议先阅读：

- [README.md](./README.md)
- [工具构建全过程](./docs/agent-eval-tool-build-process.zh-CN.md)
- [评测 Claude Code 项目全过程](./docs/agent-eval-claude-code-evaluation-process.zh-CN.md)

## 本地运行

### 运行 demo suite

```powershell
node .\agent_eval\cli.js run --suite .\examples\demo_suite.js --agent .\examples\demo_agent.js --trials 5 --out .\reports\demo-report.json
```

### 运行 demo matrix gate

```powershell
node .\agent_eval\matrix.js --matrix .\examples\demo_eval_matrix.js --out-dir .\reports\demo-matrix --fail-on-gate
```

### 使用 npm 脚本

```powershell
cmd /c npm run demo
cmd /c npm run demo:matrix
```

说明：

- 在部分 Windows PowerShell 环境中，`npm.ps1` 可能受执行策略限制。
- 如果遇到该问题，可以优先使用 `cmd /c npm run ...`。

## 提交建议

### 代码风格

- 尽量保持实现简洁、无额外依赖
- 优先复用现有 report / loader / adapter 结构
- 新增 grader 时尽量同时补示例任务

### 提交粒度

建议拆分为较清晰的提交，例如：

- 核心引擎改动
- suite / 配置改动
- 文档与报告改动

### PR 说明建议

请尽量写清：

- 解决了什么问题
- 改了哪些文件
- 怎么验证
- 是否影响已有 report / matrix / gate 行为

## Issue 建议

提交 issue 时，建议至少包含：

- 你的运行命令
- 预期结果
- 实际结果
- 平台信息（Windows / macOS / Linux）
- 如果相关，请附带 report 或 transcript 片段

## 关于生成文件

仓库中的 `reports/` 用于保留示例与已验证结果。若你的改动会改变 demo 行为，建议同时更新对应报告，使仓库状态保持自洽。

## License

向本仓库提交代码即表示你同意你的贡献可以在本项目的 Apache-2.0 许可证下发布。
