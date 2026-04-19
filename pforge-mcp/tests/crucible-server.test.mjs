/**
 * Plan Forge — Crucible MCP handler tests (Slice 01.2).
 *
 * Exercises the handler layer directly (no MCP transport) plus lane
 * inference and hub event emission via a fake hub.
 *
 * Slice 01.2 acceptance:
 *   - MUST: 6 new MCP tool handlers dispatch without error
 *   - MUST: Hub events fire with correct payloads
 *   - MUST: Invalid smelt id → structured error
 *   - MUST: forge_crucible_ask w/o answer returns current question; with answer advances
 *   - MUST: Lane inference heuristic routes keywords correctly
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  inferLane,
  getNextQuestion,
  renderDraftStub,
  collectExistingPhaseNames,
  handleSubmit,
  handleAsk,
  handlePreview,
  handleFinalize,
  handleList,
  handleAbandon,
} from "../crucible-server.mjs";

import { listClaims, claimPhaseNumber } from "../crucible.mjs";
import { loadSmelt } from "../crucible-store.mjs";
import { updateSmelt } from "../crucible-store.mjs";

let projectDir;
let fakeHub;

function makeFakeHub() {
  const broadcasts = [];
  return {
    broadcasts,
    broadcast(event) { broadcasts.push(event); },
  };
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "pforge-crucible-srv-"));
  fakeHub = makeFakeHub();
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── inferLane ───────────────────────────────────────────────────────

describe("inferLane", () => {
  it("routes tweak keywords", () => {
    expect(inferLane("fix typo in README")).toBe("tweak");
    expect(inferLane("bump dependency version")).toBe("tweak");
    expect(inferLane("rename the internal variable")).toBe("tweak");
    expect(inferLane("adjust a config default")).toBe("tweak");
  });
  it("routes feature keywords", () => {
    expect(inferLane("add rate limiting to login")).toBe("feature");
    expect(inferLane("implement OAuth2 provider")).toBe("feature");
    expect(inferLane("support multi-tenant mode")).toBe("feature");
  });
  it("routes full-phase keywords", () => {
    expect(inferLane("new phase for billing redesign")).toBe("full");
    expect(inferLane("major rewrite of the auth layer")).toBe("full");
    expect(inferLane("rearchitect the worker pool")).toBe("full");
  });
  it("FULL wins over FEATURE when both keywords present", () => {
    // "add" triggers FEATURE but "new phase" should take precedence
    expect(inferLane("add new phase for billing")).toBe("full");
  });
  it("defaults to feature for ambiguous text", () => {
    expect(inferLane("make the dashboard pop more")).toBe("feature");
    expect(inferLane("")).toBe("feature");
    expect(inferLane(null)).toBe("feature");
  });
});

// ─── getNextQuestion / renderDraftStub ───────────────────────────────

describe("getNextQuestion", () => {
  it("returns null in Slice 2 (Slice 3 replaces)", () => {
    expect(getNextQuestion({ answers: [] })).toBeNull();
  });
});

describe("renderDraftStub", () => {
  it("includes title, lane, source, raw idea", () => {
    const out = renderDraftStub({
      rawIdea: "add rate limiting",
      lane: "feature",
      source: "human",
      status: "in-progress",
      answers: [],
      phaseName: null,
    });
    expect(out).toContain("# add rate limiting");
    expect(out).toContain("**Lane**: feature");
    expect(out).toContain("**Source**: human");
    expect(out).toContain("## Raw Idea");
  });
  it("renders answers section when present", () => {
    const out = renderDraftStub({
      rawIdea: "x",
      lane: "tweak",
      source: "human",
      status: "in-progress",
      answers: [{ questionId: "1", answer: "yes" }],
      phaseName: null,
    });
    expect(out).toContain("## Interview Answers");
    expect(out).toContain("**1**: yes");
  });
});

// ─── collectExistingPhaseNames ───────────────────────────────────────

describe("collectExistingPhaseNames", () => {
  it("returns empty array on a fresh project", () => {
    expect(collectExistingPhaseNames(projectDir)).toEqual([]);
  });
  it("includes active claims", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    expect(collectExistingPhaseNames(projectDir)).toContain("Phase-01");
  });
  it("includes valid Phase-*.md files in docs/plans/", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "Phase-02.md"), "# stub", "utf-8");
    writeFileSync(join(plansDir, "Phase-02.1.md"), "# stub", "utf-8");
    writeFileSync(join(plansDir, "Phase-CRUCIBLE-01.md"), "# stub", "utf-8"); // should be skipped
    writeFileSync(join(plansDir, "README.md"), "# stub", "utf-8");             // should be skipped
    const names = collectExistingPhaseNames(projectDir).sort();
    expect(names).toEqual(["Phase-02", "Phase-02.1"]);
  });
});

// ─── handleSubmit ────────────────────────────────────────────────────

describe("handleSubmit", () => {
  it("creates smelt with inferred lane and fires start event", () => {
    const r = handleSubmit({
      rawIdea: "add rate limiting",
      projectDir,
      hub: fakeHub,
    });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.recommendedLane).toBe("feature");
    expect(r.firstQuestion).toBeNull();

    const smelt = loadSmelt(r.id, projectDir);
    expect(smelt.lane).toBe("feature");
    expect(smelt.source).toBe("human");

    expect(fakeHub.broadcasts).toHaveLength(1);
    expect(fakeHub.broadcasts[0].type).toBe("crucible-smelt-started");
    expect(fakeHub.broadcasts[0].data).toMatchObject({
      id: r.id,
      lane: "feature",
      source: "human",
    });
  });
  it("honors explicit lane override", () => {
    const r = handleSubmit({
      rawIdea: "add rate limiting",
      lane: "tweak",
      projectDir,
      hub: fakeHub,
    });
    expect(r.recommendedLane).toBe("feature");
    expect(loadSmelt(r.id, projectDir).lane).toBe("tweak");
  });
  it("accepts agent source for recursion tracking", () => {
    const parent = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    const child = handleSubmit({
      rawIdea: "y",
      source: "agent",
      parentSmeltId: parent.id,
      projectDir,
      hub: fakeHub,
    });
    const smelt = loadSmelt(child.id, projectDir);
    expect(smelt.source).toBe("agent");
    expect(smelt.parentSmeltId).toBe(parent.id);
  });
  it("rejects missing rawIdea", () => {
    expect(() => handleSubmit({ rawIdea: "   ", projectDir, hub: fakeHub }))
      .toThrow(/rawIdea is required/);
    expect(() => handleSubmit({ projectDir, hub: fakeHub }))
      .toThrow(/rawIdea is required/);
  });
  it("is safe when hub is null", () => {
    expect(() => handleSubmit({ rawIdea: "x", projectDir, hub: null })).not.toThrow();
  });
});

// ─── handleAsk ───────────────────────────────────────────────────────

describe("handleAsk", () => {
  it("without answer returns draft without mutating", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    fakeHub.broadcasts.length = 0;
    const r = handleAsk({ id, projectDir, hub: fakeHub });
    expect(r.done).toBe(true); // Slice 2 has no questions yet
    expect(r.nextQuestion).toBeNull();
    expect(typeof r.draftPreview).toBe("string");
    // No update event because nothing changed
    expect(fakeHub.broadcasts).toHaveLength(0);
  });
  it("with answer appends and fires updated event", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    fakeHub.broadcasts.length = 0;
    handleAsk({ id, answer: "first answer", projectDir, hub: fakeHub });
    const smelt = loadSmelt(id, projectDir);
    expect(smelt.answers).toHaveLength(1);
    expect(smelt.answers[0].answer).toBe("first answer");
    expect(smelt.answers[0].recordedAt).toMatch(/^\d{4}-/);
    expect(fakeHub.broadcasts).toHaveLength(1);
    expect(fakeHub.broadcasts[0].type).toBe("crucible-smelt-updated");
    expect(fakeHub.broadcasts[0].data).toMatchObject({ id, questionIndex: 1 });
  });
  it("advances question counter across multiple answers", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleAsk({ id, answer: "one", projectDir, hub: fakeHub });
    handleAsk({ id, answer: "two", projectDir, hub: fakeHub });
    const smelt = loadSmelt(id, projectDir);
    expect(smelt.answers.map((a) => a.answer)).toEqual(["one", "two"]);
  });
  it("throws structured error on unknown id", () => {
    expect(() => handleAsk({ id: "nonexistent", answer: "x", projectDir, hub: fakeHub }))
      .toThrow(/smelt not found/);
  });
  it("refuses to continue after abandon", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleAbandon({ id, projectDir });
    expect(() => handleAsk({ id, answer: "x", projectDir, hub: fakeHub }))
      .toThrow(/cannot continue/);
  });
});

// ─── handlePreview ───────────────────────────────────────────────────

describe("handlePreview", () => {
  it("returns markdown + unresolved fields", () => {
    const { id } = handleSubmit({ rawIdea: "add a widget", projectDir, hub: fakeHub });
    const r = handlePreview({ id, projectDir });
    expect(r.markdown).toContain("add a widget");
    expect(r.phaseName).toBeNull();
    expect(r.unresolvedFields).toEqual([]);
  });
  it("throws structured error on unknown id", () => {
    expect(() => handlePreview({ id: "nope", projectDir }))
      .toThrow(/smelt not found/);
  });
});

// ─── handleFinalize ──────────────────────────────────────────────────

describe("handleFinalize", () => {
  it("claims a phase number, writes the plan, marks finalized, emits event", () => {
    const { id } = handleSubmit({
      rawIdea: "add rate limiting",
      projectDir,
      hub: fakeHub,
    });
    fakeHub.broadcasts.length = 0;

    const r = handleFinalize({ id, projectDir, hub: fakeHub });

    expect(r.phaseName).toBe("Phase-01");
    expect(r.planPath.endsWith(join("docs", "plans", "Phase-01.md"))).toBe(true);
    expect(r.hardenerInvoked).toBe(false);

    expect(existsSync(r.planPath)).toBe(true);
    const contents = readFileSync(r.planPath, "utf-8");
    expect(contents).toMatch(/^---\ncrucibleId: /);
    expect(contents).toContain(`crucibleId: ${id}`);
    expect(contents).toContain("add rate limiting");

    const smelt = loadSmelt(id, projectDir);
    expect(smelt.status).toBe("finalized");
    expect(smelt.phaseName).toBe("Phase-01");

    expect(listClaims(projectDir).map((c) => c.phaseName)).toContain("Phase-01");

    expect(fakeHub.broadcasts).toHaveLength(1);
    expect(fakeHub.broadcasts[0].type).toBe("crucible-smelt-finalized");
    expect(fakeHub.broadcasts[0].data.phaseName).toBe("Phase-01");
  });
  it("picks Phase-02 when Phase-01 already exists in docs/plans/", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "Phase-01.md"), "# existing", "utf-8");

    const { id } = handleSubmit({ rawIdea: "y", projectDir, hub: fakeHub });
    const r = handleFinalize({ id, projectDir, hub: fakeHub });
    expect(r.phaseName).toBe("Phase-02");
  });
  it("refuses to finalize abandoned smelts", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleAbandon({ id, projectDir });
    expect(() => handleFinalize({ id, projectDir, hub: fakeHub }))
      .toThrow(/cannot finalize/);
  });
  it("refuses to double-finalize", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleFinalize({ id, projectDir, hub: fakeHub });
    expect(() => handleFinalize({ id, projectDir, hub: fakeHub }))
      .toThrow(/cannot finalize/);
  });
  it("throws structured error on unknown id", () => {
    expect(() => handleFinalize({ id: "nope", projectDir, hub: fakeHub }))
      .toThrow(/smelt not found/);
  });
});

// ─── handleList ──────────────────────────────────────────────────────

describe("handleList", () => {
  it("returns { smelts: [] } for fresh project", () => {
    expect(handleList({ projectDir })).toEqual({ smelts: [] });
  });
  it("returns in-progress smelts", () => {
    handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleSubmit({ rawIdea: "y", projectDir, hub: fakeHub });
    const r = handleList({ projectDir });
    expect(r.smelts).toHaveLength(2);
  });
  it("filters by status", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    handleSubmit({ rawIdea: "y", projectDir, hub: fakeHub });
    handleFinalize({ id, projectDir, hub: fakeHub });
    expect(handleList({ status: "in-progress", projectDir }).smelts).toHaveLength(1);
    expect(handleList({ status: "finalized", projectDir }).smelts).toHaveLength(1);
  });
});

// ─── handleAbandon ───────────────────────────────────────────────────

describe("handleAbandon", () => {
  it("returns {abandoned:true} and releases any claim", () => {
    const { id } = handleSubmit({ rawIdea: "x", projectDir, hub: fakeHub });
    // Simulate a manual claim (would normally happen in finalize)
    claimPhaseNumber(projectDir, "Phase-01", id);
    updateSmelt(id, { phaseName: "Phase-01" }, projectDir);

    const r = handleAbandon({ id, projectDir });
    expect(r.abandoned).toBe(true);
    expect(listClaims(projectDir)).toHaveLength(0);
    expect(loadSmelt(id, projectDir).status).toBe("abandoned");
  });
  it("returns {abandoned:false} for unknown id", () => {
    const r = handleAbandon({ id: "nope", projectDir });
    expect(r.abandoned).toBe(false);
  });
});
