/**
 * Runtime model-retirement lookups (pforge-mcp/model-retirements.mjs).
 *
 * The run-history recommender picked claude-sonnet-4.6 a month after GitHub
 * Copilot retired it, so every routed slice burned an attempt on
 * "Model ... is not available". These tests pin the lookup the recommender
 * and the run-start warning share.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetiredModel, retiredModels, retirementDate } from "../model-retirements.mjs";
import { runPlan } from "../orchestrator.mjs";

const RETIREMENTS = JSON.parse(readFileSync(new URL("../model-retirements.json", import.meta.url), "utf8")).copilot;
const [SAMPLE_MODEL, SAMPLE_DATE] = Object.entries(RETIREMENTS)[0];

describe("retirementDate", () => {
  it("returns the YYYY-MM-DD date from model-retirements.json", () => {
    expect(retirementDate(SAMPLE_MODEL)).toBe(SAMPLE_DATE);
  });

  it("returns null for a model with no announced retirement", () => {
    expect(retirementDate("claude-opus-5.5")).toBeNull();
  });

  it.each([undefined, null, "", 42, "auto"])("returns null for %j", (value) => {
    expect(retirementDate(value)).toBeNull();
  });
});

describe("isRetiredModel", () => {
  const day = (iso) => new Date(`${iso}T00:00:00Z`);

  it("is false before the retirement date", () => {
    expect(isRetiredModel("claude-opus-4.7", day("2026-10-01"))).toBe(false);
  });

  it("is true on and after the retirement date", () => {
    expect(isRetiredModel("claude-opus-4.7", day("2026-10-02"))).toBe(true);
    expect(isRetiredModel("claude-opus-4.7", day("2027-01-01"))).toBe(true);
  });

  it("is false for current and unknown models", () => {
    expect(isRetiredModel("claude-opus-5.5", day("2030-01-01"))).toBe(false);
    expect(isRetiredModel("not-a-model", day("2030-01-01"))).toBe(false);
  });

  it("defaults to the current time", () => {
    // claude-sonnet-4.6 retired 2026-09-01; the default clock is after that.
    expect(isRetiredModel("claude-sonnet-4.6")).toBe(true);
  });
});

describe("retiredModels", () => {
  it("returns each retired model with its date, keeping input order and dropping duplicates", () => {
    const found = retiredModels(
      ["claude-opus-5.5", "claude-sonnet-4.6", "auto", "claude-sonnet-4.6", null, "gpt-5.4"],
      new Date("2026-10-02T12:00:00Z"),
    );
    expect(found).toEqual([{ model: "claude-sonnet-4.6", date: "2026-09-01" }]);
  });

  it("returns an empty array for no input", () => {
    expect(retiredModels(undefined)).toEqual([]);
  });
});

// The user chose these models, so run-plan warns rather than overriding them:
// another worker (for example the Claude CLI) may still serve a model Copilot retired.
describe("runPlan — warns when a chosen model is retired", () => {
  let dir;
  let warnSpy;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pforge-retired-cfg-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const writePlan = (modelLine = "") => {
    const path = join(dir, "plan.md");
    writeFileSync(path, `---\ncrucibleId: retired-model-test\n${modelLine}---\n# Plan\n\n### Slice 1: Only\n\nTask.\n`);
    return path;
  };
  const run = (planPath, options = {}) =>
    runPlan(planPath, { cwd: dir, manualImport: true, noTempering: true, quorum: false, dryRun: true, ...options });
  const retiredWarnings = () =>
    warnSpy.mock.calls.map((args) => String(args[0])).filter((msg) => msg.startsWith("[model] retired:"));

  it("names each retired .forge.json modelRouting entry with its key and date", async () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({
      modelRouting: { default: "claude-sonnet-4.6", review: "claude-opus-4.7", test: "claude-sonnet-5.5" },
    }));
    await run(writePlan());

    const warnings = retiredWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("modelRouting.default=claude-sonnet-4.6 (2026-09-01)");
    expect(warnings[0]).toContain("modelRouting.review=claude-opus-4.7 (2026-10-02)");
    expect(warnings[0]).not.toContain("claude-sonnet-5.5");
    expect(warnings[0]).toContain(".forge.json");
  });

  it("flags a retired frontmatter model", async () => {
    await run(writePlan("model: claude-sonnet-4.6\n"));
    expect(retiredWarnings().join("\n")).toContain("plan frontmatter model=claude-sonnet-4.6 (2026-09-01)");
  });

  it("flags a retired --model override", async () => {
    await run(writePlan(), { model: "claude-sonnet-4.6" });
    expect(retiredWarnings().join("\n")).toContain("--model=claude-sonnet-4.6 (2026-09-01)");
  });

  it("stays quiet when every chosen model is current", async () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ modelRouting: { default: "claude-opus-5.5" } }));
    await run(writePlan("model: claude-sonnet-5.5\n"));
    expect(retiredWarnings()).toEqual([]);
  });
});