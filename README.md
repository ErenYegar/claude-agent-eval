# Agent Capability Eval

This project implements a lightweight agent evaluation harness inspired by Anthropic's article [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

It maps the article's core concepts directly into code:

- `task`: one problem with a prompt, environment, and success criteria
- `trial`: one attempt at a task
- `grader`: code-based scoring logic over transcript and outcome
- `transcript`: the full log of messages, tool calls, and results
- `outcome`: the final state plus the final answer
- `suite`: a collection of capability or regression tasks
- `harness`: the runner that executes trials, grades them, and aggregates metrics

## Why this matches the article

The Anthropic post emphasizes a few practical rules:

1. Run multiple trials because agent runs are stochastic.
2. Grade both the transcript and the final outcome.
3. Keep the environment isolated per trial.
4. Read transcripts when scores look odd.
5. Separate capability evals from regression evals.

This repo implements all five.

## Run the demo

```powershell
node .\agent_eval\cli.js run --suite .\examples\demo_suite.js --agent .\examples\demo_agent.js --trials 5 --out .\reports\demo-report.json
```

## Plug in your own agent

### Option 1: local JS module

Create a module that exports `createAgent()` and returns:

```js
module.exports = {
  async createAgent() {
    return {
      name: "My Agent",
      async runTask(task, runtime) {
        runtime.say("Thinking...");
        const result = await runtime.callTool("my_tool", { input: "x" });
        return runtime.finish(`Answer: ${result.value}`);
      }
    };
  }
};
```

Create a suite module that exports `createSuite()` and defines the task environments and graders.

### Option 2: language-agnostic stdio RPC

If your real agent runs as a separate process, point `--agent` at a JSON config:

```json
{
  "type": "stdio_rpc",
  "name": "My External Agent",
  "command": "python",
  "args": ["./my_agent.py"],
  "cwd": ".",
  "timeoutMs": 30000
}
```

Protocol:

- harness sends one line: `{"type":"run_task","task":{...},"context":{...}}`
- agent may emit `message`
- agent may emit `tool_call` with a `requestId`
- harness replies with `tool_result` or `tool_error`
- agent ends with `final_output`

There is a starter template at [stdio_agent_template.py](/D:/claude/examples/stdio_agent_template.py).

### Option 3: HTTP adapter

You can also point `--agent` to a JSON config that POSTs the task to an HTTP endpoint and expects JSON back:

```json
{
  "type": "http",
  "name": "My HTTP Agent",
  "url": "http://localhost:8000/run"
}
```

Expected response:

```json
{
  "output": "final answer",
  "transcript": [
    { "type": "message", "content": "thinking..." }
  ],
  "statePatch": {}
}
```

### Option 4: Claude Code CLI adapter

If you want to evaluate a real Claude Code build directly, point `--agent` at a config like:

```json
{
  "type": "claude_code_cli",
  "name": "Claude Code 2.1.88",
  "nodePath": "node",
  "cliPath": "D:\\ClaudeCode_Code\\anthropic-ai-claude-code-2.1.88-restored\\package\\cli.js",
  "dangerouslySkipPermissions": true,
  "maxTurns": 8,
  "timeoutMs": 300000
}
```

This adapter runs:

```powershell
node <cliPath> -p --output-format json --dangerously-skip-permissions
```

in the task workspace, sends the task prompt over stdin, and grades the final output plus filesystem state.

## Current grader types

- `exact_output`
- `contains_keywords`
- `tool_usage`
- `state_assertion`
- `transcript_limits`
- `file_exists`
- `file_not_exists`
- `file_contains`
- `file_content_assertion`
- `file_equals`
- `json_file_assertion`
- `shell_assertion`

## Output

The CLI prints a readable summary and can also save a full JSON report with all trials, scores, transcripts, and outcomes for later inspection.

## Example external integration

This command runs the same demo suite against a separate process via stdio RPC:

```powershell
node .\agent_eval\cli.js run --suite .\examples\demo_suite.js --agent .\examples\stdio_demo_agent.config.json --trials 3
```

This command runs a capability suite against the local Claude Code build you pointed me to:

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_capability_suite.js --agent .\examples\claude_code_agent.config.json --out .\reports\claude-code-report.json
```

This command runs a regression suite with repeated trials:

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_regression_suite.js --agent .\examples\claude_code_agent.config.json --out .\reports\claude-code-regression-report.json
```

This command runs a repo-grounded regression suite that reads facts from your real Claude Code source tree:

```powershell
node .\agent_eval\cli.js run --suite .\examples\claude_code_repo_grounded_suite.js --agent .\examples\claude_code_repo_agent.config.json --out .\reports\claude-code-repo-grounded-report.json
```

To run the full Claude Code eval matrix and save all reports in one folder:

```powershell
node .\agent_eval\matrix.js --matrix .\examples\claude_code_eval_matrix.js --out-dir .\reports\claude-code-matrix
```

To use the matrix as a CI gate, add `--fail-on-gate`. The bundled matrix requires:

- capability run signal = `strong` and pass rate = `1.0`
- regression run signal = `healthy` and pass rate = `1.0`
- repo-grounded run signal = `healthy` and pass rate = `1.0`

```powershell
node .\agent_eval\matrix.js --matrix .\examples\claude_code_eval_matrix.js --out-dir .\reports\claude-code-matrix --fail-on-gate
```

For a quick local smoke test of the gate logic without calling Claude Code:

```powershell
node .\agent_eval\matrix.js --matrix .\examples\demo_eval_matrix.js --out-dir .\reports\demo-matrix --fail-on-gate
```

To inspect failures and read trial transcripts:

```powershell
node .\agent_eval\cli.js inspect --report .\reports\claude-code-report.json --failed-only
```
