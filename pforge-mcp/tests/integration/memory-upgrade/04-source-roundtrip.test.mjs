/**
 * 04-source-roundtrip.test.mjs — Scenario 4: source roundtrip via RPC.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 4):
 *   MUST: Capture a memory citing src/foo.mjs byte range [120, 180] with contentHash.
 *   MUST: match_thoughts_by_source({ file: "src/foo.mjs", hash: <hash> }) returns at
 *         least one record whose id matches the captured memory.
 *
 * The mock OpenBrain implements POST /rpc/match_thoughts_by_source per the
 * Phase-PROVENANCE contract: it matches stored memories by metadata.provenance.sourceFile
 * and metadata.provenance.contentHash.
 *
 * NOTE: like 02 and 03, this file implements the RPC client inline as both the test
 * subject and the spec for the future production match_thoughts_by_source client.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";
import { buildProvenance, validateProvenance } from "../../../../pforge-sdk/src/hallmark.mjs";

// ─── Constants used across tests ─────────────────────────────────────────────

const SOURCE_FILE = "src/foo.mjs";
const BYTE_RANGE = [120, 180];
const CONTENT_HASH = "sha256:" + "a".repeat(64);
const ALT_HASH = "sha256:" + "b".repeat(64);

// ─── Inline RPC helpers (Phase-PROVENANCE placeholder) ───────────────────────
// When Phase-PROVENANCE ships, import captureWithSource and matchBySource from
// production memory.mjs.

/**
 * Write a memory to POST /memories with Hallmark provenance in metadata.
 * Returns { ok, id } where id is the server-assigned memory identifier.
 */
async function captureWithSource(url, thought) {
  const provenance = buildProvenance({
    toolName: thought.toolName ?? "forge_analyze",
    ...(thought.sourceFile ? { sourceFile: thought.sourceFile } : {}),
    ...(thought.byteRange ? { byteRange: thought.byteRange } : {}),
    ...(thought.contentHash ? { contentHash: thought.contentHash } : {}),
  });

  const payload = {
    content: thought.content,
    metadata: { provenance },
  };

  const res = await fetch(`${url}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = res.ok ? await res.json() : null;
  return { ok: res.ok, id: body?.id ?? null };
}

/**
 * Call POST /rpc/match_thoughts_by_source with { file, hash } filter args.
 * Returns { ok, items, total }.
 */
async function matchBySource(url, params = {}) {
  const res = await fetch(`${url}/rpc/match_thoughts_by_source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await res.json();
  return { ok: res.ok, items: body.items ?? [], total: body.total ?? 0 };
}

// ─── Scenario 4a — exact match (file + hash) ─────────────────────────────────

describe("Scenario 4a — match_thoughts_by_source with file + hash returns the captured memory", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("captured memory id appears in match results when queried by file + hash", async () => {
    const { id } = await captureWithSource(ob.url, {
      content: "analysis of foo.mjs",
      sourceFile: SOURCE_FILE,
      byteRange: BYTE_RANGE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((m) => m.id === id)).toBe(true);
  });

  it("response.ok is true for a valid RPC call", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { ok } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(ok).toBe(true);
  });

  it("total equals the number of items returned", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const result = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(result.total).toBe(result.items.length);
  });

  it("provenance in returned record passes validateProvenance", async () => {
    await captureWithSource(ob.url, {
      content: "analysis",
      sourceFile: SOURCE_FILE,
      byteRange: BYTE_RANGE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    const prov = items[0]?.metadata?.provenance;
    expect(validateProvenance(prov)).toEqual({ ok: true });
  });

  it("provenance in returned record preserves sourceFile", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(items[0]?.metadata?.provenance?.sourceFile).toBe(SOURCE_FILE);
  });

  it("provenance in returned record preserves contentHash", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(items[0]?.metadata?.provenance?.contentHash).toBe(CONTENT_HASH);
  });

  it("provenance in returned record preserves byteRange", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      byteRange: BYTE_RANGE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(items[0]?.metadata?.provenance?.byteRange).toEqual(BYTE_RANGE);
  });

  it("returned record content field is preserved", async () => {
    await captureWithSource(ob.url, {
      content: "important analysis result",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(items[0]?.content).toBe("important analysis result");
  });
});

// ─── Scenario 4b — file-only query ───────────────────────────────────────────

