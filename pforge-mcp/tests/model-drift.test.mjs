/**
 * #303 — weekly Copilot model and pricing drift check (scripts/check-model-drift.mjs).
 * The live listModels() call needs Copilot credentials, so these tests cover the
 * decisions and the report; the workflow runs the live check.
 *
 * #393 — the live list is the signed-in account's own, filtered by its Copilot plan
 * and policy. What it contains is evidence (new models, prices); what it lacks is not:
 * a model missing from it may be plan-gated, not retired. Only an announced
 * retirement (pforge-mcp/model-retirements.json) drops a model from the pricing
 * snapshot, and a default the account cannot see is a note when its gating is
 * recorded in scripts/model-availability.json.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  diffPricing, evaluateDrift, exitCodeFor, renderReport, retiringDefaults, splitUnavailable, unavailableDefaults,
  EXIT_CLEAN, EXIT_DRIFT, EXIT_LIVE_SKIPPED,
} from "../../scripts/check-model-drift.mjs";
import { buildSnapshot, mergeSnapshot, retiredAsOf, stableSnapshot } from "../../scripts/sync-copilot-pricing.mjs";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const REPO = join(import.meta.dirname, "..", "..");

describe("retiringDefaults", () => {
  const retirements = { "old-a": "2026-09-01", "soon-b": "2026-10-19", "later-c": "2027-03-01" };

  it("returns defaults that retired already or retire within the window, soonest first", () => {
    const got = retiringDefaults({ defaults: ["later-c", "soon-b", "old-a", "fine-d"], retirements, now: NOW, withinDays: 30 });
    expect(got).toEqual([
      { model: "old-a", retires: "2026-09-01", daysLeft: -30 },
      { model: "soon-b", retires: "2026-10-19", daysLeft: 18 },
    ]);
  });

  it("ignores defaults with no announced retirement", () => {
    expect(retiringDefaults({ defaults: ["fine-d"], retirements, now: NOW })).toEqual([]);
  });
});

describe("unavailableDefaults", () => {
  it("flags Copilot-served defaults missing from the live list, not direct-API ones", () => {
    const got = unavailableDefaults({
      defaults: ["claude-opus-5.5", "gone-x", "direct-y"],
      liveIds: ["claude-opus-5.5"],
      isDirectApiOnly: (m) => m === "direct-y",
    });
    expect(got).toEqual(["gone-x"]);
  });
});

describe("splitUnavailable (#393)", () => {
  const notListed = {
    "gated-a": { reason: "plan-gated", detail: "Pro+ and above", checked: "2026-10-24" },
    "unlisted-b": { reason: "unlisted", detail: "answers through the CLI", checked: "2026-10-24" },
  };

  it("keeps a missing default whose gating is recorded as a note, with its evidence", () => {
    const { drift, notes } = splitUnavailable(["gated-a", "unlisted-b"], notListed);
    expect(drift).toEqual([]);
    expect(notes).toEqual([
      { model: "gated-a", reason: "plan-gated", detail: "Pro+ and above", checked: "2026-10-24" },
      { model: "unlisted-b", reason: "unlisted", detail: "answers through the CLI", checked: "2026-10-24" },
    ]);
  });

  it("still reports a missing default nobody has explained as drift", () => {
    const { drift, notes } = splitUnavailable(["gated-a", "mystery-c"], notListed);
    expect(drift).toEqual(["mystery-c"]);
    expect(notes.map((n) => n.model)).toEqual(["gated-a"]);
  });

  it("treats everything as drift when nothing is recorded", () => {
    expect(splitUnavailable(["a", "b"], {})).toEqual({ drift: ["a", "b"], notes: [] });
  });
});

describe("diffPricing", () => {
  const saved = { a: { input: 1 }, b: { input: 2 }, c: { input: 3 } };
  const fresh = { a: { input: 1 }, b: { input: 5 }, d: { input: 4 } };

  it("lists added and repriced models, and removes only a model whose retirement has passed (#393)", () => {
    expect(diffPricing(saved, fresh, { isRetired: (id) => id === "c" })).toEqual({ added: ["d"], removed: ["c"], changed: ["b"], kept: [] });
  });

  it("keeps a model the live list lacks when no retirement has passed: its absence is not evidence (#393)", () => {
    expect(diffPricing(saved, fresh)).toEqual({ added: ["d"], removed: [], changed: ["b"], kept: ["c"] });
  });
});

describe("retiredAsOf (#393)", () => {
  const retirements = { gone: "2026-10-19", soon: "2026-11-16" };

  it("is true from the retirement date's UTC midnight and false before it", () => {
    expect(retiredAsOf(retirements, Date.parse("2026-10-19T00:00:00Z"))("gone")).toBe(true);
    expect(retiredAsOf(retirements, Date.parse("2026-10-18T23:59:59Z"))("gone")).toBe(false);
  });

  it("is false for a retirement still ahead and for a model with none", () => {
    const retired = retiredAsOf(retirements, Date.parse("2026-10-26T00:00:00Z"));
    expect(retired("soon")).toBe(false);
    expect(retired("unlisted")).toBe(false);
  });

  it("reads only the retirements it was given, not what the object inherits", () => {
    const inherited = Object.create({ gone: "2026-10-19" });
    expect(retiredAsOf(inherited, Date.parse("2026-10-26T00:00:00Z"))("gone")).toBe(false);
  });
});

describe("mergeSnapshot (#393)", () => {
  const price = (id, input = 100, output = 500) => ({ id, billing: { tokenPrices: { inputPrice: input, outputPrice: output } } });
  const existing = buildSnapshot([price("gated-a", 500, 2500), price("shared-b", 100), price("retired-c"), price("later-d")]);
  const isRetired = (id) => id === "retired-c";

  it("leaves a plan-gated model's entry in place when the account's list lacks it", () => {
    const merged = mergeSnapshot(existing, [price("shared-b", 100)], { isRetired });
    expect(merged.models["gated-a"]).toEqual(existing.models["gated-a"]);
    expect(merged.models["later-d"]).toEqual(existing.models["later-d"]);
  });

  it("drops only a model whose retirement has passed", () => {
    const merged = mergeSnapshot(existing, [price("shared-b", 100)], { isRetired });
    expect(Object.keys(merged.models)).toEqual(["gated-a", "later-d", "shared-b"]);
  });

  it("takes the live price for a model the list shows, and adds a new one", () => {
    const merged = mergeSnapshot(existing, [price("shared-b", 250), price("new-e", 300)], { isRetired });
    expect(merged.models["shared-b"].input).toBe(250 / 100 / 1_000_000);
    expect(merged.models["new-e"].input).toBe(300 / 100 / 1_000_000);
  });

  it("empties nothing when the list comes back empty", () => {
    const merged = mergeSnapshot(existing, [], { isRetired });
    expect(Object.keys(merged.models)).toEqual(["gated-a", "later-d", "shared-b"]);
  });

  it("starts from nothing when there is no snapshot yet", () => {
    expect(Object.keys(mergeSnapshot(null, [price("only-f")]).models)).toEqual(["only-f"]);
  });

  it("does not change the snapshot it was given", () => {
    const before = stableSnapshot(existing);
    mergeSnapshot(existing, [price("shared-b", 999)], { isRetired });
    expect(stableSnapshot(existing)).toBe(before);
  });

  it("is a fixed point: merging the same list again changes nothing", () => {
    const once = mergeSnapshot(existing, [price("shared-b", 250)], { isRetired });
    expect(stableSnapshot(mergeSnapshot(once, [price("shared-b", 250)], { isRetired }))).toBe(stableSnapshot(once));
  });
});

describe("renderReport", () => {
  const clean = { retiring: [], unavailable: [], notes: [], pricing: { added: [], removed: [], changed: [], kept: [] }, liveError: null, withinDays: 30 };

  it("says there is no drift when nothing is found", () => {
    expect(renderReport(clean)).toContain("No drift");
  });

  it("names each kind of drift and what to do about it", () => {
    const report = renderReport({
      ...clean,
      retiring: [{ model: "old-a", retires: "2026-09-01", daysLeft: -30 }, { model: "soon-b", retires: "2026-10-19", daysLeft: 18 }],
      unavailable: ["gone-x"],
      pricing: { added: ["d"], removed: [], changed: ["b"], kept: [] },
    });
    expect(report).toContain("`old-a` retired 30 day(s) ago (2026-09-01)");
    expect(report).toContain("`soon-b` retires in 18 day(s) (2026-10-19)");
    expect(report).toContain("- `gone-x`");
    expect(report).toContain("- Added: `d`");
    expect(report).toContain("- Repriced: `b`");
    expect(report).toContain("node scripts/sync-copilot-pricing.mjs");
    expect(report).not.toContain("No drift");
  });

  it("explains skipped live checks without claiming there is no drift", () => {
    const report = renderReport({ ...clean, pricing: null, liveError: "not authenticated" });
    expect(report).toContain("Live checks skipped");
    expect(report).toContain("COPILOT_GITHUB_TOKEN");
    expect(report).not.toContain("No drift");
  });

  it("lists a default the account cannot see as a note with its evidence, and still says there is no drift (#393)", () => {
    const report = renderReport({
      ...clean,
      notes: [{ model: "gated-a", reason: "plan-gated", detail: "Pro+ and above (changelog 2026-09-22)", checked: "2026-10-24" }],
    });
    expect(report).toContain("recorded, not drift");
    expect(report).toContain("`gated-a` is plan-gated: Pro+ and above (changelog 2026-09-22). Checked 2026-10-24.");
    expect(report).toContain("No drift");
  });

  it("lists the priced models it kept because the account cannot see them, without calling them drift (#393)", () => {
    const report = renderReport({ ...clean, pricing: { added: [], removed: [], changed: [], kept: ["gated-a", "later-d"] } });
    expect(report).toContain("`gated-a`, `later-d`");
    expect(report).toContain("No drift");
    expect(report).not.toContain("AI-credit pricing changed");
  });
});

// The acceptance criteria of #393, with a fake account whose plan hides the premium models.
describe("a check from an account that cannot see some models (#393)", () => {
  const price = (id, input = 100, output = 500) => ({ id, billing: { tokenPrices: { inputPrice: input, outputPrice: output } } });
  const NOW_26 = Date.parse("2026-10-26T00:00:00Z");
  const existing = buildSnapshot([price("claude-opus-5.5", 500, 2500), price("gpt-6-astra", 400, 2000), price("claude-sonnet-5.5"), price("gpt-5.5"), price("claude-opus-5")]);
  const accountList = [price("claude-sonnet-5.5")];
  const registry = {
    notListed: {
      "claude-opus-5.5": { reason: "plan-gated", detail: "Copilot Pro+ and above", checked: "2026-10-24" },
      "gpt-6-astra": { reason: "plan-gated", detail: "Copilot Pro+ and above", checked: "2026-10-24" },
    },
  };
  const retirements = { "gpt-5.5": "2026-10-19", "claude-opus-5": "2026-11-16" };
  const defaults = ["claude-opus-5.5", "gpt-6-astra", "claude-sonnet-5.5"];
  const synced = mergeSnapshot(existing, accountList, { isRetired: retiredAsOf(retirements, NOW_26) });
  const evaluate = (overrides = {}) => evaluateDrift({ defaults, retirements, registry, models: accountList, existing, now: NOW_26, ...overrides });

  it("reports the defaults it cannot see as notes, not as drift", () => {
    const result = evaluate({ existing: synced });
    expect(result.unavailable).toEqual([]);
    expect(result.notes.map((n) => n.model)).toEqual(["claude-opus-5.5", "gpt-6-astra"]);
    expect(exitCodeFor(result)).toBe(EXIT_CLEAN);
  });

  it("finds the pricing drift that is real: a model whose retirement has passed is still priced", () => {
    const result = evaluate();
    expect(result.pricing.removed).toEqual(["gpt-5.5"]);
    expect(result.pricing.kept).toEqual(["claude-opus-5", "claude-opus-5.5", "gpt-6-astra"]);
    expect(exitCodeFor(result)).toBe(EXIT_DRIFT);
  });

  it("is clean once the sync has run: it leaves the plan-gated and the not-yet-retired entries in place", () => {
    expect(Object.keys(synced.models)).toEqual(["claude-opus-5", "claude-opus-5.5", "claude-sonnet-5.5", "gpt-6-astra"]);
    const result = evaluate({ existing: synced });
    expect(result.pricing).toEqual({ added: [], removed: [], changed: [], kept: ["claude-opus-5", "claude-opus-5.5", "gpt-6-astra"] });
    expect(exitCodeFor(result)).toBe(EXIT_CLEAN);
  });

  it("still reports a missing default that is not recorded", () => {
    const result = evaluate({ defaults: [...defaults, "claude-opus-6"], existing: synced });
    expect(result.unavailable).toEqual(["claude-opus-6"]);
    expect(exitCodeFor(result)).toBe(EXIT_DRIFT);
  });

  it("still reports a default that retires within the window, and that alone is drift", () => {
    const result = evaluate({ retirements: { ...retirements, "claude-sonnet-5.5": "2026-11-16" }, existing: synced });
    expect(result.retiring.map((r) => r.model)).toEqual(["claude-sonnet-5.5"]);
    expect(result.unavailable).toEqual([]);
    expect(result.pricing).toMatchObject({ added: [], removed: [], changed: [] });
    expect(exitCodeFor(result)).toBe(EXIT_DRIFT);
  });

  it("exits 3 with nothing else found when the live list could not be read", () => {
    const result = evaluate({ models: null, liveError: "not authenticated" });
    expect(result.pricing).toBeNull();
    expect(exitCodeFor(result)).toBe(EXIT_LIVE_SKIPPED);
  });

  it("reports a price change the account can see", () => {
    const result = evaluate({ models: [price("claude-sonnet-5.5", 999)], existing: synced });
    expect(result.pricing.changed).toEqual(["claude-sonnet-5.5"]);
    expect(exitCodeFor(result)).toBe(EXIT_DRIFT);
  });
});

describe("scripts/model-availability.json (#393)", () => {
  const file = join(REPO, "scripts", "model-availability.json");
  const registry = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const snapshot = JSON.parse(readFileSync(join(REPO, "pforge-mcp", "copilot-pricing.json"), "utf8")).models;
  const retirements = JSON.parse(readFileSync(join(REPO, "pforge-mcp", "model-retirements.json"), "utf8")).copilot;

  it("records the evidence for every entry: a reason, what was checked and when", () => {
    const entries = Object.entries(registry.notListed ?? {});
    expect(entries.length).toBeGreaterThan(0);
    for (const [model, entry] of entries) {
      expect(["plan-gated", "unlisted"], model).toContain(entry.reason);
      expect(entry.detail?.length, `${model} detail`).toBeGreaterThan(20);
      expect(entry.checked, `${model} checked`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("only names models the pricing snapshot knows, so a typo cannot hide real drift", () => {
    expect(Object.keys(registry.notListed ?? {}).filter((model) => !(model in snapshot))).toEqual([]);
  });

  it("names no model whose retirement has passed: it is dropped from the snapshot, not explained", () => {
    const retired = retiredAsOf(retirements, Date.now());
    expect(Object.keys(registry.notListed ?? {}).filter(retired)).toEqual([]);
  });
});
