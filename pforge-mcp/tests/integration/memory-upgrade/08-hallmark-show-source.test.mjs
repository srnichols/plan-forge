/**
 * 08-hallmark-show-source.test.mjs — Scenario 8: Hallmark show/verify source.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 8):
 *   MUST: buildProvenance({ toolName, sourceFile, byteRange, contentHash }) produces a
 *         record that validateProvenance returns { ok: true }.
 *   MUST: Provenance records citing tiny-project source files can be captured to mock
 *         OpenBrain and retrieved by source via match_thoughts_by_source.
 *   MUST: Source fields (sourceFile, byteRange, contentHash) are preserved in the
 *         returned memory record exactly as supplied.
 *   MUST: The fixture record "withSourceAndRange" (expected-hallmark-records.json)
 *         validates as { ok: true }.
 *   MUST: A contentHash computed from actual tiny-project file content can anchor
 *         provenance to that file and be round-tripped through mock OpenBrain.
 *
 * No disk I/O except for reading fixture files and tiny-project fixture source.
 * Network I/O uses the in-process mock OpenBrain server only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { buildProvenance, validateProvenance, HALLMARK_SCHEMA_VERSION } from "../../../../pforge-sdk/src/hallmark.mjs";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR  = resolve(__dirname, "fixtures");
const TINY_DIR      = resolve(FIXTURES_DIR, "tiny-project");

const HALLMARK_RECORDS = JSON.parse(
  readFileSync(resolve(FIXTURES_DIR, "expected-hallmark-records.json"), "utf-8")
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute the Hallmark-format sha256 content hash for a string. */
function contentHashOf(text) {
  return "sha256:" + createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * POST a memory with Hallmark provenance to mock OpenBrain.
 * Returns { ok, id } from the 201 response.
 */
async function captureMemory(url, thought) {
  const prov = buildProvenance({
    toolName:    thought.toolName    ?? "forge_analyze",
    sourceFile:  thought.sourceFile  ?? undefined,
    byteRange:   thought.byteRange   ?? undefined,
    contentHash: thought.contentHash ?? undefined,
  });
  // Strip undefined keys so the provenance object is clean
  Object.keys(prov).forEach((k) => prov[k] === undefined && delete prov[k]);

  const res = await fetch(`${url}/memories`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ content: thought.content, metadata: { provenance: prov } }),
  });
  const body = await res.json();
  return { ok: res.ok, id: body?.id ?? null };
}

/**
 * POST /rpc/match_thoughts_by_source to mock OpenBrain.
 * Returns { ok, items, total }.
 */
