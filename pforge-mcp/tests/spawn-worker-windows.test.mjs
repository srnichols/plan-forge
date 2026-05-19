/**
 * Plan Forge — Phase-33.3 Slice 2: Bug #121 spawnWorker windowsHide + git editor
 *
 * Verifies:
 *   (a) spawn options include windowsHide: true.
 *   (b) env block includes GIT_EDITOR: "true" to prevent editor blocking.
 *   (c) env block includes GIT_TERMINAL_PROMPT: "0".
 *   (d) env block includes GIT_SEQUENCE_EDITOR: "true".
 *   (e) All four options appear inside the same spawn(cmd, args, { ... }) block.
 *
 * Following the pattern of orchestrator-spawn-shell.test.mjs — source-code
 * inspection is used because the spawn call-site in orchestrator.mjs is complex
 * to reach via live invocation (detectWorkers, loadWorkerCapabilities, etc.).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
// Phase-53 S2: spawnWorker was extracted to orchestrator/worker-spawn.mjs
const src = readFileSync(resolve(__dirname, "..", "orchestrator", "worker-spawn.mjs"), "utf8");

// Bug #192 (v2.99.1): the spawn call now uses _spawnBin / _spawnArg locals
// (Windows routes through cmd.exe instead of shell:true). Extract THAT block.
const spawnBlock = src.match(/spawn\(_spawnBin, _spawnArg, \{[\s\S]*?\}\);/)?.[0] ?? "";

describe("spawnWorker — Bug #121 windowsHide + git editor prevention", () => {
  it("(a) spawn options include windowsHide: true", () => {
    expect(spawnBlock).not.toBe("");
    expect(spawnBlock).toContain("windowsHide: true");
  });

  it("(b) env block includes GIT_EDITOR: \"true\" to prevent editor blocking", () => {
    expect(spawnBlock).toContain('GIT_EDITOR: "true"');
  });

  it("(c) env block includes GIT_TERMINAL_PROMPT: \"0\"", () => {
    expect(spawnBlock).toContain('GIT_TERMINAL_PROMPT: "0"');
  });

  it("(d) env block includes GIT_SEQUENCE_EDITOR: \"true\"", () => {
    expect(spawnBlock).toContain('GIT_SEQUENCE_EDITOR: "true"');
  });

  it("(e) all four options appear within the same spawn call block", () => {
    expect(spawnBlock).toContain("windowsHide: true");
    expect(spawnBlock).toContain('GIT_EDITOR: "true"');
    expect(spawnBlock).toContain('GIT_TERMINAL_PROMPT: "0"');
    expect(spawnBlock).toContain('GIT_SEQUENCE_EDITOR: "true"');
  });

  it("existing options (stdio, cwd) are still present and no shell:true (Bug #192)", () => {
    expect(spawnBlock).toContain("stdio:");
    expect(spawnBlock).toContain("cwd");
    // Bug #192: shell option removed in favor of cmd.exe routing on Windows.
    expect(spawnBlock).not.toMatch(/\bshell\s*:/);
  });
});
