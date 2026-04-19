/**
 * Flakiness scanner tests (TEMPER-05 Slice 05.1).
 *
 * 12 tests covering:
 *   - scanner-disabled skip
 *   - no-prior-runs skip (< 2 run records)
 *   - all stable-pass → verdict pass
 *   - flaky detection (>5% failure rate)
 *   - quarantine off → not in quarantined[]
 *   - quarantine on + ≥3 failures → in quarantined[]
 *   - quarantine on + 2 failures → NOT in quarantined[] (guard)
 *   - hub event emitted per flake
 *   - captureMemory called for confirmed flakes
 *   - budget exceeded → verdict budget-exceeded
 *   - only 2 runs → classified new, not flaky
 *   - exactly at threshold (5%) → NOT flagged (strict >)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runFlakinessScan, FLAKINESS_DEFAULTS } from "../tempering/scanners/flakiness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-flake-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeConfig(overrides = {}) {
  return {
    scanners: { flakiness: { enabled: true, ...overrides } },
    runtimeBudgets: { flakinessMaxMs: 60000 },
    ...overrides._root,
  };
}

function makeHub() {
  const events = [];
  return {
    events,
    broadcast(e) { events.push(e); },
  };
}

function writeRunRecord(dir, name, scanners) {
  const temperingDir = resolve(dir, ".forge", "tempering");
  mkdirSync(temperingDir, { recursive: true });
  writeFileSync(
    resolve(temperingDir, name),
    JSON.stringify({ scanners }),
  );
}

function makeTestScanner(tests) {
  return { scanner: "unit", tests };
}

describe("flakiness.mjs scanner", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("scanner-disabled → skipped", async () => {
    const r = await runFlakinessScan({
      config: { scanners: { flakiness: false } },
      projectDir: tmp,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("no prior runs (< 2) → skipped no-prior-runs", async () => {
    writeRunRecord(tmp, "run-2026-04-17T00-00-00-000Z.json", [
      makeTestScanner([{ testId: "a", status: "pass" }]),
    ]);
    const r = await runFlakinessScan({
      config: makeConfig(),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-prior-runs");
  });

  it("all stable-pass → verdict pass, 0 flakes", async () => {
    for (let i = 0; i < 5; i++) {
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([
          { testId: "test-a", status: "pass" },
          { testId: "test-b", status: "pass" },
        ]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig(),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("pass");
    expect(r.flakes).toHaveLength(0);
  });

  it("3-of-20 fail (15%) → classified flaky, violation emitted", async () => {
    // Create 20 run records where test-x fails in 3 of them
    for (let i = 0; i < 20; i++) {
      const status = i < 3 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T${String(i).padStart(2, "0")}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-x", status }]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig(),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("fail");
    expect(r.flakes.length).toBeGreaterThanOrEqual(1);
    const flake = r.flakes.find((f) => f.testId === "test-x");
    expect(flake).toBeDefined();
    expect(flake.classification).toBe("flaky");
    expect(flake.failureRate).toBeCloseTo(0.15, 1);
  });

  it("quarantine off → flakes NOT in quarantined[]", async () => {
    for (let i = 0; i < 5; i++) {
      const status = i < 3 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-q", status }]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig({ quarantine: false }),
      projectDir: tmp,
    });
    expect(r.quarantined).toHaveLength(0);
  });

  it("quarantine on + ≥3 failures → in quarantined[]", async () => {
    for (let i = 0; i < 5; i++) {
      const status = i < 3 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-q2", status }]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig({ quarantine: true }),
      projectDir: tmp,
    });
    expect(r.quarantined).toContain("test-q2");
  });

  it("quarantine on + 2 failures → NOT in quarantined[] (guard)", async () => {
    for (let i = 0; i < 5; i++) {
      const status = i < 2 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-q3", status }]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig({ quarantine: true, confirmedFlakeMinFailures: 3 }),
      projectDir: tmp,
    });
    expect(r.quarantined).not.toContain("test-q3");
  });

  it("hub event emitted per flake", async () => {
    const hub = makeHub();
    for (let i = 0; i < 5; i++) {
      const status = i < 3 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-hub", status }]),
      ]);
    }
    await runFlakinessScan({
      config: makeConfig(),
      projectDir: tmp,
      hub,
    });
    const flakeEvents = hub.events.filter((e) => e.type === "tempering-flakiness-detected");
    expect(flakeEvents.length).toBeGreaterThanOrEqual(1);
    expect(flakeEvents[0].data.testId).toBe("test-hub");
  });

  it("captureMemory called once per confirmed flake", async () => {
    const captures = [];
    const captureMemory = (data) => captures.push(data);
    for (let i = 0; i < 5; i++) {
      const status = i < 3 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-cap", status }]),
      ]);
    }
    await runFlakinessScan({
      config: makeConfig(),
      projectDir: tmp,
      captureMemory,
    });
    expect(captures.length).toBe(1);
    expect(captures[0].testId).toBe("test-cap");
  });

  it("budget exceeded → verdict budget-exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      writeRunRecord(tmp, `run-2026-04-17T0${i}-00-00-000Z.json`, [
        makeTestScanner([{ testId: `test-${i}`, status: i < 3 ? "fail" : "pass" }]),
      ]);
    }
    let tick = Date.now();
    const r = await runFlakinessScan({
      config: { ...makeConfig(), runtimeBudgets: { flakinessMaxMs: 0 } },
      projectDir: tmp,
      now: () => { tick += 100; return tick; },
    });
    // Budget is 0ms — should exceed on first check
    expect(r.verdict).toBe("budget-exceeded");
  });

  it("only 2 runs in window → classified new, not flaky", async () => {
    writeRunRecord(tmp, "run-2026-04-17T00-00-00-000Z.json", [
      makeTestScanner([{ testId: "test-new", status: "fail" }]),
    ]);
    writeRunRecord(tmp, "run-2026-04-17T01-00-00-000Z.json", [
      makeTestScanner([{ testId: "test-new", status: "pass" }]),
    ]);
    const r = await runFlakinessScan({
      config: makeConfig({ minRunsForClassification: 3 }),
      projectDir: tmp,
    });
    // 2 data points < minRunsForClassification=3 → classified as "new"
    expect(r.verdict).toBe("pass");
    expect(r.flakes).toHaveLength(0);
  });

  it("exactly at threshold (5%) → NOT flagged (strict >)", async () => {
    // 1-of-20 = 5% exactly — should not be flagged with strict >
    for (let i = 0; i < 20; i++) {
      const status = i === 0 ? "fail" : "pass";
      writeRunRecord(tmp, `run-2026-04-17T${String(i).padStart(2, "0")}-00-00-000Z.json`, [
        makeTestScanner([{ testId: "test-edge", status }]),
      ]);
    }
    const r = await runFlakinessScan({
      config: makeConfig({ flakeThreshold: 0.05 }),
      projectDir: tmp,
    });
    // 1/20 = 0.05 = exactly threshold → strict > means NOT flagged
    expect(r.flakes.find((f) => f.testId === "test-edge")).toBeUndefined();
  });
});
