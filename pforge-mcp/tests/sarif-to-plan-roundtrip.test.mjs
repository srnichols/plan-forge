/**
 * Plan Forge — Phase GITHUB-B Slice 8: sarif-to-plan round-trip tests.
 *
 * Verifies that the markdown emitted by sarifToPlan() is faithfully consumed
 * by the orchestrator's parsePlan() — the full produce→consume path:
 *
 *   sarifToPlan(sarif) → markdown string → write to disk → parsePlan() → slices
 *
 * Acceptance criteria verified:
 *   RT-1  Slice count matches the number of SARIF findings.
 *   RT-2  Each slice title contains the original rule ID.
 *   RT-3  Slices are ordered by severity (critical → high → medium → low).
 *   RT-4  Each slice's scope array includes the SARIF artifact file paths.
 *   RT-5  Each slice carries a non-null validationGate (the echo-TODO placeholder).
 *   RT-6  meta.title reflects the planName option passed to sarifToPlan().
 *   RT-7  Source front-matter survives intact in the plan string.
 */

import { afterAll, describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sarifToPlan } from "../sarif-to-plan.mjs";
import { parsePlan } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "sarif");

function fixture(name) {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// ─── Temp-dir helpers ─────────────────────────────────────────────────────────

const tmpDirs = [];

function makeTempDir() {
  const dir = join(
    tmpdir(),
    `pforge-sarif-rt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

/** Write a plan string to <dir>/plan.md and return the full path. */
function writePlan(dir, planMd) {
  const planPath = join(dir, "plan.md");
  writeFileSync(planPath, planMd, "utf-8");
  return planPath;
}

/** Full round-trip: sarif string → markdown → disk → parsePlan. */
function roundTrip(sarifRaw, opts = {}) {
  const dir = makeTempDir();
  const md = sarifToPlan(sarifRaw, opts);
  const planPath = writePlan(dir, md);
  return { parsed: parsePlan(planPath, dir), md };
}

afterAll(() => {
  for (const dir of tmpDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── RT-1 & RT-2: Single-finding SARIF ───────────────────────────────────────

describe("sarif-to-plan round-trip — single-finding SARIF", () => {
  it("RT-1: parsePlan returns exactly one slice", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    expect(parsed.slices).toHaveLength(1);
  });

  it("RT-2: slice title contains the SARIF rule ID", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    expect(parsed.slices[0].title).toMatch(/js\/sql-injection/);
  });

  it("RT-2: slice title contains the finding message text", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    expect(parsed.slices[0].title).toMatch(/user-provided value/i);
  });

  it("RT-4: slice scope includes the SARIF artifact file path", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    const scope = parsed.slices[0].scope;
    expect(scope.some((p) => p.includes("src/db/queries.js"))).toBe(true);
  });

  it("RT-5: slice has a non-null validationGate", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    expect(parsed.slices[0].validationGate).toBeTruthy();
  });

  it("RT-5: validationGate contains the echo-TODO placeholder for the rule", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      source: "scan.sarif",
    });
    expect(parsed.slices[0].validationGate).toMatch(/TODO.*js\/sql-injection/);
  });
});

// ─── RT-1, RT-3, RT-4, RT-5: Multi-finding SARIF ─────────────────────────────

describe("sarif-to-plan round-trip — multi-finding SARIF", () => {
  it("RT-1: parsePlan returns a slice per SARIF finding (4 slices)", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    expect(parsed.slices).toHaveLength(4);
  });

  it("RT-3: slices are ordered critical → high → medium → low", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    const titles = parsed.slices.map((s) => s.title);
    // Severity order: path-injection (9.3=critical) > sql-injection (8.8=high) > xss (6.1=medium) > unused-variable (1.0=low)
    expect(titles[0]).toMatch(/js\/path-injection/);
    expect(titles[1]).toMatch(/js\/sql-injection/);
    expect(titles[2]).toMatch(/js\/xss/);
    expect(titles[3]).toMatch(/js\/unused-variable/);
  });

  it("RT-2: each slice title contains its rule ID", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    const ruleOrder = [
      "js/path-injection",
      "js/sql-injection",
      "js/xss",
      "js/unused-variable",
    ];
    for (let i = 0; i < ruleOrder.length; i++) {
      expect(parsed.slices[i].title).toMatch(ruleOrder[i]);
    }
  });

  it("RT-4: slice scope carries the correct file path for each finding", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    // path-injection → src/files/upload.js
    expect(parsed.slices[0].scope.some((p) => p.includes("src/files/upload.js"))).toBe(true);
    // sql-injection → src/db/queries.js
    expect(parsed.slices[1].scope.some((p) => p.includes("src/db/queries.js"))).toBe(true);
    // xss → src/routes/profile.js
    expect(parsed.slices[2].scope.some((p) => p.includes("src/routes/profile.js"))).toBe(true);
    // unused-variable → src/utils/cache.js
    expect(parsed.slices[3].scope.some((p) => p.includes("src/utils/cache.js"))).toBe(true);
  });

  it("RT-4: deduplication — sql-injection scope lists each file at most once", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    const sqlSlice = parsed.slices.find((s) => s.title.includes("sql-injection"));
    const dbCount = sqlSlice.scope.filter((p) => p === "src/db/queries.js").length;
    expect(dbCount).toBe(1);
  });

  it("RT-5: every slice has a non-null validationGate", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    for (const slice of parsed.slices) {
      expect(slice.validationGate).toBeTruthy();
    }
  });

  it("RT-5: each validationGate echo-TODO references its own rule ID", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    const ruleOrder = [
      "js/path-injection",
      "js/sql-injection",
      "js/xss",
      "js/unused-variable",
    ];
    for (let i = 0; i < ruleOrder.length; i++) {
      expect(parsed.slices[i].validationGate).toMatch(
        new RegExp(`TODO.*${ruleOrder[i].replace(/\//g, "\\/")}`)
      );
    }
  });

  it("RT-1: slice numbers are sequential starting at '1'", () => {
    const { parsed } = roundTrip(fixture("multi-mixed.sarif.json"));
    const numbers = parsed.slices.map((s) => s.number);
    expect(numbers).toEqual(["1", "2", "3", "4"]);
  });
});

