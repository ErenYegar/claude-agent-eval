"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

function expandEnvVars(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, name) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new Error(
        `Environment variable "${name}" is required but was not set while resolving config value "${value}".`
      );
    }
    return resolved;
  });
}

function resolveFromConfig(configPath, maybeRelativePath) {
  if (!maybeRelativePath) {
    return maybeRelativePath;
  }
  const expanded = expandEnvVars(maybeRelativePath);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(configPath), expanded);
}

async function createAgentFromConfig(config, { configPath }) {
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid agent config at ${configPath}`);
  }

  if (config.type === "module") {
    const target = resolveFromConfig(configPath, config.path);
    if (!fs.existsSync(target)) {
      throw new Error(`Module agent target not found: ${target}`);
    }
    delete require.cache[target];
    const mod = require(target);
    if (typeof mod.createAgent === "function") {
      return mod.createAgent();
    }
    if (mod.agent) {
      return mod.agent;
    }
    throw new Error(`Module agent "${target}" must export createAgent() or agent.`);
  }

  if (config.type === "stdio_rpc") {
    return createStdioRpcAgent(config, configPath);
  }

  if (config.type === "http") {
    return createHttpAgent(config);
  }

  if (config.type === "claude_code_cli") {
    return createClaudeCodeCliAgent(config, configPath);
  }

  throw new Error(
    `Unknown agent config type "${config.type}" in ${configPath}. Expected "module", "stdio_rpc", "http", or "claude_code_cli".`
  );
}

function createStdioRpcAgent(config, configPath) {
  const command = config.command;
  const args = Array.isArray(config.args) ? config.args : [];
  const timeoutMs = Number(config.timeoutMs || 60000);
  const cwd = config.cwd ? resolveFromConfig(configPath, config.cwd) : path.dirname(configPath);
  const env = {
    ...process.env,
    ...(config.env || {})
  };

  if (!command) {
    throw new Error(`stdio_rpc config requires "command" in ${configPath}`);
  }

  return {
    name: config.name || `stdio-rpc:${path.basename(command)}`,
    async runTask(task, runtime, context) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"]
        });

        const pendingToolCalls = new Map();
        let settled = false;
        let timeoutHandle = null;
        let stderrBuffer = "";

        function cleanup() {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }

        function finishWithError(error) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          try {
            child.kill();
          } catch (_error) {
            // Ignore cleanup errors.
          }
          reject(error);
        }

        function finishSuccessfully(output) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          try {
            child.stdin.end();
          } catch (_error) {
            // Ignore cleanup errors.
          }
          try {
            child.kill();
          } catch (_error) {
            // Ignore cleanup errors.
          }
          resolve(runtime.finish(output));
        }

        async function handleMessage(message) {
          if (!message || typeof message !== "object") {
            return;
          }

          if (message.type === "message") {
            runtime.say(String(message.content || ""), message.channel || "assistant");
            return;
          }

          if (message.type === "log") {
            runtime.log("external_log", {
              level: message.level || "info",
              content: message.content || ""
            });
            return;
          }

          if (message.type === "tool_call") {
            const requestId = message.requestId;
            if (!requestId) {
              finishWithError(new Error("Received tool_call without requestId from stdio agent."));
              return;
            }
            if (pendingToolCalls.has(requestId)) {
              finishWithError(new Error(`Duplicate tool_call requestId: ${requestId}`));
              return;
            }
            pendingToolCalls.set(requestId, true);
            try {
              const result = await runtime.callTool(message.tool, message.args || {});
              child.stdin.write(
                `${JSON.stringify({ type: "tool_result", requestId, result })}\n`
              );
            } catch (error) {
              child.stdin.write(
                `${JSON.stringify({
                  type: "tool_error",
                  requestId,
                  error: error?.message || String(error)
                })}\n`
              );
            } finally {
              pendingToolCalls.delete(requestId);
            }
            return;
          }

          if (message.type === "final_output") {
            finishSuccessfully(String(message.output || ""));
            return;
          }

          if (message.type === "transcript_event") {
            runtime.log("external_event", message.event || {});
          }
        }

        child.on("error", (error) => {
          finishWithError(error);
        });

        child.on("exit", (code) => {
          if (!settled) {
            if (code === 0) {
              finishWithError(
                new Error("stdio agent exited before sending final_output.")
              );
            } else {
              finishWithError(
                new Error(
                  `stdio agent exited with code ${code}. stderr: ${stderrBuffer.trim()}`
                )
              );
            }
          }
        });

        child.stderr.on("data", (chunk) => {
          stderrBuffer += String(chunk);
        });

        const lineReader = readline.createInterface({
          input: child.stdout
        });

        lineReader.on("line", (line) => {
          if (!line.trim()) {
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch (error) {
            finishWithError(
              new Error(`Invalid JSON from stdio agent: ${line}`)
            );
            return;
          }

          Promise.resolve(handleMessage(parsed)).catch((error) => {
            finishWithError(error);
          });
        });

        timeoutHandle = setTimeout(() => {
          finishWithError(new Error(`stdio agent timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        const payload = {
          type: "run_task",
          task: {
            id: task.id,
            name: task.name,
            prompt: task.prompt,
            metadata: task.metadata || {}
          },
          context: {
            trialIndex: context.trialIndex,
            suiteId: context.suite.id || context.suite.name
          }
        };

        child.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    }
  };
}

