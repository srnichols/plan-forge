/**
 * hallmark.test.mjs — Conformance tests for the Hallmark provenance contract.
 *
 * Run with: node --test pforge-sdk/tests/hallmark.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HALLMARK_SCHEMA_VERSION,
  validateProvenance,
  buildProvenance,
  mergeProvenance,
} from '../src/hallmark.mjs';

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

test('HALLMARK_SCHEMA_VERSION equals "hallmark/v1"', () => {
  assert.equal(HALLMARK_SCHEMA_VERSION, 'hallmark/v1');
});

// ---------------------------------------------------------------------------
// validateProvenance — non-object inputs must not throw and must return ok:false
// ---------------------------------------------------------------------------

test('validateProvenance(undefined) returns { ok: false }', () => {
  const r = validateProvenance(undefined);
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0, 'errors array must be non-empty');
});

test('validateProvenance(null) returns { ok: false }', () => {
  const r = validateProvenance(null);
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

test('validateProvenance("string") returns { ok: false }', () => {
  const r = validateProvenance('string');
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

test('validateProvenance([]) returns { ok: false }', () => {
  const r = validateProvenance([]);
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

// ---------------------------------------------------------------------------
// validateProvenance — minimal valid envelope
// ---------------------------------------------------------------------------

test('validateProvenance — minimal valid envelope passes', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_hotspot',
    capturedAt: '2026-05-16T07:28:45Z',
  });
  assert.deepEqual(r, { ok: true });
});

// ---------------------------------------------------------------------------
// validateProvenance — fully populated envelope (all optional fields)
// ---------------------------------------------------------------------------

test('validateProvenance — fully populated envelope passes', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    sourceFile: 'src/index.mjs',
    byteRange: [0, 100],
    contentHash: 'sha256:' + 'a'.repeat(64),
    codeHash: 'sha256:' + 'b'.repeat(64),
    toolVersion: '0.2.0',
  });
  assert.deepEqual(r, { ok: true });
});

// ---------------------------------------------------------------------------
// validateProvenance — required field: toolName
// ---------------------------------------------------------------------------

test('validateProvenance rejects missing toolName', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    capturedAt: '2026-05-16T07:28:45Z',
  });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.toLowerCase().includes('toolname')),
    `expected an error mentioning toolName, got: ${JSON.stringify(r.errors)}`,
  );
});

// ---------------------------------------------------------------------------
// validateProvenance — schemaVersion must be exactly "hallmark/v1"
// ---------------------------------------------------------------------------

test('validateProvenance rejects schemaVersion "hallmark/v2"', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v2',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
  });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// validateProvenance — byteRange must satisfy start <= end
// ---------------------------------------------------------------------------

test('validateProvenance rejects byteRange [10, 5] (start > end)', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    byteRange: [10, 5],
  });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.toLowerCase().includes('byterange')),
    `expected an error mentioning byteRange, got: ${JSON.stringify(r.errors)}`,
  );
});

test('validateProvenance accepts byteRange [5, 10]', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    byteRange: [5, 10],
  });
  assert.deepEqual(r, { ok: true });
});

test('validateProvenance accepts byteRange [0, 0] (zero-length slice)', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    byteRange: [0, 0],
  });
  assert.deepEqual(r, { ok: true });
});

// ---------------------------------------------------------------------------
// validateProvenance — contentHash must be sha256:<64 hex chars>
// ---------------------------------------------------------------------------

test('validateProvenance rejects contentHash "md5:abcd"', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    contentHash: 'md5:abcd',
  });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(e => e.toLowerCase().includes('contenthash')),
    `expected an error mentioning contentHash, got: ${JSON.stringify(r.errors)}`,
  );
});

test('validateProvenance accepts valid contentHash', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    contentHash: 'sha256:' + 'c'.repeat(64),
  });
  assert.deepEqual(r, { ok: true });
});

// ---------------------------------------------------------------------------
// validateProvenance — codeHash must be sha256:<64 hex chars>
// ---------------------------------------------------------------------------

test('validateProvenance rejects invalid codeHash', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    codeHash: 'sha1:abc',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('codehash')));
});

// ---------------------------------------------------------------------------
// validateProvenance — additionalProperties: false
// ---------------------------------------------------------------------------

test('validateProvenance rejects extra unknown keys', () => {
  const r = validateProvenance({
    schemaVersion: 'hallmark/v1',
    toolName: 'forge_sweep',
    capturedAt: '2026-05-16T07:28:45Z',
    foo: 1,
  });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// validateProvenance — purity: calling it multiple times with identical input
// produces identical output (no side effects, no statefulness)
// ---------------------------------------------------------------------------

test('validateProvenance is referentially stable (pure)', () => {
  const input = { schemaVersion: 'hallmark/v1', toolName: 'x', capturedAt: '2026-05-16T07:28:45Z' };
  const r1 = validateProvenance(input);
  const r2 = validateProvenance(input);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1, { ok: true });
});

// ---------------------------------------------------------------------------
// buildProvenance
// ---------------------------------------------------------------------------

test('buildProvenance fills schemaVersion and capturedAt', () => {
  const before = Date.now();
  const prov = buildProvenance({ toolName: 'forge_sweep' });
  const after = Date.now();

  assert.equal(prov.schemaVersion, 'hallmark/v1', 'schemaVersion must equal "hallmark/v1"');
  assert.equal(prov.toolName, 'forge_sweep');

  assert.ok(typeof prov.capturedAt === 'string', 'capturedAt must be a string');
  assert.ok(prov.capturedAt.endsWith('Z'), 'capturedAt must end with Z (UTC)');

  const capturedMs = new Date(prov.capturedAt).getTime();
  assert.ok(
    capturedMs >= before - 1000 && capturedMs <= after + 1000,
    `capturedAt ${prov.capturedAt} should be within 1s of now (${new Date(before).toISOString()})`,
  );
});

test('buildProvenance result passes validateProvenance', () => {
  const prov = buildProvenance({ toolName: 'forge_sweep' });
  const r = validateProvenance(prov);
  assert.deepEqual(r, { ok: true });
});

// ---------------------------------------------------------------------------
// mergeProvenance
// ---------------------------------------------------------------------------

test('mergeProvenance wraps provenance under "provenance" key', () => {
  const prov = buildProvenance({ toolName: 'forge_sweep' });
  const result = mergeProvenance({ topics: ['a'] }, prov);

  assert.deepEqual(result.topics, ['a'], 'original topics key must be preserved');
  assert.deepEqual(result.provenance, prov, 'provenance must appear under "provenance" key');
  assert.equal(Object.keys(result).length, 2, 'result must have exactly two keys: topics and provenance');
});

test('mergeProvenance does not mutate the input metadata', () => {
  const meta = { topics: ['a'] };
  const prov = buildProvenance({ toolName: 'forge_sweep' });
  mergeProvenance(meta, prov);

  assert.deepEqual(meta, { topics: ['a'] }, 'original metadata must not be mutated');
});
