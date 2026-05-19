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
// Keeps structural content (sections, pass/fail lines, hook counts) intact.
function normalize(text) {
  return (
    stripAnsi(text)
      // Semver-like version strings: v1.2.3, v1.2.3.windows.4, 1.2.3.windows.4
      .replace(/v\d+\.\d+\.\d+(?:\.\S*)?/g, "v<version>")
      .replace(/\b\d+\.\d+\.\d+(?:\.\S+)?\b/g, "<version>")
      // Cache age: "(cached 95m ago)" → "(cached <age>)"
      .replace(/\(cached \d+[smhd]+ ago\)/g, "(cached <age>)")
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

describe("smith-golden: pforge smith output stability", () => {
  it.skipIf(!isWindows || !testbedExists || !ps1Exists)(
    "smith reports 8/8 lifecycle hooks (PostRun added by Phase-39/41)",
    () => {
      const result = runSmith();
      const output = normalize(result.stdout + result.stderr);
      expect(output).toMatch(/8\/8 lifecycle hooks present/);
      expect(output).not.toMatch(/Missing hooks:.*PostRun/);
    }
  );

  it.skipIf(!isWindows || !testbedExists || !ps1Exists)(
    "smith output matches the S2 golden fixture (normalized)",
    () => {
      const goldenRaw = readFileSync(GOLDEN, "utf-8");

      if (!goldenRaw.trim()) {
        // Golden was not captured yet — populate it from the current run and
        // consider this test passed (first-capture mode).
        const result = runSmith();
        const captured = stripAnsi(result.stdout + result.stderr);
        writeFileSync(GOLDEN, captured, "utf-8");
        console.warn(
          "[smith-golden] Golden was empty — captured from current run. " +
            "Re-run to validate stability."
        );
        expect(captured.trim().length).toBeGreaterThan(100);
        return;
      }

      expect(goldenRaw.length, "Golden fixture should be non-empty").toBeGreaterThan(100);

      const result = runSmith();
      const actual = normalize(result.stdout + result.stderr);
      const expected = normalize(goldenRaw);

      expect(actual).toBe(expected);
    }
  );
});
