# Agent 评测工具构建全过程详解

## 1. 文档目的

这份文档完整记录了本次 Agent 评测工具从无到有的构建过程。它不是简短的 README，也不是面向最终使用者的快速上手说明，而是一份“过程档案”。文档重点回答以下问题：

1. 这个工具为什么要这样设计。
2. 它如何对应 Anthropic 的文章《[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)》。
3. 从最初的 demo harness 到后来的真实 Claude Code 适配、中间经历了哪些迭代。
4. 在实现过程中踩过哪些坑，是如何修正的。
5. 最终形成了哪些模块、哪些 suite、哪些报告，以及它们之间如何协作。

这份文档描述的是“制作评测工具”的过程。另一份文档会单独描述“如何用这套工具评测你给出的 Agent 项目”。

---

## 2. 起点与目标

### 2.1 用户原始需求

起点是一个很明确的中文需求：根据 Anthropic 的文章《Demystifying evals for AI agents》，实现一个“能检测 agent 能力的工具”。

这个需求表面看起来像“做个 benchmark”，但如果真的按文章的精神去落地，它至少包含以下几个层次：

1. 不是只测单次输出，而是要能跑多次 trial。
2. 不是只看最终回答，而是要能看 transcript、行为过程、工具使用。
3. 不是只做 capability eval，还要能做 regression eval。
4. 不是只给一个 pass/fail，而是要能给结构化报告，方便人工回看。
5. 最终最好还能接真实 agent，而不是只停留在 mock demo。

### 2.2 环境约束

实现过程中有几个现实条件需要考虑：

1. 当前工作目录是 `<repo-root>`。
2. 用户已经说明“已经装了 python 了”，但在实际操作时，最早阶段为了确保零依赖和立即可运行，先落了 Node.js 版本。
3. 目标 Agent 项目不在当前工作目录，而是在 `${CLAUDE_CODE_REPO}`。
4. 后续真实评测需要调用该目录中的 Claude Code CLI。
5. 评测过程中既要写报告，又要创建临时 workspace，还要支持本地文件级 grader。

### 2.3 最初目标拆解

我把需求拆成了四个阶段：

1. 先做一个最小可运行 harness。
2. 再让 harness 支持真实 agent 接入。
3. 再为真实代码 agent 补齐更贴近工作的 grader 和 suite。
4. 最后把它变成可重复、可扩展、可用于长期回归甚至 CI gate 的工具。

---

## 3. 设计原则：如何把 Anthropic 文章落成代码

Anthropic 文章本质上强调的是“评测结构化”和“减少错觉”。我在实现时，把文章里的概念直接映射为代码实体。

### 3.1 概念映射

文章概念与本工具中的落地关系如下：

| 文章概念 | 工具中的落地 |
| --- | --- |
| task | 单个任务对象，包含 prompt、环境构造函数、grader 配置 |
| trial | 同一 task 的一次执行 |
| transcript | 任务执行过程中的结构化事件流 |
| outcome | 执行结果，包括 final output、环境状态、cwd、耗时 |
| grader | 对 transcript 或 outcome 进行打分的函数 |
| suite | 一组 task 的集合，分 capability / regression 两种模式 |
| harness | 负责运行 suite、聚合结果、输出报告的执行器 |

### 3.2 关键实现原则

我在实现时坚持了以下原则：

1. 每个 trial 必须隔离环境，避免状态污染。
2. transcript 必须保留足够多的信息，便于事后人工复盘。
3. grader 必须既能检查最终产物，也能检查中间行为。
4. suite 的结果必须可聚合成任务级和整体验证信号。
5. 真实 agent 接入方式不能只有一种，否则工具泛化能力不够。

---

## 4. 第一阶段：构建最小可运行评测框架

### 4.1 为什么先做最小框架

一开始如果直接对接真实 Claude Code，会同时面对：

1. 外部进程调用问题。
2. 参数协议问题。
3. transcript 结构问题。
4. 文件系统 grader 问题。
5. 真实模型不稳定性。

