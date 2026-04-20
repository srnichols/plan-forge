/**
 * Plan Forge — Testbed Happy-Path CLI Helper
 *
 * Phase TESTBED-02 Slice 01
 *
 * Lightweight CLI entry point for running all happy-path scenarios.
 * Called from pforge.ps1 / pforge.sh. Outputs JSON to stdout.
 *
 * Usage: node pforge-mcp/testbed/cli-happypath.mjs [--dry-run] [--testbed-path <path>] [--project-dir <path>]
 *
 * @module testbed/cli-happypath
 */

import { resolve } from "node:path";
import { listScenarios, loadScenario, resolveTestbedPath } from "./scenarios.mjs";
import { runScenario } from "./runner.mjs";

function parseArgs(argv) {
  const args = { dryRun: false, testbedPath: null, projectDir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--testbed-path" && argv[i + 1]) args.testbedPath = argv[++i];
    else if (argv[i] === "--project-dir" && argv[i + 1]) args.projectDir = argv[++i];
  }
  return args;
}

function makeMinimalHub() {
  const events = [];
  return { broadcast: (evt) => events.push(evt), eventHistory: events };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = resolve(args.projectDir);
  const hub = makeMinimalHub();

  const allScenarios = listScenarios({ projectRoot });
  const happyPathIds = allScenarios.filter(s => s.kind === "happy-path").map(s => s.scenarioId);

  let testbedPath;
  try {
    testbedPath = resolveTestbedPath({ testbedPath: args.testbedPath }, { projectRoot });
  } catch (err) {
    console.error(JSON.stringify({ error: err.code || "ERR_TESTBED", message: err.message }));
    process.exit(1);
  }

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
        dryRun: args.dryRun,
      });
      results.push(res);
      if (res.status === "passed") passed++;
      else failed++;
    } catch (runErr) {
      results.push({ scenarioId: id, status: "error", error: runErr.message, code: runErr.code });
      failed++;
    }
  }

  const summary = { passed, failed, total: happyPathIds.length, results };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(JSON.stringify({ error: "ERR_TESTBED", message: err.message }));
  process.exit(1);
});
