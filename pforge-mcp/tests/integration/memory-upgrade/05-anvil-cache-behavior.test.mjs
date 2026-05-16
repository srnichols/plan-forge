/**
 * 05-anvil-cache-behavior.test.mjs — Scenario 5: Anvil cache behavior.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 5):
 *   MUST: A wrapped tool invoked twice with identical args runs its inner function
 *         exactly once. (Spy-counter assertion.)
 *   MUST: Mutating one byte of input or codeHashSeed causes a second inner-function run.
 *
 * All file I/O is isolated to a tmp directory via useTmpForgeHome so the
 * real `.forge/anvil/` in the workspace is never touched.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { withAnvil, anvilStat } from "../../../anvil.mjs";
import { useTmpForgeHome } from "./helpers/with-tmp-forge-home.mjs";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TOOL_NAME = "forge_analyze";
const CODE_HASH = "src/alpha.mjs@abc123";
const INPUTS = { file: "src/alpha.mjs", line: 42 };

// ─── Scenario 5a — identical inputs: inner function runs exactly once ─────────

describe("Scenario 5a — withAnvil: identical inputs → inner function runs exactly once", () => {
  const home = useTmpForgeHome();

  it("spy counter is 1 after two identical calls", async () => {
    let callCount = 0;
    const tool = async () => {
      callCount++;
      return { summary: "ok" };
    };

    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    expect(callCount).toBe(1);
  });

  it("first call returns anvil.hit === false", async () => {
    const tool = async () => ({ value: 42 });
    const result = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(result.anvil.hit).toBe(false);
  });

  it("second call returns anvil.hit === true", async () => {
    const tool = async () => ({ value: 42 });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const result = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(result.anvil.hit).toBe(true);
  });

  it("second call returns the same payload as the first", async () => {
    const tool = async () => ({ message: "hello", score: 99 });
    const first = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const second = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(second.message).toBe(first.message);
    expect(second.score).toBe(first.score);
  });

  it("second call anvil.ageMs is a non-negative number", async () => {
    const tool = async () => ({ x: 1 });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const result = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(typeof result.anvil.ageMs).toBe("number");
    expect(result.anvil.ageMs).toBeGreaterThanOrEqual(0);
  });

  it("result.anvil.key is a non-empty hex string on both calls", async () => {
    const tool = async () => ({});
    const first = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const second = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(first.anvil.key).toMatch(/^[0-9a-f]{64}$/);
    expect(second.anvil.key).toBe(first.anvil.key);
  });
});

// ─── Scenario 5b — mutated input causes a cache miss ──────────────────────────

describe("Scenario 5b — withAnvil: mutating one input field causes a second inner-function run", () => {
  const home = useTmpForgeHome();

  it("spy counter is 2 after calls with different input values", async () => {
    let callCount = 0;
    const tool = async () => {
      callCount++;
      return { ok: true };
    };

    const inputs1 = { file: "src/alpha.mjs", line: 42 };
    const inputs2 = { file: "src/alpha.mjs", line: 43 }; // one-byte change (42→43)

    await withAnvil(tool, { toolName: TOOL_NAME, inputs: inputs1, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: inputs2, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    expect(callCount).toBe(2);
  });

  it("second call with mutated input returns anvil.hit === false", async () => {
    const tool = async () => ({ ok: true });
    const inputs1 = { query: "aaa" };
    const inputs2 = { query: "aab" };

    await withAnvil(tool, { toolName: TOOL_NAME, inputs: inputs1, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const result = await withAnvil(tool, { toolName: TOOL_NAME, inputs: inputs2, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(result.anvil.hit).toBe(false);
  });

  it("different input keys produce different cache keys", async () => {
    const tool = async () => ({});
    const r1 = await withAnvil(tool, { toolName: TOOL_NAME, inputs: { a: 1 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    const r2 = await withAnvil(tool, { toolName: TOOL_NAME, inputs: { a: 2 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    expect(r1.anvil.key).not.toBe(r2.anvil.key);
  });

  it("added key in inputs causes a cache miss", async () => {
    let callCount = 0;
    const tool = async () => { callCount++; return {}; };

    await withAnvil(tool, { toolName: TOOL_NAME, inputs: { x: 1 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: { x: 1, y: 2 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    expect(callCount).toBe(2);
  });
});

// ─── Scenario 5c — changed codeHashSeed causes a cache miss ───────────────────

describe("Scenario 5c — withAnvil: changing codeHashSeed causes a second inner-function run", () => {
  const home = useTmpForgeHome();

  it("spy counter is 2 after calls with different codeHashSeed values", async () => {
    let callCount = 0;
    const tool = async () => {
      callCount++;
      return { result: "computed" };
    };

    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "seed-v1" }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "seed-v2" }, { cwd: home.cwd });

    expect(callCount).toBe(2);
  });

  it("changed codeHashSeed returns anvil.hit === false", async () => {
    const tool = async () => ({});
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "v1" }, { cwd: home.cwd });
    const result = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "v2" }, { cwd: home.cwd });
    expect(result.anvil.hit).toBe(false);
  });

  it("different codeHashSeed values produce different cache keys", async () => {
    const tool = async () => ({});
    const r1 = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "seed-v1" }, { cwd: home.cwd });
    const r2 = await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: "seed-v2" }, { cwd: home.cwd });
    expect(r1.anvil.key).not.toBe(r2.anvil.key);
  });

  it("identical inputs but different toolName also produces a miss", async () => {
    let callCount = 0;
    const tool = async () => { callCount++; return {}; };

    await withAnvil(tool, { toolName: "tool_a", inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: "tool_b", inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    expect(callCount).toBe(2);
  });
});

// ─── Scenario 5d — anvilStat reflects hit/miss counters ───────────────────────

describe("Scenario 5d — anvilStat records hit and miss counts", () => {
  const home = useTmpForgeHome();

  it("one call → one miss recorded in anvilStat", async () => {
    const tool = async () => ({ x: 1 });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    const stat = anvilStat({ cwd: home.cwd });
    expect(stat.perTool[TOOL_NAME]?.misses).toBe(1);
  });

  it("two identical calls → one miss and one hit recorded in anvilStat", async () => {
    const tool = async () => ({ x: 1 });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    const stat = anvilStat({ cwd: home.cwd });
    expect(stat.perTool[TOOL_NAME]?.misses).toBe(1);
    expect(stat.perTool[TOOL_NAME]?.hits).toBe(1);
  });

  it("anvilStat entries count equals number of distinct cache files on disk", async () => {
    const tool = async () => ({});
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: { a: 1 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: { a: 2 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });
    // Third call is a repeat — hits cache
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: { a: 1 }, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    const stat = anvilStat({ cwd: home.cwd });
    expect(stat.entries).toBe(2);
    expect(stat.perTool[TOOL_NAME]?.count).toBe(2);
  });

  it("anvilStat totalBytes is greater than 0 after a write", async () => {
    const tool = async () => ({ payload: "some data" });
    await withAnvil(tool, { toolName: TOOL_NAME, inputs: INPUTS, codeHashSeed: CODE_HASH }, { cwd: home.cwd });

    const stat = anvilStat({ cwd: home.cwd });
    expect(stat.totalBytes).toBeGreaterThan(0);
  });
});

// ─── Scenario 5e — synchronous and async toolFn both supported ────────────────

describe("Scenario 5e — withAnvil supports both sync and async tool functions", () => {
  const home = useTmpForgeHome();

  it("sync toolFn result is cached and returned correctly", async () => {
    const syncTool = () => ({ sync: true, value: 7 });
    const result = await withAnvil(syncTool, { toolName: TOOL_NAME, inputs: { z: 1 }, codeHashSeed: "s1" }, { cwd: home.cwd });
    expect(result.sync).toBe(true);
    expect(result.value).toBe(7);
  });

  it("sync toolFn called twice is memoized (spy counter === 1)", async () => {
    let n = 0;
    const syncTool = () => { n++; return {}; };
    await withAnvil(syncTool, { toolName: TOOL_NAME, inputs: { z: 99 }, codeHashSeed: "s2" }, { cwd: home.cwd });
    await withAnvil(syncTool, { toolName: TOOL_NAME, inputs: { z: 99 }, codeHashSeed: "s2" }, { cwd: home.cwd });
    expect(n).toBe(1);
  });
});
