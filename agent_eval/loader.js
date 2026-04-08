"use strict";

const fs = require("fs");
const path = require("path");
const { createAgentFromConfig } = require("./adapters");

function resolveModule(modulePath) {
  return path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(process.cwd(), modulePath);
}

function requireFresh(modulePath) {
  const resolved = resolveModule(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

async function loadSuite(modulePath) {
  if (!fs.existsSync(resolveModule(modulePath))) {
    throw new Error(`Suite module not found: ${modulePath}`);
  }

  const mod = requireFresh(modulePath);
  if (typeof mod.createSuite === "function") {
    return await mod.createSuite();
  }
  if (mod.suite) {
    return mod.suite;
  }
  throw new Error(`Suite module "${modulePath}" must export createSuite() or suite.`);
}

async function loadAgent(modulePath) {
  const resolved = resolveModule(modulePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Agent module not found: ${modulePath}`);
  }

  if (path.extname(resolved).toLowerCase() === ".json") {
    const config = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return createAgentFromConfig(config, {
      configPath: resolved,
      resolveModule
    });
  }

  const mod = requireFresh(modulePath);
  if (typeof mod.createAgent === "function") {
    return await mod.createAgent();
  }
  if (mod.agent) {
    return mod.agent;
  }
  throw new Error(`Agent module "${modulePath}" must export createAgent() or agent.`);
}

module.exports = {
  loadSuite,
  loadAgent,
  resolveModule
};
