"use strict";

const fs = require("fs");
const path = require("path");
const { runSuite } = require("./core");
const { loadSuite, loadAgent, resolveModule } = require("./loader");
const { renderTextReport, renderInspectionReport } = require("./report");

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function printUsage() {
  console.log(`Usage:
  node agent_eval/cli.js run --suite examples/demo_suite.js --agent examples/demo_agent.js [--trials 5] [--seed seed-1] [--out reports/report.json]
  node agent_eval/cli.js inspect --report reports/report.json [--failed-only] [--task task_id] [--trial 0]

Agent can be either:
  - a JS module that exports createAgent() or agent
  - a JSON config for module / stdio_rpc / http adapters
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (command === "inspect") {
    if (!args.report) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const reportPath = resolveModule(args.report);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const text = renderInspectionReport(report, {
      failedOnly: !!args["failed-only"],
      taskId: args.task || null,
      trialIndex: args.trial
    });
    process.stdout.write(text);
    return;
  }

  if (command !== "run") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!args.suite || !args.agent) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const suite = await loadSuite(args.suite);
  const agent = await loadAgent(args.agent);
  const report = await runSuite({
    suite,
    agent,
    overrideTrials: args.trials ? Number(args.trials) : null,
    seed: args.seed || "default-seed"
  });

  const text = renderTextReport(report);
  process.stdout.write(text);

  if (args.out) {
    const outPath = resolveModule(args.out);
    ensureDirectory(outPath);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`\nSaved JSON report to ${outPath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
