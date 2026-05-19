/**
 * Tests for observer-budget.mjs — daily USD cap + hourly narration cap.
 * Phase-39, Slice 6.
 *
 * State-machine coverage:
 *   - under-cap → ok
 *   - over-narration-cap → block
 *   - over-usd-cap → block
 *   - day-rollover → reset daily spend
 *   - hour-rollover → reset hourly narrations
 *   - concurrent spend → sequential atomic (JS is single-threaded; tests
 *     verify that recordSpend + saveBudgetState compose correctly under
 *     rapid successive calls)
 *   - loadBudgetState with missing file → defaults
 *   - loadBudgetState with corrupt file → defaults
 *   - saveBudgetState → atomic write (no .tmp left behind)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  checkBudget,
  recordSpend,
  loadBudgetState,
  saveBudgetState,
  DEFAULT_BUDGET_STATE,
  BUDGET_STATE_FILE,
} from "../src/observer-budget.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `obs-budget-test-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFakeForgeDir(cwd) {
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
}

/** Fake ISO timestamp helpers */
function ts(dateStr) {
  return new Date(dateStr).getTime();
}
function isoDay(t) { return new Date(t).toISOString().slice(0, 10); }
function isoHour(t) { return new Date(t).toISOString().slice(0, 13); }

// ─── Module exports ───────────────────────────────────────────────────

describe("module exports", () => {
  it("exports checkBudget as a function", () => {
    expect(typeof checkBudget).toBe("function");
  });
  it("exports recordSpend as a function", () => {
    expect(typeof recordSpend).toBe("function");
  });
  it("exports loadBudgetState as a function", () => {
    expect(typeof loadBudgetState).toBe("function");
  });
  it("exports saveBudgetState as a function", () => {
    expect(typeof saveBudgetState).toBe("function");
  });
  it("exports DEFAULT_BUDGET_STATE with expected keys", () => {
    expect(DEFAULT_BUDGET_STATE).toHaveProperty("dailyUsd", 0);
    expect(DEFAULT_BUDGET_STATE).toHaveProperty("dailyDate", "");
    expect(DEFAULT_BUDGET_STATE).toHaveProperty("hourlyNarrations", 0);
    expect(DEFAULT_BUDGET_STATE).toHaveProperty("hourlyHour", "");
  });
  it("exports BUDGET_STATE_FILE as a non-empty string", () => {
    expect(typeof BUDGET_STATE_FILE).toBe("string");
    expect(BUDGET_STATE_FILE.length).toBeGreaterThan(0);
  });
});

// ─── checkBudget — under cap (ok path) ───────────────────────────────

describe("checkBudget — under cap", () => {
  const now = ts("2026-01-15T10:30:00Z");
  const state = {
    dailyUsd: 0.50,
    dailyDate: isoDay(now),
    hourlyNarrations: 3,
    hourlyHour: isoHour(now),
  };

  it("returns ok:true when both caps are not yet reached", () => {
    const result = checkBudget(state, { maxUsdPerDay: 1.0, maxNarrationsPerHour: 6 }, now);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns ok:true when no caps configured", () => {
    const result = checkBudget(state, {}, now);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when only narration cap is set and under limit", () => {
    const result = checkBudget(state, { maxNarrationsPerHour: 10 }, now);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when only USD cap is set and under limit", () => {
    const result = checkBudget(state, { maxUsdPerDay: 2.0 }, now);
    expect(result.ok).toBe(true);
  });
});

// ─── checkBudget — over USD cap (block) ──────────────────────────────

describe("checkBudget — over USD cap", () => {
  const now = ts("2026-01-15T10:30:00Z");
  const state = {
    dailyUsd: 1.00,
    dailyDate: isoDay(now),
    hourlyNarrations: 0,
    hourlyHour: isoHour(now),
  };

  it("returns ok:false when dailyUsd meets the cap", () => {
    const result = checkBudget(state, { maxUsdPerDay: 1.0, maxNarrationsPerHour: 6 }, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily USD cap exceeded/);
  });

  it("returns ok:false when dailyUsd exceeds the cap", () => {
    const result = checkBudget(
      { ...state, dailyUsd: 1.50 },
      { maxUsdPerDay: 1.0 },
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily USD cap exceeded/);
  });

  it("blocks even when narration cap has headroom", () => {
    const result = checkBudget(
      state,
      { maxUsdPerDay: 0.99, maxNarrationsPerHour: 100 },
      now,
    );
    expect(result.ok).toBe(false);
  });
});

