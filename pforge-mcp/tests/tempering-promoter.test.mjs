/**
 * Plan Forge — Phase-31 Slice 6: Tempering suppression promoter tests
 *
 * Covers `promoteSuppressions` in tempering.mjs:
 *   - below threshold → no bug file written
 *   - at threshold → new .forge/bugs/bug-*.json with required sections
 *   - re-run with same suppressions → idempotent (no duplicate)
 *   - custom threshold via .forge.json `runtime.tempering.promoteThreshold`
 *
 * Also covers `logSuppression`, `readSuppressions`, `readPromoteThreshold`
 * helper functions.
 *
 * Plan: docs/plans/Phase-31-CALIBRATION-v2.65-PLAN.md (Slice 6)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import {
  promoteSuppressions,
  logSuppression,
  readSuppressions,
  readPromoteThreshold,
} from "../tempering.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────

function writeForgeJson(cwd, data) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Seed N suppression entries for a given fingerprint directly into
 * .forge/tempering/suppressions.jsonl (mirrors what logSuppression writes).
 */
function seedSuppressions(cwd, { fingerprint, scanner = "unit", count, testName = "should work" }) {
  const dir = resolve(cwd, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "suppressions.jsonl");
  let existing = "";
  if (existsSync(path)) {
    existing = readFileSync(path, "utf-8");
  }
  let lines = existing;
  for (let i = 0; i < count; i++) {
    const record = {
      _v: 1,
      fingerprint,
      scanner,
      evidence: { testName },
      runId: `run-${i + 1}`,
      suppressedAt: new Date(Date.now() + i).toISOString(),
    };
    lines += JSON.stringify(record) + "\n";
  }
  writeFileSync(path, lines, "utf-8");
}

function listBugFiles(cwd) {
  const dir = resolve(cwd, ".forge", "bugs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
}

// ─── Setup ──────────────────────────────────────────────────────────────

let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pforge-promoter-"));
});

afterEach(() => {
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── readPromoteThreshold ───────────────────────────────────────────────

describe("readPromoteThreshold", () => {
  it("returns the built-in default (3) when .forge.json is absent", () => {
    expect(readPromoteThreshold(cwd)).toBe(3);
  });

  it("returns the configured value from .forge.json", () => {
    writeForgeJson(cwd, { runtime: { tempering: { promoteThreshold: 5 } } });
    expect(readPromoteThreshold(cwd)).toBe(5);
  });

  it("ignores non-numeric or zero values and falls back to default", () => {
    writeForgeJson(cwd, { runtime: { tempering: { promoteThreshold: 0 } } });
    expect(readPromoteThreshold(cwd)).toBe(3);
    writeForgeJson(cwd, { runtime: { tempering: { promoteThreshold: "five" } } });
    expect(readPromoteThreshold(cwd)).toBe(3);
  });

  it("respects the defaultThreshold parameter when no .forge.json key", () => {
    expect(readPromoteThreshold(cwd, 7)).toBe(7);
  });
});

// ─── logSuppression + readSuppressions ──────────────────────────────────

describe("logSuppression + readSuppressions", () => {
  it("creates suppressions.jsonl when absent", () => {
    logSuppression({ cwd, fingerprint: "abc123", scanner: "unit", evidence: { testName: "foo" } });
    const path = resolve(cwd, ".forge", "tempering", "suppressions.jsonl");
    expect(existsSync(path)).toBe(true);
  });

  it("appends one record per call", () => {
    logSuppression({ cwd, fingerprint: "abc123", scanner: "unit" });
    logSuppression({ cwd, fingerprint: "abc123", scanner: "unit" });
    const records = readSuppressions(cwd);
    expect(records).toHaveLength(2);
  });

  it("record has _v:1, fingerprint, scanner, evidence, suppressedAt", () => {
    const now = "2026-04-22T03:00:00.000Z";
    logSuppression({
      cwd,
      fingerprint: "fp1",
      scanner: "integration",
      evidence: { testName: "db test", assertionMessage: "expected 1" },
      runId: "run-42",
      nowFn: () => now,
    });
    const [rec] = readSuppressions(cwd);
    expect(rec._v).toBe(1);
    expect(rec.fingerprint).toBe("fp1");
    expect(rec.scanner).toBe("integration");
    expect(rec.evidence.testName).toBe("db test");
    expect(rec.suppressedAt).toBe(now);
    expect(rec.runId).toBe("run-42");
  });

  it("returns [] when no suppressions.jsonl exists", () => {
    expect(readSuppressions(cwd)).toEqual([]);
  });

  it("skips malformed lines without throwing", () => {
    const dir = resolve(cwd, ".forge", "tempering");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "suppressions.jsonl");
    writeFileSync(path, '{"_v":1,"fingerprint":"good"}\nnot-json\n{"_v":1,"fingerprint":"also-good"}\n');
    const records = readSuppressions(cwd);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.fingerprint)).toEqual(["good", "also-good"]);
  });
});

