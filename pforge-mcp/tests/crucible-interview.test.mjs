/**
 * Plan Forge — Crucible Interview Engine tests (Slice 01.3).
 *
 * Exercises:
 *   - Question-bank shape per lane
 *   - getNextQuestion advances, stops, validates
 *   - recordAnswer immutability
 *   - buildRecommendedDefault's three-source fallback
 *   - Strict "no fabrication" rule (returns null when nothing matches)
 *   - renderDraft emits the 6 mandatory blocks per lane
 *   - extractUnresolvedFields surfaces {{TBD:}} ids correctly
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  TWEAK_QUESTIONS,
  FEATURE_QUESTIONS,
  FULL_QUESTIONS,
  getQuestionBank,
  getNextQuestion,
  recordAnswer,
  buildRecommendedDefault,
  totalQuestions,
} from "../crucible-interview.mjs";

import {
  renderDraft,
  extractUnresolvedFields,
  MANDATORY_BLOCKS,
} from "../crucible-draft.mjs";

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "pforge-crucible-iv-"));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Question banks ──────────────────────────────────────────────────

describe("question banks", () => {
  it("tweak bank has 4 questions", () => {
    // Issue #135 — added `forbidden-actions` (was 3).
    expect(TWEAK_QUESTIONS).toHaveLength(4);
  });
  it("feature bank has 7 questions", () => {
    // Issue #135 — added `forbidden-actions` (was 6).
    expect(FEATURE_QUESTIONS).toHaveLength(7);
  });
  it("full bank has 12 questions (mirrors Step-0 prompt)", () => {
    expect(FULL_QUESTIONS).toHaveLength(12);
  });
  it("every question has id, prompt, required fields", () => {
    const all = [...TWEAK_QUESTIONS, ...FEATURE_QUESTIONS, ...FULL_QUESTIONS];
    for (const q of all) {
      expect(typeof q.id).toBe("string");
      expect(q.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(typeof q.prompt).toBe("string");
      expect(q.prompt.length).toBeGreaterThan(10);
      expect(typeof q.required).toBe("boolean");
    }
  });
  it("question ids are unique within each bank", () => {
    for (const bank of [TWEAK_QUESTIONS, FEATURE_QUESTIONS, FULL_QUESTIONS]) {
      const ids = bank.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("getQuestionBank maps lanes to the right banks", () => {
    expect(getQuestionBank("tweak")).toBe(TWEAK_QUESTIONS);
    expect(getQuestionBank("feature")).toBe(FEATURE_QUESTIONS);
    expect(getQuestionBank("full")).toBe(FULL_QUESTIONS);
  });
  it("getQuestionBank defaults to feature for unknown lanes", () => {
    expect(getQuestionBank("nonsense")).toBe(FEATURE_QUESTIONS);
  });
  it("totalQuestions matches bank length", () => {
    // Issue #135 — tweak 3→4, feature 6→7.
    expect(totalQuestions("tweak")).toBe(4);
    expect(totalQuestions("feature")).toBe(7);
    expect(totalQuestions("full")).toBe(12);
  });
});

// ─── getNextQuestion ─────────────────────────────────────────────────

describe("getNextQuestion", () => {
  it("returns the first question for a fresh smelt", () => {
    const q = getNextQuestion({ lane: "feature", answers: [] });
    expect(q).not.toBeNull();
    expect(q.id).toBe(FEATURE_QUESTIONS[0].id);
    expect(q.questionIndex).toBe(1);
    // Issue #135 — feature lane gained `forbidden-actions` (was 6).
    expect(q.totalQuestions).toBe(7);
  });
  it("advances to the next unanswered question", () => {
    const q = getNextQuestion({
      lane: "tweak",
      answers: [{ questionId: "scope-file", answer: "x" }],
    });
    expect(q.id).toBe("validation");
    expect(q.questionIndex).toBe(2);
  });
  it("returns null when all questions are answered", () => {
    const smelt = {
      lane: "tweak",
      answers: TWEAK_QUESTIONS.map((q) => ({ questionId: q.id, answer: "x" })),
    };
    expect(getNextQuestion(smelt)).toBeNull();
  });
  it("returns null for finalized smelts", () => {
    expect(getNextQuestion({ lane: "feature", answers: [], status: "finalized" })).toBeNull();
  });
  it("returns null for abandoned smelts", () => {
    expect(getNextQuestion({ lane: "feature", answers: [], status: "abandoned" })).toBeNull();
  });
  it("includes recommendedDefault field (null when no source)", () => {
    const q = getNextQuestion({ lane: "feature", answers: [] }, { projectDir });
    expect(q).toHaveProperty("recommendedDefault");
    // No PROJECT-PRINCIPLES and no prior plans -> null
    expect(q.recommendedDefault).toBeNull();
  });
  it("returns null for a nullish smelt", () => {
    expect(getNextQuestion(null)).toBeNull();
  });
});

// ─── recordAnswer ────────────────────────────────────────────────────

describe("recordAnswer", () => {
  it("appends an answer immutably", () => {
    const smelt = { lane: "tweak", answers: [] };
    const next = recordAnswer(smelt, "scope-file", "README.md");
    expect(smelt.answers).toHaveLength(0); // original unchanged
    expect(next.answers).toHaveLength(1);
    expect(next.answers[0]).toMatchObject({
      questionId: "scope-file",
      answer: "README.md",
    });
    expect(next.answers[0].recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("rejects empty questionId", () => {
    expect(() => recordAnswer({ answers: [] }, "", "x")).toThrow(/questionId required/);
  });
  it("rejects non-string answer", () => {
    expect(() => recordAnswer({ answers: [] }, "q", 42)).toThrow(/answer must be a string/);
  });
  it("rejects null smelt", () => {
    expect(() => recordAnswer(null, "q", "a")).toThrow(/smelt required/);
  });
});

// ─── buildRecommendedDefault — strict no-fabrication ─────────────────

describe("buildRecommendedDefault (primary: PROJECT-PRINCIPLES.md)", () => {
  it("returns null when projectDir is absent", () => {
    expect(buildRecommendedDefault("any", { defaultSource: "validation-gate" })).toBeNull();
  });
  it("returns null when defaultSource is null (question opted out)", () => {
    expect(buildRecommendedDefault("any", { projectDir, defaultSource: null })).toBeNull();
  });
  it("returns null when memory empty (the key guardrail — NO FABRICATION)", () => {
    const v = buildRecommendedDefault("validation", {
      projectDir,
      defaultSource: "validation-gate",
    });
    expect(v).toBeNull();
  });
  it("reads a validation-gate value from PROJECT-PRINCIPLES.md", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "PROJECT-PRINCIPLES.md"),
      "# Principles\n\n## Validation command\n\n```bash\nnpm test --run\n```\n",
      "utf-8",
    );
    const v = buildRecommendedDefault("validation", {
      projectDir,
      defaultSource: "validation-gate",
    });
    expect(v).toBe("npm test --run");
  });
  it("reads a test-framework hint from PROJECT-PRINCIPLES.md", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "PROJECT-PRINCIPLES.md"),
      "# Principles\n\nTesting framework: vitest\n",
      "utf-8",
    );
    expect(buildRecommendedDefault("tests", {
      projectDir,
      defaultSource: "test-framework",
    })).toBe("vitest");
  });
});

describe("buildRecommendedDefault (secondary: prior Phase-*.md)", () => {
  it("reads a validation-gate from the most recent Phase plan", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "Phase-05.md"),
      "# Phase 5\n\n**Validation Gate**\n\n```bash\nnpm --prefix api test -- --run\n```\n",
      "utf-8",
    );
    const v = buildRecommendedDefault("validation-gates", {
      projectDir,
      defaultSource: "validation-gate",
    });
    expect(v).toBe("npm --prefix api test -- --run");
  });
  it("returns null when no Phase-*.md contains the requested source", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "Phase-05.md"),
      "# Phase 5\n\nNothing relevant here.\n",
      "utf-8",
    );
    const v = buildRecommendedDefault("stack-boundary", {
      projectDir,
      defaultSource: "stack",
    });
    expect(v).toBeNull();
  });
  it("reads slice-count from the most recent plan's slice headers", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "Phase-07.md"),
      "# Phase 7\n\n### Slice 1 — a\n\n### Slice 2 — b\n\n### Slice 3 — c\n",
      "utf-8",
    );
    const v = buildRecommendedDefault("slice-count", {
      projectDir,
      defaultSource: "slice-count",
    });
    expect(v).toBe("3");
  });
  it("PROJECT-PRINCIPLES wins over Phase-*.md when both provide values", () => {
    const plansDir = resolve(projectDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "PROJECT-PRINCIPLES.md"),
      "## Validation\n\n```\nmake verify\n```\n",
      "utf-8",
    );
    writeFileSync(
      join(plansDir, "Phase-01.md"),
      "**Validation Gate**\n\n```\nnpm test\n```\n",
      "utf-8",
    );
    const v = buildRecommendedDefault("validation", {
      projectDir,
      defaultSource: "validation-gate",
    });
    expect(v).toBe("make verify");
  });
});

// ─── renderDraft — 6 mandatory blocks ────────────────────────────────

describe("renderDraft — six mandatory blocks", () => {
  it("emits all 6 mandatory block headings for a feature smelt", () => {
    const md = renderDraft({
      rawIdea: "add rate limiting",
      lane: "feature",
      source: "human",
      status: "in-progress",
      answers: [],
      phaseName: null,
    });
    for (const heading of MANDATORY_BLOCKS) {
      expect(md).toContain(heading);
    }
  });
  it("emits all 6 mandatory block headings for a tweak smelt", () => {
    const md = renderDraft({
      rawIdea: "fix typo", lane: "tweak", source: "human", status: "in-progress", answers: [],
    });
    for (const heading of MANDATORY_BLOCKS) expect(md).toContain(heading);
  });
  it("emits all 6 mandatory block headings for a full smelt", () => {
    const md = renderDraft({
      rawIdea: "new phase", lane: "full", source: "human", status: "in-progress", answers: [],
    });
    for (const heading of MANDATORY_BLOCKS) expect(md).toContain(heading);
    // Full lane also adds problem/stack/data/api/security
    expect(md).toContain("## Problem & Success Metric");
    expect(md).toContain("## Stack Boundary");
    expect(md).toContain("## Data Model");
    expect(md).toContain("## API Surface");
    expect(md).toContain("## Security Posture");
  });
  it("surfaces {{TBD: <id>}} markers for every unanswered field", () => {
    const md = renderDraft({
      rawIdea: "add rate limiting",
      lane: "feature",
      source: "human",
      status: "in-progress",
      answers: [],
    });
    const tbds = extractUnresolvedFields(md);
    expect(tbds.length).toBeGreaterThan(0);
    // At least scope-files, validation-gates, rollback, forbidden-actions must be present
    expect(tbds).toEqual(expect.arrayContaining([
      "scope-files", "validation-gates", "rollback", "forbidden-actions",
    ]));
  });
  it("does NOT emit {{TBD:}} for fields that have answers", () => {
    const md = renderDraft({
      rawIdea: "add rate limiting",
      lane: "feature",
      source: "human",
      status: "in-progress",
      answers: [
        { questionId: "validation-gates", answer: "npm test" },
        { questionId: "rollback", answer: "revert commit" },
      ],
    });
    const tbds = extractUnresolvedFields(md);
    expect(tbds).not.toContain("validation-gates");
    expect(tbds).not.toContain("rollback");
    // validation-gates answer should render in the Validation Gates block
    expect(md).toMatch(/## Validation Gates\n+npm test/);
  });
  it("renders change manifest from scope-files answer as a bullet list", () => {
    const md = renderDraft({
      rawIdea: "x",
      lane: "feature",
      source: "human",
      status: "in-progress",
      answers: [
        { questionId: "scope-files", answer: "src/a.ts\nsrc/b.ts" },
      ],
    });
    expect(md).toMatch(/## Change Manifest\n+- src\/a\.ts\n- src\/b\.ts/);
  });
  it("stop conditions are boilerplate and do not use {{TBD:}}", () => {
    const md = renderDraft({
      rawIdea: "x", lane: "feature", source: "human", status: "in-progress", answers: [],
    });
    const stopBlock = md.split("## Stop Conditions")[1].split("##")[0];
    expect(stopBlock).not.toContain("{{TBD:");
    expect(stopBlock).toMatch(/Validation gate fails/);
  });
  it("includes the raw idea verbatim", () => {
    const md = renderDraft({
      rawIdea: "add rate limiting to /login",
      lane: "feature", source: "human", status: "in-progress", answers: [],
    });
    expect(md).toContain("add rate limiting to /login");
  });
  it("uses feature-name answer as title when present", () => {
    const md = renderDraft({
      rawIdea: "x",
      lane: "full",
      source: "human",
      status: "in-progress",
      answers: [{ questionId: "feature-name", answer: "Billing Redesign" }],
    });
    expect(md).toMatch(/^# Billing Redesign/);
  });
  it("prefixes phase name in title when finalized", () => {
    const md = renderDraft({
      rawIdea: "add widget",
      lane: "feature",
      source: "human",
      status: "finalized",
      answers: [],
      phaseName: "Phase-03",
    });
    expect(md).toMatch(/^# Phase-03: add widget/);
  });
});

// ─── extractUnresolvedFields ─────────────────────────────────────────

describe("extractUnresolvedFields", () => {
  it("returns empty array when no markers present", () => {
    expect(extractUnresolvedFields("# Clean plan\n\nAll fields resolved.")).toEqual([]);
  });
  it("extracts unique, ordered question ids", () => {
    const md = "a {{TBD: foo}} b {{TBD: bar}} c {{TBD: foo}} d";
    expect(extractUnresolvedFields(md)).toEqual(["foo", "bar"]);
  });
  it("handles non-string input defensively", () => {
    expect(extractUnresolvedFields(null)).toEqual([]);
    expect(extractUnresolvedFields(undefined)).toEqual([]);
    expect(extractUnresolvedFields(42)).toEqual([]);
  });
  it("tolerates whitespace inside the marker", () => {
    expect(extractUnresolvedFields("x {{TBD:   spaced-id   }} y")).toEqual(["spaced-id"]);
  });
});
