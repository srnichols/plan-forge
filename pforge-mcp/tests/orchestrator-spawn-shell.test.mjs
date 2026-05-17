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
const src = readFileSync(resolve(__dirname, "..", "orchestrator.mjs"), "utf8");

// The new spawn call uses the local names _spawnBin / _spawnArg created by the
// Bug #192 prelude. Extract THAT block (not the old `spawn(cmd, args, …)`).
const spawnBlock = src.match(/spawn\(_spawnBin, _spawnArg, \{[\s\S]*?\}\);/)?.[0] ?? "";

describe("spawnWorker — Bug #82 .cmd shim resolution (post Bug #192)", () => {
  it("Bug #192 cmd-routing prelude is present", () => {
    expect(src).toContain('_isWin    = process.platform === "win32"');
    expect(src).toContain('_spawnBin = _isWin ? "cmd" : cmd');
    expect(src).toContain('_spawnArg = _isWin ? ["/d", "/s", "/c", cmd, ...args] : args');
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

  it("only one spawn(_spawnBin, _spawnArg, …) call-site exists in orchestrator.mjs", () => {
    const all = src.match(/spawn\(_spawnBin, _spawnArg,/g) ?? [];
    expect(all.length).toBe(1);
  });
});
