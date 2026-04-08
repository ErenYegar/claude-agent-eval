"use strict";

const path = require("path");
const { spawn } = require("child_process");

class EvalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EvalError";
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeSearchText(value, options = {}) {
  let text = String(value ?? "");
  if (options.collapseWhitespace !== false) {
    text = text.replace(/\s+/g, " ");
  }
  if (options.trim !== false) {
    text = text.trim();
  }
  if (!options.caseSensitive) {
    text = text.toLowerCase();
  }
  return text;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function createMulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stringToSeed(input) {
  const text = String(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class AgentRuntime {
  constructor({ task, trialIndex, environment, random }) {
    this.task = task;
    this.trialIndex = trialIndex;
    this.environment = environment;
    this.random = random;
    this.startedAt = Date.now();
    this.finalOutput = "";
    this.transcript = [
      {
        type: "task",
        at: nowIso(),
        payload: {
          taskId: task.id,
          prompt: task.prompt,
          metadata: task.metadata || {}
        }
      }
    ];
  }

  log(type, payload) {
    this.transcript.push({
      type,
      at: nowIso(),
      payload: deepClone(payload)
    });
  }

  async callTool(name, args = {}) {
    const tool = this.environment.tools?.[name];
    if (!tool) {
      throw new EvalError(`Tool "${name}" is not available for task "${this.task.id}".`, {
        tool: name,
        taskId: this.task.id
      });
    }

    this.log("tool_call", { tool: name, args });
    const startedAt = Date.now();
    const result = await tool(deepClone(args), {
      state: this.environment.state,
      task: this.task,
      runtime: this
    });
    this.log("tool_result", {
      tool: name,
      latencyMs: Date.now() - startedAt,
      result
    });
    return deepClone(result);
  }

  say(content, channel = "assistant") {
    this.log("message", { channel, content });
  }

  finish(output) {
    this.finalOutput = String(output ?? "");
    this.log("final_output", { output: this.finalOutput });
    return this.finalOutput;
  }

  buildOutcome() {
    return {
      output: this.finalOutput,
      state: deepClone(this.environment.state),
      cwd: this.environment.cwd || null,
      durationMs: Date.now() - this.startedAt
    };
  }
}

async function runTrial({ suite, task, agent, trialIndex, baseSeed, overrideTrials }) {
  const seed = stringToSeed(`${suite.id || suite.name}:${task.id}:${trialIndex}:${baseSeed}`);
  const random = createMulberry32(seed);
  const environment = await task.createEnvironment({ random, trialIndex });
  const runtime = new AgentRuntime({ task, trialIndex, environment, random });

  let uncaughtError = null;
  try {
    const rawResult = await agent.runTask(task, runtime, {
      random,
      trialIndex,
      suite
    });

    if (!runtime.finalOutput && rawResult !== undefined) {
      runtime.finish(rawResult);
    }
  } catch (error) {
    uncaughtError = {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || ""
    };
    runtime.log("error", uncaughtError);
  }

  const outcome = runtime.buildOutcome();
  const grading = await scoreTask(task, runtime.transcript, outcome);

  return {
    taskId: task.id,
    taskName: task.name || task.id,
    trialIndex,
    seed,
    passed: grading.passed,
    score: grading.score,
    uncaughtError,
    transcript: runtime.transcript,
    outcome,
    grading,
    taskConfig: {
      requestedTrials: overrideTrials ?? task.trials ?? suite.defaultTrials ?? 1
    }
  };
}

function summarizeTrials(task, trials) {
  const total = trials.length;
  const passedTrials = trials.filter((trial) => trial.passed).length;
  const avgScore =
    total === 0 ? 0 : trials.reduce((sum, trial) => sum + trial.score, 0) / total;
  const passRate = total === 0 ? 0 : passedTrials / total;
  const estimatedPassAtK = {};

  for (let k = 1; k <= total; k += 1) {
    estimatedPassAtK[k] = 1 - Math.pow(1 - passRate, k);
  }

  return {
    taskId: task.id,
    taskName: task.name || task.id,
    passRate,
    avgScore,
    passedTrials,
    totalTrials: total,
    allPassed: total > 0 && passedTrials === total,
    estimatedPassAtK,
    latestFailure:
      trials.find((trial) => !trial.passed)?.grading?.summary || null
  };
}

async function runSuite({ suite, agent, overrideTrials = null, seed = "default-seed" }) {
  const startedAt = nowIso();
  const taskSummaries = [];
  const trials = [];

  for (const task of suite.tasks) {
    const taskTrials = overrideTrials ?? task.trials ?? suite.defaultTrials ?? 1;
    const perTaskTrials = [];

    for (let trialIndex = 0; trialIndex < taskTrials; trialIndex += 1) {
      const result = await runTrial({
        suite,
        task,
        agent,
        trialIndex,
        baseSeed: seed,
        overrideTrials
      });
      trials.push(result);
      perTaskTrials.push(result);
    }

    taskSummaries.push(summarizeTrials(task, perTaskTrials));
  }

  const passRates = taskSummaries.map((item) => item.passRate);
  const avgTaskPassRate =
    passRates.length === 0
      ? 0
      : passRates.reduce((sum, value) => sum + value, 0) / passRates.length;

  return {
    meta: {
      suiteId: suite.id || suite.name,
      suiteName: suite.name,
      suiteMode: suite.mode || "capability",
      agentName: agent.name || "unnamed-agent",
      startedAt,
      completedAt: nowIso(),
      seed,
      rootDir: path.resolve(process.cwd())
    },
    summary: {
      taskCount: suite.tasks.length,
      trialCount: trials.length,
      avgTaskPassRate,
      fullyReliableTasks: taskSummaries.filter((item) => item.allPassed).length,
      capabilitySignal:
        suite.mode === "regression"
          ? avgTaskPassRate >= 0.99
            ? "healthy"
            : "regression-risk"
          : avgTaskPassRate >= 0.8
            ? "strong"
            : avgTaskPassRate >= 0.5
              ? "developing"
              : "weak"
    },
    tasks: taskSummaries,
    trials
  };
}

const graders = {
  exact_output({ transcript, outcome, config }) {
    const actual = normalizeText(outcome.output);
    const accepted = (config.accepted || []).map((item) => normalizeText(item));
    const passed = accepted.includes(actual);
    return {
      passed,
      score: passed ? 1 : 0,
      detail: {
        expected: config.accepted,
        actual: outcome.output
      }
    };
  },

  contains_keywords({ outcome, config }) {
    const haystack = normalizeText(outcome.output);
    const required = (config.required || []).map((item) => normalizeText(item));
    const matched = required.filter((item) => haystack.includes(item));
    const score = required.length === 0 ? 1 : matched.length / required.length;
    return {
      passed: matched.length === required.length,
      score,
      detail: {
        required,
        matched,
        output: outcome.output
      }
    };
  },

  tool_usage({ transcript, config }) {
    const calls = transcript
      .filter((entry) => entry.type === "tool_call")
      .map((entry) => entry.payload.tool);

    const required = config.required || [];
    const forbidden = config.forbidden || [];
    const missing = required.filter((tool) => !calls.includes(tool));
    const violations = forbidden.filter((tool) => calls.includes(tool));
    const passed = missing.length === 0 && violations.length === 0;
    const possibleChecks = required.length + forbidden.length || 1;
    const failedChecks = missing.length + violations.length;
    return {
      passed,
      score: (possibleChecks - failedChecks) / possibleChecks,
      detail: {
        calls,
        missing,
        violations
      }
    };
  },

  state_assertion({ outcome, config }) {
    const failures = [];
    for (const [path, expected] of Object.entries(config.expect || {})) {
      const actual = readPath(outcome.state, path);
      if (stableStringify(actual) !== stableStringify(expected)) {
        failures.push({ path, expected, actual });
      }
    }

    return {
      passed: failures.length === 0,
      score:
        Object.keys(config.expect || {}).length === 0
          ? 1
          : (Object.keys(config.expect || {}).length - failures.length) /
            Object.keys(config.expect || {}).length,
      detail: {
        failures,
        state: outcome.state
      }
    };
  },

  transcript_limits({ transcript, config }) {
    const messageCount = transcript.filter((item) => item.type === "message").length;
    const toolCallCount = transcript.filter((item) => item.type === "tool_call").length;
    const failures = [];

    if (typeof config.maxMessages === "number" && messageCount > config.maxMessages) {
      failures.push(`message_count>${config.maxMessages}`);
    }
    if (typeof config.maxToolCalls === "number" && toolCallCount > config.maxToolCalls) {
      failures.push(`tool_calls>${config.maxToolCalls}`);
    }

    return {
      passed: failures.length === 0,
      score: failures.length === 0 ? 1 : 0,
      detail: {
        messageCount,
        toolCallCount,
        failures
      }
    };
  },

  file_exists({ outcome, config }) {
    const target = resolveOutcomePath(outcome, config.path);
    const fs = require("fs");
    const exists = fs.existsSync(target);
    return {
      passed: exists,
      score: exists ? 1 : 0,
      detail: {
        path: target,
        exists
      }
    };
  },

  file_not_exists({ outcome, config }) {
    const target = resolveOutcomePath(outcome, config.path);
    const fs = require("fs");
    const exists = fs.existsSync(target);
    return {
      passed: !exists,
      score: exists ? 0 : 1,
      detail: {
        path: target,
        exists
      }
    };
  },

  file_contains({ outcome, config }) {
    const fs = require("fs");
    const target = resolveOutcomePath(outcome, config.path);
    if (!fs.existsSync(target)) {
      return {
        passed: false,
        score: 0,
        detail: {
          path: target,
          error: "file_not_found"
        }
      };
    }

    const content = fs.readFileSync(target, "utf8");
    const required = config.required || [];
    const matched = required.filter((item) => content.includes(String(item)));
    const score = required.length === 0 ? 1 : matched.length / required.length;
    return {
      passed: matched.length === required.length,
      score,
      detail: {
        path: target,
        matched,
        required
      }
    };
  },

  file_content_assertion({ outcome, config }) {
    const fs = require("fs");
    const target = resolveOutcomePath(outcome, config.path);
    if (!fs.existsSync(target)) {
      return {
        passed: false,
        score: 0,
        detail: {
          path: target,
          error: "file_not_found"
        }
      };
    }

    const content = fs.readFileSync(target, "utf8");
    const requiredGroups = config.allOf || [];
    const forbiddenGroups = config.forbidden || [];
    const matchedRequired = requiredGroups.filter((group) =>
      matchesTextGroup(content, group, config)
    );
    const violatedForbidden = forbiddenGroups.filter((group) =>
      matchesTextGroup(content, group, config)
    );
    const totalChecks = requiredGroups.length + forbiddenGroups.length || 1;
    const score =
      (matchedRequired.length +
        (forbiddenGroups.length - violatedForbidden.length)) /
      totalChecks;

    return {
      passed:
        matchedRequired.length === requiredGroups.length &&
        violatedForbidden.length === 0,
      score,
      detail: {
        path: target,
        requiredGroups,
        matchedRequired,
        forbiddenGroups,
        violatedForbidden
      }
    };
  },

  file_equals({ outcome, config }) {
    const fs = require("fs");
    const target = resolveOutcomePath(outcome, config.path);
    if (!fs.existsSync(target)) {
      return {
        passed: false,
        score: 0,
        detail: {
          path: target,
          error: "file_not_found"
        }
      };
    }

    const actual = fs.readFileSync(target, "utf8");
    const normalize = config.normalizeLineEndings !== false;
    const normalizedActual = normalize ? actual.replace(/\r\n/g, "\n") : actual;
    const normalizedExpected = normalize
      ? String(config.expected || "").replace(/\r\n/g, "\n")
      : String(config.expected || "");
    const passed = normalizedActual === normalizedExpected;
    return {
      passed,
      score: passed ? 1 : 0,
      detail: {
        path: target,
        expected: normalizedExpected,
        actual: normalizedActual
      }
    };
  },

  json_file_assertion({ outcome, config }) {
    const fs = require("fs");
    const target = resolveOutcomePath(outcome, config.path);
    if (!fs.existsSync(target)) {
      return {
        passed: false,
        score: 0,
        detail: {
          path: target,
          error: "file_not_found"
        }
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    } catch (error) {
      return {
        passed: false,
        score: 0,
        detail: {
          path: target,
          error: "invalid_json",
          message: error?.message || String(error)
        }
      };
    }

    const failures = [];
    for (const [dottedPath, expected] of Object.entries(config.expect || {})) {
      const actual = readPath(parsed, dottedPath);
      if (stableStringify(actual) !== stableStringify(expected)) {
        failures.push({
          path: dottedPath,
          expected,
          actual
        });
      }
    }

    const total = Object.keys(config.expect || {}).length || 1;
    return {
      passed: failures.length === 0,
      score: (total - failures.length) / total,
      detail: {
        path: target,
        failures,
        json: parsed
      }
    };
  },

  shell_assertion: async ({ outcome, config }) => {
    const cwd = config.cwd
      ? resolveOutcomePath(outcome, config.cwd)
      : outcome.cwd || process.cwd();
    const result = await runShellCommand({
      command: config.command,
      cwd,
      timeoutMs: config.timeoutMs || 30000
    });
    const stdoutIncludes = config.stdoutIncludes || [];
    const stderrIncludes = config.stderrIncludes || [];
    const exitMatches =
      config.expectExitCode === undefined ||
      Number(result.exitCode) === Number(config.expectExitCode);
    const stdoutMatches = stdoutIncludes.every((item) =>
      result.stdout.includes(String(item))
    );
    const stderrMatches = stderrIncludes.every((item) =>
      result.stderr.includes(String(item))
    );
    const passed = exitMatches && stdoutMatches && stderrMatches;
    const checks =
      (config.expectExitCode === undefined ? 0 : 1) +
        stdoutIncludes.length +
        stderrIncludes.length || 1;
    const failedChecks =
      (exitMatches ? 0 : 1) +
      stdoutIncludes.filter((item) => !result.stdout.includes(String(item))).length +
      stderrIncludes.filter((item) => !result.stderr.includes(String(item))).length;
    return {
      passed,
      score: (checks - failedChecks) / checks,
      detail: result
    };
  }
};

function readPath(object, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((current, segment) => (current == null ? undefined : current[segment]), object);
}

function resolveOutcomePath(outcome, targetPath) {
  if (!targetPath) {
    throw new EvalError("A grader path was not provided.");
  }
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(outcome.cwd || process.cwd(), targetPath);
}

function matchesTextGroup(content, expectation, config = {}) {
  if (Array.isArray(expectation)) {
    return expectation.some((item) => matchesTextGroup(content, item, config));
  }

  if (expectation instanceof RegExp) {
    return expectation.test(content);
  }

  const haystack = normalizeSearchText(content, config);
  const needle = normalizeSearchText(expectation, config);
  return haystack.includes(needle);
}

function runShellCommand({ command, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch (_error) {
        // Ignore cleanup errors.
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        cwd,
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        cwd,
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message || String(error)
      });
    });
  });
}

