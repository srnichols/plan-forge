/**
 * hallmark.test.mjs — Conformance tests for the Hallmark provenance contract.
 *
 * Run with: npx vitest run pforge-sdk/tests/hallmark.test.mjs
 * (Also compatible with: node --test pforge-sdk/tests/hallmark.test.mjs)
 */

import { test } from 'vitest';
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

// ---------------------------------------------------------------------------
// validateProvenance — exact error lists (meta-bug #383)
// Every message, in the order the contract reports them, so that the validator can
// be split into per-field checks without changing what callers see.
// ---------------------------------------------------------------------------

const ERR = {
  SCHEMA: 'schemaVersion must be "hallmark/v1"',
  TOOL: 'toolName is required and must be a non-empty string',
  CAPTURED: 'capturedAt must be an ISO 8601 UTC date-time string ending in Z (e.g. 2026-05-16T07:28:45Z)',
  BYTE_RANGE: 'byteRange must be [start, endExclusive] with 0 <= start <= end (integers)',
  CONTENT_HASH: 'contentHash must match pattern sha256:<64 lowercase hex chars>',
  CODE_HASH: 'codeHash must match pattern sha256:<64 lowercase hex chars>',
  SOURCE_FILE: 'sourceFile must be a string',
  TOOL_VERSION: 'toolVersion must be a string',
  NOT_OBJECT: 'record must be a plain object',
};
const unknownProperty = (key) => `unknown property: "${key}" (additionalProperties is false)`;

const BASE = { schemaVersion: 'hallmark/v1', toolName: 'forge_sweep', capturedAt: '2026-05-16T07:28:45Z' };
const HASH = 'sha256:' + 'a'.repeat(64);
const withBase = (extra) => ({ ...BASE, ...extra });

const inheritedToolName = Object.create({ toolName: 'inherited' });
inheritedToolName.schemaVersion = 'hallmark/v1';
inheritedToolName.capturedAt = '2026-05-16T07:28:45Z';

const inheritedExtra = Object.assign(Object.create({ inheritedKey: 1 }), BASE);

const protoKey = JSON.parse('{"__proto__": 1}');

