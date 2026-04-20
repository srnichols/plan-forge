import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  logFinding,
  listFindings,
  updateFindingStatus,
  validateFinding,
  toSlug,
  SEVERITY_VALUES,
  SURFACE_VALUES,
  STATUS_VALUES,
} from "../testbed/defect-log.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-defect-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt) };
}

function makeFinding(overrides = {}) {
  return {
    findingId: overrides.findingId || `f-${randomUUID().slice(0, 8)}`,
    date: "2026-04-19",
    scenario: "happy-path-01",
    severity: "medium",
    surface: "cli",
    title: "Test finding title",
    expected: "exit code 0",
    observed: "exit code 1",
    status: "open",
    ...overrides,
  };
}

describe("testbed/defect-log", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    hub = makeHub();
    mkdirSync(resolve(tmpDir, "docs", "plans", "testbed-findings"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── validateFinding ───────────────────────────────────────────────

  it("rejects missing severity", () => {
    const result = validateFinding({ findingId: "f1", date: "2026-01-01", scenario: "s1", surface: "cli", title: "t", expected: "e", observed: "o", status: "open" });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("severity"))).toBe(true);
  });

  it("rejects invalid severity value", () => {
    const result = validateFinding(makeFinding({ severity: "critical" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("severity"))).toBe(true);
  });

  it("accepts all valid severity values", () => {
    for (const sev of SEVERITY_VALUES) {
      const result = validateFinding(makeFinding({ severity: sev }));
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid surface value", () => {
    const result = validateFinding(makeFinding({ surface: "unknown-surface" }));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = validateFinding(makeFinding({ status: "pending" }));
    expect(result.ok).toBe(false);
  });

  // ─── toSlug ────────────────────────────────────────────────────────

  it("generates kebab-case slug max 40 chars", () => {
    const slug = toSlug("This Is A Very Long Title That Should Be Truncated For Safety");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toMatch(/^-|-$/);
  });

  // ─── logFinding ────────────────────────────────────────────────────

  it("writes finding file under testbed-findings", () => {
    const finding = makeFinding();
    const result = logFinding(finding, { hub, projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.findingId).toBe(finding.findingId);
  });

  it("auto-creates findings directory when missing", () => {
    const freshDir = makeTmpDir();
    const finding = makeFinding();
    const result = logFinding(finding, { hub, projectRoot: freshDir });
    expect(result.ok).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    rmSync(freshDir, { recursive: true, force: true });
  });

  it("idempotent re-log by findingId overwrites file", () => {
    const finding = makeFinding({ title: "original" });
    logFinding(finding, { hub, projectRoot: tmpDir });
    const updated = { ...finding, observed: "updated observed" };
    const result = logFinding(updated, { hub, projectRoot: tmpDir });
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.observed).toBe("updated observed");
  });

  it("handles slug collision with suffix", () => {
    const f1 = makeFinding({ findingId: "f1", title: "same title", date: "2026-01-01" });
    const f2 = makeFinding({ findingId: "f2", title: "same title", date: "2026-01-01" });
    const r1 = logFinding(f1, { hub, projectRoot: tmpDir });
    const r2 = logFinding(f2, { hub, projectRoot: tmpDir });
    expect(r1.filename).not.toBe(r2.filename);
  });

  it("redacts secret-like patterns in observed field", () => {
    const finding = makeFinding({ observed: "Token was ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn and sk-abcdefghijklmnopqrstuvwxyz" });
    const result = logFinding(finding, { hub, projectRoot: tmpDir });
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.observed).not.toContain("ghp_");
    expect(written.observed).not.toContain("sk-");
    expect(written.observed).toContain("[REDACTED]");
  });

  it("emits testbed-finding-logged hub event", () => {
    const finding = makeFinding();
    logFinding(finding, { hub, projectRoot: tmpDir });
    expect(hub.events.length).toBe(1);
    expect(hub.events[0].type).toBe("testbed-finding-logged");
    expect(hub.events[0].data.findingId).toBe(finding.findingId);
  });

  // ─── listFindings ──────────────────────────────────────────────────

  it("lists findings filtered by status", () => {
    logFinding(makeFinding({ findingId: "f1", status: "open" }), { hub, projectRoot: tmpDir });
    logFinding(makeFinding({ findingId: "f2", status: "open" }), { hub, projectRoot: tmpDir });
    const all = listFindings({}, { projectRoot: tmpDir });
    expect(all.length).toBe(2);
    const open = listFindings({ status: "open" }, { projectRoot: tmpDir });
    expect(open.length).toBe(2);
  });

  // ─── updateFindingStatus ───────────────────────────────────────────

  it("updates status from open to fixed", () => {
    const finding = makeFinding({ findingId: "update-test" });
    logFinding(finding, { hub, projectRoot: tmpDir });
    const result = updateFindingStatus("update-test", "fixed", "GH-123", { projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.noop).toBe(false);
  });

  it("returns noop when status unchanged", () => {
    const finding = makeFinding({ findingId: "noop-test" });
    logFinding(finding, { hub, projectRoot: tmpDir });
    const result = updateFindingStatus("noop-test", "open", null, { projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.noop).toBe(true);
  });

  it("throws on unknown findingId", () => {
    expect(() => updateFindingStatus("nonexistent", "fixed", null, { projectRoot: tmpDir }))
      .toThrow(/Finding not found/);
  });
});
