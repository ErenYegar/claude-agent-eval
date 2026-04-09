# 使用 Agent 评测工具评测 Claude Code 项目的全过程详解

## 1. 文档目的

这份文档专门记录“如何使用已经构建好的 Agent 评测工具，评测用户提供的真实 Agent 项目”的全过程。

这里的“真实 Agent 项目”指的是用户提供的 Claude Code 项目：

鍦ㄥ綋鍓嶈繖鍙版満鍣ㄤ笂锛屾枃涓殑 `<repo-root>` 瀵瑰簲鐨勫疄闄呰矾寰勬槸 `D:\claude\claude-agent-eval`銆?

`${CLAUDE_CODE_REPO}`

这份文档与另一份“工具构建过程”文档的区别是：

1. 那一份重点讲“工具怎么做出来”。
2. 这一份重点讲“工具如何被拿来评测这个具体项目”。

我会尽量把每一步都写清楚，包括：

1. 路径是如何接入的。
2. 配置是如何设计的。
3. suite 是如何为 Claude Code 量身定制的。
4. 真实运行中出现了哪些失败。
5. 如何一步步把评测从可用推进到稳定。

---

## 2. 被评测对象是什么

用户给出的项目路径是：

`${CLAUDE_CODE_REPO}`

从仓库内容看，这个目录至少包含：

1. `package/`
2. `src/`
3. `vendor/`
4. `package.json`
5. `restore-manifest.json`
6. `RESTORE_NOTES.md`
7. `SETUP_GUIDE.md`

其中，对评测接入最关键的文件是：

`${CLAUDE_CODE_CLI_PATH}`

因为这意味着该项目存在一个可以被 headless 调用的 CLI 入口。

---

## 3. 第一步：确认目标 Agent 有可调用入口

### 3.1 为什么先验证入口

评测一个真实项目，最先要确认的不是任务设计，而是：

“有没有一个稳定、自动化、非交互的调用方式？”

如果没有，那后面所有 suite 都无从谈起。

### 3.2 实际验证方式

最先确认的是版本命令是否能跑通：

```powershell
node ${CLAUDE_CODE_CLI_PATH} --version
```

该命令实际返回：

`2.1.88 (Claude Code)`

这一步说明：

1. 目标项目可执行。
2. `package\cli.js` 是正确的 CLI 入口。
3. 后续可以基于它继续构造 headless eval adapter。

---

## 4. 第二步：阅读目标源码，确认可用的 CLI 模式

### 4.1 为什么不能直接猜参数

很多 CLI 工具看起来支持“打印模式”，但真实使用时往往有：

1. 输入格式限制；
2. 输出格式限制；
3. 权限绕过选项；
4. 仅在某种模式下可用的 flag。

为了避免“适配器基于错误假设实现”，我在接入前先阅读了目标源码。

### 4.2 重点检查的源码点

重点查看了：

1. `${CLAUDE_CODE_REPO}\src\main.tsx`
2. `${CLAUDE_CODE_REPO}\src\cli\print.ts`

### 4.3 确认到的关键能力

通过源码阅读，确认了以下事实：

1. 存在 `-p, --print` 非交互模式。
2. 存在 `--output-format text|json|stream-json`。
3. 存在 `--input-format text|stream-json`。
4. 存在 `--dangerously-skip-permissions`。
5. 非交互模式支持 `--max-turns`。

这些事实后来直接决定了 `claude_code_cli` adapter 的命令构造方式。

---

## 5. 第三步：把 Claude Code 接进评测框架

### 5.1 新增的 adapter 类型

为了把这个项目纳入评测工具，我在 `<repo-root>\agent_eval\adapters.js` 中新增了：

`claude_code_cli`

它不是通用 HTTP，也不是 stdio RPC，而是专门针对 Claude Code 这种“本地 CLI + JSON 输出 + 文件系统工作区”的 agent 形式设计。

### 5.2 adapter 的职责

这个 adapter 负责：

1. 读取 agent config。
2. 构造 `node <cliPath> -p --output-format json ...` 命令。
3. 将每个 task 放入独立 workspace 中运行。
4. 捕获 stdout/stderr。
5. 解析 Claude Code 返回的 JSON。
6. 记录 `external_command`、`external_command_result`、`external_agent_result`。
7. 将结果交给 grader 判断。

