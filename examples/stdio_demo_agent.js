"use strict";

const readline = require("readline");

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function createRpcRuntime() {
  let nextRequestId = 1;
  const pending = new Map();

  const reader = readline.createInterface({
    input: process.stdin
  });

  reader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    const message = JSON.parse(line);
    if (message.type === "tool_result" || message.type === "tool_error") {
      const handler = pending.get(message.requestId);
      if (!handler) {
        return;
      }
      pending.delete(message.requestId);
      if (message.type === "tool_error") {
        handler.reject(new Error(message.error || "Unknown tool error"));
      } else {
        handler.resolve(message.result);
      }
    } else if (message.type === "run_task") {
      void runTask(message.task, runtime).catch((error) => {
        writeMessage({
          type: "final_output",
          output: `Agent error: ${error.message || String(error)}`
        });
        process.exitCode = 1;
      });
    }
  });

  const runtime = {
    say(content, channel = "assistant") {
      writeMessage({
        type: "message",
        channel,
        content
      });
    },

    async callTool(tool, args = {}) {
      const requestId = `req-${nextRequestId++}`;
      writeMessage({
        type: "tool_call",
        requestId,
        tool,
        args
      });
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
    },

    finish(output) {
      writeMessage({
        type: "final_output",
        output
      });
      process.exit(0);
    }
  };

  return runtime;
}

async function runTask(task, runtime) {
  if (task.id === "policy_refund") {
    runtime.say("I'll verify the refund policy first.");
    const policy = await runtime.callTool("fetch_policy", { topic: "refunds" });
    runtime.finish(
      `Yes. Because the order is under $${policy.instant_refund_limit}, it can be instantly refunded after identity verification.`
    );
    return;
  }

  if (task.id === "calculator_total") {
    runtime.say("Using calculator.");
    const result = await runtime.callTool("calculator", {
      numbers: [14, 27, 19]
    });
    runtime.finish(String(result.total));
    return;
  }

  if (task.id === "restock_workflow") {
    runtime.say("Checking SKU-7 inventory.");
    const inventory = await runtime.callTool("lookup_inventory", { sku: "SKU-7" });
    if (inventory.stock < 5) {
      await runtime.callTool("create_restock_order", {
        sku: "SKU-7",
        quantity: 20
      });
      runtime.finish("Created a restock order for SKU-7 with quantity 20.");
      return;
    }
    runtime.finish("SKU-7 has enough stock already.");
    return;
  }

  runtime.finish(`Unsupported task ${task.id}`);
}

const runtime = createRpcRuntime();
