"use strict";

async function createMatrix() {
  return {
    id: "claude-code-eval-matrix",
    name: "Claude Code Eval Matrix",
    runs: [
      {
        id: "capability",
        suite: "./examples/claude_code_capability_suite.js",
        agent: "./examples/claude_code_agent.config.json",
        out: "claude-code-report.json",
        gate: {
          allowedSignals: ["strong"],
          minAvgTaskPassRate: 1
        }
      },
      {
        id: "regression",
        suite: "./examples/claude_code_regression_suite.js",
        agent: "./examples/claude_code_agent.config.json",
        out: "claude-code-regression-report.json",
        gate: {
          allowedSignals: ["healthy"],
          minAvgTaskPassRate: 1
        }
      },
      {
        id: "repo-grounded",
        suite: "./examples/claude_code_repo_grounded_suite.js",
        agent: "./examples/claude_code_repo_agent.config.json",
        out: "claude-code-repo-grounded-report.json",
        gate: {
          allowedSignals: ["healthy"],
          minAvgTaskPassRate: 1
        }
      }
    ]
  };
}

module.exports = {
  createMatrix
};