### 5.3 生成的 agent 配置

最先创建的 Claude Code 配置文件是：

`<repo-root>\examples\claude_code_agent.config.json`

它包括：

1. `type = "claude_code_cli"`
2. `cliPath = ${CLAUDE_CODE_CLI_PATH}`
3. `dangerouslySkipPermissions = true`
4. `maxTurns = 8`
5. `timeoutMs = 300000`
6. 一组允许工具

这是后续 capability 与 standard regression suite 的默认 agent 配置。

---

## 6. 第四步：修复 prompt 传递方式

### 6.1 初次接入时出现的问题

在最早版本中，Claude Code CLI 没能正确接受 prompt。根本原因是：

我最初没有采用它实际要求的输入方式。

### 6.2 错误的症状

CLI 报出类似下面的错误信息：

`Input must be provided either through stdin or as a prompt argument when using --print`

### 6.3 修正方式

修正后的调用逻辑是：

1. 命令参数只负责配置运行模式和格式。
2. 真正的 task prompt 通过 stdin 发送给子进程。

### 6.4 这一步为什么重要

如果这一步不修好，后续所有 capability suite 和 regression suite 都只是在错误输入方式上反复失败，没有评测价值。

这一步修复完成后，Claude Code 才真正进入“可被自动化评测”的状态。

---

## 7. 第五步：先做第一轮真实能力评测

### 7.1 为什么先从 capability suite 开始

在接通真实项目后，我没有立刻做 CI，也没有立刻做长期回归，而是先做最直接的问题验证：

“Claude Code 现在能不能完成一些典型 coding agent 任务？”

### 7.2 设计第一轮 capability task 的思路

最先设计的 capability task 需要满足：

1. 足够简单，便于快速跑通。
2. 又不能过于简单，否则无法体现 agent 能力。
3. 最好覆盖不同能力维度。

最终形成的任务包括：

1. 创建指定文件。
2. 修 bug 并让测试通过。
3. 遵循本地说明文件再修改文档。

### 7.3 第一轮结果

在 prompt 传输修复后，Claude Code 首次真实跑通 capability suite，并生成了：

`<repo-root>\reports\claude-code-report.json`

早期这一轮的结果已经达到了 100%，说明：

1. adapter 可用；
2. workspace 隔离可用；
3. grader 可用；
4. Claude Code 对这类典型基础 coding task 有稳定能力。

---

## 8. 第六步：扩展 capability suite，逼近真实能力边界

### 8.1 为什么要扩展

如果 capability suite 只有 2 到 3 个任务，很容易产生一种错觉：

“它全过了，所以它什么都行。”

这显然不够严谨。于是我继续把 suite 扩展到更接近真实工作的 6 个任务。

### 8.2 扩展后的 6 个任务

最终 capability suite 包含：

1. `create_file`
2. `bugfix_with_test`
3. `multi_file_feature`
4. `follow_repo_instructions`
5. `structured_output_file`
6. `respect_no_touch_file`

### 8.3 第一次扩展后的失败

扩展后第一次运行并不是满分。

当时：

1. 多文件 feature 任务拿到了部分分。
2. 失败类型主要是文档关键词没有完全命中 grader。

这不是 agent 完全不会，而是“grader 太硬”暴露出来的问题。

### 8.4 如何判断这不是纯粹的 agent 失败

我通过 `inspect` 查看失败样本，发现：

1. 测试实际上通过了。
2. README 也确实被更新了。
3. 只是文案没有完全匹配最早写死的关键词。

这一步说明工具开始发挥真实价值了：

它不只是告诉我们“失败了”，还帮助我们判断：

“失败来自能力不足，还是来自评测设计不合理？”

### 8.5 修复后结果

新增 `file_content_assertion` 并调整 `multi_file_feature` 的 grader 后，再次运行 capability suite，结果变为：

1. 6 个任务
2. 6 个 trial
3. 平均任务通过率 `1.0`
4. signal = `strong`

对应报告是：

