/**
 * anvil.test.mjs — Tests for the Anvil memoization cache (Slice 1)
 *
 * Covers: withAnvil (cache hit/miss, key sensitivity), anvilStat,
 * anvilClear (ERR_ANVIL_NO_FILTER, tool filter, age filter), anvilRebuild.
 *
 * All tests use tmp directories injected via deps.cwd so they never touch
 * the real .forge/ directory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { withAnvil, anvilStat, anvilClear, anvilRebuild, anvilDlqAppend, anvilDlqList, anvilDlqDrain } from "../anvil.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `anvil-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── withAnvil ────────────────────────────────────────────────────────────────

describe("withAnvil", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("invokes the tool function on the first call (cache miss)", async () => {
    const fn = vi.fn().mockResolvedValue({ score: 42 });
    const result = await withAnvil(fn, {
      toolName: "forge_analyze",
      inputs: { file: "foo.js" },
      codeHashSeed: "seed-v1",
    }, { cwd: tmpDir });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.score).toBe(42);
    expect(result.anvil.hit).toBe(false);
    expect(typeof result.anvil.key).toBe("string");
    expect(result.anvil.key).toHaveLength(64); // sha256 hex
  });

  it("returns a cache hit on the second call with identical inputs", async () => {
    const fn = vi.fn().mockResolvedValue({ score: 42 });
    const opts = { toolName: "forge_analyze", inputs: { file: "foo.js" }, codeHashSeed: "seed-v1" };

    await withAnvil(fn, opts, { cwd: tmpDir });
    const result = await withAnvil(fn, opts, { cwd: tmpDir });

    expect(fn).toHaveBeenCalledTimes(1); // not invoked again
    expect(result.score).toBe(42);
    expect(result.anvil.hit).toBe(true);
    expect(typeof result.anvil.ageMs).toBe("number");
    expect(result.anvil.ageMs).toBeGreaterThanOrEqual(0);
  });

  it("misses when inputs change even by one value", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ score: 1 })
      .mockResolvedValueOnce({ score: 2 });

    const base = { toolName: "forge_sweep", codeHashSeed: "s1" };

    const r1 = await withAnvil(fn, { ...base, inputs: { x: 1 } }, { cwd: tmpDir });
    const r2 = await withAnvil(fn, { ...base, inputs: { x: 2 } }, { cwd: tmpDir });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(r1.anvil.hit).toBe(false);
    expect(r2.anvil.hit).toBe(false);
    expect(r1.anvil.key).not.toBe(r2.anvil.key);
  });

  it("misses when codeHashSeed changes", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ v: "a" })
      .mockResolvedValueOnce({ v: "b" });

    const base = { toolName: "forge_hotspot", inputs: { path: "src/" } };

    const r1 = await withAnvil(fn, { ...base, codeHashSeed: "hash-v1" }, { cwd: tmpDir });
    const r2 = await withAnvil(fn, { ...base, codeHashSeed: "hash-v2" }, { cwd: tmpDir });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(r1.anvil.hit).toBe(false);
    expect(r2.anvil.hit).toBe(false);
  });

  it("works with a synchronous tool function", async () => {
    const fn = vi.fn().mockReturnValue({ ok: true });

    const result = await withAnvil(fn, {
      toolName: "forge_tempering_scan",
      inputs: {},
      codeHashSeed: "sync-seed",
    }, { cwd: tmpDir });

    expect(result.ok).toBe(true);
    expect(result.anvil.hit).toBe(false);
  });

  it("produces the same key regardless of input key ordering", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ same: true })
      .mockResolvedValueOnce({ same: true });

    const opts1 = { toolName: "t", inputs: { a: 1, b: 2 }, codeHashSeed: "s" };
    const opts2 = { toolName: "t", inputs: { b: 2, a: 1 }, codeHashSeed: "s" };

    const r1 = await withAnvil(fn, opts1, { cwd: tmpDir });
    const r2 = await withAnvil(fn, opts2, { cwd: tmpDir });

    // Same key → second call is a hit
    expect(r2.anvil.hit).toBe(true);
    expect(r1.anvil.key).toBe(r2.anvil.key);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stores entry under .forge/anvil/<toolName>/<key>.json", async () => {
    const fn = vi.fn().mockResolvedValue({ stored: true });
    const result = await withAnvil(fn, {
      toolName: "my_tool",
      inputs: { q: 1 },
      codeHashSeed: "cs",
    }, { cwd: tmpDir });

    const entryPath = join(tmpDir, ".forge", "anvil", "my_tool", `${result.anvil.key}.json`);
    expect(existsSync(entryPath)).toBe(true);
    const raw = JSON.parse(readFileSync(entryPath, "utf-8"));
    expect(raw.toolName).toBe("my_tool");
    expect(raw.cacheKey).toBe(result.anvil.key);
    expect(raw.payload).toEqual({ stored: true });
  });

  it("hit response does not include nested anvil inside payload", async () => {
    const fn = vi.fn().mockResolvedValue({ data: "hello" });
    const opts = { toolName: "t2", inputs: {}, codeHashSeed: "c2" };
    await withAnvil(fn, opts, { cwd: tmpDir });

    const hit = await withAnvil(fn, opts, { cwd: tmpDir });
    // The payload is { data: "hello" } — no recursive anvil keys
    expect(hit.data).toBe("hello");
    expect(hit.anvil.hit).toBe(true);
  });
});

// ─── anvilStat ────────────────────────────────────────────────────────────────

describe("anvilStat", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns zeroes / nulls when anvil directory does not exist", () => {
    const stat = anvilStat({ cwd: tmpDir });
    expect(stat.entries).toBe(0);
    expect(stat.totalBytes).toBe(0);
    expect(stat.oldestMtime).toBeNull();
    expect(stat.perTool).toEqual({});
  });

  it("counts entries per tool and totals match ls count", async () => {
    const fn = vi.fn().mockResolvedValue({ x: 1 });

    // Write 3 entries for forge_analyze, 2 for forge_sweep
    await withAnvil(fn, { toolName: "forge_analyze", inputs: { i: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });
    await withAnvil(fn, { toolName: "forge_analyze", inputs: { i: 2 }, codeHashSeed: "s" }, { cwd: tmpDir });
    await withAnvil(fn, { toolName: "forge_analyze", inputs: { i: 3 }, codeHashSeed: "s" }, { cwd: tmpDir });
    await withAnvil(fn, { toolName: "forge_sweep", inputs: { i: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });
    await withAnvil(fn, { toolName: "forge_sweep", inputs: { i: 2 }, codeHashSeed: "s" }, { cwd: tmpDir });

    const stat = anvilStat({ cwd: tmpDir });
    expect(stat.entries).toBe(5);
    expect(stat.perTool["forge_analyze"].count).toBe(3);
    expect(stat.perTool["forge_sweep"].count).toBe(2);
    expect(stat.totalBytes).toBeGreaterThan(0);
  });

  it("tracks hit and miss counters in stats.json", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const opts = { toolName: "forge_hotspot", inputs: {}, codeHashSeed: "h" };

    await withAnvil(fn, opts, { cwd: tmpDir }); // miss
    await withAnvil(fn, opts, { cwd: tmpDir }); // hit
    await withAnvil(fn, opts, { cwd: tmpDir }); // hit

    const stat = anvilStat({ cwd: tmpDir });
    expect(stat.perTool["forge_hotspot"].misses).toBe(1);
    expect(stat.perTool["forge_hotspot"].hits).toBe(2);
  });

  it("oldestMtime is a number when at least one entry exists", async () => {
    const fn = vi.fn().mockResolvedValue({ r: 1 });
    await withAnvil(fn, { toolName: "t", inputs: {}, codeHashSeed: "s" }, { cwd: tmpDir });

    const stat = anvilStat({ cwd: tmpDir });
    expect(typeof stat.oldestMtime).toBe("number");
    expect(stat.oldestMtime).toBeGreaterThan(0);
  });
});

// ─── anvilClear ──────────────────────────────────────────────────────────────

describe("anvilClear", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("throws ERR_ANVIL_NO_FILTER when called with no filters", () => {
    expect(() => anvilClear({}, { cwd: tmpDir })).toThrowError(/ERR_ANVIL_NO_FILTER|accidental/i);
    try {
      anvilClear({}, { cwd: tmpDir });
    } catch (err) {
      expect(err.code).toBe("ERR_ANVIL_NO_FILTER");
    }
  });

  it("deletes only the targeted tool directory when tool filter supplied", async () => {
    const fn = vi.fn().mockResolvedValue({ q: 1 });
    await withAnvil(fn, { toolName: "forge_sweep", inputs: { a: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });
    await withAnvil(fn, { toolName: "forge_analyze", inputs: { a: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });

    anvilClear({ tool: "forge_sweep" }, { cwd: tmpDir });

    const root = join(tmpDir, ".forge", "anvil");
    expect(existsSync(join(root, "forge_sweep"))).toBe(false);
    expect(existsSync(join(root, "forge_analyze"))).toBe(true);
  });

  it("deletes entries older than olderThanMs across all tools", async () => {
    const fn = vi.fn().mockResolvedValue({ q: 1 });
    await withAnvil(fn, { toolName: "forge_analyze", inputs: { z: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });

    // All entries were just written — they are NOT older than 10 hours
    const result = anvilClear({ olderThanMs: 10 * 60 * 60 * 1000 }, { cwd: tmpDir });
    expect(result.deleted).toBe(0);
  });

  it("deletes files that are older than the threshold", async () => {
    // Write an entry, then backdate its mtime via stat mock isn't practical here.
    // Instead, verify that olderThanMs=0 deletes everything (0ms threshold → all files are "old").
    const fn = vi.fn().mockResolvedValue({ d: 1 });
    await withAnvil(fn, { toolName: "forge_sweep", inputs: { n: 1 }, codeHashSeed: "s" }, { cwd: tmpDir });

    const result = anvilClear({ olderThanMs: 0 }, { cwd: tmpDir });
    expect(result.deleted).toBeGreaterThan(0);

    const toolDir = join(tmpDir, ".forge", "anvil", "forge_sweep");
    const remainingJson = existsSync(toolDir)
      ? readdirSync(toolDir).filter(f => f.endsWith(".json"))
      : [];
    expect(remainingJson.length).toBe(0);
  });

  it("returns { deleted: 0 } when anvil directory does not exist", () => {
    const result = anvilClear({ tool: "nonexistent" }, { cwd: tmpDir });
    expect(result.deleted).toBe(0);
  });

  it("is a no-op for a tool that has no entries", async () => {
    const fn = vi.fn().mockResolvedValue({ r: 1 });
    await withAnvil(fn, { toolName: "forge_analyze", inputs: {}, codeHashSeed: "s" }, { cwd: tmpDir });

    const result = anvilClear({ tool: "nonexistent_tool" }, { cwd: tmpDir });
    expect(result.deleted).toBe(0);
  });
});

// ─── anvilRebuild ────────────────────────────────────────────────────────────

describe("anvilRebuild", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("throws when called without { since }", () => {
    expect(() => anvilRebuild({}, { cwd: tmpDir })).toThrow(/since/i);
  });

  it("invalidates entries whose codeHashSeed references a changed file", async () => {
    const fn = vi.fn()
      .mockResolvedValue({ r: 1 });

    // Write two entries with different codeHashSeeds (file paths)
    await withAnvil(fn, {
      toolName: "forge_analyze",
      inputs: { x: 1 },
      codeHashSeed: "pforge-mcp/server.mjs",
    }, { cwd: tmpDir });

    await withAnvil(fn, {
      toolName: "forge_sweep",
      inputs: { x: 1 },
      codeHashSeed: "pforge-mcp/brain.mjs",
    }, { cwd: tmpDir });

    // Mock git to say only server.mjs changed
    const mockExec = vi.fn().mockReturnValue("pforge-mcp/server.mjs\n");

    const result = anvilRebuild({ since: "abc1234" }, {
      cwd: tmpDir,
      exec: mockExec,
    });

    expect(result.invalidated).toBe(1);
    expect(result.changedFiles).toContain("pforge-mcp/server.mjs");

    // forge_analyze entry (server.mjs) should be gone; forge_sweep (brain.mjs) intact
    const analyzeDir = join(tmpDir, ".forge", "anvil", "forge_analyze");
    const sweepDir = join(tmpDir, ".forge", "anvil", "forge_sweep");

    const analyzeFiles = existsSync(analyzeDir)
      ? readdirSync(analyzeDir).filter(f => f.endsWith(".json"))
      : [];
    const sweepFiles = existsSync(sweepDir)
      ? readdirSync(sweepDir).filter(f => f.endsWith(".json"))
      : [];

    expect(analyzeFiles.length).toBe(0);
    expect(sweepFiles.length).toBe(1);
  });

  it("invalidates an entry when codeHashSeed is an absolute path ending with the changed file", async () => {
    const fn = vi.fn().mockResolvedValue({ abs: true });
    await withAnvil(fn, {
      toolName: "forge_hotspot",
      inputs: {},
      codeHashSeed: "/home/user/project/pforge-mcp/orchestrator.mjs",
    }, { cwd: tmpDir });

    const mockExec = vi.fn().mockReturnValue("pforge-mcp/orchestrator.mjs\n");

    const result = anvilRebuild({ since: "deadbeef" }, { cwd: tmpDir, exec: mockExec });
    expect(result.invalidated).toBe(1);
  });

  it("returns { invalidated: 0 } when no files changed", async () => {
    const fn = vi.fn().mockResolvedValue({ r: 1 });
    await withAnvil(fn, {
      toolName: "forge_analyze",
      inputs: { y: 2 },
      codeHashSeed: "some-file.mjs",
    }, { cwd: tmpDir });

    const mockExec = vi.fn().mockReturnValue("");
    const result = anvilRebuild({ since: "abc" }, { cwd: tmpDir, exec: mockExec });
    expect(result.invalidated).toBe(0);
  });

  it("returns { invalidated: 0 } when git diff fails", async () => {
    const mockExec = vi.fn().mockImplementation(() => { throw new Error("not a git repo"); });
    const result = anvilRebuild({ since: "abc" }, { cwd: tmpDir, exec: mockExec });
    expect(result.invalidated).toBe(0);
    expect(result.changedFiles).toEqual([]);
  });

  it("returns { invalidated: 0 } when anvil directory does not exist", () => {
    const mockExec = vi.fn().mockReturnValue("some-file.mjs\n");
    const result = anvilRebuild({ since: "abc" }, { cwd: tmpDir, exec: mockExec });
    expect(result.invalidated).toBe(0);
    expect(result.changedFiles).toContain("some-file.mjs");
  });

  it("does not re-run the tool — next call after rebuild is a clean miss", async () => {
    const fn = vi.fn().mockResolvedValue({ rebuilt: true });
    const opts = {
      toolName: "forge_tempering_scan",
      inputs: { f: "x" },
      codeHashSeed: "pforge-mcp/tempering.mjs",
    };

    // Prime the cache
    await withAnvil(fn, opts, { cwd: tmpDir });
    expect(fn).toHaveBeenCalledTimes(1);

    // Rebuild invalidates it
    const mockExec = vi.fn().mockReturnValue("pforge-mcp/tempering.mjs\n");
    anvilRebuild({ since: "sha1" }, { cwd: tmpDir, exec: mockExec });

    // Next call should be a miss (not hit), invoking fn again
    const result = await withAnvil(fn, opts, { cwd: tmpDir });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.anvil.hit).toBe(false);
  });
});

// ─── anvilDlqAppend ──────────────────────────────────────────────────────────

describe("anvilDlqAppend", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns an object with a UUID id", () => {
    const { id } = anvilDlqAppend({ toolName: "forge_analyze", error: "timeout" }, { cwd: tmpDir });
    expect(typeof id).toBe("string");
    // UUID v4 format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("writes a JSON file under .forge/anvil/dlq/<id>.json", () => {
    const { id } = anvilDlqAppend({ toolName: "forge_sweep", error: "boom" }, { cwd: tmpDir });
    const p = join(tmpDir, ".forge", "anvil", "dlq", `${id}.json`);
    expect(existsSync(p)).toBe(true);
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    expect(raw.id).toBe(id);
    expect(raw.toolName).toBe("forge_sweep");
    expect(raw.error).toBe("boom");
    expect(typeof raw.failedAt).toBe("string");
  });

  it("preserves arbitrary caller-provided fields", () => {
    const { id } = anvilDlqAppend({ toolName: "t", inputs: { x: 1 }, custom: "meta" }, { cwd: tmpDir });
    const p = join(tmpDir, ".forge", "anvil", "dlq", `${id}.json`);
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    expect(raw.inputs).toEqual({ x: 1 });
    expect(raw.custom).toBe("meta");
  });

  it("assigns null defaults for toolName, inputs, error when omitted", () => {
    const { id } = anvilDlqAppend({}, { cwd: tmpDir });
    const p = join(tmpDir, ".forge", "anvil", "dlq", `${id}.json`);
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    expect(raw.toolName).toBeNull();
    expect(raw.inputs).toBeNull();
    expect(raw.error).toBeNull();
  });

  it("each call generates a unique id", () => {
    const id1 = anvilDlqAppend({ toolName: "t" }, { cwd: tmpDir }).id;
    const id2 = anvilDlqAppend({ toolName: "t" }, { cwd: tmpDir }).id;
    expect(id1).not.toBe(id2);
  });
});

// ─── anvilDlqList ────────────────────────────────────────────────────────────

describe("anvilDlqList", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns empty items and total=0 when dlq directory does not exist", () => {
    const result = anvilDlqList({}, { cwd: tmpDir });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("lists all entries when no filter is supplied", () => {
    anvilDlqAppend({ toolName: "forge_analyze", error: "e1" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_sweep", error: "e2" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_analyze", error: "e3" }, { cwd: tmpDir });

    const { items, total } = anvilDlqList({}, { cwd: tmpDir });
    expect(total).toBe(3);
    expect(items).toHaveLength(3);
  });

  it("filters by tool name", () => {
    anvilDlqAppend({ toolName: "forge_analyze", error: "a" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_sweep", error: "b" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_analyze", error: "c" }, { cwd: tmpDir });

    const { items, total } = anvilDlqList({ tool: "forge_analyze" }, { cwd: tmpDir });
    expect(total).toBe(2);
    expect(items.every(i => i.toolName === "forge_analyze")).toBe(true);
  });

  it("respects limit option without changing total", () => {
    for (let i = 0; i < 5; i++) {
      anvilDlqAppend({ toolName: "forge_hotspot", error: `err${i}` }, { cwd: tmpDir });
    }
    const { items, total } = anvilDlqList({ limit: 2 }, { cwd: tmpDir });
    expect(total).toBe(5);
    expect(items).toHaveLength(2);
  });

  it("each returned item includes id and failedAt", () => {
    anvilDlqAppend({ toolName: "forge_analyze", error: "oops" }, { cwd: tmpDir });
    const { items } = anvilDlqList({}, { cwd: tmpDir });
    expect(typeof items[0].id).toBe("string");
    expect(typeof items[0].failedAt).toBe("string");
  });
});

// ─── anvilDlqDrain ───────────────────────────────────────────────────────────

describe("anvilDlqDrain", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns { drained: 0 } when dlq directory does not exist", () => {
    expect(anvilDlqDrain({}, { cwd: tmpDir })).toEqual({ drained: 0 });
  });

  it("drains all entries when no filter is supplied", () => {
    anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_sweep" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_hotspot" }, { cwd: tmpDir });

    const result = anvilDlqDrain({}, { cwd: tmpDir });
    expect(result.drained).toBe(3);
    expect(anvilDlqList({}, { cwd: tmpDir }).total).toBe(0);
  });

  it("drains only the specified id", () => {
    const { id: id1 } = anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_sweep" }, { cwd: tmpDir });

    const result = anvilDlqDrain({ id: id1 }, { cwd: tmpDir });
    expect(result.drained).toBe(1);

    const { total } = anvilDlqList({}, { cwd: tmpDir });
    expect(total).toBe(1);
  });

  it("returns { drained: 0 } when id does not exist", () => {
    anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    const result = anvilDlqDrain({ id: "00000000-0000-4000-8000-000000000000" }, { cwd: tmpDir });
    expect(result.drained).toBe(0);
  });

  it("drains only entries matching the tool filter", () => {
    anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_sweep" }, { cwd: tmpDir });

    const result = anvilDlqDrain({ tool: "forge_analyze" }, { cwd: tmpDir });
    expect(result.drained).toBe(2);

    const { items } = anvilDlqList({}, { cwd: tmpDir });
    expect(items).toHaveLength(1);
    expect(items[0].toolName).toBe("forge_sweep");
  });

  it("id filter takes precedence over tool filter", () => {
    const { id } = anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });
    anvilDlqAppend({ toolName: "forge_analyze" }, { cwd: tmpDir });

    // id is provided; tool is ignored
    const result = anvilDlqDrain({ id, tool: "forge_analyze" }, { cwd: tmpDir });
    expect(result.drained).toBe(1);
    expect(anvilDlqList({}, { cwd: tmpDir }).total).toBe(1);
  });
});
