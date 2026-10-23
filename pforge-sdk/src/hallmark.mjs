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

const isString = (value) => typeof value === 'string';
const isHash = (value) => isString(value) && HASH_RE.test(value);

// [start, endExclusive]: two integers, 0 <= start <= end
const isByteRange = (value) => Array.isArray(value)
  && value.length === 2
  && Number.isInteger(value[0])
  && Number.isInteger(value[1])
  && value[0] >= 0
  && value[1] >= 0
  && value[0] <= value[1];

// Each rule maps a record to the error messages it produced.
const required = (field, isValid, message) => (record) => (isValid(record[field]) ? [] : [message]);

const optional = (field, isValid, message) => (record) => {
  const value = record[field];
  return value === undefined || isValid(value) ? [] : [message];
};

// additionalProperties: false — reject unknown keys
function unknownProperties(record) {
  return Object.keys(record)
    .filter((key) => !ALLOWED_KEYS.has(key))
    .map((key) => `unknown property: "${key}" (additionalProperties is false)`);
}

// The order here is the order errors are reported in.
const PROVENANCE_RULES = [
  required('schemaVersion', (value) => value === HALLMARK_SCHEMA_VERSION, `schemaVersion must be "${HALLMARK_SCHEMA_VERSION}"`),
  required('toolName', (value) => isString(value) && value.length > 0, 'toolName is required and must be a non-empty string'),
  required(
    'capturedAt',
    (value) => isString(value) && ISO_UTC_RE.test(value),
    'capturedAt must be an ISO 8601 UTC date-time string ending in Z (e.g. 2026-05-16T07:28:45Z)',
  ),
  optional('byteRange', isByteRange, 'byteRange must be [start, endExclusive] with 0 <= start <= end (integers)'),
  optional('contentHash', isHash, 'contentHash must match pattern sha256:<64 lowercase hex chars>'),
  optional('codeHash', isHash, 'codeHash must match pattern sha256:<64 lowercase hex chars>'),
  optional('sourceFile', isString, 'sourceFile must be a string'),
  optional('toolVersion', isString, 'toolVersion must be a string'),
  unknownProperties,
];

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

  const errors = PROVENANCE_RULES.flatMap((rule) => rule(record));
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