`<repo-root>\reports\claude-code-report.json`

---

## 9. 第七步：构建 standard regression suite

### 9.1 为什么 capability 不能直接当 regression

capability suite 的目标是探测能力边界，它可以包含略有挑战、甚至可能偶发失败的任务。

但 regression suite 不一样，它需要：

1. 任务更稳定；
2. 条件更可控；
3. 一旦失败，信号应该更可信。

### 9.2 regression suite 的设计原则

我为 Claude Code 单独设计了：

`<repo-root>\examples\claude_code_regression_suite.js`

原则是：

1. 每个任务都非常短。
2. 每个任务都强约束输入与输出。
3. 默认 2 个 trial，防止单次随机波动。

### 9.3 任务内容

任务包括：

1. 稳定文件创建
2. 稳定 bug 修复
3. 稳定本地指令遵循

### 9.4 运行结果

运行后生成：

`<repo-root>\reports\claude-code-regression-report.json`

结果为：

1. 3 个任务
2. 6 个 trial
3. 平均任务通过率 `1.0`
4. signal = `healthy`

这说明 Claude Code 至少在这一批稳定任务上，达到了适合长期回归的表现。

---

## 10. 第八步：为真实仓库理解任务设计 repo-grounded suite

### 10.1 为什么需要 repo-grounded

只用临时 toy workspace 去测 Claude Code，虽然可以测修改能力，但仍然有一个缺口：

它并没有真正利用“用户给的这个真实仓库”。

而用户给出的项目本身就是 Claude Code 源码恢复仓库，它恰好非常适合被用来设计“基于真实仓库事实抽取”的任务。

### 10.2 repo-grounded suite 的思路

我把任务设计成：

1. 读取真实仓库的某个文件；
2. 提取其中的稳定事实；
3. 写入当前评测 workspace 中的 JSON 文件；
4. 用 `json_file_assertion` 精确校验。

这类任务有几个优点：

1. 非常稳定；
2. 很适合做长期回归；
3. 可以直接绑定到用户给的真实项目；
4. 能测“读源码理解并结构化输出”的能力。

### 10.3 最早的 repo-grounded 任务

最开始主要做了 3 个：

1. `repo_cli_flags_snapshot`
2. `repo_marketplace_policy_snapshot`
3. `repo_official_marketplaces_inventory`

### 10.4 首次运行暴露的问题

第一次直接用通用 agent config 去跑 repo-grounded suite 时，出现了明显问题：

1. CLI flags 任务失败；
2. marketplace policy 任务失败；
3. 很多失败是 `error_max_turns`；
4. agent 在真实源码阅读任务里比在 toy task 上更容易耗尽 turns。

### 10.5 如何修正

修正分为两步：

第一步是配置层：

新增 `<repo-root>\examples\claude_code_repo_agent.config.json`

主要提高 `maxTurns`、收窄工具、增加“精确抽取”的系统提示。

第二步是任务层：

把最容易引起歧义的 CLI flags 题重新设计成：

1. `printShortFlag`
2. `printLongFlag`

而不是一个模糊的 `printFlag` 字段。

这样就不会因为 agent 输出长旗标还是短旗标而导致本不应该的误判。

### 10.6 修复后结果

修复后，repo-grounded suite 跑到了稳定 100%，报告为：

`<repo-root>\reports\claude-code-repo-grounded-report.json`

其结果是：

1. 5 个任务
2. 10 个 trial
3. 平均任务通过率 `1.0`
4. signal = `healthy`

---

## 11. 第九步：把 repo-grounded suite 扩成长期回归集

### 11.1 为什么还要继续扩充

当 repo-grounded 3 题稳定通过之后，我没有停在这里，而是继续思考：

“什么样的任务更值得长期保留在回归集中？”

答案是：

1. 绑定真实仓库事实；
2. 结构稳定；
3. 不容易因为文案小波动失效；
4. 能代表不同类型的仓库理解能力。

### 11.2 最终增加的两类任务

后来又加入了：

1. `repo_branch_title_rules`
2. `repo_restore_manifest_snapshot`

这样 repo-grounded suite 变成 5 个任务，分别覆盖：

