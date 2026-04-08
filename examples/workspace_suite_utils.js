"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function resetDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(target);
}

function writeFile(target, content) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, "utf8");
}

function writeJson(target, value) {
  writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspaceFactory(rootDir) {
  return function workspaceFor(taskId, trialIndex) {
    return path.join(rootDir, `${taskId}-trial-${trialIndex}`);
  };
}

function createEnvironmentFactory(rootDir, taskId, builder) {
  const workspaceFor = createWorkspaceFactory(rootDir);
  return async ({ trialIndex }) => {
    const cwd = workspaceFor(taskId, trialIndex);
    resetDir(cwd);
    await builder(cwd, trialIndex);
    return {
      cwd,
      state: {},
      tools: {}
    };
  };
}

module.exports = {
  ensureDir,
  resetDir,
  writeFile,
  writeJson,
  createWorkspaceFactory,
  createEnvironmentFactory
};
