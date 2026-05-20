/**
 * Bug #82 — Windows: spawn claude ENOENT — original fix was `shell:true` on
 * Windows. Bug #192 (v2.99.1) replaced that with cmd.exe routing to avoid
 * Node's DEP0190 deprecation. This file now asserts the *replacement* pattern
 * still resolves .cmd shims on Windows.
 *
 * Source-code inspection is used because Node marks child_process.spawn as
 * non-configurable and the real spawn call-site requires worker detection.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
// Phase-53 S2: spawnWorker moved to orchestrator/worker-spawn.mjs
// Phase-43 C-series: vars renamed _isWin/_spawnBin/_spawnArg → isWindows/spawnBin/spawnArgs
//   and extracted into spawnCliWorkerProcess() helper.
const src = readFileSync(resolve(__dirname, "..", "orchestrator", "worker-spawn.mjs"), "utf8");

// Phase-43: spawn call now uses spawnBin / spawnArgs inside spawnCliWorkerProcess().
const spawnBlock = src.match(/return spawn\(spawnBin, spawnArgs, \{[\s\S]*?\}\);/)?.[0] ?? "";

describe("spawnWorker — Bug #82 .cmd shim resolution (post Bug #192)", () => {
  it("Bug #192 cmd-routing prelude is present", () => {
    expect(src).toContain('isWindows = process.platform === "win32"');
    expect(src).toContain('spawnBin = isWindows ? "cmd" : cmd');
    expect(src).toContain('spawnArgs = isWindows ? ["/d", "/s", "/c", cmd, ...args] : args');
  });

  it("worker spawn no longer uses the deprecated shell:true pattern", () => {
    expect(spawnBlock).not.toBe("");
    expect(spawnBlock).not.toMatch(/\bshell\s*:/);
    expect(src).not.toContain('shell: process.platform === "win32"');
  });

  it("worker spawn still pipes stdio", () => {
    expect(spawnBlock).toContain("stdio:");
  });

  it("worker spawn still sets cwd", () => {
    expect(spawnBlock).toContain("cwd");
  });

  it("only one spawn(spawnBin, spawnArgs, …) call-site exists in worker-spawn.mjs", () => {
    const all = src.match(/return spawn\(spawnBin, spawnArgs,/g) ?? [];
    expect(all.length).toBe(1);
  });
});
