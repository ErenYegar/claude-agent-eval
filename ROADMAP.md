# Roadmap

本文件用于记录 `claude-agent-eval` 的后续演进方向。它不是严格承诺，但可以作为项目规划和 issue 讨论的参考。

## Near Term

### 1. 强化报告能力

- 为 `matrix-summary.json` 增加更适合人阅读的 Markdown 汇总
- 为 `inspect` 增加更细粒度的过滤参数
- 补充多次运行之间的对比视图

### 2. 丰富 grader

- 新增更严格的文件改动边界检查
- 新增对“禁止修改文件”的通用组合 grader
- 新增 transcript 中 turn 数、工具调用数等效率型指标

### 3. 丰富 repo-grounded eval

- 为真实仓库增加更多源码抽取题
- 增加“跨文件事实一致性”类任务
- 增加“代码与文档同步性”类任务

## Mid Term

### 4. 更适合 CI 的输出

- 增加 GitHub Actions 摘要输出
- 增加失败任务的简明摘要文件
- 支持在 gate 失败时只打印高优先级问题

### 5. 更通用的 agent 接入

- 为更多 CLI 型 agent 补通用配置模板
- 增加更标准化的 JSON-RPC / stream-json 接入方式
- 支持对接 self-hosted runner 场景下的真实 agent

### 6. 历史趋势与回归分析

- 保存过去多次运行结果并做趋势比较
- 标记首次失败时间点
- 标记最近 7 次 / 30 次通过率

## Longer Term

### 7. 任务资产化

- 将任务拆成可复用的 task 库
- 支持 capability pack / regression pack
- 支持根据项目类型选择不同 eval 组合

### 8. 可视化与发布

- 增加静态 HTML 报告导出
- 增加 release 说明中自动附带 eval 结果摘要
- 让结果更适合展示给团队或管理者

## Not Planned Yet

- 云端托管评测服务
- Web UI 管理后台
- 多租户任务管理

这些方向并非永远不做，而是当前还不在近期优先级内。
