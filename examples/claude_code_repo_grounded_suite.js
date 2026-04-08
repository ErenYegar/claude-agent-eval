"use strict";

const path = require("path");
const {
  createEnvironmentFactory,
  writeJson
} = require("./workspace_suite_utils");

const ROOT = path.resolve("D:\\claude\\eval_workspaces\\claude_code_repo_grounded");
const TARGET_REPO =
  "D:\\ClaudeCode_Code\\anthropic-ai-claude-code-2.1.88-restored";

function environmentFactory(taskId, builder) {
  return createEnvironmentFactory(ROOT, taskId, builder);
}

async function createSuite() {
  return {
    id: "claude-code-repo-grounded-suite",
    name: "Claude Code Repo Grounded Suite",
    mode: "regression",
    defaultTrials: 2,
    tasks: [
      {
        id: "repo_cli_flags_snapshot",
        name: "Extract stable CLI flags from the real repo",
        prompt: [
          `Read ${TARGET_REPO}\\src\\main.tsx and write cli-flags.json in the current workspace.`,
          'Use this exact JSON shape:',
          '{',
          '  "printShortFlag": string,',
          '  "printLongFlag": string,',
          '  "outputFormats": string[],',
          '  "inputFormats": string[],',
          '  "skipPermissionsFlag": string',
          '}',
          'Use exact flag strings from the source.'
        ].join("\n"),
        createEnvironment: environmentFactory(
          "repo_cli_flags_snapshot",
          async (cwd) => {
            writeJson(path.join(cwd, "cli-flags.json"), {
              printShortFlag: "",
              printLongFlag: "",
              outputFormats: [],
              inputFormats: [],
              skipPermissionsFlag: ""
            });
          }
        ),
        graders: [
          {
            type: "json_file_assertion",
            path: "cli-flags.json",
            expect: {
              printShortFlag: "-p",
              printLongFlag: "--print",
              outputFormats: ["text", "json", "stream-json"],
              inputFormats: ["text", "stream-json"],
              skipPermissionsFlag: "--dangerously-skip-permissions"
            },
            weight: 3
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "repo_marketplace_policy_snapshot",
        name: "Extract marketplace policy facts from the real repo",
        prompt: [
          `Read ${TARGET_REPO}\\src\\utils\\plugins\\schemas.ts and write marketplace-policy.json in the current workspace.`,
          'Use this exact JSON shape:',
          '{',
          '  "officialOrg": string,',
          '  "noAutoUpdateMarketplace": string,',
          '  "relativeJsonPrefix": string,',
          '  "relativeMarkdownSuffix": string',
          '}',
          "Use exact strings from the source."
        ].join("\n"),
        createEnvironment: environmentFactory(
          "repo_marketplace_policy_snapshot",
          async (cwd) => {
            writeJson(path.join(cwd, "marketplace-policy.json"), {
              officialOrg: "",
              noAutoUpdateMarketplace: "",
              relativeJsonPrefix: "",
              relativeMarkdownSuffix: ""
            });
          }
        ),
        graders: [
          {
            type: "json_file_assertion",
            path: "marketplace-policy.json",
            expect: {
              officialOrg: "anthropics",
              noAutoUpdateMarketplace: "knowledge-work-plugins",
              relativeJsonPrefix: "./",
              relativeMarkdownSuffix: ".md"
            },
            weight: 3
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "repo_official_marketplaces_inventory",
        name: "Inventory official marketplace names from the real repo",
        prompt: [
          `Read ${TARGET_REPO}\\src\\utils\\plugins\\schemas.ts and write official-marketplaces.json in the current workspace.`,
          'Use this exact JSON shape:',
          '{',
          '  "count": number,',
          '  "officialNames": string[]',
          '}',
          "The array must include every official marketplace name from the source, sorted alphabetically."
        ].join("\n"),
        createEnvironment: environmentFactory(
          "repo_official_marketplaces_inventory",
          async (cwd) => {
            writeJson(path.join(cwd, "official-marketplaces.json"), {
              count: 0,
              officialNames: []
            });
          }
        ),
        graders: [
          {
            type: "json_file_assertion",
            path: "official-marketplaces.json",
            expect: {
              count: 8,
              officialNames: [
                "agent-skills",
                "anthropic-marketplace",
                "anthropic-plugins",
                "claude-code-marketplace",
                "claude-code-plugins",
                "claude-plugins-official",
                "knowledge-work-plugins",
                "life-sciences"
              ]
            },
            weight: 3
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "repo_branch_title_rules",
        name: "Extract branch title derivation rules from the real repo",
        prompt: [
          `Read ${TARGET_REPO}\\src\\commands\\branch\\branch.ts and write branch-rules.json in the current workspace.`,
          'Use this exact JSON shape:',
          '{',
          '  "fallbackTitle": string,',
          '  "maxDerivedPromptChars": number,',
          '  "firstBranchSuffix": string,',
          '  "secondBranchSuffixExample": string',
          '}',
          "Use exact strings and numbers from the source."
        ].join("\n"),
        createEnvironment: environmentFactory(
          "repo_branch_title_rules",
          async (cwd) => {
            writeJson(path.join(cwd, "branch-rules.json"), {
              fallbackTitle: "",
              maxDerivedPromptChars: 0,
              firstBranchSuffix: "",
              secondBranchSuffixExample: ""
            });
          }
        ),
        graders: [
          {
            type: "json_file_assertion",
            path: "branch-rules.json",
            expect: {
              fallbackTitle: "Branched conversation",
              maxDerivedPromptChars: 100,
              firstBranchSuffix: " (Branch)",
              secondBranchSuffixExample: " (Branch 2)"
            },
            weight: 3
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "repo_restore_manifest_snapshot",
        name: "Extract restore manifest facts from the real repo",
        prompt: [
          `Read ${TARGET_REPO}\\restore-manifest.json and write restore-summary.json in the current workspace.`,
          'Use this exact JSON shape:',
          '{',
          '  "packageName": string,',
          '  "version": string,',
          '  "totalSourcesInMap": number,',
          '  "restoredCount": number,',
          '  "srcTopLevelCount": number',
          '}',
          "Use exact values from the JSON file."
        ].join("\n"),
        createEnvironment: environmentFactory(
          "repo_restore_manifest_snapshot",
          async (cwd) => {
            writeJson(path.join(cwd, "restore-summary.json"), {
              packageName: "",
              version: "",
              totalSourcesInMap: 0,
              restoredCount: 0,
              srcTopLevelCount: 0
            });
          }
        ),
        graders: [
          {
            type: "json_file_assertion",
            path: "restore-summary.json",
            expect: {
              packageName: "@anthropic-ai/claude-code",
              version: "2.1.88",
              totalSourcesInMap: 4756,
              restoredCount: 4756,
              srcTopLevelCount: 1902
            },
            weight: 3
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
