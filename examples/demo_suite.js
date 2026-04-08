"use strict";

function createEnvironmentFactory(builder) {
  return async ({ random, trialIndex }) => builder({ random, trialIndex });
}

async function createSuite() {
  return {
    id: "demo-agent-capability",
    name: "Demo Agent Capability Suite",
    mode: "capability",
    defaultTrials: 3,
    tasks: [
      {
        id: "policy_refund",
        name: "Grounded refund answer",
        prompt:
          "A user asks: 'Can I issue an instant refund for a failed accessory order worth $80?' Answer using the available policy tool.",
        metadata: {
          dimension: "grounded-answering"
        },
        createEnvironment: createEnvironmentFactory(() => ({
          state: {
            policyRead: false
          },
          tools: {
            fetch_policy: async () => ({
              instant_refund_limit: 100,
              note: "Orders under or equal to $100 can be instantly refunded after identity verification."
            })
          }
        })),
        graders: [
          {
            type: "contains_keywords",
            required: ["$100", "identity verification"],
            weight: 2
          },
          {
            type: "tool_usage",
            required: ["fetch_policy"],
            weight: 1
          },
          {
            type: "transcript_limits",
            maxToolCalls: 2,
            maxMessages: 3
          }
        ],
        scoring: {
          mode: "hybrid",
          threshold: 0.9,
          requiredGraders: ["tool_usage"]
        }
      },
      {
        id: "calculator_total",
        name: "Correct computation with tool usage",
        prompt:
          "Use the calculator tool to add 14 + 27 + 19, then answer with the numeric result only.",
        metadata: {
          dimension: "tool-use"
        },
        createEnvironment: createEnvironmentFactory(() => ({
          state: {
            lastCalculation: null
          },
          tools: {
            calculator: async ({ numbers }) => {
              const total = numbers.reduce((sum, value) => sum + Number(value), 0);
              return { total };
            }
          }
        })),
        graders: [
          {
            type: "exact_output",
            accepted: ["60"],
            weight: 2
          },
          {
            type: "tool_usage",
            required: ["calculator"],
            weight: 1
          }
        ],
        scoring: {
          mode: "all"
        }
      },
      {
        id: "restock_workflow",
        name: "Outcome-based workflow completion",
        prompt:
          "Check whether SKU-7 needs restocking. If stock is below 5, create a restock order for 20 units and confirm what you did.",
        metadata: {
          dimension: "outcome"
        },
        createEnvironment: createEnvironmentFactory(({ random, trialIndex }) => ({
          state: {
            inventory: {
              "SKU-7": trialIndex % 2 === 0 ? 3 : 2
            },
            restockOrder: null
          },
          tools: {
            lookup_inventory: async ({ sku }) => ({
              sku,
              stock: sku === "SKU-7" ? 3 + Math.floor(random() * 1) : 0
            }),
            create_restock_order: async ({ sku, quantity }, { state }) => {
              state.restockOrder = {
                sku,
                quantity,
                status: "created"
              };
              return state.restockOrder;
            }
          }
        })),
        graders: [
          {
            type: "state_assertion",
            expect: {
              "restockOrder.sku": "SKU-7",
              "restockOrder.quantity": 20,
              "restockOrder.status": "created"
            },
            weight: 2
          },
          {
            type: "tool_usage",
            required: ["lookup_inventory", "create_restock_order"],
            weight: 1
          },
          {
            type: "contains_keywords",
            required: ["SKU-7", "20"],
            weight: 1
          }
        ],
        scoring: {
          mode: "threshold",
          threshold: 0.9
        }
      }
    ]
  };
}

module.exports = {
  createSuite
};
