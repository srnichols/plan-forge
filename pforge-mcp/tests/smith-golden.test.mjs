/**
 * Phase-41 ENUMS-CENTRALIZATION Slice 2
 * Smoke-test: pforge smith output against the testbed is stable.
 *
 * On every run we capture current smith output, normalize volatile fields
 * (tool versions, cache age timestamps), then compare against the golden
 * fixture captured at S2-time.  Any structural change in smith output
 * (added/removed sections, changed hook counts, new fail messages) will
 * surface here.
 *
 * The test is skipped on CI / non-Windows runners where pforge.ps1 cannot
 * run — use the companion pforge.sh path for that case.
 *
 * Testbed: E:\GitHub\plan-forge-testbed  (read-only; must NOT be modified)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "fixtures");
const GOLDEN = resolve(FIXTURES, "smith-golden-pre-enums.txt");

const TESTBED = "E:\\GitHub\\plan-forge-testbed";
const PFORGE_PS1 = resolve(HERE, "..", "..", "pforge.ps1");

const isWindows = process.platform === "win32";
const testbedExists = existsSync(TESTBED);
const ps1Exists = existsSync(PFORGE_PS1);

/** Strip ANSI escape sequences so golden diffs are color-independent. */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// Normalize volatile fields so minor version bumps don't fail the comparison.
// Keeps structural content (sections, hook counts) intact while masking items
// that legitimately vary between environments (tool availability, API key presence).
function normalize(text) {
  return (
    stripAnsi(text)
      // Semver-like version strings: v1.2.3, v1.2.3.windows.4, 1.2.3.windows.4
      .replace(/v\d+\.\d+\.\d+(?:\.\S*)?/g, "v<version>")
      .replace(/\b\d+\.\d+\.\d+(?:\.\S+)?\b/g, "<version>")
      // Cache age: "(cached 95m ago)" → "(cached <age>)"
      .replace(/\(cached \d+[smhd]+ ago\)/g, "(cached <age>)")
      // gh-copilot agentic status: varies by environment (login session, flags)
      .replace(/gh-copilot v<version>[^\n]*/g, "gh-copilot v<version> <copilot-agent-status>")
      // copilot-coding-agent: check result changes with gh auth state
      .replace(/copilot-coding-agent v[^\n]*/g, "copilot-coding-agent <coding-agent-status>")
      // Image API key presence: XAI_API_KEY / OPENAI_API_KEY vary by environment
      .replace(/[^\S\n]*(?:✓|✅|Γ£à)[^\n]*API_KEY[^\n]*/g, "  <api-key-present>")
      .replace(/[^\S\n]*(?:✓|✅|Γ£à)[^\n]*Grok Aurora[^\n]*/g, "  <api-key-present>")
      .replace(/[^\S\n]*(?:⚠|⚠️|ΓÜá∩╕Å)[^\n]*No image API keys configured[^\n]*/g, "  <no-api-keys>")
      .replace(/[^\S\n]+FIX: Set XAI_API_KEY or OPENAI_API_KEY[^\n]*/g, "")
      // Results summary: pass/fail/warning counts vary with environment state
      .replace(/Results:\s+\d+ passed\s*\|\s*\d+ failed\s*\|\s*\d+ warnings/g, "Results: <summary>")
      // "Fix the N issue(s) above" count varies
      .replace(/Fix the \d+ issue\(s\) above[^\n]*/g, "Fix <n> issue(s) above")
      // Box-drawing characters (U+2500–U+257F) and CP850 mojibake variants
      // The golden may be captured in a different console encoding than the test run;
      // normalise all box-drawing to ASCII dashes/pipes so the structural content
      // is compared rather than the frame decoration.
      .replace(/[─━╔╗╚╝║═╠╣╦╩╬┌┐└┘├┤┬┴┼│\u2500-\u257F]+/g, "<box>")
      // Windows-1252 / CP850 mojibake of the same box chars (ΓòöΓòÉΓòÉ… etc.)
      .replace(/[\u0393\u00F2\u00F6\u00DC\u00C9\u00C7\u00C6\u00C8\u00C4\u00C3\u00BF]+/g, "<box>")
      // Trailing whitespace and CRLF → LF
      .replace(/\r\n/g, "\n")
      .replace(/ +\n/g, "\n")
  );
}

function runSmith() {
  return spawnSync(
    "pwsh",
    ["-NonInteractive", "-NoProfile", "-File", PFORGE_PS1, "smith"],
    { cwd: TESTBED, encoding: "utf-8", timeout: 60_000 }
  );
}

// Run smith once and share the result across both tests in this file.
// Avoids running pforge.ps1 twice (each invocation takes 15–30 s under load).
const canRun = isWindows && testbedExists && ps1Exists;
let _smithOutput = null;
function getSmithOutput() {
  if (_smithOutput === null) {
    const result = runSmith();
    _smithOutput = result.stdout + result.stderr;
  }
  return _smithOutput;
}

describe("smith-golden: pforge smith output stability", () => {
  it.skipIf(!canRun)(
    "smith reports 8/8 lifecycle hooks (PostRun added by Phase-39/41)",
    () => {
      const output = normalize(getSmithOutput());
      expect(output).toMatch(/8\/8 lifecycle hooks present/);
      expect(output).not.toMatch(/Missing hooks:.*PostRun/);
    },
    90_000
  );

  it.skipIf(!canRun)(
    "smith output matches the S2 golden fixture (normalized)",
    () => {
      const goldenRaw = readFileSync(GOLDEN, "utf-8");

      if (!goldenRaw.trim()) {
        // Golden was not captured yet — populate it from the current run and
        // consider this test passed (first-capture mode).
        const captured = stripAnsi(getSmithOutput());
        writeFileSync(GOLDEN, captured, "utf-8");
        console.warn(
          "[smith-golden] Golden was empty — captured from current run. " +
            "Re-run to validate stability."
        );
        expect(captured.trim().length).toBeGreaterThan(100);
        return;
      }

      expect(goldenRaw.length, "Golden fixture should be non-empty").toBeGreaterThan(100);

      const actual = normalize(getSmithOutput());
      const expected = normalize(goldenRaw);

      expect(actual).toBe(expected);
    },
    90_000
  );
});
