/**
 * hallmark.mjs — Hallmark provenance: schema version constant, validator, builder, merger.
 *
 * All functions are pure and dependency-free; validation mirrors
 * schemas/hallmark-provenance.v1.json without requiring a JSON-Schema library.
 */

/** Current schema version — must match the $id in hallmark-provenance.v1.json. */
export const HALLMARK_SCHEMA_VERSION = '1';

// ISO 8601 date-time: YYYY-MM-DDTHH:MM:SS[.sss](Z|±HH:MM)
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate a provenance record against the v1 schema.
 *
 * @param {object} record
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validateProvenance(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['record must be a plain object'] };
  }

  if (typeof record.schemaVersion !== 'string' || record.schemaVersion.length === 0) {
    errors.push('schemaVersion is required and must be a non-empty string');
  }

  if (typeof record.toolName !== 'string' || record.toolName.length === 0) {
    errors.push('toolName is required and must be a non-empty string');
  }

  if (typeof record.capturedAt !== 'string' || record.capturedAt.length === 0) {
    errors.push('capturedAt is required and must be a non-empty string');
  } else if (!ISO_DT_RE.test(record.capturedAt)) {
    errors.push('capturedAt must be an ISO 8601 date-time string (e.g. 2026-05-16T07:28:45Z)');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * Build a new provenance record with sensible defaults.
 *
 * @param {Partial<ProvenanceRecord>} options
 * @returns {ProvenanceRecord}
 */
export function buildProvenance(options = {}) {
  return {
    schemaVersion: HALLMARK_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    ...options,
  };
}

/**
 * Merge two provenance records — patch fields overwrite base fields.
 * Arrays and nested objects are replaced, not deep-merged.
 *
 * @param {object} base
 * @param {object} patch
 * @returns {object}
 */
export function mergeProvenance(base, patch) {
  return { ...base, ...patch };
}
