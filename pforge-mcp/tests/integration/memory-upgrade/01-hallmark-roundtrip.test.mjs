/**
 * 01-hallmark-roundtrip.test.mjs — Scenario 1: Hallmark provenance roundtrip.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 1):
 *   MUST: buildProvenance({ toolName }) → serialize → parse → validateProvenance === { ok: true }
 *   MUST: Tampering with any required field causes validateProvenance to return
 *         { ok: false, errors: [...] } with at least one error specifying the field name.
 *
 * Pure function tests — no I/O, no network, no tmp dir needed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProvenance,
  validateProvenance,
  HALLMARK_SCHEMA_VERSION,
} from "../../../../pforge-sdk/src/hallmark.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(__dirname, "fixtures", "expected-hallmark-records.json");
const FIXTURES = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

// ─── buildProvenance + validateProvenance roundtrip ──────────────────────────

describe("Scenario 1 — Hallmark roundtrip (buildProvenance → validate)", () => {
  it("minimal: buildProvenance sets schemaVersion and capturedAt automatically", () => {
    const rec = buildProvenance({ toolName: "test" });
    expect(rec.schemaVersion).toBe(HALLMARK_SCHEMA_VERSION);
    expect(typeof rec.capturedAt).toBe("string");
    expect(rec.toolName).toBe("test");
  });

  it("minimal: serialize → JSON.parse → validateProvenance returns { ok: true }", () => {
    const rec = buildProvenance({ toolName: "test" });
    const serialized = JSON.stringify(rec);
    const parsed = JSON.parse(serialized);
    const result = validateProvenance(parsed);
    expect(result).toEqual({ ok: true });
  });

  it("with optional fields: serialize → parse → validateProvenance returns { ok: true }", () => {
    const rec = buildProvenance({
      toolName: "forge_analyze",
      sourceFile: "src/alpha.mjs",
      byteRange: [0, 100],
      contentHash: "sha256:" + "a".repeat(64),
      codeHash: "sha256:" + "b".repeat(64),
      toolVersion: "2.95.0",
    });
    const parsed = JSON.parse(JSON.stringify(rec));
    expect(validateProvenance(parsed)).toEqual({ ok: true });
  });

  it("capturedAt is ISO 8601 UTC format ending in Z", () => {
    const rec = buildProvenance({ toolName: "test" });
    expect(rec.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("caller cannot override schemaVersion via options", () => {
    const rec = buildProvenance({ toolName: "test", schemaVersion: "hallmark/v0" });
    expect(rec.schemaVersion).toBe(HALLMARK_SCHEMA_VERSION);
  });

  it("caller cannot override capturedAt via options", () => {
    const overrideTime = "2000-01-01T00:00:00Z";
    const rec = buildProvenance({ toolName: "test", capturedAt: overrideTime });
    expect(rec.capturedAt).not.toBe(overrideTime);
  });

  it("byteRange [0, 0] is valid (zero-length range)", () => {
    const rec = buildProvenance({ toolName: "test", byteRange: [0, 0] });
    const parsed = JSON.parse(JSON.stringify(rec));
    expect(validateProvenance(parsed)).toEqual({ ok: true });
  });
});

// ─── validateProvenance — tamper tests ───────────────────────────────────────

describe("Scenario 1 — validateProvenance rejects tampered records", () => {
  it("missing toolName → { ok: false } with toolName in errors", () => {
    const rec = buildProvenance({ toolName: "test" });
    delete rec.toolName;
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.some((e) => /toolName/i.test(e))).toBe(true);
  });

  it("empty toolName → { ok: false } with toolName in errors", () => {
    const rec = buildProvenance({ toolName: "test" });
    rec.toolName = "";
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /toolName/i.test(e))).toBe(true);
  });

  it("bad capturedAt ('not-a-date') → { ok: false } with capturedAt in errors", () => {
    const rec = buildProvenance({ toolName: "test" });
    rec.capturedAt = "not-a-date";
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /capturedAt/i.test(e))).toBe(true);
  });

  it("wrong schemaVersion ('hallmark/v0') → { ok: false } with schemaVersion in errors", () => {
    const rec = buildProvenance({ toolName: "test" });
    rec.schemaVersion = "hallmark/v0";
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /schemaVersion/i.test(e))).toBe(true);
  });

  it("inverted byteRange ([180, 120]) → { ok: false } with byteRange in errors", () => {
    const rec = buildProvenance({ toolName: "test", byteRange: [180, 120] });
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /byteRange/i.test(e))).toBe(true);
  });

  it("bad contentHash ('not-a-valid-hash') → { ok: false } with contentHash in errors", () => {
    const rec = buildProvenance({ toolName: "test", contentHash: "not-a-valid-hash" });
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /contentHash/i.test(e))).toBe(true);
  });

  it("unknown extra property → { ok: false } for additionalProperties: false", () => {
    const rec = buildProvenance({ toolName: "test" });
    rec.unknownField = "oops";
    const result = validateProvenance(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /unknownField/i.test(e))).toBe(true);
  });

  it("null record → { ok: false }", () => {
    expect(validateProvenance(null).ok).toBe(false);
  });

  it("non-object record (string) → { ok: false }", () => {
    expect(validateProvenance("not an object").ok).toBe(false);
  });

  it("array record → { ok: false }", () => {
    expect(validateProvenance([]).ok).toBe(false);
  });
});

// ─── Fixture-driven tamper tests ──────────────────────────────────────────────

describe("Scenario 1 — fixture-driven tamper cases (expected-hallmark-records.json)", () => {
  it("fixture minimalValid round-trips as { ok: true } when capturedAt is real ISO timestamp", () => {
    // The fixture has a static timestamp — provide a well-formed one for the roundtrip
    const base = { ...FIXTURES.minimalValid };
    // Replace static capturedAt with a valid UTC ISO string
    base.capturedAt = new Date().toISOString();
    expect(validateProvenance(base)).toEqual({ ok: true });
  });

  it("fixture withSourceAndRange round-trips as { ok: true } (static capturedAt provided)", () => {
    const base = { ...FIXTURES.withSourceAndRange };
    // The fixture capturedAt is "2026-05-16T00:00:00Z" — valid ISO UTC
    expect(validateProvenance(base)).toEqual({ ok: true });
  });

  it("fixture missingToolName → { ok: false }", () => {
    const result = validateProvenance(FIXTURES.tamperedFields.missingToolName);
    expect(result.ok).toBe(false);
  });

  it("fixture badCapturedAt → { ok: false } with capturedAt error", () => {
    const result = validateProvenance(FIXTURES.tamperedFields.badCapturedAt);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /capturedAt/i.test(e))).toBe(true);
  });

  it("fixture badSchemaVersion → { ok: false } with schemaVersion error", () => {
    const result = validateProvenance(FIXTURES.tamperedFields.badSchemaVersion);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /schemaVersion/i.test(e))).toBe(true);
  });

  it("fixture badByteRange → { ok: false } with byteRange error", () => {
    const result = validateProvenance(FIXTURES.tamperedFields.badByteRange);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /byteRange/i.test(e))).toBe(true);
  });

  it("fixture badContentHash → { ok: false } with contentHash error", () => {
    const result = validateProvenance(FIXTURES.tamperedFields.badContentHash);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /contentHash/i.test(e))).toBe(true);
  });
});

// ─── mergeProvenance (implicit via fixture.withSourceAndRange) ────────────────

describe("Scenario 1 — provenance in memory metadata shape", () => {
  it("provenance from buildProvenance validates after being nested in metadata and extracted", () => {
    const prov = buildProvenance({
      toolName: "forge_analyze",
      sourceFile: "src/alpha.mjs",
      byteRange: [120, 180],
      contentHash: "sha256:" + "0".repeat(64),
    });
    // Simulate what a POST /memories body stores
    const memoryBody = {
      content: "some analysis",
      metadata: { provenance: prov },
    };
    // Extract and validate
    const extracted = memoryBody.metadata.provenance;
    expect(validateProvenance(extracted)).toEqual({ ok: true });
  });
});