// ─── checkBudget — over narration cap (block) ────────────────────────

describe("checkBudget — over narration cap", () => {
  const now = ts("2026-01-15T10:30:00Z");
  const state = {
    dailyUsd: 0.01,
    dailyDate: isoDay(now),
    hourlyNarrations: 6,
    hourlyHour: isoHour(now),
  };

  it("returns ok:false when hourlyNarrations meets the cap", () => {
    const result = checkBudget(state, { maxUsdPerDay: 1.0, maxNarrationsPerHour: 6 }, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/hourly narration cap exceeded/);
  });

  it("returns ok:false when hourlyNarrations exceeds the cap", () => {
    const result = checkBudget(
      { ...state, hourlyNarrations: 10 },
      { maxNarrationsPerHour: 6 },
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/hourly narration cap exceeded/);
  });

  it("USD cap is checked first — reason reflects USD block", () => {
    const result = checkBudget(
      { ...state, dailyUsd: 2.0 },
      { maxUsdPerDay: 1.0, maxNarrationsPerHour: 6 },
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily USD cap/);
  });
});

// ─── checkBudget — day rollover ───────────────────────────────────────

describe("checkBudget — day rollover resets daily spend", () => {
  it("allows spend when state is from yesterday and cap was exhausted", () => {
    const yesterday = ts("2026-01-14T23:59:00Z");
    const today = ts("2026-01-15T00:01:00Z");
    const state = {
      dailyUsd: 5.00, // exhausted yesterday
      dailyDate: isoDay(yesterday),
      hourlyNarrations: 0,
      hourlyHour: isoHour(today),
    };
    const result = checkBudget(state, { maxUsdPerDay: 1.0 }, today);
    expect(result.ok).toBe(true);
  });

  it("day rollover does not reset hourly narrations if still same hour", () => {
    const yesterday = ts("2026-01-14T10:30:00Z");
    const today = ts("2026-01-15T10:30:00Z");
    const state = {
      dailyUsd: 5.0,
      dailyDate: isoDay(yesterday),
      hourlyNarrations: 10,
      hourlyHour: isoHour(today), // same hour as now
    };
    const result = checkBudget(state, { maxUsdPerDay: 100, maxNarrationsPerHour: 5 }, today);
    // hourly narrations NOT reset (same hour), so narration cap should still block
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/hourly narration/);
  });
});

// ─── checkBudget — hour rollover ─────────────────────────────────────

describe("checkBudget — hour rollover resets hourly narrations", () => {
  it("allows narration when state is from last hour and cap was exhausted", () => {
    const lastHour = ts("2026-01-15T09:59:00Z");
    const thisHour = ts("2026-01-15T10:01:00Z");
    const state = {
      dailyUsd: 0.10,
      dailyDate: isoDay(thisHour),
      hourlyNarrations: 10, // exhausted last hour
      hourlyHour: isoHour(lastHour),
    };
    const result = checkBudget(state, { maxUsdPerDay: 1.0, maxNarrationsPerHour: 6 }, thisHour);
    expect(result.ok).toBe(true);
  });

  it("hour rollover does not reset daily USD", () => {
    const lastHour = ts("2026-01-15T09:59:00Z");
    const thisHour = ts("2026-01-15T10:01:00Z");
    const state = {
      dailyUsd: 1.0, // at cap
      dailyDate: isoDay(thisHour),
      hourlyNarrations: 10,
      hourlyHour: isoHour(lastHour),
    };
    const result = checkBudget(state, { maxUsdPerDay: 1.0 }, thisHour);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily USD cap/);
  });
});

// ─── recordSpend ──────────────────────────────────────────────────────

