"use strict";

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function summarizeTranscriptEntry(entry) {
  const payload = entry.payload || {};
  switch (entry.type) {
    case "task":
      return `task: ${payload.taskId}`;
    case "message":
      return `${payload.channel || "assistant"}: ${truncate(payload.content, 140)}`;
    case "tool_call":
      return `tool_call: ${payload.tool} ${JSON.stringify(payload.args || {})}`;
    case "tool_result":
      return `tool_result: ${payload.tool} ${truncate(JSON.stringify(payload.result), 140)}`;
    case "final_output":
      return `final_output: ${truncate(payload.output, 160)}`;
    case "external_command":
      return `external_command: ${payload.command} ${(payload.args || []).join(" ")}`;
    case "external_command_result":
      return `external_command_result: exit=${payload.exitCode} timedOut=${payload.timedOut}`;
    case "external_stderr":
      return `stderr: ${truncate(payload.content, 160)}`;
    case "external_agent_result":
      return `agent_result: subtype=${payload.subtype} result=${truncate(payload.result, 120)}`;
    case "error":
      return `error: ${payload.message}`;
    default:
      return `${entry.type}: ${truncate(JSON.stringify(payload), 160)}`;
  }
}

function truncate(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function renderTextReport(report) {
  const lines = [];
  lines.push(`Suite: ${report.meta.suiteName} (${report.meta.suiteMode})`);
  lines.push(`Agent: ${report.meta.agentName}`);
  lines.push(`Signal: ${report.summary.capabilitySignal}`);
  lines.push(
    `Average task pass rate: ${formatPercent(report.summary.avgTaskPassRate)} across ${report.summary.taskCount} tasks / ${report.summary.trialCount} trials`
  );
  lines.push("");
  lines.push("Task breakdown:");

  for (const task of report.tasks) {
    lines.push(
      `- ${task.taskId}: pass ${task.passedTrials}/${task.totalTrials} (${formatPercent(task.passRate)}), avg score ${task.avgScore.toFixed(2)}`
    );
    if (task.latestFailure) {
      lines.push(`  latest failure: ${task.latestFailure}`);
    }
  }

  lines.push("");
  lines.push("Why this harness matches the Anthropic article:");
  lines.push("- separates task, trial, transcript, outcome, grader, and suite");
  lines.push("- runs multiple trials per task to reduce single-run noise");
  lines.push("- records transcripts for manual review when scores look suspicious");
  lines.push("- supports capability suites and regression-style suites");

  return `${lines.join("\n")}\n`;
}

function renderInspectionReport(report, options = {}) {
  const failedOnly = !!options.failedOnly;
  const taskFilter = options.taskId || null;
  const trialFilter =
    options.trialIndex === undefined || options.trialIndex === null
      ? null
      : Number(options.trialIndex);

  const selected = report.trials.filter((trial) => {
    if (failedOnly && trial.passed) {
      return false;
    }
    if (taskFilter && trial.taskId !== taskFilter) {
      return false;
    }
    if (trialFilter !== null && trial.trialIndex !== trialFilter) {
      return false;
    }
    return true;
  });

  const lines = [];
  lines.push(`Inspecting ${selected.length} trial(s) from ${report.meta.suiteName}`);
  lines.push("");

  for (const trial of selected) {
    lines.push(
      `[${trial.taskId}#${trial.trialIndex}] ${trial.passed ? "PASS" : "FAIL"} score=${trial.score.toFixed(2)}`
    );
    lines.push(`summary: ${trial.grading.summary}`);
    if (trial.uncaughtError?.message) {
      lines.push(`uncaught: ${trial.uncaughtError.message}`);
    }
    if (trial.outcome?.output) {
      lines.push(`output: ${truncate(trial.outcome.output, 200)}`);
    }
    lines.push("transcript:");
    for (const entry of trial.transcript || []) {
      lines.push(`- ${summarizeTranscriptEntry(entry)}`);
    }
    lines.push("");
  }

  if (selected.length === 0) {
    lines.push("No trials matched the filters.");
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  renderTextReport,
  renderInspectionReport
};
