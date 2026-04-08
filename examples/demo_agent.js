"use strict";

async function createAgent() {
  return {
    name: "Heuristic Demo Agent",
    async runTask(task, runtime, { random }) {
      if (task.id === "policy_refund") {
        runtime.say("I should ground this answer in policy before responding.");
        const policy = await runtime.callTool("fetch_policy", { topic: "refunds" });
        const shouldSlip = random() < 0.15;
        if (shouldSlip) {
          return runtime.finish("Yes, you can refund it right away.");
        }
        return runtime.finish(
          `Yes. Because the order is under $${policy.instant_refund_limit}, it can be instantly refunded after identity verification.`
        );
      }

      if (task.id === "calculator_total") {
        runtime.say("I'll compute it with the calculator tool.");
        const result = await runtime.callTool("calculator", {
          numbers: [14, 27, 19]
        });
        return runtime.finish(String(result.total));
      }

      if (task.id === "restock_workflow") {
        runtime.say("I'll inspect stock first.");
        const inventory = await runtime.callTool("lookup_inventory", { sku: "SKU-7" });
        if (inventory.stock < 5) {
          await runtime.callTool("create_restock_order", {
            sku: "SKU-7",
            quantity: 20
          });
          return runtime.finish("Created a restock order for SKU-7 with quantity 20.");
        }
        return runtime.finish("SKU-7 has enough stock already.");
      }

      throw new Error(`Unsupported task: ${task.id}`);
    }
  };
}

module.exports = {
  createAgent
};