describe("recordSpend", () => {
  const now = ts("2026-01-15T10:30:00Z");
  const baseState = {
    dailyUsd: 0.10,
    dailyDate: isoDay(now),
    hourlyNarrations: 2,
    hourlyHour: isoHour(now),
  };

  it("increments dailyUsd by the spend amount", () => {
    const next = recordSpend(baseState, { usd: 0.05, timestamp: now });
    expect(next.dailyUsd).toBeCloseTo(0.15, 10);
  });

  it("increments hourlyNarrations by 1", () => {
    const next = recordSpend(baseState, { usd: 0.01, timestamp: now });
    expect(next.hourlyNarrations).toBe(3);
  });

  it("does not mutate input state", () => {
    const frozen = Object.freeze({ ...baseState });
    expect(() => recordSpend(frozen, { usd: 0.01, timestamp: now })).not.toThrow();
    expect(frozen.dailyUsd).toBe(0.10);
  });

  it("handles zero usd spend", () => {
    const next = recordSpend(baseState, { usd: 0, timestamp: now });
    expect(next.dailyUsd).toBe(0.10);
    expect(next.hourlyNarrations).toBe(3);
  });

  it("applies day rollover before incrementing", () => {
    const tomorrow = ts("2026-01-16T10:30:00Z");
    const next = recordSpend(baseState, { usd: 0.05, timestamp: tomorrow });
    expect(next.dailyUsd).toBeCloseTo(0.05, 10); // reset to 0 then + 0.05
    expect(next.dailyDate).toBe(isoDay(tomorrow));
  });

  it("applies hour rollover before incrementing", () => {
    const nextHour = ts("2026-01-15T11:01:00Z");
    const next = recordSpend(baseState, { usd: 0.01, timestamp: nextHour });
    expect(next.hourlyNarrations).toBe(1); // reset to 0 then + 1
    expect(next.hourlyHour).toBe(isoHour(nextHour));
  });

  it("defaults timestamp to Date.now() when omitted", () => {
    // Should not throw; result should have today's date
    const next = recordSpend(baseState, { usd: 0.01 });
    expect(typeof next.dailyUsd).toBe("number");
    expect(typeof next.hourlyNarrations).toBe("number");
  });

  it("sequential spends accumulate correctly (concurrent spend simulation)", () => {
    let state = baseState;
    for (let i = 0; i < 5; i++) {
      state = recordSpend(state, { usd: 0.10, timestamp: now });
    }
    expect(state.dailyUsd).toBeCloseTo(0.10 + 5 * 0.10, 10);
    expect(state.hourlyNarrations).toBe(2 + 5);
  });
});

// ─── loadBudgetState ──────────────────────────────────────────────────

describe("loadBudgetState", () => {
  let cwd;

  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns defaults when state file is missing", () => {
    const state = loadBudgetState({ cwd });
    expect(state.dailyUsd).toBe(0);
    expect(state.hourlyNarrations).toBe(0);
    expect(typeof state.dailyDate).toBe("string");
    expect(typeof state.hourlyHour).toBe("string");
  });

  it("returns defaults when state file is corrupt JSON", () => {
    makeFakeForgeDir(cwd);
    writeFileSync(resolve(cwd, BUDGET_STATE_FILE), "NOT JSON {{{", "utf-8");
    const state = loadBudgetState({ cwd });
    expect(state.dailyUsd).toBe(0);
    expect(state.hourlyNarrations).toBe(0);
  });

  it("merges persisted state with defaults (extra fields ignored)", () => {
    const now = ts("2026-01-15T10:30:00Z");
    const persisted = {
      dailyUsd: 0.42,
      dailyDate: isoDay(now),
      hourlyNarrations: 3,
      hourlyHour: isoHour(now),
    };
    makeFakeForgeDir(cwd);
    writeFileSync(resolve(cwd, BUDGET_STATE_FILE), JSON.stringify(persisted), "utf-8");
    const state = loadBudgetState({ cwd, now });
    expect(state.dailyUsd).toBeCloseTo(0.42, 10);
    expect(state.hourlyNarrations).toBe(3);
  });

  it("applies day rollover when loaded state is from a previous day", () => {
    const yesterday = ts("2026-01-14T10:30:00Z");
    const today = ts("2026-01-15T10:30:00Z");
    const persisted = {
      dailyUsd: 5.00,
      dailyDate: isoDay(yesterday),
      hourlyNarrations: 0,
      hourlyHour: isoHour(today),
    };
    makeFakeForgeDir(cwd);
    writeFileSync(resolve(cwd, BUDGET_STATE_FILE), JSON.stringify(persisted), "utf-8");
    const state = loadBudgetState({ cwd, now: today });
    expect(state.dailyUsd).toBe(0); // reset
    expect(state.dailyDate).toBe(isoDay(today));
  });

  it("applies hour rollover when loaded state is from a previous hour", () => {
    const lastHour = ts("2026-01-15T09:30:00Z");
    const thisHour = ts("2026-01-15T10:05:00Z");
    const persisted = {
      dailyUsd: 0.10,
      dailyDate: isoDay(thisHour),
      hourlyNarrations: 6,
      hourlyHour: isoHour(lastHour),
    };
    makeFakeForgeDir(cwd);
    writeFileSync(resolve(cwd, BUDGET_STATE_FILE), JSON.stringify(persisted), "utf-8");
    const state = loadBudgetState({ cwd, now: thisHour });
    expect(state.hourlyNarrations).toBe(0); // reset
    expect(state.hourlyHour).toBe(isoHour(thisHour));
  });
});

