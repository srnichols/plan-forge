/**
 * Plan Forge — Phase TEMPER-07 Slice 07.1: Agent Router tests.
 *
 * ~20 tests covering:
 *   - ROUTING_TABLE (2)
 *   - deriveBugType (6)
 *   - resolveRoute (5)
 *   - buildAnalystPrompt (2)
 *   - writeAnalystFinding (2)
 *   - recordDelegation (2)
 *   - loadAgentRoutingConfig (3)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  ROUTING_TABLE,
  deriveBugType,
  resolveRoute,
  buildAnalystPrompt,
  writeAnalystFinding,
  recordDelegation,
  loadAgentRoutingConfig,
} from "../tempering/agent-router.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `temper-07-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeBug(overrides = {}) {
  return {
    bugId: `BUG-20260419-${String(Math.floor(Math.random() * 999)).padStart(3, "0")}`,
    scanner: "unit",
    severity: "critical",
    classification: "real-bug",
    evidence: {
      testName: "UserService.login should validate credentials",
      assertionMessage: "Expected true to be false",
      stackTrace: "at Object.<anonymous> (src/services/user.test.js:42:5)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    },
    affectedFiles: ["src/services/user.js"],
    reproSteps: ["Run unit tests", "Check login validation"],
    classifierMeta: {},
    ...overrides,
  };
}

// ─── ROUTING_TABLE ───────────────────────────────────────────────────

describe("ROUTING_TABLE", () => {
  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(ROUTING_TABLE)).toBe(true);
  });

  it("has entries for all 5 bug types", () => {
    const types = new Set(Object.keys(ROUTING_TABLE).map((k) => k.split("|")[0]));
    expect(types).toEqual(new Set(["security", "performance", "functional", "contract", "visual"]));
  });
});

// ─── deriveBugType ──────────────────────────────────────────────────

describe("deriveBugType", () => {
  it("returns null for null/undefined bug", () => {
    expect(deriveBugType(null)).toBeNull();
    expect(deriveBugType(undefined)).toBeNull();
  });

  it("prefers explicit bug.type over all other sources", () => {
    const bug = makeBug({ type: "security", scanner: "unit", classifierMeta: { bugType: "performance" } });
    expect(deriveBugType(bug)).toBe("security");
  });

  it("falls back to classifierMeta.bugType when type is absent", () => {
    const bug = makeBug({ classifierMeta: { bugType: "contract" } });
    expect(deriveBugType(bug)).toBe("contract");
  });

  it("falls back to scanner-name mapping when classifierMeta.bugType is absent", () => {
    const cases = [
      ["contract", "contract"],
      ["visual-diff", "visual"],
      ["performance-budget", "performance"],
      ["load-stress", "performance"],
      ["unit", "functional"],
      ["integration", "functional"],
      ["ui-playwright", "functional"],
      ["mutation", "functional"],
      ["flakiness", "functional"],
    ];
    for (const [scanner, expected] of cases) {
      expect(deriveBugType({ scanner })).toBe(expected);
    }
  });

  it("returns null for unknown scanner with no type fields", () => {
    expect(deriveBugType({ scanner: "unknown-scanner" })).toBeNull();
  });

  it("ignores empty-string type field", () => {
    const bug = makeBug({ type: "", scanner: "unit" });
    expect(deriveBugType(bug)).toBe("functional");
  });
});

// ─── resolveRoute ───────────────────────────────────────────────────

describe("resolveRoute", () => {
  it("returns null for null bug", () => {
    expect(resolveRoute(null)).toBeNull();
  });

  it("returns null for bug with unmappable type", () => {
    expect(resolveRoute({ scanner: "unknown", severity: "critical" })).toBeNull();
  });

  it("matches exact type|severity entry", () => {
    const route = resolveRoute(makeBug({ scanner: "unit", severity: "critical" }));
    expect(route).toEqual({ agent: "test-runner", skill: "test-sweep" });
  });

  it("falls back to wildcard type|* when severity has no exact match", () => {
    const route = resolveRoute(makeBug({ scanner: "contract", severity: "low" }));
    expect(route).toEqual({ agent: "api-contracts", skill: "api-doc-gen" });
  });

  it("returns null with console.warn for unmatched type+severity combo", () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(" "));
    try {
      // functional|medium has no exact match and no wildcard
      const route = resolveRoute(makeBug({ scanner: "unit", severity: "medium" }));
      expect(route).toBeNull();
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0]).toContain("[agent-router]");
    } finally {
      console.warn = origWarn;
    }
  });

  it("positive cases for each routing table row", () => {
    expect(resolveRoute(makeBug({ type: "security", severity: "critical" }))).toEqual({ agent: "security", skill: "security-audit" });
    expect(resolveRoute(makeBug({ type: "security", severity: "major" }))).toEqual({ agent: "security", skill: "security-audit" });
    expect(resolveRoute(makeBug({ type: "performance", severity: "critical" }))).toEqual({ agent: "performance", skill: null });
    expect(resolveRoute(makeBug({ type: "performance", severity: "major" }))).toEqual({ agent: "performance", skill: null });
    expect(resolveRoute(makeBug({ type: "functional", severity: "critical" }))).toEqual({ agent: "test-runner", skill: "test-sweep" });
    expect(resolveRoute(makeBug({ type: "functional", severity: "major" }))).toEqual({ agent: "test-runner", skill: null });
    expect(resolveRoute(makeBug({ type: "contract", severity: "low" }))).toEqual({ agent: "api-contracts", skill: "api-doc-gen" });
    expect(resolveRoute(makeBug({ type: "visual", severity: "low" }))).toEqual({ agent: "accessibility", skill: null });
  });
});

// ─── buildAnalystPrompt ─────────────────────────────────────────────

describe("buildAnalystPrompt", () => {
  it("contains literal 'do NOT edit files'", () => {
    const bug = makeBug();
    const route = { agent: "test-runner", skill: "test-sweep" };
    const prompt = buildAnalystPrompt(bug, route);
    expect(prompt).toContain("do NOT edit files");
  });

  it("includes evidence, agent, and skill in prompt", () => {
    const bug = makeBug({ scanner: "unit", severity: "critical" });
    const route = { agent: "test-runner", skill: "test-sweep" };
    const prompt = buildAnalystPrompt(bug, route);
    expect(prompt).toContain(bug.bugId);
    expect(prompt).toContain("unit");
    expect(prompt).toContain("critical");
    expect(prompt).toContain("test-runner");
    expect(prompt).toContain("test-sweep");
    expect(prompt).toContain(bug.evidence.testName);
  });
});

// ─── writeAnalystFinding ────────────────────────────────────────────

describe("writeAnalystFinding", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writes finding to correct path with _v field", () => {
    const bug = makeBug();
    const route = { agent: "security", skill: "security-audit" };
    const finding = { rootCause: "SQL injection", impact: "high" };
    writeAnalystFinding(dir, bug, route, finding);

    const filePath = resolve(dir, ".forge", "tempering", "findings", `${bug.bugId}.json`);
    expect(existsSync(filePath)).toBe(true);

    const record = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(record._v).toBe(1);
    expect(record.bugId).toBe(bug.bugId);
    expect(record.agent).toBe("security");
    expect(record.skill).toBe("security-audit");
    expect(record.finding).toEqual(finding);
    expect(record.createdAt).toBeDefined();
  });

  it("creates directory structure if missing", () => {
    const bug = makeBug();
    const route = { agent: "test-runner", skill: null };
    writeAnalystFinding(dir, bug, route, "analysis result");

    const findingsDir = resolve(dir, ".forge", "tempering", "findings");
    expect(existsSync(findingsDir)).toBe(true);
  });
});

// ─── recordDelegation ───────────────────────────────────────────────

describe("recordDelegation", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("appends JSONL line with correct shape", () => {
    const route = { agent: "security", skill: "security-audit" };
    recordDelegation(dir, "BUG-001", route, "analyst", null);

    const filePath = resolve(dir, ".forge", "tempering", "delegations.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const line = readFileSync(filePath, "utf-8").trim();
    const record = JSON.parse(line);
    expect(record._v).toBe(1);
    expect(record.bugId).toBe("BUG-001");
    expect(record.agent).toBe("security");
    expect(record.skill).toBe("security-audit");
    expect(record.mode).toBe("analyst");
    expect(record.reviewItemId).toBeNull();
    expect(record.timestamp).toBeDefined();
  });

  it("appends multiple records without overwriting", () => {
    const route = { agent: "test-runner", skill: null };
    recordDelegation(dir, "BUG-001", route, "analyst", null);
    recordDelegation(dir, "BUG-002", route, "review-queue-item", "review-123");

    const filePath = resolve(dir, ".forge", "tempering", "delegations.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).bugId).toBe("BUG-002");
    expect(JSON.parse(lines[1]).reviewItemId).toBe("review-123");
  });
});

// ─── loadAgentRoutingConfig ─────────────────────────────────────────

describe("loadAgentRoutingConfig", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns { enabled: false } when config file is missing", () => {
    expect(loadAgentRoutingConfig(dir)).toEqual({ enabled: false });
  });

  it("returns { enabled: false } for malformed JSON", () => {
    const configDir = resolve(dir, ".forge", "tempering");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.json"), "NOT JSON{{{", "utf-8");
    expect(loadAgentRoutingConfig(dir)).toEqual({ enabled: false });
  });

  it("returns agentRouting config when present and valid", () => {
    const configDir = resolve(dir, ".forge", "tempering");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.json"), JSON.stringify({
      agentRouting: { enabled: true, customField: "test" },
    }), "utf-8");
    const config = loadAgentRoutingConfig(dir);
    expect(config.enabled).toBe(true);
    expect(config.customField).toBe("test");
  });
});