这会让排障难度很高。所以我先做了一个最小但结构完整的本地 harness。

### 4.2 最初生成的核心文件

第一轮落下的核心文件包括：

1. `<repo-root>\package.json`
2. `<repo-root>\agent_eval\core.js`
3. `<repo-root>\agent_eval\loader.js`
4. `<repo-root>\agent_eval\report.js`
5. `<repo-root>\agent_eval\cli.js`
6. `<repo-root>\examples\demo_suite.js`
7. `<repo-root>\examples\demo_agent.js`
8. `<repo-root>\README.md`

### 4.3 `core.js` 的职责

`core.js` 是整个系统的心脏。它承担了：

1. 运行单个 trial。
2. 构造 `AgentRuntime`。
3. 记录 transcript。
4. 生成 outcome。
5. 调用 grader。
6. 聚合 task summary。
7. 聚合 suite summary。

这一步最重要的不是“功能多”，而是“数据模型对不对”。我优先确保 trial、task、suite 三层关系正确，再逐渐增加能力。

### 4.4 `AgentRuntime` 的初衷

我没有让 agent 直接操作全局对象，而是设计了一个 `AgentRuntime`，目的是给 agent 一个受控执行上下文。它提供：

1. `say()`：记录对话消息。
2. `callTool()`：调用环境中注册的工具。
3. `finish()`：写入最终输出。
4. `log()`：写入自定义事件。
5. `buildOutcome()`：构造最终结果对象。

这样做的好处是 transcript 有统一来源，后续无论接本地 mock agent、stdio agent、HTTP agent 还是 Claude Code CLI，都能复用同样的事件结构。

### 4.5 初始 grader 集合

最初一版 grader 主要是通用型的：

1. `exact_output`
2. `contains_keywords`
3. `tool_usage`
4. `state_assertion`
5. `transcript_limits`

这一阶段目标不是覆盖所有场景，而是先把“结果判分”这条链路跑通。

### 4.6 `report.js` 与 `cli.js`

为了让工具从第一天起就能“看结果”，我同时实现了：

1. 文本版 summary 输出。
2. JSON report 输出。
3. CLI 入口。

CLI 的第一版只需要支持：

```powershell
node .\agent_eval\cli.js run --suite .\examples\demo_suite.js --agent .\examples\demo_agent.js --trials 5 --out .\reports\demo-report.json
```

这一步的价值在于：只要报告结构先稳定下来，后续 agent 适配和 grader 扩展都可以在同一输出协议上演进。

---

## 5. 第二阶段：先用 demo 验证架构正确

### 5.1 为什么要先做 demo suite

如果没有 demo suite，很难判断是：

1. harness 设计有问题；
2. grader 有问题；
3. agent 行为不稳定；
4. 真实模型调用失败。

所以我做了一个完全可控的 demo agent 和 demo suite。

### 5.2 demo 的用途

demo 的核心作用不是“有多真实”，而是提供以下验证能力：

1. 验证 trial 机制是否正常。
2. 验证 transcript 是否按预期记录。
3. 验证 grader 是否能按设计打分。
4. 验证 report 是否正确聚合。
5. 验证 CLI 能否输出可读文本与 JSON 报告。

### 5.3 demo 运行结果

最终 demo 跑通，并生成了：

`<repo-root>\reports\demo-report.json`

后续 matrix gate 的本地 smoke test 也基于这一思路，又增加了：

`<repo-root>\examples\demo_eval_matrix.js`

这样即使真实 Claude Code 额度不足，也能验证 gate 逻辑本身没有问题。

---

## 6. 第三阶段：让工具支持真实 agent 接入

### 6.1 为什么不能只支持一种 agent 接法

如果工具只能加载本地 JS 模块，它几乎只能评测“写在当前 Node 进程里的 demo agent”。这和真实世界差距太大。

真实 agent 可能有三种典型接法：

1. 直接是一个本地 JS 模块。
2. 是一个独立进程，通过 stdin/stdout 通讯。
3. 是一个 HTTP 服务。