// ─── saveBudgetState ──────────────────────────────────────────────────

describe("saveBudgetState", () => {
  let cwd;

  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("writes state to .forge/forge-master-observer-state.json", () => {
    const state = { dailyUsd: 0.25, dailyDate: "2026-01-15", hourlyNarrations: 2, hourlyHour: "2026-01-15T10" };
    saveBudgetState(state, { cwd });
    const loaded = loadBudgetState({ cwd, now: ts("2026-01-15T10:30:00Z") });
    expect(loaded.dailyUsd).toBeCloseTo(0.25, 10);
    expect(loaded.hourlyNarrations).toBe(2);
  });

  it("creates .forge directory if it does not exist", () => {
    const state = { ...DEFAULT_BUDGET_STATE };
    expect(() => saveBudgetState(state, { cwd })).not.toThrow();
    expect(existsSync(resolve(cwd, BUDGET_STATE_FILE))).toBe(true);
  });

  it("leaves no .tmp files behind after successful write", () => {
    const state = { ...DEFAULT_BUDGET_STATE };
    saveBudgetState(state, { cwd });
    const dir = resolve(cwd, ".forge");
    const tmpFiles = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("is idempotent — multiple saves overwrite cleanly", () => {
    const stateA = { dailyUsd: 0.10, dailyDate: "2026-01-15", hourlyNarrations: 1, hourlyHour: "2026-01-15T10" };
    const stateB = { dailyUsd: 0.20, dailyDate: "2026-01-15", hourlyNarrations: 2, hourlyHour: "2026-01-15T10" };
    saveBudgetState(stateA, { cwd });
    saveBudgetState(stateB, { cwd });
    const loaded = loadBudgetState({ cwd, now: ts("2026-01-15T10:30:00Z") });
    expect(loaded.dailyUsd).toBeCloseTo(0.20, 10);
  });
});

// ─── Integration: checkBudget + recordSpend + save + load ─────────────

describe("integration: full budget cycle", () => {
  let cwd;

  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("persists spend across load cycles and blocks when cap reached", () => {
    const now = ts("2026-01-15T10:30:00Z");

    // Start from empty state
    let state = loadBudgetState({ cwd, now });
    expect(checkBudget(state, { maxUsdPerDay: 0.10, maxNarrationsPerHour: 3 }, now).ok).toBe(true);

    // Record 3 narrations — should still be allowed before 4th
    for (let i = 0; i < 3; i++) {
      state = recordSpend(state, { usd: 0.01, timestamp: now });
      saveBudgetState(state, { cwd });
    }

    // 4th check: narration cap (3) is now exhausted
    state = loadBudgetState({ cwd, now });
    const result = checkBudget(state, { maxUsdPerDay: 1.0, maxNarrationsPerHour: 3 }, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/hourly narration/);
  });

  it("budget unblocks after hour rollover", () => {
    const hour1 = ts("2026-01-15T10:30:00Z");
    const hour2 = ts("2026-01-15T11:01:00Z");

    let state = loadBudgetState({ cwd, now: hour1 });
    // Exhaust narration cap in hour1
    for (let i = 0; i < 6; i++) {
      state = recordSpend(state, { usd: 0.001, timestamp: hour1 });
    }
    saveBudgetState(state, { cwd });

    // Cap is exhausted
    state = loadBudgetState({ cwd, now: hour1 });
    expect(checkBudget(state, { maxNarrationsPerHour: 6 }, hour1).ok).toBe(false);

    // After rollover to hour2, should be allowed again
    state = loadBudgetState({ cwd, now: hour2 });
    expect(checkBudget(state, { maxNarrationsPerHour: 6 }, hour2).ok).toBe(true);
  });
});
