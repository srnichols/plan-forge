/**
 * Issue #254 — records in .forge/liveguard-memories.jsonl whose `content` is
 * an object instead of a string are permanently unsearchable.
 *
 * Measured in THIS repo's store: 42 of 50 records (84%) are double-wrapped —
 * worse than the 63/99 reported. The outer record is a well-formed thought
 * (`_v`, `expiresAt`, `captured_at` all stamped), and one level down sits a
 * second thought envelope carrying the real text.
 *
 * The report says "the writer that emits the double-wrapped shape was not
 * identified and is the real root cause". It is `_captureRunMemoryAndDrain`
 * in orchestrator/run-plan.mjs and `_handleRunPlanMemoryCapture` in
 * server/tool-handlers/shared.mjs. Both call `buildRunSummaryThought()` /
 * `buildCostAnomalyThought()`, which return a full
 * `{ content, project, source, created_by }` envelope, and pass that whole
 * object as the `content` argument of `captureMemory()` — which wraps it
 * again. The measured inner key sets match those two builders exactly,
 * including the extra `type` that only the cost builder adds.
 *
 * Sibling call sites got it right: `shapeWatcherAnomalyThought()` returns the
 * same envelope shape and its callers destructure
 * (`captureMemory(shaped.content, shaped.type, shaped.source, ...)`).
 *
 * So this file pins both halves:
 *   - the WRITER, so no new double-wrapped records are produced
 *   - the READER, so the ones already on disk become searchable again
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { thoughtContent, buildRunSummaryThought, buildCostAnomalyThought } from "../memory.mjs";
import { _handleRunPlanMemoryCapture } from "../server/tool-handlers/shared.mjs";
import { L2_SOURCES } from "../search/sources.mjs";

let cwd;
beforeEach(() => {
  cwd = mkdtempSync(resolve(tmpdir(), "pf-254-"));
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
});
afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

// ─── the helper ───────────────────────────────────────────────────────

describe("thoughtContent (#254)", () => {
  it("returns a plain string unchanged", () => {
    expect(thoughtContent({ content: "hello" })).toBe("hello");
  });

  it("unwraps one level of double-wrapping — the shape actually on disk", () => {
    expect(thoughtContent({
      content: { content: "real text", project: "p", source: "s", created_by: "x" },
    })).toBe("real text");
  });

  it("unwraps several levels", () => {
    expect(thoughtContent({ content: { content: { content: "deep" } } })).toBe("deep");
  });

  it("honours the message / text aliases at any depth", () => {
    expect(thoughtContent({ message: "m" })).toBe("m");
    expect(thoughtContent({ text: "t" })).toBe("t");
    expect(thoughtContent({ content: { message: "nested message" } })).toBe("nested message");
  });

  it("never returns '[object Object]'", () => {
    expect(thoughtContent({ content: { project: "p" } })).toBe("");
    expect(thoughtContent({ content: {} })).toBe("");
  });

  it("terminates on a self-referential record instead of recursing forever", () => {
    const rec = { content: null };
    rec.content = rec;
    expect(() => thoughtContent(rec)).not.toThrow();
    expect(thoughtContent(rec)).toBe("");
  });

  it("tolerates junk", () => {
    expect(thoughtContent(null)).toBe("");
    expect(thoughtContent(undefined)).toBe("");
    expect(thoughtContent("bare string")).toBe("bare string");
    expect(thoughtContent({ content: 42 })).toBe("");
    expect(thoughtContent({ content: ["a"] })).toBe("");
  });
});

// ─── the writer (root cause) ──────────────────────────────────────────

describe("writers no longer double-wrap (#254)", () => {
  function readStore() {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf-8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  }

  const summary = {
    plan: "Phase-99-TEST",
    status: "success",
    results: { passed: 3, failed: 0 },
    totalDuration: 12_000,
    cost: { total_cost_usd: 4 },
  };

  it("the builders still return an envelope — other consumers depend on it", () => {
    const t = buildRunSummaryThought(summary, "proj");
    expect(typeof t).toBe("object");
    expect(typeof t.content).toBe("string");
    expect(t.project).toBe("proj");
  });

  it("_handleRunPlanMemoryCapture writes a string content, not the envelope", () => {
    _handleRunPlanMemoryCapture({
      _memoryCapture: {
        _captured: false,
        runSummary: buildRunSummaryThought(summary, "proj"),
        costAnomaly: buildCostAnomalyThought(summary, { total_cost_usd: 4, runs: 4 }, "proj"),
      },
    }, cwd);

    const records = readStore();
    expect(records.length).toBeGreaterThan(0);
    for (const rec of records) {
      expect(typeof rec.content, `content should be a string, got ${typeof rec.content}`).toBe("string");
      expect(rec.content).not.toBe("[object Object]");
    }
    expect(records[0].content).toContain("Plan execution completed: Phase-99-TEST");
  });

  it("the orchestrator capture path extracts .content too", async () => {
    // _captureRunMemoryAndDrain sits deep inside runPlan; guard the call shape
    // at the source so a future edit cannot silently reintroduce the wrap.
    const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
    const captureLines = src.split(/\r?\n/).filter((l) => /captureMemory\(\{\s*content:/.test(l));
    expect(captureLines.length).toBeGreaterThan(0);
    for (const line of captureLines) {
      expect(line, `passes a thought envelope as content: ${line.trim()}`)
        .not.toMatch(/content:\s*(runSummary|costAnomaly)\s*,/);
    }
  });
});

// ─── the readers (recovery of what is already on disk) ────────────────

describe("readers recover double-wrapped records (#254)", () => {
  const DOUBLE_WRAPPED = {
    _v: 1,
    content: {
      content: "Plan execution completed: Phase-42. Status: success",
      project: "plan-forge",
      source: "plan-forge-orchestrator/Phase-42",
      created_by: "plan-forge-orchestrator",
    },
    project: "plan-forge",
    type: "decision",
    source: "forge_run_plan",
    created_by: "liveguard-auto",
    captured_at: "2026-09-02T00:00:00.000Z",
  };

  it("forge_search indexes the real text, not [object Object]", () => {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    writeFileSync(p, `${JSON.stringify(DOUBLE_WRAPPED)}\n`, "utf-8");
    const memory = L2_SOURCES.find((s) => s.source === "memory");
    const entries = memory.parse(null, p);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).not.toContain("[object Object]");
    expect(entries[0].text).toContain("Phase-42");
  });

  it("forge_local_search scores a double-wrapped record above zero", async () => {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    writeFileSync(p, `${JSON.stringify(DOUBLE_WRAPPED)}\n`, "utf-8");
    const { searchLocalThoughts } = await import("../local-recall.mjs");
    const res = await searchLocalThoughts("plan execution completed", { cwd, limit: 5 });
    const hits = res?.results || res?.hits || [];
    expect(hits.length, "double-wrapped record scored 0 and was dropped").toBeGreaterThan(0);
  });

  it("readLocalThoughts surfaces the real text for a double-wrapped record", async () => {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    writeFileSync(p, `${JSON.stringify(DOUBLE_WRAPPED)}\n`, "utf-8");
    const { readLocalThoughts, buildCorpusIndex } = await import("../local-recall.mjs");
    const thoughts = readLocalThoughts(cwd);
    expect(thoughts.length).toBe(1);
    const index = buildCorpusIndex(thoughts);
    // A record whose tokens are empty contributes nothing to the corpus.
    expect(index.tokenMaps[0].length, "record tokenised to nothing").toBeGreaterThan(0);
  });

  it("the corpus index is built correctly for the FIRST record too", async () => {
    // Array.map passes the index as the second argument. A bare
    // `.map(thoughtContent)` reads that as maxDepth, so record 0 gets
    // maxDepth=0 and never unwraps. Two records, first one double-wrapped.
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    writeFileSync(p, [
      JSON.stringify(DOUBLE_WRAPPED),
      JSON.stringify({ content: "second record plain string", type: "lesson" }),
      "",
    ].join("\n"), "utf-8");
    const { readLocalThoughts, buildCorpusIndex } = await import("../local-recall.mjs");
    const index = buildCorpusIndex(readLocalThoughts(cwd));
    // tokenMaps[0] is the FIRST record — the one a bare .map(thoughtContent)
    // would have handed maxDepth=0 and tokenised to nothing.
    expect(index.tokenMaps[0].length, "first record tokenised to nothing").toBeGreaterThan(0);
    expect(index.tokenMaps[0].map(([tok]) => tok)).toContain("phase");
  });

  it("the timeline payload carries a string, not an object", async () => {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    writeFileSync(p, `${JSON.stringify({ ...DOUBLE_WRAPPED, timestamp: "2026-09-02T00:00:00.000Z" })}\n`, "utf-8");
    const { TIMELINE_SOURCES } = await import("../timeline/sources.mjs");
    const events = await TIMELINE_SOURCES.memory.read(cwd, {});
    expect(typeof events[0].payload.content).toBe("string");
    expect(events[0].payload.content).toContain("Phase-42");
  });
});