1. CLI 能力声明
2. 插件 marketplace 规则
3. 官方 marketplace 名单
4. branch 标题生成规则
5. restore manifest 元信息抽取

### 11.3 为什么这套很适合长期使用

因为这些任务：

1. 来自真实仓库。
2. 值得长期关注。
3. 几乎都能通过 JSON 断言精确判分。
4. 不依赖随机输入。
5. 不依赖网络。

这使得它们非常适合作为长期 regression 的一部分。

---

## 12. 第十步：构建 Claude Code 专属 eval matrix

### 12.1 为什么要做 matrix

当 capability、standard regression、repo-grounded regression 三套都存在之后，需要一个统一入口批量执行它们。

于是我新增了：

`<repo-root>\examples\claude_code_eval_matrix.js`

并实现：

`<repo-root>\agent_eval\matrix.js`

### 12.2 matrix 包含哪些 run

当前默认 matrix 包含：

1. capability run
2. regression run
3. repo-grounded run

### 12.3 matrix 输出什么

matrix 运行后会写出：

1. 每个 run 的独立 JSON 报告
2. 一个总览汇总 `matrix-summary.json`

这为后续：

1. 手工批量跑评测
2. 接脚本
3. 接 CI gate

都提供了统一出口。

---

## 13. 第十一步：把 matrix 变成 CI gate

### 13.1 gate 的目标

如果只是“批量运行”，那 matrix 还只是一个批处理器。

要进 CI，就需要它能：

1. 根据阈值判断是否通过；
2. 在失败时返回非 0 退出码；
3. 把失败原因写到 summary 中。

### 13.2 设计方式

我没有硬编码判断逻辑，而是允许每个 run 在 matrix 文件里声明 gate：

1. `allowedSignals`
2. `minAvgTaskPassRate`

### 13.3 当前 gate 配置

当前 Claude Code matrix 中的 gate 是：

1. capability 必须 `strong` 且 `avgTaskPassRate = 1`
2. regression 必须 `healthy` 且 `avgTaskPassRate = 1`
3. repo-grounded 必须 `healthy` 且 `avgTaskPassRate = 1`

### 13.4 本地 gate 验证

为了避免每次测试 gate 都调用真实 Claude Code，我还做了：

`<repo-root>\examples\demo_eval_matrix.js`

并实际验证：

```powershell
node .\agent_eval\matrix.js --matrix .\examples\demo_eval_matrix.js --out-dir .\reports\demo-matrix --fail-on-gate
```

这条命令成功通过，证明 gate 机制本身工作正常。

---

## 14. 第十二步：真实 matrix 最近一次为什么会失败

### 14.1 表面现象

最近一次以 `--fail-on-gate` 跑真实 Claude Code matrix 时，出现了全部变红的情况，`matrix-summary.json` 中显示：

1. capability = `weak`
2. regression = `regression-risk`
3. repo-grounded = `regression-risk`
4. 平均通过率全部为 0

### 14.2 初看很像工具坏了

如果只看 summary，很容易怀疑：

1. 是不是 matrix.js 写错了。
2. 是不是 gate 判断错了。
3. 是不是 suite 路径没加载对。

### 14.3 实际原因

通过读取具体 report 内容，发现真实原因是：

Claude Code CLI 在那次运行中不断返回：

`Credit balance is too low`

也就是说，这次失败不是：

1. suite 写错；
2. grader 写错；
3. matrix 逻辑错；
4. agent 能力忽然退化到 0；

而是底层账号/额度问题导致根本没有正常执行任务。

### 14.4 这为什么仍然是有价值的评测结果

因为评测工具的职责不是“只在 everything is fine 时给出漂亮结果”，而是在真实失败时也把系统状态暴露清楚。

这次失败报告说明：

1. gate 的确会拦截。
2. 报告会如实记录失败原因。
3. 真实运行环境问题也会被纳入评测体系。

### 14.5 后续修正

为了让这类问题不再被误判成“普通成功结果”，我进一步修正了 adapter：

只要 Claude Code 返回：

1. `subtype !== "success"`，或者
2. `is_error === true`

就直接视为底层错误。

这样未来再遇到类似额度问题，系统会更明确地区分：