所以我在 `adapters.js` 和 `loader.js` 中同时实现了这三类入口。

### 6.2 `loader.js` 的职责

`loader.js` 的设计目标是统一“怎么把用户给的路径变成 agent 实例”。它负责：

1. 解析 JS 模块。
2. 解析 JSON 配置。
3. 根据 `type` 选择不同 adapter。

这一步把“suite 加载”和“agent 加载”分离开来，后续可以各自独立演进。

### 6.3 `adapters.js` 的三类适配器

实现的适配器包括：

1. `module`
2. `stdio_rpc`
3. `http`

其中：

- `module` 适合本地直接开发。
- `stdio_rpc` 适合语言无关外部 agent。
- `http` 适合已有服务端接口。

### 6.4 为什么实现 stdio RPC

stdio RPC 是一个很重要的中间层。它解决了一个现实问题：

很多 agent 不一定是 Node 写的，也不一定已经有 HTTP 服务，但只要它能读 stdin、写 stdout，就能接进评测框架。

为此我设计了一个简洁协议：

1. harness 发送 `run_task`。
2. agent 可发送 `message`。
3. agent 可发送 `tool_call`。
4. harness 回复 `tool_result` / `tool_error`。
5. agent 最终发送 `final_output`。

同时提供了示例：

1. `<repo-root>\examples\stdio_demo_agent.config.json`
2. `<repo-root>\examples\stdio_demo_agent.js`
3. `<repo-root>\examples\stdio_agent_template.py`

这一步让工具首次具备了“不是只测 demo，而是能接真实外部进程”的能力。

---

## 7. 第四阶段：接入真实 Claude Code CLI

### 7.1 用户给出的真实项目

当用户明确愿意接真实 agent 后，提供了项目路径：

`${CLAUDE_CODE_REPO}`

这是整个项目从“概念验证”进入“真实落地”的转折点。

### 7.2 先验证目标 CLI 是否可执行

在真正适配前，我先确认目标 CLI 可以调用，检查到了：

```powershell
node ${CLAUDE_CODE_CLI_PATH} --version
```

实际输出确认版本为：

`2.1.88 (Claude Code)`

这说明目标 agent 的 headless CLI 入口存在且可运行。

### 7.3 阅读目标源码确认 headless 能力

为了避免“猜参数”，我进一步阅读了目标仓库源码，主要确认了：

1. `-p / --print` 非交互模式存在。
2. `--output-format json|stream-json` 存在。
3. `--input-format text|stream-json` 存在。
4. `--dangerously-skip-permissions` 存在。

这一步非常关键，因为它决定了 adapter 的调用方式应该基于官方/源码支持的接口，而不是靠试错拍脑袋。

### 7.4 `claude_code_cli` 适配器的落地

随后在 `<repo-root>\agent_eval\adapters.js` 中新增了 `claude_code_cli` 适配器。

它负责：

1. 读取 JSON config。
2. 构造 `node <cliPath> -p --output-format json ...` 命令。
3. 在 task workspace 中启动 Claude Code。
4. 解析 JSON 结果。
5. 将 Claude Code 的输出转成统一 transcript / outcome。

### 7.5 第一个坑：prompt 传递方式错了

第一次接入时，最重要的一个错误是 prompt 传递方式不对。

起初的直觉实现是把 prompt 作为命令行参数直接跟在后面，但真实 Claude Code CLI 在 `--print` 模式下对输入的要求更严格，结果报出了类似下面的错误：

`Input must be provided either through stdin or as a prompt argument when using --print`

排查后，我把实现改成：

1. 命令参数只保留 `-p --output-format json ...`
2. 任务 prompt 通过 stdin 写入子进程

这是整个真实接入过程中最关键的适配修正之一。

### 7.6 第二个坑：CLI JSON 中 `subtype=success` 但 `is_error=true`

后续在做 matrix gate 时，又发现了一个很隐蔽的问题：

Claude Code CLI 有时会返回：

