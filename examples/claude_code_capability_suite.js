"use strict";

const path = require("path");
const {
  createEnvironmentFactory,
  writeFile,
  writeJson
} = require("./workspace_suite_utils");

const ROOT = path.resolve("D:\\claude\\eval_workspaces\\claude_code");

function environmentFactory(taskId, builder) {
  return createEnvironmentFactory(ROOT, taskId, builder);
}

async function createSuite() {
  return {
    id: "claude-code-capability-suite",
    name: "Claude Code Capability Suite",
    mode: "capability",
    defaultTrials: 1,
    tasks: [
      {
        id: "create_file",
        name: "Create a requested artifact",
        prompt:
          "In the current workspace, create a file named RESULT.md containing exactly these three lines:\n# Eval Ready\nstatus: pass\nagent: claude-code\nDo not create any other files.",
        createEnvironment: environmentFactory("create_file", async (cwd) => {
          writeFile(
            path.join(cwd, "README.md"),
            "# Workspace\nOnly create the requested file.\n"
          );
        }),
        graders: [
          {
            type: "file_exists",
            path: "RESULT.md",
            weight: 1
          },
          {
            type: "file_contains",
            path: "RESULT.md",
            required: ["# Eval Ready", "status: pass", "agent: claude-code"],
            weight: 2
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "bugfix_with_test",
        name: "Fix code until tests pass",
        prompt:
          "Fix the bug in sum.js so that node test.js passes. You may inspect files, edit code, and run the test command. Finish by briefly stating what you fixed.",
        createEnvironment: environmentFactory("bugfix_with_test", async (cwd) => {
          writeFile(
            path.join(cwd, "sum.js"),
            [
              "function sum(values) {",
              "  return values.reduce((total, value) => total - value, 0);",
              "}",
              "",
              "module.exports = { sum };",
              ""
            ].join("\n")
          );
          writeFile(
            path.join(cwd, "test.js"),
            [
              "const assert = require('assert');",
              "const { sum } = require('./sum');",
              "",
              "assert.strictEqual(sum([1, 2, 3]), 6);",
              "assert.strictEqual(sum([10, -2, 4]), 12);",
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
          },
          {
            type: "file_contains",
            path: "sum.js",
            required: ["+ value"],
            weight: 1
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "multi_file_feature",
        name: "Implement feature and update docs",
        prompt:
          "Update slugify.js so the tests pass, then add a short note to README.md saying punctuation is removed from slugs.",
        createEnvironment: environmentFactory("multi_file_feature", async (cwd) => {
          writeFile(
            path.join(cwd, "slugify.js"),
            [
              "function slugify(input) {",
              "  return String(input).toLowerCase().replace(/\\s+/g, '-');",
              "}",
              "",
              "module.exports = { slugify };",
              ""
            ].join("\n")
          );
          writeFile(
            path.join(cwd, "README.md"),
            [
              "# Slugify",
              "",
              "Converts titles into URL-friendly slugs.",
              ""
            ].join("\n")
          );
          writeFile(
            path.join(cwd, "test.js"),
            [
              "const assert = require('assert');",
              "const { slugify } = require('./slugify');",
              "",
              "assert.strictEqual(slugify('  Hello, World!  '), 'hello-world');",
              "assert.strictEqual(slugify('A   B   C'), 'a-b-c');",
              "assert.strictEqual(slugify('Already-clean'), 'already-clean');",
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
          },
          {
            type: "file_content_assertion",
            path: "README.md",
            allOf: [
              ["punctuation", "special character", "special characters"],
              ["removed", "stripped", "omitted"],
              ["slug", "slugs"]
            ],
            weight: 1
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "follow_repo_instructions",
        name: "Follow local instructions while editing docs",
        prompt:
          "Read the repository instructions and update docs/answer.md so it contains a single bullet that says the preferred branch prefix is codex/. Keep the file concise.",
        createEnvironment: environmentFactory(
          "follow_repo_instructions",
          async (cwd) => {
            writeFile(
              path.join(cwd, "CLAUDE.md"),
              [
                "# Local Instructions",
                "",
                "- Preferred branch prefix: codex/",
                "- Keep answers concise.",
                ""
              ].join("\n")
            );
            writeFile(
              path.join(cwd, "docs", "answer.md"),
              [
                "# Notes",
                "",
                "- Placeholder",
                ""
              ].join("\n")
            );
          }
        ),
        graders: [
          {
            type: "file_contains",
            path: "docs/answer.md",
            required: ["codex/"],
            weight: 2
          }
        ],
        scoring: {
          mode: "threshold",
          threshold: 1
        }
      },
      {
        id: "structured_output_file",
        name: "Generate structured artifact from local data",
        prompt:
          "Read numbers.txt, compute the sum, and write summary.json with keys sum and label. sum should be the numeric total and label should be exactly \"batch-a\".",
        createEnvironment: environmentFactory("structured_output_file", async (cwd) => {
          writeFile(
            path.join(cwd, "numbers.txt"),
            ["4", "7", "11", "18"].join("\n") + "\n"
          );
          writeJson(path.join(cwd, "summary.json"), {
            sum: 0,
            label: "placeholder"
          });
        }),
        graders: [
          {
            type: "json_file_assertion",
            path: "summary.json",
            expect: {
              sum: 40,
              label: "batch-a"
            },
            weight: 2
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "respect_no_touch_file",
        name: "Edit target file without touching protected file",
        prompt:
          "Update notes.md so it says 'branch prefix: codex/' on one line. Do not modify protected.txt.",
        createEnvironment: environmentFactory("respect_no_touch_file", async (cwd) => {
          writeFile(path.join(cwd, "notes.md"), "todo\n");
          writeFile(path.join(cwd, "protected.txt"), "DO NOT CHANGE\n");
        }),
        graders: [
          {
            type: "file_contains",
            path: "notes.md",
            required: ["branch prefix: codex/"],
            weight: 1
          },
          {
            type: "file_equals",
            path: "protected.txt",
            expected: "DO NOT CHANGE\n",
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
