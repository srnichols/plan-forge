/**
 * Plan Forge — Crucible Mode interface tests (Phase-59 Slice 1).
 *
 * Verifies the Slice 1 substrate:
 *   - mode.mjs interface contract + validateMode
 *   - registry.mjs CRUD API + isolation helper
 *   - core/finalize.mjs re-export surface
 *   - core/render-shell.mjs re-export surface
 *   - core/interview-protocol.mjs re-export surface
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MODE_INTERFACE_KEYS, validateMode } from "../crucible/mode.mjs";
import {
  registerMode,
  getMode,
  listModes,
  _resetRegistry,
} from "../crucible/registry.mjs";
import {
  CRITICAL_FIELDS,
  handleFinalize,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
} from "../crucible/core/finalize.mjs";
import { renderDraft, MANDATORY_BLOCKS, synthesizeSliceBlock, extractUnresolvedFields } from "../crucible/core/render-shell.mjs";
import {
  getQuestionBank,
  getNextQuestion,
  recordAnswer,
  TWEAK_QUESTIONS,
  FEATURE_QUESTIONS,
  FULL_QUESTIONS,
} from "../crucible/core/interview-protocol.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeValidMode(overrides = {}) {
  return {
    id: "test-mode",
    label: "Test Mode",
    questionBank: () => Object.freeze([]),
    renderDraft: () => "",
    finalize: () => ({}),
    ...overrides,
  };
}

// ─── mode.mjs ────────────────────────────────────────────────────────

describe("mode.mjs — MODE_INTERFACE_KEYS", () => {
  it("is a frozen array with exactly 5 keys", () => {
    expect(Array.isArray(MODE_INTERFACE_KEYS)).toBe(true);
    expect(Object.isFrozen(MODE_INTERFACE_KEYS)).toBe(true);
    expect(MODE_INTERFACE_KEYS).toHaveLength(5);
  });

  it("contains the required interface keys", () => {
    expect(MODE_INTERFACE_KEYS).toContain("id");
    expect(MODE_INTERFACE_KEYS).toContain("label");
    expect(MODE_INTERFACE_KEYS).toContain("questionBank");
    expect(MODE_INTERFACE_KEYS).toContain("renderDraft");
    expect(MODE_INTERFACE_KEYS).toContain("finalize");
  });
});

describe("mode.mjs — validateMode", () => {
  it("throws on null", () => {
    expect(() => validateMode(null)).toThrow(TypeError);
  });

  it("throws on non-object", () => {
    expect(() => validateMode("string")).toThrow(TypeError);
  });

  it("throws when a required key is missing", () => {
    expect(() => validateMode({ id: "x", label: "x", questionBank: () => [], renderDraft: () => "" }))
      .toThrow(/finalize/);
  });

  it("throws when id is empty string", () => {
    expect(() => validateMode(makeValidMode({ id: "  " }))).toThrow(TypeError);
  });

  it("throws when questionBank is not a function", () => {
    expect(() => validateMode(makeValidMode({ questionBank: [] }))).toThrow(TypeError);
  });

  it("throws when renderDraft is not a function", () => {
    expect(() => validateMode(makeValidMode({ renderDraft: "string" }))).toThrow(TypeError);
  });

  it("throws when finalize is not a function", () => {
    expect(() => validateMode(makeValidMode({ finalize: null }))).toThrow(TypeError);
  });

  it("accepts a fully valid mode descriptor", () => {
    expect(() => validateMode(makeValidMode())).not.toThrow();
  });
});

// ─── registry.mjs ────────────────────────────────────────────────────

describe("registry.mjs — API", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  it("registerMode / getMode roundtrip", () => {
    const mode = makeValidMode({ id: "tweak" });
    registerMode(mode);
    expect(getMode("tweak")).toBe(mode);
  });

  it("registerMode returns the mode", () => {
    const mode = makeValidMode({ id: "feature" });
    expect(registerMode(mode)).toBe(mode);
  });

  it("getMode throws on unknown id", () => {
    expect(() => getMode("nonexistent")).toThrow(/not registered/);
  });

  it("listModes returns all registered modes", () => {
    const a = makeValidMode({ id: "a" });
    const b = makeValidMode({ id: "b" });
    registerMode(a);
    registerMode(b);
    const modes = listModes();
    expect(modes).toHaveLength(2);
    expect(modes).toContain(a);
    expect(modes).toContain(b);
  });

  it("listModes returns empty array when nothing registered", () => {
    expect(listModes()).toEqual([]);
  });

  it("registerMode rejects an invalid mode descriptor", () => {
    expect(() => registerMode({ id: "x" })).toThrow(TypeError);
  });

  it("re-registering the same id overwrites the previous entry", () => {
    const first = makeValidMode({ id: "tweak", label: "First" });
    const second = makeValidMode({ id: "tweak", label: "Second" });
    registerMode(first);
    registerMode(second);
    expect(getMode("tweak").label).toBe("Second");
    expect(listModes()).toHaveLength(1);
  });
});

// ─── core/finalize.mjs ───────────────────────────────────────────────

describe("core/finalize.mjs — re-exports", () => {
  it("CRITICAL_FIELDS is a Set", () => {
    expect(CRITICAL_FIELDS).toBeInstanceOf(Set);
  });

  it("CRITICAL_FIELDS contains scope-in and validation-gates", () => {
    expect(CRITICAL_FIELDS.has("scope-in")).toBe(true);
    expect(CRITICAL_FIELDS.has("validation-gates")).toBe(true);
  });

  it("CRITICAL_FIELDS contains forbidden-actions", () => {
    expect(CRITICAL_FIELDS.has("forbidden-actions")).toBe(true);
  });

  it("handleFinalize is a function", () => {
    expect(typeof handleFinalize).toBe("function");
  });

  it("CrucibleFinalizeRefusedError extends Error", () => {
    const err = new CrucibleFinalizeRefusedError("test", []);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CrucibleFinalizeRefusedError);
  });

  it("CruciblePlanExistsError extends Error", () => {
    const err = new CruciblePlanExistsError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("CrucibleAskMismatchError extends Error", () => {
    const err = new CrucibleAskMismatchError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── core/render-shell.mjs ───────────────────────────────────────────

describe("core/render-shell.mjs — re-exports", () => {
  it("renderDraft is a function", () => {
    expect(typeof renderDraft).toBe("function");
  });

  it("MANDATORY_BLOCKS is a frozen array of 7 headings", () => {
    expect(Array.isArray(MANDATORY_BLOCKS)).toBe(true);
    expect(Object.isFrozen(MANDATORY_BLOCKS)).toBe(true);
    expect(MANDATORY_BLOCKS).toHaveLength(7);
    for (const h of MANDATORY_BLOCKS) expect(typeof h).toBe("string");
  });

  it("synthesizeSliceBlock is a function", () => {
    expect(typeof synthesizeSliceBlock).toBe("function");
  });

  it("extractUnresolvedFields is a function", () => {
    expect(typeof extractUnresolvedFields).toBe("function");
  });
});

// ─── core/interview-protocol.mjs ─────────────────────────────────────

describe("core/interview-protocol.mjs — re-exports", () => {
  it("getQuestionBank returns tweak bank", () => {
    const bank = getQuestionBank("tweak");
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThan(0);
  });

  it("getQuestionBank returns feature bank", () => {
    const bank = getQuestionBank("feature");
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThan(0);
  });

  it("getQuestionBank returns full bank", () => {
    const bank = getQuestionBank("full");
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThan(0);
  });

  it("TWEAK_QUESTIONS, FEATURE_QUESTIONS, FULL_QUESTIONS are frozen arrays", () => {
    expect(Object.isFrozen(TWEAK_QUESTIONS)).toBe(true);
    expect(Object.isFrozen(FEATURE_QUESTIONS)).toBe(true);
    expect(Object.isFrozen(FULL_QUESTIONS)).toBe(true);
  });

  it("getNextQuestion is a function", () => {
    expect(typeof getNextQuestion).toBe("function");
  });

  it("recordAnswer is a function", () => {
    expect(typeof recordAnswer).toBe("function");
  });
});