1. `subtype = "success"`
2. 但同时 `is_error = true`
3. `result = "Credit balance is too low"`

如果只看 `subtype === "success"`，这个返回会被误当成正常完成。于是我又修正了 `claude_code_cli` adapter 的判定逻辑：

只要 `parsed.subtype !== "success"` 或 `parsed.is_error === true`，就明确视为错误。

这次修正非常重要，因为它让工具能够区分：

1. Agent 真正完成了任务但没通过 grader；
2. Agent 根本没开始执行任务，而是底层调用失败。

---

## 8. 第五阶段：补齐真实代码 Agent 需要的 grader

### 8.1 为什么初始 grader 不够

对真实代码 agent 而言，只用：

1. 输出关键词；
2. transcript 行为；
3. 简单状态断言；

是不够的。因为很多 coding task 的“真正结果”体现在文件系统里。

### 8.2 后续新增的 grader

我逐步补齐了以下 grader：

1. `file_exists`
2. `file_not_exists`
3. `file_contains`
4. `file_equals`
5. `json_file_assertion`
6. `shell_assertion`
7. `file_content_assertion`

这些 grader 的意义分别是：

- `file_exists`：检查目标文件是否被创建。
- `file_not_exists`：检查某文件确实没有被创建或污染。
- `file_contains`：检查某些关键文本是否存在。
- `file_equals`：检查整个文件内容是否精确一致。
- `json_file_assertion`：检查 JSON 文件的结构和值。
- `shell_assertion`：运行命令验证，如 `node .\test.js` 是否通过。
- `file_content_assertion`：做更柔性的文本内容断言，适合文档类任务。

### 8.3 `file_content_assertion` 是怎么来的

这个 grader 不是一开始就想到的，而是一次真实失败驱动出来的。

在 capability suite 中，`multi_file_feature` 最初失败过一次。失败并不是因为 Claude Code 没完成任务，而是因为 README 中的描述语义正确，但没有刚好命中最初的硬编码关键词组合。

这类问题如果不处理，会导致评测系统对“措辞差异”过度敏感，误把正确行为当成失败。

因此我实现了 `file_content_assertion`，支持：

1. 同义词组匹配；
2. 文本归一化；
3. 禁止项匹配；
4. 更细粒度得分。

这使得评测更贴近“能力判断”，而不是“死板字面匹配”。

---

## 9. 第六阶段：加入 inspect 能力

### 9.1 为什么需要 inspect

单看 pass/fail 很难理解失败原因。尤其文章里强调，评测时必须回看 transcript。

所以我新增了 `inspect` 子命令，用于从 JSON 报告中筛选失败 trial，并把 transcript 压缩成便于人工阅读的格式。

### 9.2 相关实现

涉及文件包括：

1. `<repo-root>\agent_eval\report.js`
2. `<repo-root>\agent_eval\cli.js`

支持的用法示例：

```powershell
node .\agent_eval\cli.js inspect --report .\reports\claude-code-report.json --failed-only
```

### 9.3 inspect 的价值

它解决了两个问题：

1. 从结构化 JSON 到人类可读复盘视图的转换。
2. 在失败任务中快速定位“是没做、做偏了、工具调用错了，还是底层 CLI 报错”。

---

## 10. 第七阶段：构建 capability 与 regression 套件

### 10.1 capability suite 的目标

capability suite 用来回答：

“这个 agent 当前具备哪些能力边界？”

我在 `<repo-root>\examples\claude_code_capability_suite.js` 中逐步增加了这类任务，最终形成 6 个任务：

1. `create_file`
2. `bugfix_with_test`
3. `multi_file_feature`
4. `follow_repo_instructions`
5. `structured_output_file`
6. `respect_no_touch_file`

这些任务覆盖了：

1. 产物创建
2. bug 修复
3. 多文件修改
4. 本地说明遵循
5. 结构化产物生成
6. 对受保护文件的约束遵循

### 10.2 regression suite 的目标

regression suite 用来回答：

