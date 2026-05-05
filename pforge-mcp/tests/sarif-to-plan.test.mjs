/**
 * Plan Forge — Phase GITHUB-B Slice 6: sarif-to-plan core module tests.
 *
 * Covers the five cases required by the Slice 6 acceptance criteria:
 *   1. Empty SARIF          → NoFindingsError (exitCode 1)
 *   2. Single-finding SARIF → 1-slice plan, severity reflected in header
 *   3. Multi-finding SARIF  → slices ordered by severity (critical first)
 *   4. No securitySeverity  → falls back to `level` field
 *   5. Malformed JSON       → ParseError (exitCode 2)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  sarifToPlan,
  NoFindingsError,
  ParseError,
  SarifError,
} from "../sarif-to-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "sarif");

function fixture(name) {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// ─── Case 1: Empty SARIF ──────────────────────────────────────────────────────

describe("sarifToPlan — empty SARIF", () => {
  it("throws NoFindingsError", () => {
    const raw = fixture("empty.sarif.json");
    expect(() => sarifToPlan(raw)).toThrow(NoFindingsError);
  });

  it("NoFindingsError has exitCode 1", () => {
    const raw = fixture("empty.sarif.json");
    let err;
    try {
      sarifToPlan(raw);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NoFindingsError);
    expect(err.exitCode).toBe(1);
    expect(err.message).toMatch(/no findings/i);
  });

  it("also throws for a completely empty object", () => {
    expect(() => sarifToPlan({ runs: [{ tool: { driver: { rules: [] } }, results: [] }] }))
      .toThrow(NoFindingsError);
  });
});

// ─── Case 2: Single-finding SARIF ─────────────────────────────────────────────

describe("sarifToPlan — single-finding SARIF", () => {
  it("generates a plan with exactly one slice", () => {
    const raw = fixture("single-high.sarif.json");
    const plan = sarifToPlan(raw, { source: "scan.sarif" });
    const slices = [...plan.matchAll(/^## Slice \d+/gm)];
    expect(slices).toHaveLength(1);
  });

  it("includes 'high' in the severity summary", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { source: "scan.sarif" });
    expect(plan).toMatch(/\|\s*high\s*\|\s*1\s*\|/);
  });

  it("includes Source and Generated front-matter lines", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { source: "scan.sarif" });
    expect(plan).toMatch(/^Source: scan\.sarif$/m);
    expect(plan).toMatch(/^Generated: \d{4}-\d{2}-\d{2}T/m);
  });

  it("slice contains the rule ID and message text", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { source: "scan.sarif" });
    expect(plan).toMatch(/\[js\/sql-injection\]/);
    expect(plan).toMatch(/user-provided value/);
  });

  it("slice lists the correct file in scope", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { source: "scan.sarif" });
    expect(plan).toMatch(/src\/db\/queries\.js/);
  });

  it("slice includes a TODO validation gate placeholder", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { source: "scan.sarif" });
    expect(plan).toMatch(/echo "TODO: add validation gate for js\/sql-injection"/);
  });
});

// ─── Case 3: Multi-finding SARIF — severity ordering ─────────────────────────

describe("sarifToPlan — multi-finding SARIF", () => {
  it("generates a slice for every finding", () => {
    const plan = sarifToPlan(fixture("multi-mixed.sarif.json"));
    const slices = [...plan.matchAll(/^## Slice \d+/gm)];
    // fixture has 4 findings
    expect(slices).toHaveLength(4);
  });

  it("orders slices by severity descending (critical first)", () => {
    const plan = sarifToPlan(fixture("multi-mixed.sarif.json"));
    // critical (path-injection, 9.3) → high (sql-injection, 8.8) → medium (xss, 6.1) → low (unused-variable, 1.0)
    const sliceLines = [...plan.matchAll(/^## Slice \d+ — \[(.+?)\]/gm)].map((m) => m[1]);
    expect(sliceLines[0]).toBe("js/path-injection");
    expect(sliceLines[1]).toBe("js/sql-injection");
    expect(sliceLines[2]).toBe("js/xss");
    expect(sliceLines[3]).toBe("js/unused-variable");
  });

  it("deduplicates repeated URIs in a single finding's Files in scope", () => {
    const plan = sarifToPlan(fixture("multi-mixed.sarif.json"));
    // sql-injection finding references src/db/queries.js twice; should appear once
    const sqlSlice = plan.split(/^## Slice/m).find((s) => s.includes("sql-injection")) ?? "";
    const uriMatches = [...sqlSlice.matchAll(/src\/db\/queries\.js/g)];
    // Should appear in **Files in scope** and **Goal** lines, but not duplicated in the files list
    const scopeLine = sqlSlice.split("\n").find((l) => l.startsWith("**Files in scope**")) ?? "";
    const scopeUris = scopeLine.split(":")[1]?.split(",").map((s) => s.trim()) ?? [];
    const deduped = scopeUris.filter((u) => u === "src/db/queries.js");
    expect(deduped).toHaveLength(1);
  });

  it("severity histogram sums to total findings", () => {
    const plan = sarifToPlan(fixture("multi-mixed.sarif.json"));
    const rows = [...plan.matchAll(/\|\s*(\w+)\s*\|\s*(\d+)\s*\|/g)];
    const total = rows.reduce((sum, m) => sum + parseInt(m[2], 10), 0);
    expect(total).toBe(4);
  });
});

// ─── Case 4: No securitySeverity — level fallback ────────────────────────────

describe("sarifToPlan — level fallback (no securitySeverity)", () => {
  function buildSarif(results, rules) {
    return {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "TestTool", rules } }, results }],
    };
  }

  it("error level → high severity", () => {
    const doc = buildSarif(
      [{ ruleId: "r1", message: { text: "msg" }, level: "error", locations: [] }],
      [{ id: "r1", shortDescription: { text: "desc" }, defaultConfiguration: { level: "error" } }]
    );
    const plan = sarifToPlan(doc);
    expect(plan).toMatch(/\|\s*high\s*\|\s*1\s*\|/);
  });

  it("warning level → medium severity", () => {
    const doc = buildSarif(
      [{ ruleId: "r1", message: { text: "msg" }, level: "warning", locations: [] }],
      [{ id: "r1", shortDescription: { text: "desc" }, defaultConfiguration: { level: "warning" } }]
    );
    const plan = sarifToPlan(doc);
    expect(plan).toMatch(/\|\s*medium\s*\|\s*1\s*\|/);
  });

  it("note level → low severity", () => {
    const doc = buildSarif(
      [{ ruleId: "r1", message: { text: "msg" }, level: "note", locations: [] }],
      [{ id: "r1", shortDescription: { text: "desc" }, defaultConfiguration: { level: "note" } }]
    );
    const plan = sarifToPlan(doc);
    expect(plan).toMatch(/\|\s*low\s*\|\s*1\s*\|/);
  });

  it("result level takes precedence over rule defaultConfiguration level", () => {
    const doc = buildSarif(
      // result says 'error' but rule default says 'note'
      [{ ruleId: "r1", message: { text: "msg" }, level: "error", locations: [] }],
      [{ id: "r1", shortDescription: { text: "desc" }, defaultConfiguration: { level: "note" } }]
    );
    const plan = sarifToPlan(doc);
    // Should use result.level = error → high
    expect(plan).toMatch(/\|\s*high\s*\|\s*1\s*\|/);
  });

  it("no level at all defaults to medium (warning fallback)", () => {
    const doc = buildSarif(
      [{ ruleId: "r1", message: { text: "msg" }, locations: [] }],
      [{ id: "r1", shortDescription: { text: "desc" } }]
    );
    const plan = sarifToPlan(doc);
    expect(plan).toMatch(/\|\s*medium\s*\|\s*1\s*\|/);
  });
});

// ─── Case 5: Malformed SARIF JSON ─────────────────────────────────────────────

describe("sarifToPlan — malformed SARIF JSON", () => {
  it("throws ParseError on invalid JSON string", () => {
    expect(() => sarifToPlan("{ not valid json }")).toThrow(ParseError);
  });

  it("ParseError has exitCode 2", () => {
    let err;
    try {
      sarifToPlan("{ not valid json }");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/SARIF parse error/i);
  });

  it("ParseError is a SarifError subclass", () => {
    let err;
    try {
      sarifToPlan("oops");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SarifError);
  });

  it("throws ParseError on null input", () => {
    expect(() => sarifToPlan(null)).toThrow(ParseError);
  });
});

// ─── Additional edge cases ────────────────────────────────────────────────────

describe("sarifToPlan — edge cases", () => {
  it("result with no location → files in scope shows placeholder", () => {
    const doc = {
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "T", rules: [{ id: "r1", shortDescription: { text: "d" } }] } },
          results: [{ ruleId: "r1", message: { text: "m" }, locations: [] }],
        },
      ],
    };
    const plan = sarifToPlan(doc);
    expect(plan).toMatch(/\(no location in SARIF\)/);
  });

  it("accepts a pre-parsed object (not just a string)", () => {
    const doc = JSON.parse(fixture("single-high.sarif.json"));
    expect(() => sarifToPlan(doc)).not.toThrow();
  });

  it("planName option overrides the default heading", () => {
    const plan = sarifToPlan(fixture("single-high.sarif.json"), { planName: "MY-CUSTOM-PLAN" });
    expect(plan).toMatch(/^# MY-CUSTOM-PLAN$/m);
  });
});
