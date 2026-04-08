"use strict";

async function createMatrix() {
  return {
    id: "demo-eval-matrix",
    name: "Demo Eval Matrix",
    runs: [
      {
        id: "demo-capability",
        suite: "./examples/demo_suite.js",
        agent: "./examples/demo_agent.js",
        trials: 1,
        out: "demo-capability-report.json",
        gate: {
          allowedSignals: ["strong"],
          minAvgTaskPassRate: 1
        }
      }
    ]
  };
}

module.exports = {
  createMatrix
};
