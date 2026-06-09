// Tests for bug #223: forge_analyze (pforge analyze) slice counter rejected
// slice headers at any level other than h3, so plans whose slices used h2/h4
// em-dash headers (### Slice N — Title is h3; Phase 70 used another level)
// reported "No execution slices found" and lost Test-Coverage scoring even
// though the canonical parser at plan-parser.mjs:237 (/^#{2,4}\s+Slice\s+\d+\b/)
// parsed them fine.
//
// The slice counter lives in the shell entrypoints (pforge.ps1 / pforge.sh),
// so we inspect their source and exercise the embedded regex against sample
// headers — the same source-inspection pattern used by background-console and
// cli-capture-encoding tests.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const ps1 = readFileSync(resolve(repoRoot, "pforge.ps1"), "utf-8");
const sh = readFileSync(resolve(repoRoot, "pforge.sh"), "utf-8");

// JS equivalent of the canonical slice-header regex (plan-parser.mjs:237).
const CANONICAL = /^#{2,4}\s+Slice\s+\d+\b/m;

const H2 = "## Slice 1 — Foundation";
const H3 = "### Slice 2 — Build";
const H4 = "#### Slice 3 — Ship";
const NOT_A_SLICE = "### Scope Contract";

describe("bug #223 — analyze slice counter accepts h2/h3/h4 headers", () => {
  it("canonical parser regex matches em-dash headers at all three levels", () => {
    expect(CANONICAL.test(H2)).toBe(true);
    expect(CANONICAL.test(H3)).toBe(true);
    expect(CANONICAL.test(H4)).toBe(true);
    expect(CANONICAL.test(NOT_A_SLICE)).toBe(false);
  });

  it("pforge.ps1 slice counter uses the h2-h4 regex, not h3-only", () => {
    expect(ps1).toContain("^#{2,4}\\s+Slice\\s+\\d+\\b");
    // The old h3-only literal must be gone from the analyze counter.
    expect(ps1).not.toContain("'(?m)^###\\s+Slice\\s+\\d')");
  });

  it("pforge.sh slice counter uses an h2-h4 ERE, not h3-only", () => {
    expect(sh).toContain("'^#{2,4}[[:space:]]+Slice[[:space:]]+[0-9]'");
    expect(sh).not.toContain("grep -c '^### Slice [0-9]'");
  });
});