// [name, record, expected errors in order — empty when the record is valid]
const PROVENANCE_CASES = [
  ['an empty object reports only the three required fields', {}, [ERR.SCHEMA, ERR.TOOL, ERR.CAPTURED]],
  ['a Map is an object with none of the fields', new Map(), [ERR.SCHEMA, ERR.TOOL, ERR.CAPTURED]],
  ['an object with no prototype is read like any other', Object.create(null), [ERR.SCHEMA, ERR.TOOL, ERR.CAPTURED]],
  [
    'every field wrong at once, in contract order, unknown keys last in key order',
    {
      schemaVersion: 'v0', toolName: '', capturedAt: 'yesterday', byteRange: [2, 1], contentHash: 'x', codeHash: 'y',
      sourceFile: 1, toolVersion: 2, zzz: 1, aaa: 2,
    },
    [
      ERR.SCHEMA, ERR.TOOL, ERR.CAPTURED, ERR.BYTE_RANGE, ERR.CONTENT_HASH, ERR.CODE_HASH,
      ERR.SOURCE_FILE, ERR.TOOL_VERSION, unknownProperty('zzz'), unknownProperty('aaa'),
    ],
  ],
  ['a toolName that is not a string', withBase({ toolName: 5 }), [ERR.TOOL]],
  ['a missing schemaVersion', { toolName: 'x', capturedAt: BASE.capturedAt }, [ERR.SCHEMA]],
  ['fractional seconds are a valid capturedAt', withBase({ capturedAt: '2026-05-16T07:28:45.123Z' }), []],
  ['a capturedAt with an offset is rejected', withBase({ capturedAt: '2026-05-16T07:28:45+00:00' }), [ERR.CAPTURED]],
  ['a capturedAt without a zone is rejected', withBase({ capturedAt: '2026-05-16T07:28:45' }), [ERR.CAPTURED]],
  ['a capturedAt with a space for the T is rejected', withBase({ capturedAt: '2026-05-16 07:28:45Z' }), [ERR.CAPTURED]],
  ['a capturedAt with a bare dot is rejected', withBase({ capturedAt: '2026-05-16T07:28:45.Z' }), [ERR.CAPTURED]],
  ['a numeric capturedAt is rejected', withBase({ capturedAt: 20260516 }), [ERR.CAPTURED]],
  ['an undefined optional field counts as absent', withBase({ byteRange: undefined, contentHash: undefined, sourceFile: undefined }), []],
  ['a null byteRange is not absent', withBase({ byteRange: null }), [ERR.BYTE_RANGE]],
  ['an empty byteRange', withBase({ byteRange: [] }), [ERR.BYTE_RANGE]],
  ['a byteRange of one number', withBase({ byteRange: [1] }), [ERR.BYTE_RANGE]],
  ['a byteRange of three numbers', withBase({ byteRange: [1, 2, 3] }), [ERR.BYTE_RANGE]],
  ['a byteRange that is a string', withBase({ byteRange: 'ab' }), [ERR.BYTE_RANGE]],
  ['a byteRange that is an array-like object', withBase({ byteRange: { 0: 1, 1: 2, length: 2 } }), [ERR.BYTE_RANGE]],
  ['a fractional byteRange start', withBase({ byteRange: [1.5, 2] }), [ERR.BYTE_RANGE]],
  ['a negative byteRange start', withBase({ byteRange: [-1, 2] }), [ERR.BYTE_RANGE]],
  ['a negative byteRange end', withBase({ byteRange: [1, -2] }), [ERR.BYTE_RANGE]],
  ['a NaN byteRange start', withBase({ byteRange: [NaN, 1] }), [ERR.BYTE_RANGE]],
  ['a numeric string in byteRange', withBase({ byteRange: ['1', 2] }), [ERR.BYTE_RANGE]],
  ['a byteRange of equal numbers is valid', withBase({ byteRange: [2, 2] }), []],
  ['a byteRange up to the largest safe integer is valid', withBase({ byteRange: [0, Number.MAX_SAFE_INTEGER] }), []],
  ['a null contentHash is not absent', withBase({ contentHash: null }), [ERR.CONTENT_HASH]],
  ['a contentHash one hex digit short', withBase({ contentHash: 'sha256:' + 'a'.repeat(63) }), [ERR.CONTENT_HASH]],
  ['an upper-case codeHash', withBase({ codeHash: 'sha256:' + 'A'.repeat(64) }), [ERR.CODE_HASH]],
  ['both hashes wrong', withBase({ contentHash: 'md5:abcd', codeHash: 7 }), [ERR.CONTENT_HASH, ERR.CODE_HASH]],
  ['an empty sourceFile and toolVersion are strings', withBase({ sourceFile: '', toolVersion: '' }), []],
  ['a null sourceFile', withBase({ sourceFile: null }), [ERR.SOURCE_FILE]],
  ['a numeric toolVersion', withBase({ toolVersion: 1 }), [ERR.TOOL_VERSION]],
  ['an unknown key with an undefined value is still unknown', withBase({ extra: undefined }), [unknownProperty('extra')]],
  ['a nested provenance key is unknown', withBase({ provenance: {} }), [unknownProperty('provenance')]],
  ['an own __proto__ key is unknown', protoKey, [ERR.SCHEMA, ERR.TOOL, ERR.CAPTURED, unknownProperty('__proto__')]],
  ['an inherited toolName satisfies the required field', inheritedToolName, []],
  ['an inherited key is not an unknown property', inheritedExtra, []],
  ['a frozen record passes (nothing is written to it)', Object.freeze(withBase({ byteRange: [0, 1] })), []],
  ['a full envelope passes', withBase({ sourceFile: 'a.mjs', byteRange: [0, 100], contentHash: HASH, codeHash: HASH, toolVersion: '1' }), []],
];

for (const [name, record, errors] of PROVENANCE_CASES) {
  test(`validateProvenance exact result — ${name}`, () => {
    const expected = errors.length === 0 ? { ok: true } : { ok: false, errors };
    assert.deepStrictEqual(validateProvenance(record), expected);
  });
}

for (const input of [undefined, null, 'string', 42, true, []]) {
  test(`validateProvenance exact result — ${JSON.stringify(input)} is not a plain object`, () => {
    assert.deepStrictEqual(validateProvenance(input), { ok: false, errors: [ERR.NOT_OBJECT] });
  });
}