“哪些任务应该稳定通过，后续如果退化必须报警？”

所以在 `<repo-root>\examples\claude_code_regression_suite.js` 中，我专门挑选了更短、更稳定的任务，默认每题 2 个 trial：

1. `regression_create_file`
2. `regression_fix_test`
3. `regression_follow_instruction`

这类任务适合长期回归，因为它们足够简单，波动少，失败的信号更可信。

### 10.3 repo-grounded suite 的目标

后续我又构建了第三套：

`<repo-root>\examples\claude_code_repo_grounded_suite.js`

这套更接近“真实项目理解任务”，不是让 agent 在临时 toy workspace 里凭空改文件，而是让它直接读取你给的 Claude Code 仓库，抽取稳定事实并写成结构化 JSON。

最终形成了 5 个任务：

1. `repo_cli_flags_snapshot`
2. `repo_marketplace_policy_snapshot`
3. `repo_official_marketplaces_inventory`
4. `repo_branch_title_rules`
5. `repo_restore_manifest_snapshot`

这套任务很适合长期使用，因为：

1. 它们不依赖随机生成内容；
2. 它们直接绑定到真实仓库事实；
3. 一旦仓库改动导致 agent 理解或抽取行为退化，会立即体现出来。

---

## 11. 第八阶段：为 repo-reading 场景单独调优 agent 配置

### 11.1 为什么原来的配置不够

最初我用同一个 `claude_code_agent.config.json` 去跑 capability 和 repo-grounded 任务。但 repo-grounded 任务需要 agent 阅读真实源码并输出精确 JSON，相比简单编码题更容易耗费 turn。

结果最早的 repo-grounded 运行中，出现了：

`error_max_turns`

### 11.2 解决方案

我为 repo-reading 场景新增了单独配置：

`<repo-root>\examples\claude_code_repo_agent.config.json`

它做了几件事：

1. 把 `maxTurns` 从 8 提高到 16。
2. 将系统提示收窄为“精确事实抽取”。
3. 收紧可用工具，减少无关探索。

这一调整非常有效。后来 repo-grounded suite 扩展到 5 个任务之后，仍能稳定达到 100%。

---

## 12. 第九阶段：做成 matrix，支持一键批量运行

### 12.1 为什么要做 matrix

当 suite 增加到三套之后：

1. capability
2. standard regression
3. repo-grounded regression

如果仍然逐条手敲命令，成本会越来越高，也不利于接 CI。

所以我新增了：

1. `<repo-root>\agent_eval\matrix.js`
2. `<repo-root>\examples\claude_code_eval_matrix.js`

### 12.2 matrix 的职责

`matrix.js` 负责：

1. 读取 matrix 配置。
2. 顺序运行多个 suite。
3. 为每个 suite 输出单独 report。
4. 生成总汇总报告 `matrix-summary.json`。

### 12.3 matrix 的产物

当前默认输出目录示例是：

`<repo-root>\reports\claude-code-matrix`

其中包含：

1. `claude-code-report.json`
2. `claude-code-regression-report.json`
3. `claude-code-repo-grounded-report.json`
4. `matrix-summary.json`

---

## 13. 第十阶段：加入 CI gate 能力

### 13.1 为什么 matrix 还不够

仅仅“批量运行”还不够。如果要真正进入 CI，系统必须在不满足条件时返回非 0 退出码。

所以我继续在 `matrix.js` 中新增了：

`--fail-on-gate`

### 13.2 gate 设计

我没有把 gate 写死在代码里，而是允许每个 run 在 matrix 配置里声明自己的 gate 条件，比如：

1. 允许的 signal
2. 最小平均任务通过率

### 13.3 当前默认 gate

在 `<repo-root>\examples\claude_code_eval_matrix.js` 中，默认 gate 是：

1. capability：必须 `strong` 且平均通过率 `1.0`
2. regression：必须 `healthy` 且平均通过率 `1.0`
3. repo-grounded：必须 `healthy` 且平均通过率 `1.0`

### 13.4 本地 smoke test

