/**
 * hallmark.mjs — Hallmark provenance: schema version constant, validator, builder, merger.
 *
 * All functions are pure and dependency-free; validation mirrors
 * schemas/hallmark-provenance.v1.json without requiring a JSON-Schema library.
 */

/** Current schema version identifier — carried in every provenance envelope. */
export const HALLMARK_SCHEMA_VERSION = 'hallmark/v1';

// Allowed top-level property names (additionalProperties: false)
const ALLOWED_KEYS = new Set([
  'schemaVersion', 'toolName', 'capturedAt',
  'sourceFile', 'byteRange', 'contentHash', 'codeHash', 'toolVersion',
]);

// ISO 8601 UTC: YYYY-MM-DDTHH:MM:SS[.sss]Z  (Z suffix required — no offset variants)
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// Hash format: sha256:<64 lowercase hex chars>
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Validate a provenance record against the hallmark/v1 schema.
 * Pure — no I/O, no throws. Always returns a structured result.
 *
 * @param {unknown} record
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateProvenance(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['record must be a plain object'] };
  }

  const errors = [];

  // schemaVersion: must be exactly HALLMARK_SCHEMA_VERSION
  if (record.schemaVersion !== HALLMARK_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be "${HALLMARK_SCHEMA_VERSION}"`);
  }

  // toolName: required non-empty string
  if (typeof record.toolName !== 'string' || record.toolName.length === 0) {
    errors.push('toolName is required and must be a non-empty string');
  }

  // capturedAt: required ISO 8601 UTC string ending in Z
  if (typeof record.capturedAt !== 'string' || !ISO_UTC_RE.test(record.capturedAt)) {
    errors.push('capturedAt must be an ISO 8601 UTC date-time string ending in Z (e.g. 2026-05-16T07:28:45Z)');
  }

  // byteRange: optional [start, endExclusive] — two non-negative integers, start ≤ end
  if (record.byteRange !== undefined) {
    const br = record.byteRange;
    if (
      !Array.isArray(br) || br.length !== 2 ||
      !Number.isInteger(br[0]) || !Number.isInteger(br[1]) ||
      br[0] < 0 || br[1] < 0 || br[0] > br[1]
    ) {
      errors.push('byteRange must be [start, endExclusive] with 0 <= start <= end (integers)');
    }
  }

  // contentHash: optional sha256:<64 hex chars>
  if (record.contentHash !== undefined) {
    if (typeof record.contentHash !== 'string' || !HASH_RE.test(record.contentHash)) {
      errors.push('contentHash must match pattern sha256:<64 lowercase hex chars>');
    }
  }

  // codeHash: optional sha256:<64 hex chars>
  if (record.codeHash !== undefined) {
    if (typeof record.codeHash !== 'string' || !HASH_RE.test(record.codeHash)) {
      errors.push('codeHash must match pattern sha256:<64 lowercase hex chars>');
    }
  }

  // sourceFile: optional string
  if (record.sourceFile !== undefined && typeof record.sourceFile !== 'string') {
    errors.push('sourceFile must be a string');
  }

  // toolVersion: optional string
  if (record.toolVersion !== undefined && typeof record.toolVersion !== 'string') {
    errors.push('toolVersion must be a string');
  }

  // additionalProperties: false — reject unknown keys
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(`unknown property: "${key}" (additionalProperties is false)`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Build a new provenance record, filling schemaVersion and capturedAt automatically.
 * The caller supplies toolName and any optional fields; schemaVersion / capturedAt
 * are always set by this function and cannot be overridden by the caller.
 *
 * @param {{ toolName: string, sourceFile?: string, byteRange?: [number,number], contentHash?: string, codeHash?: string, toolVersion?: string }} options
 * @returns {object}
 */
export function buildProvenance(options = {}) {
  const { schemaVersion: _sv, capturedAt: _ca, ...rest } = options;
  return {
    ...rest,
    schemaVersion: HALLMARK_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Additively merge provenance into an existing metadata object by attaching it
 * under the "provenance" key. Does not mutate the input; does not clobber other keys.
 *
 * @param {object} existingMetadata  — the metadata object to enrich
 * @param {object} provenance        — a provenance record from buildProvenance()
 * @returns {object}
 */
export function mergeProvenance(existingMetadata, provenance) {
  return { ...existingMetadata, provenance };
}
