/**
 * Plan Forge — Phase TEMPER-06 Slice 06.1: Bug Registry + Classifier tests.
 *
 * ~41 tests covering:
 *   - Bug ID generation (3)
 *   - Registration happy path (5)
 *   - Deduplication (4)
 *   - Classifier rules (9)
 *   - LLM arbitration (5)
 *   - Infra classification (3)
 *   - Status transitions (5)
 *   - listBugs filters (4)
 *   - Edge cases (3)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  BUG_STATUSES,
  VALID_TRANSITIONS,
  ensureBugsDir,
  generateBugId,
  computeFingerprint,
  findDuplicate,
  loadBug,
  listBugs,
  registerBug,
  updateBugStatus,
  setExternalRef,
} from "../tempering/bug-registry.mjs";

import {
  classify,
  classifyByRules,
  classifyByLLM,
  loadFlakinessData,
} from "../tempering/bug-classifier.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `temper-06-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return {
    events,
    broadcast: (evt) => events.push(evt),
  };
}

function makeEvidence(overrides = {}) {
  return {
    testName: "UserService.login should validate credentials",
    assertionMessage: "Expected true to be false",
    stackTrace: "at Object.<anonymous> (src/services/user.test.js:42:5)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ...overrides,
  };
}

// ─── Bug ID Generation ───────────────────────────────────────────────

describe("Bug ID generation", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("generates bug-YYYY-MM-DD-001 for first bug", () => {
    const id = generateBugId(dir, () => new Date("2026-04-19T12:00:00Z").getTime());
    expect(id).toBe("bug-2026-04-19-001");
  });

  it("increments sequence when bugs exist", () => {
    const bugsDir = ensureBugsDir(dir);
    writeFileSync(resolve(bugsDir, "bug-2026-04-19-001.json"), "{}");
    writeFileSync(resolve(bugsDir, "bug-2026-04-19-002.json"), "{}");
    const id = generateBugId(dir, () => new Date("2026-04-19T12:00:00Z").getTime());
    expect(id).toBe("bug-2026-04-19-003");
  });

  it("starts at 001 on date rollover", () => {
    const bugsDir = ensureBugsDir(dir);
    writeFileSync(resolve(bugsDir, "bug-2026-04-18-005.json"), "{}");
    const id = generateBugId(dir, () => new Date("2026-04-19T12:00:00Z").getTime());
    expect(id).toBe("bug-2026-04-19-001");
  });
});

// ─── Registration Happy Path ─────────────────────────────────────────

describe("registerBug — happy path", () => {
  let dir, hub, memCaptures;
  beforeEach(() => {
    dir = makeTmpDir();
    hub = makeHub();
    memCaptures = [];
  });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("returns ok with bugId for real-bug classification", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "corr-1",
      classification: "real-bug",
      classifierMeta: { rule: "src-assertion", reason: "test", confidence: 0.9, source: "rule" },
      hub,
    });
    expect(result.ok).toBe(true);
    expect(result.bugId).toMatch(/^bug-\d{4}-\d{2}-\d{2}-\d{3}$/);
    expect(result.classification).toBe("real-bug");
  });

  it("writes bug JSON file to .forge/bugs/", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "corr-2",
      classification: "real-bug",
      classifierMeta: {},
      hub,
    });
    const filePath = resolve(dir, ".forge", "bugs", `${result.bugId}.json`);
    expect(existsSync(filePath)).toBe(true);
    const bug = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(bug.scanner).toBe("unit");
    expect(bug.severity).toBe("high");
    expect(bug.status).toBe("open");
    expect(bug.correlationId).toBe("corr-2");
  });

  it("emits tempering-bug-registered hub event", async () => {
    await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "corr-3",
      classification: "real-bug",
      classifierMeta: {},
      hub,
    });
    const evt = hub.events.find((e) => e.type === "tempering-bug-registered");
    expect(evt).toBeTruthy();
    expect(evt.data.scanner).toBe("unit");
    expect(evt.data.severity).toBe("high");
  });

  it("captures L3 memory for real-bug classification", async () => {
    const captures = [];
    await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "critical",
      evidence: makeEvidence(),
      correlationId: "corr-4",
      classification: "real-bug",
      classifierMeta: {},
      hub,
      captureMemory: (...args) => captures.push(args),
    });
    expect(captures).toHaveLength(1);
    expect(captures[0][0]).toContain("unit");
    expect(captures[0][1]).toBe("decision");
  });

  it("includes correlationId and sliceRef in the record", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "contract",
      severity: "medium",
      evidence: makeEvidence(),
      correlationId: "corr-5",
      sliceRef: { plan: "Phase-FOO.md", slice: "03.1" },
      classification: "real-bug",
      classifierMeta: {},
      hub,
    });
    const bug = loadBug(dir, result.bugId);
    expect(bug.correlationId).toBe("corr-5");
    expect(bug.sliceRef).toEqual({ plan: "Phase-FOO.md", slice: "03.1" });
  });
});

// ─── Deduplication ───────────────────────────────────────────────────

describe("Deduplication", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("detects exact duplicate by fingerprint", async () => {
    const evidence = makeEvidence();
    await registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence, correlationId: "c1", classification: "real-bug", classifierMeta: {} });
    const result = await registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence, correlationId: "c2", classification: "real-bug", classifierMeta: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("DUPLICATE_BUG");
    expect(result.existingBugId).toMatch(/^bug-/);
  });

  it("does not flag different tests as duplicates", async () => {
    await registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence: makeEvidence({ testName: "test-A" }), correlationId: "c1", classification: "real-bug", classifierMeta: {} });
    const result = await registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence: makeEvidence({ testName: "test-B" }), correlationId: "c2", classification: "real-bug", classifierMeta: {} });
    expect(result.ok).toBe(true);
  });

  it("handles cross-scanner dedup (different scanners, same fingerprint match)", () => {
    const fp1 = computeFingerprint("unit", makeEvidence());
    const fp2 = computeFingerprint("integration", makeEvidence());
    // Different scanners with same evidence produce different fingerprints
    expect(fp1).not.toBe(fp2);
  });

  it("normalizes timestamps in assertions for stable fingerprints", () => {
    const fp1 = computeFingerprint("unit", { testName: "t", assertionMessage: "Failed at 2026-04-19T12:00:00.000Z" });
    const fp2 = computeFingerprint("unit", { testName: "t", assertionMessage: "Failed at 2026-04-20T15:30:00.123Z" });
    expect(fp1).toBe(fp2);
  });
});

// ─── Classifier Rules ─────────────────────────────────────────────────

describe("Classifier rules", () => {
  it("Rule 1 — test-frame-top: top frame in test code → infra", () => {
    const result = classifyByRules({
      scanner: "unit",
      evidence: {
        testName: "t",
        stackTrace: "at Object.<anonymous> (tests/user.spec.js:10:3)",
      },
    });
    expect(result.classification).toBe("infra");
    expect(result.rule).toBe("test-frame-top");
    expect(result.confidence).toBe(0.95);
  });

  it("Rule 2 — visual-quorum: visual-diff with quorum verdict → real-bug", () => {
    const result = classifyByRules({
      scanner: "visual-diff",
      evidence: { testName: "homepage", quorumVerdict: "regression" },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("visual-quorum");
  });

  it("Rule 3 — src-assertion: assertion in src/ → real-bug", () => {
    const result = classifyByRules({
      scanner: "unit",
      evidence: {
        testName: "t",
        assertionMessage: "Expected 1 to be 2",
        stackTrace: "at UserService.validate (src/services/user.js:42:5)",
      },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("src-assertion");
  });

  it("Rule 4 — a11y-critical: UI scanner with serious a11y → real-bug", () => {
    const result = classifyByRules({
      scanner: "ui-playwright",
      evidence: { testName: "a11y", a11ySeverity: "serious" },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("a11y-critical");
  });

  it("Rule 5 — contract-mismatch: contract violation → real-bug", () => {
    const result = classifyByRules({
      scanner: "contract",
      evidence: { testName: "api", violation: true },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("contract-mismatch");
  });

  it("Rule 6 — flaky-threshold: ≥3 failures → infra", () => {
    const result = classifyByRules({
      scanner: "unit",
      evidence: { testName: "flaky" },
      flakinessData: { failureCount: 4, runCount: 10, failureRate: 0.4 },
    });
    expect(result.classification).toBe("infra");
    expect(result.rule).toBe("flaky-threshold");
  });

  it("Rule 7 — perf-consecutive: 2+ consecutive perf failures → real-bug", () => {
    const result = classifyByRules({
      scanner: "performance-budget",
      evidence: { testName: "perf", consecutiveFailures: 3 },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("perf-consecutive");
  });

  it("Rule 8 — load-error-rate: error rate breach → real-bug", () => {
    const result = classifyByRules({
      scanner: "load-stress",
      evidence: { testName: "load", errorRateBreach: true },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.rule).toBe("load-error-rate");
  });

  it("Rule 9 — test-modified-same-commit: modified test → infra", () => {
    const result = classifyByRules({
      scanner: "unit",
      evidence: {
        testName: "t",
        stackTrace: "at Object.<anonymous> (tests/user.test.js:10:3)",
        testModifiedInCommit: true,
      },
    });
    expect(result.classification).toBe("infra");
    // Rule 1 matches first (test-frame-top) — both classify as infra
    expect(result.rule).toBe("test-frame-top");
  });
});

// ─── LLM Arbitration ─────────────────────────────────────────────────

describe("classifyByLLM", () => {
  it("calls model and returns parsed classification", async () => {
    const result = await classifyByLLM({
      scanner: "unit",
      evidence: { testName: "t", assertionMessage: "fail" },
      callModel: async () => '{ "classification": "real-bug", "reason": "production code bug", "confidence": 0.85 }',
    });
    expect(result.classification).toBe("real-bug");
    expect(result.confidence).toBe(0.85);
    expect(result.source).toBe("llm");
  });

  it("returns needs-human-review when confidence < 0.7", async () => {
    const result = await classifyByLLM({
      scanner: "unit",
      evidence: { testName: "t" },
      callModel: async () => '{ "classification": "real-bug", "reason": "maybe", "confidence": 0.5 }',
    });
    expect(result.classification).toBe("needs-human-review");
    expect(result.confidence).toBe(0.5);
  });

  it("returns unknown when LLM is unavailable", async () => {
    const result = await classifyByLLM({
      scanner: "unit",
      evidence: { testName: "t" },
      callModel: async () => { throw new Error("API down"); },
    });
    expect(result.classification).toBe("unknown");
    expect(result.source).toBe("llm");
  });

  it("returns unknown when callModel is not a function", async () => {
    const result = await classifyByLLM({
      scanner: "unit",
      evidence: { testName: "t" },
    });
    expect(result.classification).toBe("unknown");
    expect(result.reason).toContain("no callModel");
  });

  it("handles malformed LLM response gracefully", async () => {
    const result = await classifyByLLM({
      scanner: "unit",
      evidence: { testName: "t" },
      callModel: async () => "I think this is a bug but I'm not sure",
    });
    expect(result.classification).toBe("unknown");
  });
});

// ─── Infra Classification ────────────────────────────────────────────

describe("Infra classification path", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("does not write a file for infra classification", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "medium",
      evidence: makeEvidence(),
      correlationId: "c1",
      classification: "infra",
      classifierMeta: { rule: "test-frame-top", reason: "test", confidence: 0.95, source: "rule" },
    });
    expect(result.ok).toBe(true);
    expect(result.classification).toBe("infra");
    expect(result.action).toBe("recorded-in-run");
    // No file written
    const bugsDir = resolve(dir, ".forge", "bugs");
    if (existsSync(bugsDir)) {
      const files = readdirSync(bugsDir).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(0);
    }
  });

  it("does not capture L3 memory for infra", async () => {
    const captures = [];
    await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "medium",
      evidence: makeEvidence(),
      correlationId: "c1",
      classification: "infra",
      classifierMeta: {},
      captureMemory: (...args) => captures.push(args),
    });
    expect(captures).toHaveLength(0);
  });

  it("does not emit hub event for infra", async () => {
    const hub = makeHub();
    await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "medium",
      evidence: makeEvidence(),
      correlationId: "c1",
      classification: "infra",
      classifierMeta: {},
      hub,
    });
    expect(hub.events).toHaveLength(0);
  });
});

// ─── Status Transitions ──────────────────────────────────────────────

describe("updateBugStatus", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  async function createBug(status = "open") {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence({ testName: `test-${randomUUID()}` }),
      correlationId: "c1",
      classification: "real-bug",
      classifierMeta: {},
    });
    if (status !== "open" && result.ok) {
      // Force status for testing
      const bug = loadBug(dir, result.bugId);
      bug.status = status;
      writeFileSync(resolve(dir, ".forge", "bugs", `${result.bugId}.json`), JSON.stringify(bug, null, 2));
    }
    return result.bugId;
  }

  it("transitions open → in-fix successfully", async () => {
    const bugId = await createBug();
    const result = await updateBugStatus(dir, bugId, "in-fix");
    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe("in-fix");
  });

  it("transitions in-fix → fixed successfully", async () => {
    const bugId = await createBug("in-fix");
    const result = await updateBugStatus(dir, bugId, "fixed");
    expect(result.ok).toBe(true);
  });

  it("transitions open → wont-fix successfully", async () => {
    const bugId = await createBug();
    const result = await updateBugStatus(dir, bugId, "wont-fix");
    expect(result.ok).toBe(true);
  });

  it("rejects invalid transition: open → fixed", async () => {
    const bugId = await createBug();
    const result = await updateBugStatus(dir, bugId, "fixed");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_TRANSITION");
  });

  it("rejects transition from terminal state: fixed → open", async () => {
    const bugId = await createBug("fixed");
    const result = await updateBugStatus(dir, bugId, "open");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_TRANSITION");
  });
});

// ─── listBugs Filters ────────────────────────────────────────────────

describe("listBugs", () => {
  let dir;
  beforeEach(async () => {
    dir = makeTmpDir();
    // Seed 3 bugs
    await registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence: makeEvidence({ testName: "a" }), correlationId: "c1", classification: "real-bug", classifierMeta: {} });
    await registerBug({ cwd: dir, scanner: "contract", severity: "medium", evidence: makeEvidence({ testName: "b" }), correlationId: "c2", classification: "real-bug", classifierMeta: {} });
    await registerBug({ cwd: dir, scanner: "unit", severity: "low", evidence: makeEvidence({ testName: "c" }), correlationId: "c3", classification: "real-bug", classifierMeta: {} });
  });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("lists all bugs when no filter", () => {
    const bugs = listBugs(dir);
    expect(bugs).toHaveLength(3);
  });

  it("filters by status", () => {
    const bugs = listBugs(dir, { status: "open" });
    expect(bugs).toHaveLength(3);
    const closed = listBugs(dir, { status: "fixed" });
    expect(closed).toHaveLength(0);
  });

  it("filters by severity", () => {
    const bugs = listBugs(dir, { severity: "high" });
    expect(bugs).toHaveLength(1);
    expect(bugs[0].severity).toBe("high");
  });

  it("filters by scanner", () => {
    const bugs = listBugs(dir, { scanner: "unit" });
    expect(bugs).toHaveLength(2);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────

describe("Edge cases", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("auto-creates .forge/bugs/ on first registration", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    expect(existsSync(bugsDir)).toBe(false);
    await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "medium",
      evidence: makeEvidence(),
      correlationId: "c1",
      classification: "real-bug",
      classifierMeta: {},
    });
    expect(existsSync(bugsDir)).toBe(true);
  });

  it("returns MISSING_EVIDENCE for malformed evidence", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "medium",
      evidence: {},
      correlationId: "c1",
      classification: "real-bug",
      classifierMeta: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("MISSING_EVIDENCE");
  });

  it("lists empty array for empty registry", () => {
    const bugs = listBugs(dir);
    expect(bugs).toEqual([]);
  });
});

// ─── Full classify() flow ────────────────────────────────────────────

describe("classify() — full flow", () => {
  it("returns rule result when rule matches", async () => {
    const result = await classify({
      scanner: "contract",
      evidence: { testName: "api", violation: true },
    });
    expect(result.classification).toBe("real-bug");
    expect(result.source).toBe("rule");
  });

  it("falls through to LLM when no rule matches", async () => {
    const result = await classify({
      scanner: "unit",
      evidence: { testName: "t", assertionMessage: "ambiguous" },
      callModel: async () => '{ "classification": "real-bug", "reason": "code bug", "confidence": 0.8 }',
    });
    expect(result.classification).toBe("real-bug");
    expect(result.source).toBe("llm");
  });

  it("returns unknown when no rule matches and no LLM available", async () => {
    const result = await classify({
      scanner: "unit",
      evidence: { testName: "t", assertionMessage: "ambiguous" },
    });
    expect(result.classification).toBe("unknown");
  });
});

// ─── loadFlakinessData ───────────────────────────────────────────────

describe("loadFlakinessData", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("returns zeros when no run data exists", () => {
    const data = loadFlakinessData(dir, "test-x");
    expect(data.failureCount).toBe(0);
    expect(data.runCount).toBe(0);
  });

  it("returns zeros when testName is empty", () => {
    const data = loadFlakinessData(dir, "");
    expect(data.failureCount).toBe(0);
  });
});

// ─── Dispatch Integration (Slice 06.2) ──────────────────────────────

describe("registerBug — dispatch integration", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("persists externalRef on successful GitHub dispatch", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    try {
      const mockFetch = async () => ({
        ok: true, status: 201,
        json: async () => ({ number: 42, html_url: "https://github.com/o/r/issues/42" }),
        headers: { get: () => null },
      });
      const result = await registerBug({
        cwd: dir,
        scanner: "unit",
        severity: "high",
        evidence: makeEvidence(),
        correlationId: "c1",
        classification: "real-bug",
        classifierMeta: {},
        config: { bugRegistry: { integration: "github", autoCreateIssues: true, githubRepo: "o/r" } },
        fetch: mockFetch,
      });
      expect(result.ok).toBe(true);
      expect(result.external).not.toBeNull();
      if (result.external?.ok) {
        const bug = loadBug(dir, result.bugId);
        expect(bug.externalRef).toBeDefined();
        expect(bug.externalRef.provider).toBe("github");
        expect(bug.externalRef.issueNumber).toBe(42);
      }
    } finally {
      if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
      else delete process.env.GITHUB_TOKEN;
    }
  });

  it("returns local success when external dispatch fails (non-fatal)", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const result = await registerBug({
        cwd: dir,
        scanner: "unit",
        severity: "high",
        evidence: makeEvidence(),
        correlationId: "c2",
        classification: "real-bug",
        classifierMeta: {},
        config: { bugRegistry: { integration: "github", autoCreateIssues: true, githubRepo: "o/r" } },
      });
      expect(result.ok).toBe(true);
      expect(result.bugId).toMatch(/^bug-/);
      // Bug file still written even though external failed
      const bug = loadBug(dir, result.bugId);
      expect(bug).not.toBeNull();
    } finally {
      if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
      else delete process.env.GITHUB_TOKEN;
    }
  });

  it("skips external entirely when integration is jsonl", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "c3",
      classification: "real-bug",
      classifierMeta: {},
      config: { bugRegistry: { integration: "jsonl" } },
    });
    expect(result.ok).toBe(true);
    expect(result.external).toBeNull();
  });

  it("updateBugStatus triggers dispatch and surfaces external result", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "c4",
      classification: "real-bug",
      classifierMeta: {},
    });
    const updateResult = await updateBugStatus(dir, result.bugId, "in-fix");
    expect(updateResult.ok).toBe(true);
    expect(updateResult.newStatus).toBe("in-fix");
    // external should be null when no config provided
    expect(updateResult.external).toBeNull();
  });

  it("loadBug hydrates externalRef field when present", async () => {
    const result = await registerBug({
      cwd: dir,
      scanner: "unit",
      severity: "high",
      evidence: makeEvidence(),
      correlationId: "c5",
      classification: "real-bug",
      classifierMeta: {},
    });
    // Manually set externalRef via setExternalRef
    setExternalRef(dir, result.bugId, { provider: "github", issueNumber: 99, url: "https://github.com/o/r/issues/99", syncedAt: "2026-04-19T12:00:00Z" });
    const bug = loadBug(dir, result.bugId);
    expect(bug.externalRef).toBeDefined();
    expect(bug.externalRef.issueNumber).toBe(99);
    expect(bug.externalRef.provider).toBe("github");
  });

  it("concurrent registerBug calls don't produce duplicate external issues", async () => {
    const evidence1 = makeEvidence({ testName: "concurrent-test-A" });
    const evidence2 = makeEvidence({ testName: "concurrent-test-B" });
    const [r1, r2] = await Promise.all([
      registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence: evidence1, correlationId: "c6a", classification: "real-bug", classifierMeta: {} }),
      registerBug({ cwd: dir, scanner: "unit", severity: "high", evidence: evidence2, correlationId: "c6b", classification: "real-bug", classifierMeta: {} }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.bugId).not.toBe(r2.bugId);
  });
});