// ─── RT-6: planName option ────────────────────────────────────────────────────

describe("sarif-to-plan round-trip — planName option", () => {
  it("RT-6: meta.title matches the planName option", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"), {
      planName: "Phase-SARIF-REMEDIATION-CUSTOM",
    });
    expect(parsed.meta.title).toBe("Phase-SARIF-REMEDIATION-CUSTOM");
  });

  it("RT-6: default planName starts with 'Phase-SARIF-' when not overridden", () => {
    const { parsed } = roundTrip(fixture("single-high.sarif.json"));
    expect(parsed.meta.title).toMatch(/^Phase-SARIF-\d+-REMEDIATION$/);
  });
});

// ─── RT-7: Source front-matter ────────────────────────────────────────────────

describe("sarif-to-plan round-trip — source front-matter", () => {
  it("RT-7: generated markdown includes Source: line verbatim", () => {
    const { md } = roundTrip(fixture("single-high.sarif.json"), {
      source: "results/codeql.sarif",
    });
    expect(md).toMatch(/^Source: results\/codeql\.sarif$/m);
  });

  it("RT-7: generated markdown includes a Generated: ISO-8601 timestamp", () => {
    const { md } = roundTrip(fixture("single-high.sarif.json"), {
      source: "test.sarif",
    });
    expect(md).toMatch(/^Generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/m);
  });
});

// ─── Idempotence: two round-trips produce structurally identical slices ────────

describe("sarif-to-plan round-trip — idempotence", () => {
  it("two round-trips on the same SARIF produce the same slice structure", () => {
    const opts = { planName: "STABLE-PLAN" };
    const { parsed: p1 } = roundTrip(fixture("multi-mixed.sarif.json"), opts);
    const { parsed: p2 } = roundTrip(fixture("multi-mixed.sarif.json"), opts);

    const normalize = (slices) =>
      slices.map((s) => ({
        number: s.number,
        titleContainsRuleId:
          /js\/path-injection|js\/sql-injection|js\/xss|js\/unused-variable/.test(s.title),
        hasGate: !!s.validationGate,
        scopeCount: s.scope.length,
      }));

    expect(normalize(p1.slices)).toEqual(normalize(p2.slices));
  });
});
