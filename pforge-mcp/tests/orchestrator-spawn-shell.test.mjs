/**
 * Bug #82 — Windows: spawn claude ENOENT — missing shell:true on Windows.
 *
 * On Windows, npm-global CLIs (claude, codex) are installed as .cmd shims.
 * Node.js spawn() does not resolve .cmd extensions without shell:true.
 * The fix adds `shell: process.platform === "win32"` to the spawn options
 * in spawnWorker().
 *
 * These tests verify the source code contains the correct guard by parsing
 * the spawn call-site AST-free (regex on source). We cannot vi.spyOn(spawn)
 * because Node marks child_process.spawn as non-configurable.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const src = readFileSync(resolve(__dirname, "..", "orchestrator.mjs"), "utf8");

describe("spawnWorker — bug #82 shell option on Windows", () => {
  it("source code contains shell: process.platform === \"win32\" in spawn options", () => {
    expect(src).toContain('shell: process.platform === "win32"');
  });

  it("the shell guard appears inside the spawn() call, not elsewhere", () => {
    // Find the spawn call block and verify shell option is within it
    const spawnBlock = src.match(/const child = spawn\(cmd, args, \{[\s\S]*?\}\);/);
    expect(spawnBlock).not.toBeNull();
    expect(spawnBlock[0]).toContain('shell: process.platform === "win32"');
  });

  it("spawn options include stdio pipes", () => {
    const spawnBlock = src.match(/const child = spawn\(cmd, args, \{[\s\S]*?\}\);/);
    expect(spawnBlock).not.toBeNull();
    expect(spawnBlock[0]).toContain("stdio:");
  });

  it("spawn options include cwd", () => {
    const spawnBlock = src.match(/const child = spawn\(cmd, args, \{[\s\S]*?\}\);/);
    expect(spawnBlock).not.toBeNull();
    expect(spawnBlock[0]).toContain("cwd");
  });

  it("no other spawn(cmd, args, ...) calls exist without the shell guard", () => {
    // Split into lines and find spawn call-sites, then verify each block has shell:
    const lines = src.split(/\r?\n/);
    const spawnLineIdxs = lines
      .map((l, i) => (l.includes("spawn(cmd, args,") ? i : -1))
      .filter((i) => i >= 0);
    expect(spawnLineIdxs.length).toBeGreaterThan(0);
    for (const idx of spawnLineIdxs) {
      // Check the next 20 lines for shell: (window widened for env-block additions)
      const block = lines.slice(idx, idx + 20).join("\n");
      expect(block).toContain("shell:");
    }
  });
});