// ─── promoteSuppressions ────────────────────────────────────────────────

describe("promoteSuppressions — below threshold", () => {
  it("returns promoted=[] when no suppressions exist", () => {
    const result = promoteSuppressions({ cwd });
    expect(result.ok).toBe(true);
    expect(result.promoted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("does not write a bug file when count is below threshold", () => {
    seedSuppressions(cwd, { fingerprint: "fp-below", count: 2 });
    promoteSuppressions({ cwd, threshold: 3 });
    expect(listBugFiles(cwd)).toHaveLength(0);
  });

  it("includes below-threshold entry in skipped with reason 'below-threshold'", () => {
    seedSuppressions(cwd, { fingerprint: "fp-below", count: 2 });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("below-threshold");
    expect(result.skipped[0].fingerprint).toBe("fp-below");
    expect(result.skipped[0].count).toBe(2);
  });
});

describe("promoteSuppressions — at threshold", () => {
  it("writes a bug file when count equals threshold", () => {
    seedSuppressions(cwd, { fingerprint: "fp-at", scanner: "unit", count: 3, testName: "my test" });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.ok).toBe(true);
    expect(result.promoted).toHaveLength(1);
    expect(listBugFiles(cwd)).toHaveLength(1);
  });

  it("bug file has all required sections", () => {
    seedSuppressions(cwd, { fingerprint: "fp-req", scanner: "integration", count: 3, testName: "critical path" });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(1);

    const bugFile = listBugFiles(cwd)[0];
    const bug = JSON.parse(readFileSync(resolve(cwd, ".forge", "bugs", bugFile), "utf-8"));

    // Required sections
    expect(bug.bugId).toMatch(/^bug-\d{4}-\d{2}-\d{2}-\d{3}$/);
    expect(bug.fingerprint).toBe("fp-req");
    expect(bug.source).toBe("suppression-promoter");
    expect(bug.scanner).toBe("integration");
    expect(bug.evidence.testName).toBe("critical path");
    expect(bug.suppressionCount).toBe(3);
    expect(bug.status).toBe("open");
    expect(bug.promotedAt).toBeTruthy();
    // Registry-compatible fields
    expect(bug.classification).toBe("real-bug");
    expect(bug.classifierMeta.rule).toBe("suppression-promoter");
    expect(bug.severity).toBe("medium");
    expect(bug.discoveredAt).toBeTruthy();
    expect(bug.updatedAt).toBeTruthy();
  });

  it("bugId uses date-based naming (bug-YYYY-MM-DD-NNN)", () => {
    seedSuppressions(cwd, { fingerprint: "fp-id", count: 3 });
    promoteSuppressions({ cwd, threshold: 3 });
    const [bugFile] = listBugFiles(cwd);
    expect(bugFile).toMatch(/^bug-\d{4}-\d{2}-\d{2}-\d{3}\.json$/);
  });

  it("bug file is written inside .forge/bugs/", () => {
    seedSuppressions(cwd, { fingerprint: "fp-path", count: 3 });
    promoteSuppressions({ cwd, threshold: 3 });
    const [bugFile] = listBugFiles(cwd);
    const fullPath = resolve(cwd, ".forge", "bugs", bugFile);
    expect(existsSync(fullPath)).toBe(true);
    // Guard: ensure it's inside .forge/bugs/, not elsewhere
    expect(fullPath.startsWith(resolve(cwd, ".forge", "bugs"))).toBe(true);
  });
});

describe("promoteSuppressions — idempotency", () => {
  it("re-run with same suppressions does not create a second bug file", () => {
    seedSuppressions(cwd, { fingerprint: "fp-idem", count: 3 });
    promoteSuppressions({ cwd, threshold: 3 });
    promoteSuppressions({ cwd, threshold: 3 });
    expect(listBugFiles(cwd)).toHaveLength(1);
  });

  it("second run reports existing bug in skipped with reason 'already-exists'", () => {
    seedSuppressions(cwd, { fingerprint: "fp-idem2", count: 3 });
    promoteSuppressions({ cwd, threshold: 3 });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(0);
    const existing = result.skipped.find((s) => s.reason === "already-exists");
    expect(existing).toBeTruthy();
    expect(existing.fingerprint).toBe("fp-idem2");
    expect(existing.bugId).toMatch(/^bug-/);
  });

  it("promoted entry returns stable bugId matching the file on disk", () => {
    seedSuppressions(cwd, { fingerprint: "fp-stable", count: 3 });
    const first = promoteSuppressions({ cwd, threshold: 3 });
    const promotedBugId = first.promoted[0].bugId;
    expect(existsSync(resolve(cwd, ".forge", "bugs", `${promotedBugId}.json`))).toBe(true);
  });
});

describe("promoteSuppressions — custom threshold", () => {
  it("respects threshold parameter (higher threshold = no promotion)", () => {
    seedSuppressions(cwd, { fingerprint: "fp-custom-high", count: 3 });
    promoteSuppressions({ cwd, threshold: 5 });
    expect(listBugFiles(cwd)).toHaveLength(0);
  });

  it("respects threshold parameter (lower threshold = promotion)", () => {
    seedSuppressions(cwd, { fingerprint: "fp-custom-low", count: 2 });
    promoteSuppressions({ cwd, threshold: 2 });
    expect(listBugFiles(cwd)).toHaveLength(1);
  });

  it("reads promoteThreshold from .forge.json and overrides threshold param", () => {
    writeForgeJson(cwd, { runtime: { tempering: { promoteThreshold: 5 } } });
    seedSuppressions(cwd, { fingerprint: "fp-forge-json", count: 3 });
    // threshold param is 3 but .forge.json says 5 → should NOT promote
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(0);
    expect(listBugFiles(cwd)).toHaveLength(0);
  });

  it("promotes when count meets .forge.json threshold", () => {
    writeForgeJson(cwd, { runtime: { tempering: { promoteThreshold: 2 } } });
    seedSuppressions(cwd, { fingerprint: "fp-forge-json-meet", count: 2 });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(1);
    expect(listBugFiles(cwd)).toHaveLength(1);
  });
});

describe("promoteSuppressions — multiple fingerprints", () => {
  it("promotes each fingerprint independently", () => {
    seedSuppressions(cwd, { fingerprint: "fp-a", count: 3 });
    seedSuppressions(cwd, { fingerprint: "fp-b", count: 3 });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(2);
    expect(listBugFiles(cwd)).toHaveLength(2);
  });

  it("skips below-threshold while promoting above-threshold fingerprint", () => {
    seedSuppressions(cwd, { fingerprint: "fp-low", count: 1 });
    seedSuppressions(cwd, { fingerprint: "fp-high", count: 3 });
    const result = promoteSuppressions({ cwd, threshold: 3 });
    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0].fingerprint).toBe("fp-high");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].fingerprint).toBe("fp-low");
    expect(listBugFiles(cwd)).toHaveLength(1);
  });
});
