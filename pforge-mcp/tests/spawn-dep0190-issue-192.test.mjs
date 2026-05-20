/**
 * Bug #192 (v2.99.1) — DEP0190: no spawn site may use `shell:true` + array args.
 *
 * Node's DEP0190 deprecation flags the legacy pattern of passing an args array
 * to spawn()/spawnSync() with `shell: true`, because Node concatenates the
 * args into a shell command line without escaping. This is an OWASP-relevant
 * argument-injection surface and will throw in a future Node major.
 *
 * The portable replacement (already used in workers/copilot-coding-agent.mjs):
 *   const isWin    = process.platform === "win32";
 *   const spawnBin = isWin ? "cmd" : bin;
 *   const spawnArg = isWin ? ["/d", "/s", "/c", bin, ...args] : args;
 *   spawn(spawnBin, spawnArg, { ..., windowsHide: isWin });
 *
 * This test inspects orchestrator.mjs / spaces-sync.mjs / github-metrics.mjs
 * sources to assert the bad pattern is gone and the cmd-routing pattern is in
 * place at the three known sites.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const orchSrc    = readFileSync(resolve(__dirname, "..", "orchestrator.mjs"),   "utf8");
// Phase-53 S2: spawnWorker was extracted to orchestrator/worker-spawn.mjs
const workerSpawnSrc = readFileSync(resolve(__dirname, "..", "orchestrator", "worker-spawn.mjs"), "utf8");
const spacesSrc  = readFileSync(resolve(__dirname, "..", "spaces-sync.mjs"),    "utf8");
const metricsSrc = readFileSync(resolve(__dirname, "..", "github-metrics.mjs"), "utf8");

describe("Bug #192 — no DEP0190 spawn pattern", () => {
  it("orchestrator.mjs: no `shell: process.platform === \"win32\"` remains", () => {
    expect(orchSrc).not.toContain('shell: process.platform === "win32"');
    // Also check the extracted sub-module
    expect(workerSpawnSrc).not.toContain('shell: process.platform === "win32"');
  });

  it("spaces-sync.mjs: no `shell: process.platform === \"win32\"` remains", () => {
    expect(spacesSrc).not.toContain('shell: process.platform === "win32"');
  });

  it("github-metrics.mjs: no `shell: process.platform === \"win32\"` remains", () => {
    expect(metricsSrc).not.toContain('shell: process.platform === "win32"');
  });

  it("orchestrator.mjs: cmd-routing pattern present near the worker spawn", () => {
    // Phase-53 S2: spawnWorker extracted to orchestrator/worker-spawn.mjs
    // Phase-43 C-series: vars renamed _spawnBin/_isWin → spawnBin/isWindows
    const m = workerSpawnSrc.match(/spawnBin = isWindows \? "cmd" : cmd[\s\S]{0,1200}return spawn\(spawnBin/);
    expect(m).not.toBeNull();
  });

  it("spaces-sync.mjs: cmd-routing pattern present", () => {
    expect(spacesSrc).toContain('isWin ? "cmd" : ghCmd');
    expect(spacesSrc).toContain('"/d", "/s", "/c", ghCmd, "api"');
  });

  it("github-metrics.mjs: cmd-routing pattern present", () => {
    expect(metricsSrc).toContain('isWin ? "cmd" : ghCmd');
    expect(metricsSrc).toContain('"/d", "/s", "/c", ghCmd, "api", url');
  });

  it("orchestrator.mjs: worker spawn still pipes stdio and sets windowsHide", () => {
    // Phase-53 S2: spawnWorker extracted to orchestrator/worker-spawn.mjs
    // Phase-43 C-series: spawn call now uses spawnBin/spawnArgs inside spawnCliWorkerProcess()
    const block = workerSpawnSrc.match(/return spawn\(spawnBin, spawnArgs, \{[\s\S]*?\}\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toContain("stdio:");
    expect(block[0]).toContain("windowsHide: true");
  });

  it("orchestrator.mjs: worker spawn no longer passes a shell option", () => {
    // Phase-53 S2: spawnWorker extracted to orchestrator/worker-spawn.mjs
    // Phase-43 C-series: spawn call now uses spawnBin/spawnArgs inside spawnCliWorkerProcess()
    const block = workerSpawnSrc.match(/return spawn\(spawnBin, spawnArgs, \{[\s\S]*?\}\);/);
    expect(block).not.toBeNull();
    expect(block[0]).not.toMatch(/\bshell\s*:/);
  });

  it("workers/copilot-coding-agent.mjs reference pattern intact (regression guard)", () => {
    const refSrc = readFileSync(
      resolve(__dirname, "..", "workers", "copilot-coding-agent.mjs"),
      "utf8"
    );
    // The reference implementation we modeled the fix on must not regress.
    expect(refSrc).toContain('isWindows ? "cmd" : "gh"');
    expect(refSrc).toContain('"/d", "/s", "/c", "gh"');
    expect(refSrc).not.toContain('shell: process.platform === "win32"');
  });
});
