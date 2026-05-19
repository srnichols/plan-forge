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
import { readFileSync, existsSync } from "node:fs";
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

// Normalize volatile fields so minor version bumps don't fail the comparison.
// Keeps structural content (sections, pass/fail lines, hook counts) intact.
function normalize(text) {
  return (
    text
      // Semver-like version strings: v1.2.3, v1.2.3.windows.4, 1.2.3.windows.4
      .replace(/v\d+\.\d+\.\d+(?:\.\S*)?/g, "v<version>")
      .replace(/\b\d+\.\d+\.\d+(?:\.\S+)?\b/g, "<version>")
      // Cache age: "(cached 95m ago)" → "(cached <age>)"
      .replace(/\(cached \d+[smhd]+ ago\)/g, "(cached <age>)")
      // Trailing whitespace and CRLF → LF
      .replace(/\r\n/g, "\n")
      .replace(/ +\n/g, "\n")
  );
}

describe("smith-golden: pforge smith output stability", () => {
  it.skipIf(!isWindows || !testbedExists || !ps1Exists)(
    "smith output matches the S2 golden fixture (normalized)",
    () => {
      const goldenRaw = readFileSync(GOLDEN, "utf-8");
      expect(goldenRaw.length, "Golden fixture should be non-empty").toBeGreaterThan(100);

      const result = spawnSync(
        "pwsh",
        ["-NonInteractive", "-NoProfile", "-Command", `& '${PFORGE_PS1}' smith`],
        { cwd: TESTBED, encoding: "utf-8", timeout: 60_000 }
      );

      const actual = normalize(result.stdout + result.stderr);
      const expected = normalize(goldenRaw);

      expect(actual).toBe(expected);
    }
  );
});