async function matchBySource(url, params = {}) {
  const res = await fetch(`${url}/rpc/match_thoughts_by_source`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
  const body = await res.json();
  return { ok: res.ok, items: body.items ?? [], total: body.total ?? 0 };
}

// ─── Scenario 8a — buildProvenance with source fields validates correctly ──────

describe("Scenario 8a — buildProvenance with source fields passes validateProvenance", () => {
  it("sourceFile alone is valid", () => {
    const rec = buildProvenance({ toolName: "forge_analyze", sourceFile: "src/alpha.mjs" });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("sourceFile + byteRange is valid", () => {
    const rec = buildProvenance({
      toolName:   "forge_analyze",
      sourceFile: "src/alpha.mjs",
      byteRange:  [0, 256],
    });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("sourceFile + byteRange + contentHash is valid", () => {
    const hash = "sha256:" + "a".repeat(64);
    const rec = buildProvenance({
      toolName:    "forge_analyze",
      sourceFile:  "src/alpha.mjs",
      byteRange:   [120, 180],
      contentHash: hash,
    });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("byteRange [0, 0] (zero-length range) is valid with source file", () => {
    const rec = buildProvenance({ toolName: "t", sourceFile: "src/alpha.mjs", byteRange: [0, 0] });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("contentHash computed from actual alpha.mjs content is valid", () => {
    const src  = readFileSync(resolve(TINY_DIR, "src/alpha.mjs"), "utf-8");
    const hash = contentHashOf(src);
    const rec  = buildProvenance({ toolName: "forge_analyze", sourceFile: "src/alpha.mjs", contentHash: hash });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("contentHash computed from actual helpers.py content is valid", () => {
    const src  = readFileSync(resolve(TINY_DIR, "utils/helpers.py"), "utf-8");
    const hash = contentHashOf(src);
    const rec  = buildProvenance({ toolName: "forge_analyze", sourceFile: "utils/helpers.py", contentHash: hash });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });

  it("provenance schemaVersion is always HALLMARK_SCHEMA_VERSION", () => {
    const rec = buildProvenance({ toolName: "t", sourceFile: "src/alpha.mjs" });
    expect(rec.schemaVersion).toBe(HALLMARK_SCHEMA_VERSION);
  });

  it("capturedAt is set automatically and is ISO UTC", () => {
    const rec = buildProvenance({ toolName: "t", sourceFile: "src/alpha.mjs" });
    expect(rec.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("sourceFile field is preserved exactly as supplied", () => {
    const rec = buildProvenance({ toolName: "t", sourceFile: "src/epsilon.mjs" });
    expect(rec.sourceFile).toBe("src/epsilon.mjs");
  });

  it("byteRange field is preserved exactly as supplied", () => {
    const rec = buildProvenance({ toolName: "t", sourceFile: "src/alpha.mjs", byteRange: [10, 99] });
    expect(rec.byteRange).toEqual([10, 99]);
  });
});

// ─── Scenario 8b — fixture-driven: expected-hallmark-records.json withSourceAndRange ──

describe("Scenario 8b — fixture withSourceAndRange validates as { ok: true }", () => {
  it("withSourceAndRange record validates without modification", () => {
    expect(validateProvenance(HALLMARK_RECORDS.withSourceAndRange)).toEqual({ ok: true });
  });

  it("withSourceAndRange sourceFile is 'src/alpha.mjs'", () => {
    expect(HALLMARK_RECORDS.withSourceAndRange.sourceFile).toBe("src/alpha.mjs");
  });

  it("withSourceAndRange byteRange is [120, 180]", () => {
    expect(HALLMARK_RECORDS.withSourceAndRange.byteRange).toEqual([120, 180]);
  });

  it("withSourceAndRange contentHash passes HASH_RE pattern", () => {
    const hash = HALLMARK_RECORDS.withSourceAndRange.contentHash;
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("provenance built from sourceRoundtrip fixture fields validates", () => {
    const fixture = HALLMARK_RECORDS.sourceRoundtrip;
    const rec = buildProvenance({
      toolName:   fixture.toolName,
      sourceFile: fixture.sourceFile,
      byteRange:  fixture.byteRange,
    });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });
});

// ─── Scenario 8c — round-trip through mock OpenBrain by source ────────────────

describe("Scenario 8c — memory captured with source provenance is retrievable by source", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("captured memory id appears in match_thoughts_by_source results", async () => {
    const hash = "sha256:" + "0".repeat(64);
    const { id } = await captureMemory(ob.url, {
      content:     "analysis of alpha.mjs",
      sourceFile:  "src/alpha.mjs",
      byteRange:   [0, 256],
      contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/alpha.mjs", hash });
    expect(items.some((m) => m.id === id)).toBe(true);
  });

  it("response total equals items length", async () => {
    const hash = "sha256:" + "1".repeat(64);
    await captureMemory(ob.url, {
      content: "x", sourceFile: "src/beta.mjs", contentHash: hash,
    });

    const result = await matchBySource(ob.url, { file: "src/beta.mjs", hash });
    expect(result.total).toBe(result.items.length);
  });

  it("sourceFile is preserved in the returned provenance", async () => {
    const hash = "sha256:" + "2".repeat(64);
    await captureMemory(ob.url, {
      content: "x", sourceFile: "src/gamma.mjs", contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/gamma.mjs", hash });
    expect(items[0]?.metadata?.provenance?.sourceFile).toBe("src/gamma.mjs");
  });

  it("byteRange is preserved in the returned provenance", async () => {
    const hash = "sha256:" + "3".repeat(64);
    await captureMemory(ob.url, {
      content: "x", sourceFile: "src/delta.mjs", byteRange: [5, 50], contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/delta.mjs", hash });
    expect(items[0]?.metadata?.provenance?.byteRange).toEqual([5, 50]);
  });

  it("contentHash is preserved in the returned provenance", async () => {
    const hash = "sha256:" + "4".repeat(64);
    await captureMemory(ob.url, {
      content: "x", sourceFile: "src/zeta.mjs", contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/zeta.mjs", hash });
    expect(items[0]?.metadata?.provenance?.contentHash).toBe(hash);
  });

  it("provenance in returned record passes validateProvenance", async () => {
    const hash = "sha256:" + "5".repeat(64);
    await captureMemory(ob.url, {
      content: "analysis", sourceFile: "src/alpha.mjs", byteRange: [120, 180], contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/alpha.mjs", hash });
    expect(validateProvenance(items[0]?.metadata?.provenance)).toEqual({ ok: true });
  });

  it("memory content is preserved in the returned record", async () => {
    const hash = "sha256:" + "6".repeat(64);
    await captureMemory(ob.url, {
      content: "special analysis payload", sourceFile: "src/epsilon.mjs", contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/epsilon.mjs", hash });
    expect(items[0]?.content).toBe("special analysis payload");
  });
});

// ─── Scenario 8d — selective retrieval by source among multiple memories ──────

describe("Scenario 8d — match_thoughts_by_source is selective when multiple memories exist", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("only the memory for the matching file is returned", async () => {
    const hashA = "sha256:" + "a".repeat(64);
    const hashB = "sha256:" + "b".repeat(64);

    const { id: idA } = await captureMemory(ob.url, {
      content: "alpha", sourceFile: "src/alpha.mjs", contentHash: hashA,
    });
    await captureMemory(ob.url, {
      content: "beta", sourceFile: "src/beta.mjs", contentHash: hashB,
    });

    const { items } = await matchBySource(ob.url, { file: "src/alpha.mjs", hash: hashA });
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(idA);
  });

  it("file-only query returns all memories for that file across different hash versions", async () => {
    const hashV1 = "sha256:" + "c".repeat(64);
    const hashV2 = "sha256:" + "d".repeat(64);

    await captureMemory(ob.url, { content: "v1", sourceFile: "src/alpha.mjs", contentHash: hashV1 });
    await captureMemory(ob.url, { content: "v2", sourceFile: "src/alpha.mjs", contentHash: hashV2 });

    const { total } = await matchBySource(ob.url, { file: "src/alpha.mjs" });
    expect(total).toBe(2);
  });

  it("each tiny-project source file can independently anchor a memory", async () => {
    const files = [
      "src/alpha.mjs",
      "src/beta.mjs",
      "src/gamma.mjs",
      "src/delta.mjs",
      "src/epsilon.mjs",
      "src/zeta.mjs",
    ];

    const capturedIds = {};
    for (let i = 0; i < files.length; i++) {
      const hash = "sha256:" + String(i).repeat(64).slice(0, 64);
      const { id } = await captureMemory(ob.url, {
        content: `memory for ${files[i]}`, sourceFile: files[i], contentHash: hash,
      });
      capturedIds[files[i]] = id;
    }

    // Each file resolves to exactly its own memory
    for (let i = 0; i < files.length; i++) {
      const hash = "sha256:" + String(i).repeat(64).slice(0, 64);
      const { items } = await matchBySource(ob.url, { file: files[i], hash });
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(capturedIds[files[i]]);
    }
  });
});

// ─── Scenario 8e — content hash anchors provenance to file content ─────────────

describe("Scenario 8e — contentHash computed from fixture file content anchors provenance", () => {
  let ob;

  beforeEach(async () => {
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("memory captured with sha256 of alpha.mjs content is found by that hash", async () => {
    const src  = readFileSync(resolve(TINY_DIR, "src/alpha.mjs"), "utf-8");
    const hash = contentHashOf(src);

    const { id } = await captureMemory(ob.url, {
      content: "analysis of real alpha.mjs", sourceFile: "src/alpha.mjs", contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/alpha.mjs", hash });
    expect(items.some((m) => m.id === id)).toBe(true);
  });

  it("wrong hash for a file does not match the memory", async () => {
    const src    = readFileSync(resolve(TINY_DIR, "src/beta.mjs"), "utf-8");
    const hash   = contentHashOf(src);
    const wrong  = "sha256:" + "z".repeat(64).replace(/z/g, "f");

    await captureMemory(ob.url, {
      content: "beta analysis", sourceFile: "src/beta.mjs", contentHash: hash,
    });

    const { items } = await matchBySource(ob.url, { file: "src/beta.mjs", hash: wrong });
    expect(items.length).toBe(0);
  });

  it("provenance built from actual file content validates", () => {
    const src  = readFileSync(resolve(TINY_DIR, "utils/helpers.py"), "utf-8");
    const hash = contentHashOf(src);
    const rec  = buildProvenance({
      toolName:    "forge_analyze",
      sourceFile:  "utils/helpers.py",
      contentHash: hash,
    });
    expect(validateProvenance(rec)).toEqual({ ok: true });
  });
});