describe("Scenario 4b — match_thoughts_by_source with file only (no hash)", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("query by file only returns the captured memory", async () => {
    const { id } = await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE });
    expect(items.some((m) => m.id === id)).toBe(true);
  });

  it("query by file only returns all memories for that file", async () => {
    await captureWithSource(ob.url, {
      content: "write-1",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });
    await captureWithSource(ob.url, {
      content: "write-2",
      sourceFile: SOURCE_FILE,
      contentHash: ALT_HASH,
    });

    const { total } = await matchBySource(ob.url, { file: SOURCE_FILE });
    expect(total).toBe(2);
  });
});

// ─── Scenario 4c — no-match cases ─────────────────────────────────────────────

describe("Scenario 4c — match_thoughts_by_source returns empty for non-matching queries", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("query with wrong file returns no records", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, {
      file: "src/other.mjs",
      hash: CONTENT_HASH,
    });
    expect(items.length).toBe(0);
  });

  it("query with wrong hash returns no records", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    const { items } = await matchBySource(ob.url, {
      file: SOURCE_FILE,
      hash: ALT_HASH,
    });
    expect(items.length).toBe(0);
  });

  it("query against empty store returns no records", async () => {
    const { items, total } = await matchBySource(ob.url, {
      file: SOURCE_FILE,
      hash: CONTENT_HASH,
    });
    expect(items.length).toBe(0);
    expect(total).toBe(0);
  });

  it("memory without provenance does not appear in match results", async () => {
    // Write a memory directly without provenance
    await fetch(`${ob.url}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no-prov", metadata: {} }),
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE });
    expect(items.length).toBe(0);
  });
});

// ─── Scenario 4d — multiple memories, selective retrieval ────────────────────

describe("Scenario 4d — multiple memories, RPC returns only the matching source", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("only the memory with the matching sourceFile is returned, not others", async () => {
    const { id: targetId } = await captureWithSource(ob.url, {
      content: "target",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });
    await captureWithSource(ob.url, {
      content: "other",
      sourceFile: "src/bar.mjs",
      contentHash: ALT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE });
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(targetId);
  });

  it("two memories from same file — both returned by file-only query", async () => {
    const { id: id1 } = await captureWithSource(ob.url, {
      content: "first",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });
    const { id: id2 } = await captureWithSource(ob.url, {
      content: "second",
      sourceFile: SOURCE_FILE,
      contentHash: ALT_HASH,
    });

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE });
    const ids = items.map((m) => m.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("file + hash query discriminates between same-file different-hash memories", async () => {
    const { id: id1 } = await captureWithSource(ob.url, {
      content: "v1",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });
    const { id: id2 } = await captureWithSource(ob.url, {
      content: "v2",
      sourceFile: SOURCE_FILE,
      contentHash: ALT_HASH,
    });

    const { items: matches1 } = await matchBySource(ob.url, {
      file: SOURCE_FILE,
      hash: CONTENT_HASH,
    });
    expect(matches1.length).toBe(1);
    expect(matches1[0].id).toBe(id1);

    const { items: matches2 } = await matchBySource(ob.url, {
      file: SOURCE_FILE,
      hash: ALT_HASH,
    });
    expect(matches2.length).toBe(1);
    expect(matches2[0].id).toBe(id2);
  });

  it("rpc hit counter increments for each match_thoughts_by_source call", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    await matchBySource(ob.url, { file: SOURCE_FILE });
    await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });

    expect(ob.hitCounts.rpc).toBe(2);
  });

  it("ob.requests.rpc records the file and hash sent in each RPC call", async () => {
    await captureWithSource(ob.url, {
      content: "x",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });

    const recorded = ob.requests.rpc[0];
    expect(recorded.body.file).toBe(SOURCE_FILE);
    expect(recorded.body.hash).toBe(CONTENT_HASH);
  });
});

// ─── Scenario 4e — ob.reset() clears stored memories ─────────────────────────

describe("Scenario 4e — ob.reset() clears the source index", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("after ob.reset(), previously captured memories are no longer matched", async () => {
    await captureWithSource(ob.url, {
      content: "pre-reset",
      sourceFile: SOURCE_FILE,
      contentHash: CONTENT_HASH,
    });

    ob.reset();

    const { items } = await matchBySource(ob.url, { file: SOURCE_FILE, hash: CONTENT_HASH });
    expect(items.length).toBe(0);
  });

  it("after ob.reset(), rpc hit counter is zeroed", async () => {
    await matchBySource(ob.url, { file: SOURCE_FILE });
    ob.reset();
    expect(ob.hitCounts.rpc).toBe(0);
  });
});
