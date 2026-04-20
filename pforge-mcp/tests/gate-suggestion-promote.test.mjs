/**
 * Plan Forge — Phase-26 Slice 7 (Gate-suggestion accept counter + auto-inject) tests
 *
 * Covers:
 *   memory.mjs — computeGateSuggestionKey, recordGateAccept, getGateSuggestionCounter.
 *   orchestrator.mjs — synthesizeGateSuggestions auto-inject path in enforce mode.
 *
 * Contract (Phase-26 MUST #C4 / D8):
 *   - Per-suggestion counter tracked in `.forge/gate-suggestions.jsonl` (append-only).
 *   - Stable key from `(domain, suggestedCommand)` — same tuple aggregates across plans.
 *   - `autoInjected` flag flips true in `enforce` mode when acceptCount >= 5.
 *   - `suggest` and `off` modes NEVER auto-inject, regardless of accept count.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  computeGateSuggestionKey,
  recordGateAccept,
  getGateSuggestionCounter,
} from "../memory.mjs";
import {
  synthesizeGateSuggestions,
  GATE_SUGGESTION_AUTO_INJECT_THRESHOLD,
} from "../orchestrator.mjs";

function writeConfig(cwd, block) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(block, null, 2), "utf-8");
}

const SAMPLE_SUGGESTION = {
  sliceNumber: 3,
  sliceTitle: "Add user service",
  domain: "domain",
  suggestedCommand: "bash -c \"cd pforge-mcp && npx vitest run tests/user.test.mjs\"",
};

describe("computeGateSuggestionKey (Phase-26 D8)", () => {
  it("produces a stable 12-char hex key", () => {
    const key = computeGateSuggestionKey(SAMPLE_SUGGESTION);
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same (domain, command) tuple", () => {
    const a = computeGateSuggestionKey(SAMPLE_SUGGESTION);
    const b = computeGateSuggestionKey({ ...SAMPLE_SUGGESTION, sliceNumber: 99, sliceTitle: "other" });
    expect(a).toBe(b);
  });

  it("differs when domain differs", () => {
    const a = computeGateSuggestionKey(SAMPLE_SUGGESTION);
    const b = computeGateSuggestionKey({ ...SAMPLE_SUGGESTION, domain: "controller" });
    expect(a).not.toBe(b);
  });

  it("differs when command differs", () => {
    const a = computeGateSuggestionKey(SAMPLE_SUGGESTION);
    const b = computeGateSuggestionKey({ ...SAMPLE_SUGGESTION, suggestedCommand: "other" });
    expect(a).not.toBe(b);
  });

  it("handles missing fields without throwing", () => {
    expect(() => computeGateSuggestionKey({})).not.toThrow();
    expect(() => computeGateSuggestionKey({ domain: "x" })).not.toThrow();
    expect(() => computeGateSuggestionKey({ suggestedCommand: "y" })).not.toThrow();
  });
});

describe("recordGateAccept + getGateSuggestionCounter", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-gate-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns 0 when the ledger is missing", () => {
    const key = computeGateSuggestionKey(SAMPLE_SUGGESTION);
    expect(getGateSuggestionCounter(key, cwd)).toBe(0);
  });

  it("returns 0 for a missing suggestionKey arg", () => {
    expect(getGateSuggestionCounter(null, cwd)).toBe(0);
    expect(getGateSuggestionCounter("", cwd)).toBe(0);
  });

  it("increments the counter on each accept", () => {
    const first = recordGateAccept(SAMPLE_SUGGESTION, cwd);
    expect(first.acceptCount).toBe(1);
    const second = recordGateAccept(SAMPLE_SUGGESTION, cwd);
    expect(second.acceptCount).toBe(2);
    expect(second.suggestionKey).toBe(first.suggestionKey);
  });

  it("creates the `.forge/` directory if absent", () => {
    expect(existsSync(resolve(cwd, ".forge"))).toBe(false);
    recordGateAccept(SAMPLE_SUGGESTION, cwd);
    expect(existsSync(resolve(cwd, ".forge", "gate-suggestions.jsonl"))).toBe(true);
  });

  it("appends JSONL records — one per accept", () => {
    recordGateAccept(SAMPLE_SUGGESTION, cwd);
    recordGateAccept(SAMPLE_SUGGESTION, cwd);
    const raw = readFileSync(resolve(cwd, ".forge", "gate-suggestions.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("accept");
    expect(first.domain).toBe("domain");
    expect(first.sliceNumber).toBe(3);
    expect(typeof first.at).toBe("string");
  });

  it("keeps counters separate across distinct suggestions", () => {
    const a = { ...SAMPLE_SUGGESTION, domain: "domain" };
    const b = { ...SAMPLE_SUGGESTION, domain: "controller" };
    recordGateAccept(a, cwd);
    recordGateAccept(a, cwd);
    recordGateAccept(b, cwd);
    expect(getGateSuggestionCounter(computeGateSuggestionKey(a), cwd)).toBe(2);
    expect(getGateSuggestionCounter(computeGateSuggestionKey(b), cwd)).toBe(1);
  });

  it("throws on non-object input", () => {
    expect(() => recordGateAccept(null, cwd)).toThrow();
    expect(() => recordGateAccept("str", cwd)).toThrow();
  });

  it("tolerates malformed lines in the ledger", () => {
    const path = resolve(cwd, ".forge", "gate-suggestions.jsonl");
    // Seed with a valid accept + a malformed line
    recordGateAccept(SAMPLE_SUGGESTION, cwd);
    writeFileSync(path, `${readFileSync(path, "utf-8")}not valid json\n`, "utf-8");
    expect(getGateSuggestionCounter(computeGateSuggestionKey(SAMPLE_SUGGESTION), cwd)).toBe(1);
  });
});

describe("synthesizeGateSuggestions — auto-inject path (Phase-26 C4)", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-gate-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  const sliceWithoutGate = {
    number: 1,
    title: "Add user domain service",
    files: ["src/user-service.js"],
    validationGate: "",
  };

  it("exports the threshold constant as 5", () => {
    expect(GATE_SUGGESTION_AUTO_INJECT_THRESHOLD).toBe(5);
  });

  it("attaches suggestionKey and acceptCount=0 to fresh suggestions", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "suggest" } } });
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions.length).toBe(1);
    const s = result.suggestions[0];
    expect(typeof s.suggestionKey).toBe("string");
    expect(s.acceptCount).toBe(0);
    expect(s.autoInjected).toBe(false);
  });

  it("does NOT auto-inject in `suggest` mode even above threshold", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "suggest" } } });
    // Pre-seed 6 accepts for the matching suggestion
    const preview = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    for (let i = 0; i < 6; i++) recordGateAccept(preview.suggestions[0], cwd);
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions[0].acceptCount).toBe(6);
    expect(result.suggestions[0].autoInjected).toBe(false);
    expect(result.autoInjected).toEqual([]);
  });

  it("does NOT auto-inject in `enforce` mode below threshold", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "enforce" } } });
    const preview = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    for (let i = 0; i < 4; i++) recordGateAccept(preview.suggestions[0], cwd);
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions[0].acceptCount).toBe(4);
    expect(result.suggestions[0].autoInjected).toBe(false);
  });

  it("auto-injects in `enforce` mode at threshold", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "enforce" } } });
    const preview = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    for (let i = 0; i < 5; i++) recordGateAccept(preview.suggestions[0], cwd);
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions[0].acceptCount).toBe(5);
    expect(result.suggestions[0].autoInjected).toBe(true);
    expect(result.autoInjected.length).toBe(1);
    expect(result.autoInjected[0].suggestionKey).toBe(result.suggestions[0].suggestionKey);
    expect(result.autoInjected[0].acceptCount).toBe(5);
  });

  it("auto-injects above threshold", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "enforce" } } });
    const preview = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    for (let i = 0; i < 12; i++) recordGateAccept(preview.suggestions[0], cwd);
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions[0].autoInjected).toBe(true);
    expect(result.suggestions[0].acceptCount).toBe(12);
  });

  it("returns an empty autoInjected array when no suggestions qualify", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "enforce" } } });
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.autoInjected).toEqual([]);
  });

  it("returns empty suggestions + no autoInjected in `off` mode", () => {
    writeConfig(cwd, { runtime: { gateSynthesis: { mode: "off" } } });
    const result = synthesizeGateSuggestions({ slices: [sliceWithoutGate], cwd });
    expect(result.suggestions).toEqual([]);
    expect(result.mode).toBe("off");
  });
});