为了避免每次验证 gate 都调用真实 Claude Code，我新增了：

`<repo-root>\examples\demo_eval_matrix.js`

它可以在本地快速验证：

```powershell
node .\agent_eval\matrix.js --matrix .\examples\demo_eval_matrix.js --out-dir .\reports\demo-matrix --fail-on-gate
```

这条命令已经实际跑通。

---

## 14. 关键失败、修复与经验总结

这一部分是整个构建过程中最有价值的经验。

### 14.1 失败一：真实 CLI prompt 传递错误

问题：

最初没有通过 stdin 传 prompt，导致 Claude Code CLI 输入协议不满足要求。

修复：

将 prompt 改为通过 stdin 发送。

经验：

接真实 agent 时，优先以官方接口的真实调用方式为准，不要假设“把 prompt 直接拼在命令后面”一定成立。

### 14.2 失败二：grader 太硬，误判正确行为

问题：

`multi_file_feature` 一开始只得了部分分，因为 README 文案语义正确但没有命中死板关键词。

修复：

新增 `file_content_assertion`，支持同义词组和更柔性的内容断言。

经验：

评测工具如果过于依赖硬编码字面匹配，会把“能力评测”变成“模板填空比赛”。

### 14.3 失败三：repo-reading 任务容易 hitting max turns

问题：

直接用通用 agent 配置跑 repo-grounded suite，出现 `error_max_turns`。

修复：

新增 `claude_code_repo_agent.config.json`，提高 turn 限制，并缩小任务风格与工具范围。

经验：

不同任务类型往往需要不同 agent 配置。评测工具不应强迫所有任务共用同一运行策略。

### 14.4 失败四：CLI “看起来成功”，实际是底层报错

问题：

Claude Code 返回 `subtype=success` 但 `is_error=true` 且 `result=Credit balance is too low`。

修复：

在 adapter 中明确识别 `is_error=true` 的情况。

经验：

外部系统的“协议层 success”和“业务层 success”不是一回事，评测工具必须同时检查。

### 14.5 失败五：matrix gate 一开始变红

问题：

CI gate 真实运行时三套 suite 全红。

根本原因不是 gate 代码有 bug，而是 Claude Code 当前额度不足，所有任务都在底层就失败了。

修复：

1. 保留这次失败报告，作为真实例子。
2. 强化 adapter 错误识别。
3. 用 demo matrix 验证 gate 逻辑本身没问题。

经验：

好的评测工具不仅要告诉你“红了”，还要帮助你区分：

1. 评测逻辑错误；
2. agent 能力退化；
3. 外部依赖失效；
4. 账号或额度问题。

---

## 15. 最终形成的文件结构

截至当前，这个评测工具的核心产物包括：

### 15.1 核心执行层

1. `<repo-root>\agent_eval\core.js`
2. `<repo-root>\agent_eval\adapters.js`
3. `<repo-root>\agent_eval\loader.js`
4. `<repo-root>\agent_eval\cli.js`
5. `<repo-root>\agent_eval\report.js`
6. `<repo-root>\agent_eval\matrix.js`

### 15.2 示例与配置层

1. `<repo-root>\examples\demo_suite.js`
2. `<repo-root>\examples\demo_agent.js`
3. `<repo-root>\examples\stdio_demo_agent.config.json`
4. `<repo-root>\examples\stdio_demo_agent.js`
5. `<repo-root>\examples\stdio_agent_template.py`
6. `<repo-root>\examples\claude_code_agent.config.json`
7. `<repo-root>\examples\claude_code_repo_agent.config.json`
8. `<repo-root>\examples\claude_code_capability_suite.js`
9. `<repo-root>\examples\claude_code_regression_suite.js`
10. `<repo-root>\examples\claude_code_repo_grounded_suite.js`
11. `<repo-root>\examples\claude_code_eval_matrix.js`
12. `<repo-root>\examples\demo_eval_matrix.js`
13. `<repo-root>\examples\workspace_suite_utils.js`

