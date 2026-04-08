"use strict";

const fs = require("fs");
const path = require("path");
const { runSuite } = require("./core");
const { loadSuite, loadAgent, resolveModule } = require("./loader");

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

function printUsage() {
  console.log(`Usage:
  node agent_eval/matrix.js --matrix examples/claude_code_eval_matrix.js [--seed seed-1] [--out-dir reports/claude-code-matrix] [--fail-on-gate]
`);
}

function requireFresh(modulePath) {
  const resolved = resolveModule(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

async function loadMatrix(modulePath) {
  const resolved = resolveModule(modulePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Matrix module not found: ${modulePath}`);
  }

  const mod = requireFresh(resolved);
  if (typeof mod.createMatrix === "function") {
    return mod.createMatrix();
  }
  if (mod.matrix) {
    return mod.matrix;
  }
  throw new Error(`Matrix module "${modulePath}" must export createMatrix() or matrix.`);
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function summarizeRun(id, report, outPath, gate) {
  return {
    id,
    suiteId: report.meta.suiteId,
    suiteName: report.meta.suiteName,
    suiteMode: report.meta.suiteMode,
    agentName: report.meta.agentName,
    signal: report.summary.capabilitySignal,
    avgTaskPassRate: report.summary.avgTaskPassRate,
    taskCount: report.summary.taskCount,
    trialCount: report.summary.trialCount,
    outPath,
    gate
  };
}

function evaluateGate(runConfig, report) {
  const gateConfig = runConfig.gate || {};
  const reasons = [];
  const signal = report.summary.capabilitySignal;
  const avgTaskPassRate = report.summary.avgTaskPassRate;

  if (Array.isArray(gateConfig.allowedSignals) && gateConfig.allowedSignals.length > 0) {
    if (!gateConfig.allowedSignals.includes(signal)) {
      reasons.push(
        `signal ${JSON.stringify(signal)} not in ${JSON.stringify(gateConfig.allowedSignals)}`
      );
    }
  }

  if (typeof gateConfig.minAvgTaskPassRate === "number") {
    if (avgTaskPassRate < gateConfig.minAvgTaskPassRate) {
      reasons.push(
        `avgTaskPassRate ${avgTaskPassRate.toFixed(3)} < ${gateConfig.minAvgTaskPassRate.toFixed(3)}`
      );
    }
  }

  return {
    enabled:
      Array.isArray(gateConfig.allowedSignals) ||
      typeof gateConfig.minAvgTaskPassRate === "number",
    passed: reasons.length === 0,
    reasons,
    config: gateConfig
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matrix) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const matrix = await loadMatrix(args.matrix);
  const outDir = resolveModule(args["out-dir"] || "./reports/claude-code-matrix");
  ensureDir(outDir);

  const runs = [];
  for (const run of matrix.runs || []) {
    const suite = await loadSuite(run.suite);
    const agent = await loadAgent(run.agent);
    const report = await runSuite({
      suite,
      agent,
      overrideTrials: run.trials ? Number(run.trials) : null,
      seed: args.seed || run.seed || "default-seed"
    });

    const filename = run.out || `${run.id}-report.json`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const gate = evaluateGate(run, report);
    const summary = summarizeRun(run.id, report, outPath, gate);
    runs.push(summary);

    process.stdout.write(
      `[${run.id}] ${summary.signal} ${Math.round(summary.avgTaskPassRate * 1000) / 10}%${
        gate.enabled ? ` gate=${gate.passed ? "pass" : "fail"}` : ""
      } -> ${outPath}\n`
    );
  }

  const gateFailures = runs.filter((run) => run.gate?.enabled && !run.gate?.passed);

  const matrixReport = {
    meta: {
      matrixId: matrix.id || matrix.name || "eval-matrix",
      matrixName: matrix.name || matrix.id || "Eval Matrix",
      completedAt: new Date().toISOString(),
      outDir
    },
    summary: {
      runCount: runs.length,
      healthyRuns: runs.filter((run) => ["healthy", "strong"].includes(run.signal))
        .length,
      gateFailures: gateFailures.length,
      gatePassed: gateFailures.length === 0,
      avgPassRate:
        runs.length === 0
          ? 0
          : runs.reduce((sum, run) => sum + run.avgTaskPassRate, 0) / runs.length
    },
    runs
  };

  const matrixOutPath = path.join(outDir, "matrix-summary.json");
  fs.writeFileSync(matrixOutPath, `${JSON.stringify(matrixReport, null, 2)}\n`, "utf8");
  process.stdout.write(`Saved matrix summary to ${matrixOutPath}\n`);

  if (args["fail-on-gate"] && gateFailures.length > 0) {
    for (const run of gateFailures) {
      process.stderr.write(
        `Gate failed for ${run.id}: ${(run.gate.reasons || []).join("; ")}\n`
      );
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadMatrix,
  evaluateGate,
  main
};