1. agent 结果失败；
2. 基础调用环境失败。

---

## 15. 本次评测过程中形成的关键文件

### 15.1 Agent 接入配置

1. `<repo-root>\examples\claude_code_agent.config.json`
2. `<repo-root>\examples\claude_code_repo_agent.config.json`

### 15.2 Claude Code 专属 suite

1. `<repo-root>\examples\claude_code_capability_suite.js`
2. `<repo-root>\examples\claude_code_regression_suite.js`
3. `<repo-root>\examples\claude_code_repo_grounded_suite.js`

### 15.3 批量与 gate

1. `<repo-root>\examples\claude_code_eval_matrix.js`
2. `<repo-root>\agent_eval\matrix.js`

### 15.4 报告文件

1. `<repo-root>\reports\claude-code-report.json`
2. `<repo-root>\reports\claude-code-regression-report.json`
3. `<repo-root>\reports\claude-code-repo-grounded-report.json`
4. `<repo-root>\reports\claude-code-matrix\matrix-summary.json`

---

## 16. 评测流程按时间顺序的完整回放

下面按真实推进顺序，把整个“评测这个项目”的过程重新串起来。

### 16.1 接到项目路径

用户给出：

`${CLAUDE_CODE_REPO}`

这是整个评测进入真实项目阶段的开始。

### 16.2 验证 CLI 可执行

确认 `package\cli.js --version` 可用，并输出 `2.1.88 (Claude Code)`。

### 16.3 阅读源码确认 headless 模式

确认存在：

1. `--print`
2. `--output-format json`
3. `--input-format`
4. `--dangerously-skip-permissions`

### 16.4 新增 `claude_code_cli` adapter

让评测框架能直接在每个 task workspace 中调用 Claude Code CLI。

### 16.5 修复 stdin prompt 传递

解决最初的 headless 输入问题。

### 16.6 设计第一版 capability suite

先验证 Claude Code 是否能完成基础 coding task。

### 16.7 首次真实跑通

能力评测报告成功生成。

### 16.8 扩展 capability suite

加入更多任务以探测能力边界。

### 16.9 失败样本复盘

通过 `inspect` 发现某些失败来自 grader 过硬，而不是 agent 真不会。

### 16.10 新增更柔性的 grader

引入 `file_content_assertion`，修正文档类任务误判。

### 16.11 再跑 capability，达到 100%

说明 suite 与 grader 对齐程度更高。

### 16.12 设计 standard regression suite

挑选更稳定的短任务，形成长期回归集。

### 16.13 跑 standard regression，达到 100%

说明 Claude Code 在这类稳定任务上的表现足够好。

### 16.14 设计 repo-grounded suite

开始直接利用真实 Claude Code 仓库做事实抽取任务。

### 16.15 第一次 repo-grounded 失败

遇到 `error_max_turns` 和字段设计歧义问题。

### 16.16 新增 repo-reader 配置并重构题目

通过更长 turns、更窄工具、精确 JSON 字段改善任务稳定性。

### 16.17 repo-grounded 达到 100%

这说明 Claude Code 对真实仓库事实抽取任务也能稳定完成。

### 16.18 继续扩展 repo-grounded 到 5 题

把它从“验证性样例”提升为更可信的长期回归集。

### 16.19 新增 eval matrix

把 capability、regression、repo-grounded 三套整合成统一批量运行入口。

### 16.20 新增 CI gate

支持 `--fail-on-gate`。

### 16.21 真实 gate 运行时暴露额度问题

批量跑时，Claude Code CLI 出现 `Credit balance is too low`，导致 gate 变红。

### 16.22 修正 adapter 错误识别

将 `is_error=true` 明确纳入错误处理。

### 16.23 用 demo matrix 验证 gate 逻辑正确

确保：

1. gate 机制没问题；
2. 真实 matrix 变红不是因为 gate 本身坏了。

---

## 17. 当前阶段对 Claude Code 项目可以得出的结论

基于目前已完成且成功的单独报告，可以比较有把握地得出以下结论。

### 17.1 在受控 capability task 上

Claude Code 2.1.88 当前表现为：

