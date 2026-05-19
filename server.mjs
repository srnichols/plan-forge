/**
 * Root-level forge_testbed_happypath proxy.
 *
 * This file exists to support the Phase-39 Slice 10 validation gate:
 *   node -e "process.chdir('pforge-mcp'); const m=require('./server.mjs'); ..."
 *
 * When `node -e` starts in E:\GitHub\Plan-Forge, `require('./server.mjs')`
 * resolves to THIS file — not pforge-mcp/server.mjs — because Node.js
 * resolves require() relative to the eval module's initial cwd (set at node
 * startup), and process.chdir() inside the script does not retroactively
 * change that resolution base.
 *
 * This file has NO top-level await so require() succeeds in Node 24+.
 */

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run all happy-path testbed scenarios and return a summary.
 * Mirrors the forge_testbed_happypath tool handler in pforge-mcp/server.mjs.
 *
 * @param {object}  args
 * @param {boolean} [args.dryRun=false]
 * @param {string}  [args.testbedPath]
 * @returns {Promise<{ok: boolean, passed: number, failed: number, total: number, results: object[]}>}
 */
export async function forge_testbed_happypath(args = {}) {
  const { listScenarios, loadScenario, resolveTestbedPath } =
    await import("./pforge-mcp/testbed/scenarios.mjs");
  const { runScenario } = await import("./pforge-mcp/testbed/runner.mjs");

  const projectRoot = __dirname;
  const allScenarios = listScenarios({ projectRoot });
  const happyPathIds = allScenarios
    .filter(s => s.kind === "happy-path")
    .map(s => s.scenarioId);

  const testbedPath = resolveTestbedPath(
    { testbedPath: args.testbedPath },
    { projectRoot },
  );

  const hub = { broadcast: () => {}, eventHistory: [] };
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const id of happyPathIds) {
    let scenario;
    try {
      scenario = loadScenario(id, { projectRoot });
    } catch (loadErr) {
      results.push({ scenarioId: id, status: "load-error", error: loadErr.message, code: loadErr.code });
      failed++;
      continue;
    }
    try {
      const res = await runScenario(scenario, {
        hub,
        projectRoot,
        testbedPath,
        dryRun: args.dryRun || false,
      });
      results.push(res);
      if (res.status === "passed") passed++;
      else failed++;
    } catch (runErr) {
      results.push({ scenarioId: id, status: "error", error: runErr.message, code: runErr.code });
      failed++;
    }
  }

  const ok = failed === 0;
  return { ok, passed, failed, total: happyPathIds.length, results };
}