async function scoreTask(task, transcript, outcome) {
  const results = [];
  for (const graderConfig of task.graders || []) {
    const grader = graders[graderConfig.type];
    if (!grader) {
      throw new EvalError(`Unknown grader type "${graderConfig.type}" on task "${task.id}".`);
    }
    const result = await grader({ task, transcript, outcome, config: graderConfig });
    results.push({
      type: graderConfig.type,
      weight: graderConfig.weight ?? 1,
      passed: !!result.passed,
      score: Number(result.score ?? (result.passed ? 1 : 0)),
      detail: result.detail || {}
    });
  }

  const scoring = task.scoring || { mode: "all" };
  const totalWeight = results.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weightedScore =
    results.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;

  let passed = false;
  if (scoring.mode === "threshold") {
    passed = weightedScore >= (scoring.threshold ?? 1);
  } else if (scoring.mode === "hybrid") {
    const requiredTypes = scoring.requiredGraders || [];
    const requiredPassed = requiredTypes.every((type) =>
      results.find((item) => item.type === type)?.passed
    );
    passed = requiredPassed && weightedScore >= (scoring.threshold ?? 1);
  } else {
    passed = results.every((item) => item.passed);
  }

  return {
    passed,
    score: weightedScore,
    summary: passed
      ? "passed"
      : results
          .filter((item) => !item.passed)
          .map((item) => item.type)
          .join(", "),
    results
  };
}

module.exports = {
  EvalError,
  runSuite,
  normalizeText,
  deepClone
};