1. 可以稳定创建文件。
2. 可以修简单 bug 并使测试通过。
3. 可以进行多文件修改。
4. 可以遵循本地 `CLAUDE.md` 之类的指令。
5. 可以生成结构化 JSON 产物。
6. 可以在约束下不误改受保护文件。

### 17.2 在稳定 regression task 上

Claude Code 的表现已经足以支持长期回归：

1. 任务短；
2. 成功率稳定；
3. 两次 trial 都通过；
4. signal 为 `healthy`。

### 17.3 在 repo-grounded 任务上

Claude Code 也具备：

1. 阅读真实源码；
2. 抽取稳定事实；
3. 生成精确 JSON 输出；
4. 在多轮重复执行中保持稳定；

这说明它不仅是“会改 toy 文件”，而且对真实项目理解任务也有可观表现。

### 17.4 当前最大的外部风险

不是能力问题，而是运行环境问题：

Claude Code CLI 的真实评测依赖可用额度。如果额度不足，matrix gate 会红，而且应该红。

这在工程上是合理的，因为从 CI 的角度看：

“评测无法正常执行”本身就是一个阻塞条件。

---

## 18. 如果未来继续评测这个项目，最值得增加什么

### 18.1 更贴近真实开发工作流的修改任务

例如：

1. 读取一个真实源码文件后做小修复。
2. 修改某份文档并保持与源码一致。
3. 生成插件或配置骨架。

### 18.2 更严格的文件变更边界检查

例如：

1. 只允许修改某几个文件。
2. 修改了额外文件就扣分。
3. 如果 agent 使用了不必要工具也扣分。

### 18.3 更细的 repo-grounded 理解题

例如：

1. 抽取某个模块的默认值逻辑。
2. 解释某个 flag 的组合约束。
3. 比较两个文件中的规则是否一致。

### 18.4 与真实 CI 结合

例如：

1. 在账号额度正常时每日跑 matrix。
2. gate 失败时保存 report artifact。
3. 自动提取最关键失败摘要。

---

## 19. 复现本次评测过程的建议命令

### 19.1 跑 capability suite

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_capability_suite.js --agent .\examples\claude_code_agent.config.json --out .\reports\claude-code-report.json
```

### 19.2 跑 standard regression suite

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_regression_suite.js --agent .\examples\claude_code_agent.config.json --out .\reports\claude-code-regression-report.json
```

### 19.3 跑 repo-grounded suite

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_repo_grounded_suite.js --agent .\examples\claude_code_repo_agent.config.json --out .\reports\claude-code-repo-grounded-report.json
```

### 19.4 查看失败样本

```powershell
node .\agent_eval\cli.js inspect --report .\reports\claude-code-report.json --failed-only
```

### 19.5 跑整套 matrix

```powershell
node .\agent_eval\matrix.js --matrix .\examples\claude_code_eval_matrix.js --out-dir .\reports\claude-code-matrix
```

### 19.6 以 gate 模式跑 matrix

```powershell
node .\agent_eval\matrix.js --matrix .\examples\claude_code_eval_matrix.js --out-dir .\reports\claude-code-matrix --fail-on-gate
```

---

## 20. 结论

这次对 Claude Code 项目的评测，不是“把一个现成 benchmark 往上一套”那么简单，而是经历了一个完整的工程过程：

1. 找到真实可调用入口。
2. 阅读源码确认 headless 协议。
3. 实现专属 adapter。
4. 修复输入方式。
5. 设计 capability task。
6. 扩展为 regression task。
7. 扩展为 repo-grounded task。
8. 根据真实失败不断修正 grader 与配置。
9. 最终把它纳入 matrix 与 gate。

如果只看最终表面结果，会看到：

1. 单独 suite 曾全部稳定通过。
2. 最新 gate 因额度问题而变红。

但真正重要的是过程本身揭示了：

1. Claude Code 在多类受控任务上确实表现稳定。
2. 这套评测工具已经能够区分任务失败、评测设计问题和外部运行环境问题。
3. 这意味着你现在手上已经有了一套不仅能“测一次”，而且能持续、结构化、工程化地评测这个真实 Agent 项目的基础设施。
