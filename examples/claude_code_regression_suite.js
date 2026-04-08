"use strict";

const path = require("path");
const {
  createEnvironmentFactory,
  resolveWorkspaceRoot,
  writeFile
} = require("./workspace_suite_utils");

const ROOT = resolveWorkspaceRoot("claude_code_regression");

function environmentFactory(taskId, builder) {
  return createEnvironmentFactory(ROOT, taskId, builder);
}

async function createSuite() {
  return {
    id: "claude-code-regression-suite",
    name: "Claude Code Regression Suite",
    mode: "regression",
    defaultTrials: 2,
    tasks: [
      {
        id: "regression_create_file",
        name: "Stable file creation",
        prompt:
          "Create done.txt containing exactly the text: regression pass",
        createEnvironment: environmentFactory("regression_create_file", async (cwd) => {
          writeFile(path.join(cwd, "README.md"), "Regression workspace\n");
        }),
        graders: [
          {
            type: "file_equals",
            path: "done.txt",
            expected: "regression pass",
            normalizeLineEndings: false,
            weight: 2
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "regression_fix_test",
        name: "Stable bug fix",
        prompt:
          "Fix multiply.js so node test.js passes. Keep the implementation simple.",
        createEnvironment: environmentFactory("regression_fix_test", async (cwd) => {
          writeFile(
            path.join(cwd, "multiply.js"),
            [
              "function multiply(a, b) {",
              "  return a + b;",
              "}",
              "",
              "module.exports = { multiply };",
              ""
            ].join("\n")
          );
          writeFile(
            path.join(cwd, "test.js"),
            [
              "const assert = require('assert');",
              "const { multiply } = require('./multiply');",
              "assert.strictEqual(multiply(6, 7), 42);",
              "console.log('PASS');",
              ""
            ].join("\n")
          );
        }),
        graders: [
          {
            type: "shell_assertion",
            command: "node .\\test.js",
            expectExitCode: 0,
            stdoutIncludes: ["PASS"],
            weight: 2
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "regression_follow_instruction",
        name: "Stable local instruction following",
        prompt:
          "Read local instructions and write response.txt with exactly the preferred suffix, and nothing else.",
        createEnvironment: environmentFactory(
          "regression_follow_instruction",
          async (cwd) => {
            writeFile(
              path.join(cwd, "CLAUDE.md"),
              [
                "# Instructions",
                "",
                "- Preferred suffix: /stable",
                ""
              ].join("\n")
            );
            writeFile(path.join(cwd, "response.txt"), "placeholder\n");
          }
        ),
        graders: [
          {
            type: "file_contains",
            path: "response.txt",
            required: ["/stable"],
            weight: 2
          }
        ],
        scoring: {
          mode: "all"
        }
      }
    ]
  };
}

module.exports = {
  createSuite
};