### 15.3 产出与文档层

1. `<repo-root>\README.md`
2. `<repo-root>\reports\...`
3. `<repo-root>\docs\agent-eval-tool-build-process.zh-CN.md`
4. `<repo-root>\docs\agent-eval-claude-code-evaluation-process.zh-CN.md`

---

## 16. 已验证的关键运行结果

### 16.1 单独 capability suite

文件：

`<repo-root>\reports\claude-code-report.json`

结果：

1. 6 个任务
2. 6 个 trial
3. 平均任务通过率 `1.0`
4. signal = `strong`

### 16.2 单独 standard regression suite

文件：

`<repo-root>\reports\claude-code-regression-report.json`

结果：

1. 3 个任务
2. 6 个 trial
3. 平均任务通过率 `1.0`
4. signal = `healthy`

### 16.3 单独 repo-grounded regression suite

文件：

`<repo-root>\reports\claude-code-repo-grounded-report.json`

结果：

1. 5 个任务
2. 10 个 trial
3. 平均任务通过率 `1.0`
4. signal = `healthy`

### 16.4 demo gate

文件：

`<repo-root>\reports\demo-matrix\matrix-summary.json`

结果：

1. gate 通过
2. 用于证明 `--fail-on-gate` 机制本身可工作

### 16.5 真实 Claude Code gate 的最新状态

文件：

`<repo-root>\reports\claude-code-matrix\matrix-summary.json`

结果：

当前 gate 报红，但这并不说明工具错误，而是说明在最近一次批量运行时，真实 Claude Code 账户出现了：

`Credit balance is too low`

这也是评测工具应当保留下来的重要运行现实。

---

## 17. 为什么说这个工具已经超出了“玩具 demo”

很多所谓 eval 工具只有：

1. 一个 prompt；
2. 一个模型调用；
3. 一个字符串匹配；
4. 一个 pass/fail。

这套工具已经明显超出了那个层级，因为它具备：

1. 多种 agent 接入方式；
2. 多种 grader；
3. trial 与 suite 聚合；
4. transcript 复盘；
5. capability / regression 区分；
6. repo-grounded 任务；
7. matrix 批量运行；
8. CI gate；
9. 真实外部失败识别。

从工程角度看，它已经是一套可继续扩展的 agent eval 基础设施，而不是一次性脚本。

---

## 18. 如果继续演进，下一步最值得做什么

从当前状态往后看，最值得继续推进的方向有四个：

### 18.1 引入更细粒度的行为指标

例如：

1. 工具调用数
2. turn 数
3. 是否访问了指定文件
4. 是否在不必要时修改了额外文件

### 18.2 为 report 增加趋势视图

例如：

1. 同一 suite 多次运行的对比
2. 回归任务的历史通过率变化
3. gate 首次失败时间点

### 18.3 将 matrix 与 CI 平台整合

例如：

1. 在 GitHub Actions 中保存 report artifact
2. 在失败时输出重点任务摘要
3. 自动调用 inspect 生成可读失败摘要

### 18.4 加入更多真实工作流任务

例如：

1. 插件结构生成
2. 配置文件理解与修改
3. 文档与代码的一致性检查
4. 跨文件事实抽取与变更建议

---

## 19. 结论

这次构建不是“先写个框架，再塞几个示例”那么简单，而是一个逐步逼近真实场景的过程。

它的演进路径大致是：

1. 从概念映射到最小 harness。
2. 从 demo 到通用 adapter。
3. 从通用 adapter 到真实 Claude Code 接入。
4. 从简单 grader 到文件级、JSON 级、命令级 grader。
5. 从单次运行到 inspect、regression、repo-grounded、matrix、gate。
6. 从“看起来能跑”到“出现额度问题时也能正确暴露系统状态”。

如果把 Anthropic 原文的精神概括成一句话，那就是：

“评测不是一次问答，而是一套结构化、可复盘、可持续迭代的工程系统。”

这次构建，实际上就是在把这句话变成一个真实可运行的本地工程。