function createHttpAgent(config) {
  if (!config.url) {
    throw new Error('http config requires "url".');
  }

  return {
    name: config.name || `http:${config.url}`,
    async runTask(task, runtime, context) {
      const response = await fetch(config.url, {
        method: config.method || "POST",
        headers: {
          "content-type": "application/json",
          ...(config.headers || {})
        },
        body: JSON.stringify({
          task: {
            id: task.id,
            name: task.name,
            prompt: task.prompt,
            metadata: task.metadata || {}
          },
          context: {
            trialIndex: context.trialIndex,
            suiteId: context.suite.id || context.suite.name
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP agent returned ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      for (const event of payload.transcript || []) {
        if (event.type === "message") {
          runtime.say(String(event.content || ""), event.channel || "assistant");
        } else {
          runtime.log("external_event", event);
        }
      }

      if (payload.statePatch && typeof payload.statePatch === "object") {
        Object.assign(runtime.environment.state, payload.statePatch);
      }

      return runtime.finish(String(payload.output || ""));
    }
  };
}

function createClaudeCodeCliAgent(config, configPath) {
  const nodePath = config.nodePath || "node";
  const cliPath = resolveFromConfig(configPath, config.cliPath);
  const timeoutMs = Number(config.timeoutMs || 300000);
  const extraArgs = Array.isArray(config.extraArgs) ? config.extraArgs : [];
  const env = {
    ...process.env,
    ...(config.env || {})
  };

  if (!cliPath) {
    throw new Error(`claude_code_cli config requires "cliPath" in ${configPath}`);
  }

  return {
    name: config.name || "Claude Code CLI",
    async runTask(task, runtime) {
      const cwd = runtime.environment.cwd || config.cwd || process.cwd();
      const args = [cliPath, "-p", "--output-format", "json"];

      if (config.dangerouslySkipPermissions !== false) {
        args.push("--dangerously-skip-permissions");
      }
      if (config.model) {
        args.push("--model", String(config.model));
      }
      if (config.maxTurns) {
        args.push("--max-turns", String(config.maxTurns));
      }
      if (config.systemPrompt) {
        args.push("--append-system-prompt", String(config.systemPrompt));
      }
      args.push(...extraArgs.map(String));

      runtime.log("external_command", {
        command: nodePath,
        args,
        cwd
      });

      const result = await spawnForJsonResult({
        command: nodePath,
        args,
        cwd,
        env,
        timeoutMs,
        stdinText: task.prompt
      });

      runtime.log("external_command_result", {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderr: result.stderr
      });

      if (result.stderr.trim()) {
        runtime.log("external_stderr", {
          content: result.stderr.trim()
        });
      }

      const parsed = parseClaudeCodeJsonResult(result.stdout);
      runtime.log("external_agent_result", parsed);

      if (parsed.subtype !== "success" || parsed.is_error) {
        throw new Error(
          `Claude Code CLI returned subtype "${parsed.subtype}" with errors: ${[
            ...(parsed.errors || []),
            parsed.result
          ]
            .filter(Boolean)
            .join("; ")}`
        );
      }

      return runtime.finish(String(parsed.result || ""));
    }
  };
}

function spawnForJsonResult({ command, args, cwd, env, timeoutMs, stdinText }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch (_error) {
        // Ignore cleanup errors.
      }
    }, timeoutMs);

    function finish(err, payload) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(payload);
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(error);
    });
    if (stdinText) {
      child.stdin.write(String(stdinText));
    }
    child.stdin.end();
    child.on("exit", (code, signal) => {
      finish(null, {
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr
      });
    });
  });
}

function parseClaudeCodeJsonResult(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("Claude Code CLI returned empty stdout.");
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    const lastLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    if (!lastLine) {
      throw new Error("Claude Code CLI returned non-JSON stdout.");
    }
    return JSON.parse(lastLine);
  }
}

module.exports = {
  createAgentFromConfig
};
