// Issue #196 — Windows: child-process stdout capture for `pforge analyze`
// corrupts Unicode (box-drawing + ✓/⚠) to U+FFFD on disk.
//
// Root cause: PowerShell's default [Console]::OutputEncoding on Windows is
// the OEM codepage (CP437/CP850). When orchestrator.mjs::runAutoAnalyze
// captures stdout via execSync({ encoding: "utf-8" }), the OEM-encoded
// multi-byte glyphs decode as invalid UTF-8 → U+FFFD permanent corruption
// in summary.json.analyze.output.
//
// Fix lives in TWO places (defense in depth):
//   1. pforge.ps1 sets [Console]::OutputEncoding = UTF8 at startup.
//   2. orchestrator.mjs::runAutoAnalyze spawns PowerShell with a
//      -Command wrapper that sets the encoding BEFORE invoking pforge.ps1,
//      protecting older wrapper checkouts.
//
// This regression test pins both invariants. We don't actually spawn
// PowerShell here (CI runs on Linux); instead we assert on the static
// strings the production code uses.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

describe("Issue #196 — UTF-8 encoding for captured analyze CLI output", () => {
  describe("pforge.ps1 sets UTF-8 console encoding at startup", () => {
    const ps1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf-8");

    it("contains [Console]::OutputEncoding = UTF8 directive", () => {
      expect(ps1).toMatch(/\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/);
    });

    it("sets the directive early (within the first 60 lines of the script)", () => {
      const lines = ps1.split("\n");
      const idx = lines.findIndex((l) => /\[Console\]::OutputEncoding/.test(l));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(60);
    });

    it("wraps the setter in try/catch so constrained PS hosts don't crash", () => {
      const encodingIdx = ps1.indexOf("[Console]::OutputEncoding");
      // Walk backward up to 200 chars and forward to find the enclosing try block
      const window = ps1.slice(Math.max(0, encodingIdx - 200), encodingIdx + 400);
      expect(window).toMatch(/try\s*\{/);
      expect(window).toMatch(/\}\s*catch\s*\{/);
    });

    it("references Issue #196 in a nearby comment for grep-discoverability", () => {
      const encodingIdx = ps1.indexOf("[Console]::OutputEncoding");
      const window = ps1.slice(Math.max(0, encodingIdx - 600), encodingIdx);
      expect(window).toMatch(/#196/);
    });
  });

  describe("orchestrator.mjs::runAutoAnalyze forces UTF-8 in the spawn command", () => {
    const orch = readFileSync(join(REPO_ROOT, "pforge-mcp", "orchestrator.mjs"), "utf-8");

    it("Windows branch sets [Console]::OutputEncoding before invoking pforge.ps1", () => {
      // Find runAutoAnalyze function body
      const fnIdx = orch.indexOf("function runAutoAnalyze");
      expect(fnIdx).toBeGreaterThan(0);
      const fnBody = orch.slice(fnIdx, fnIdx + 2000);
      // The Windows command string must include the encoding setter
      expect(fnBody).toMatch(/\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/);
    });

    it("Windows branch still invokes pforge.ps1 analyze with the plan path", () => {
      const fnIdx = orch.indexOf("function runAutoAnalyze");
      const fnBody = orch.slice(fnIdx, fnIdx + 2000);
      expect(fnBody).toMatch(/pforge\.ps1\s+analyze/);
      // and templates the planPath
      expect(fnBody).toMatch(/\$\{planPath\}/);
    });

    it("Linux branch unchanged — bash pforge.sh analyze (no encoding kludge needed)", () => {
      const fnIdx = orch.indexOf("function runAutoAnalyze");
      const fnBody = orch.slice(fnIdx, fnIdx + 2000);
      expect(fnBody).toMatch(/bash pforge\.sh analyze/);
    });

    it("execSync still uses { encoding: 'utf-8' } so Node decodes correctly", () => {
      const fnIdx = orch.indexOf("function runAutoAnalyze");
      const fnBody = orch.slice(fnIdx, fnIdx + 2000);
      expect(fnBody).toMatch(/encoding:\s*["']utf-?8["']/);
    });

    it("references Issue #196 in the function for context", () => {
      const fnIdx = orch.indexOf("function runAutoAnalyze");
      const fnBody = orch.slice(fnIdx, fnIdx + 2000);
      expect(fnBody).toMatch(/#196/);
    });
  });

  describe("U+FFFD invariant — captured output round-trips Unicode safely", () => {
    // We can't spawn PowerShell from a Linux CI runner, but we can prove that
    // the encoding pipeline used by execSync({ encoding: "utf-8" }) preserves
    // box-drawing + checkmark codepoints when the underlying byte stream is
    // valid UTF-8. This validates our END of the contract — the producer
    // (PowerShell with [Console]::OutputEncoding=UTF8) must hold up its end.
    it("valid UTF-8 bytes for ╔═╗ and ✓ ⚠ decode without U+FFFD", () => {
      const sample = "╔══════════════╗\n║  ✓ pass  ⚠ warn  ║\n╚══════════════╝";
      const bytes = Buffer.from(sample, "utf-8");
      const decoded = bytes.toString("utf-8");
      expect(decoded).toBe(sample);
      expect(decoded).not.toContain("\uFFFD");
    });

    it("OEM-encoded bytes (the bug) DO produce U+FFFD when decoded as UTF-8", () => {
      // CP437 encodes ╔ as 0xC9, ═ as 0xCD, ╗ as 0xBB — all single bytes that
      // are invalid UTF-8 continuation bytes. This is the exact failure mode
      // we are eliminating.
      const cp437Bytes = Buffer.from([0xc9, 0xcd, 0xcd, 0xbb]);
      const decoded = cp437Bytes.toString("utf-8");
      expect(decoded).toContain("\uFFFD");
    });
  });
});
