/**
 * chunker.mjs — Chunk record contract, validator, and capability descriptor.
 *
 * All functions are pure and dependency-free. This file defines the shared
 * contract that both the pure-JS chunker (chunker-pureJs.mjs) and the
 * tree-sitter chunker (lattice-chunker-treesitter.mjs) must satisfy.
 */

/** Valid chunk kind values. */
export const CHUNK_KINDS = /** @type {const} */ (['file', 'module', 'class', 'function', 'method', 'block']);

// Hash format: sha256:<64 lowercase hex chars>
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Validate a chunk record against the CodeChunker contract.
 * Pure — no I/O, no throws. Always returns a structured result.
 *
 * Required fields: filePath, language, kind, name, startByte, endByte,
 *                  startLine, endLine, contentHash, declares, references
 *
 * @param {unknown} record
 * @returns {{ ok: true } | { ok: false, errors: Array<{ code: string, message: string }> }}
 */
export function validateChunk(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      ok: false,
      errors: [{ code: 'ERR_CHUNK_INVALID_RECORD', message: 'chunk record must be a plain object' }],
    };
  }

  const errors = [];

  // filePath: required non-empty string
  if (typeof record.filePath !== 'string' || record.filePath.length === 0) {
    errors.push({ code: 'ERR_CHUNK_MISSING_FILE_PATH', message: 'filePath is required and must be a non-empty string' });
  }

  // language: required non-empty string
  if (typeof record.language !== 'string' || record.language.length === 0) {
    errors.push({ code: 'ERR_CHUNK_MISSING_LANGUAGE', message: 'language is required and must be a non-empty string' });
  }

  // kind: required, must be one of CHUNK_KINDS
  if (!CHUNK_KINDS.includes(record.kind)) {
    errors.push({
      code: 'ERR_CHUNK_INVALID_KIND',
      message: `kind must be one of: ${CHUNK_KINDS.join(', ')}`,
    });
  }

  // name: required string (may be empty for file-kind chunks, but must be a string)
  if (typeof record.name !== 'string') {
    errors.push({ code: 'ERR_CHUNK_MISSING_NAME', message: 'name is required and must be a string' });
  }

  // startByte: required non-negative integer
  if (!Number.isInteger(record.startByte) || record.startByte < 0) {
    errors.push({ code: 'ERR_CHUNK_INVALID_START_BYTE', message: 'startByte must be a non-negative integer' });
  }

  // endByte: required non-negative integer, >= startByte
  if (!Number.isInteger(record.endByte) || record.endByte < 0) {
    errors.push({ code: 'ERR_CHUNK_INVALID_END_BYTE', message: 'endByte must be a non-negative integer' });
  } else if (Number.isInteger(record.startByte) && record.startByte >= 0 && record.endByte < record.startByte) {
    errors.push({ code: 'ERR_CHUNK_INVALID_BYTE_RANGE', message: 'endByte must be >= startByte' });
  }

  // startLine: required positive integer (1-indexed)
  if (!Number.isInteger(record.startLine) || record.startLine < 1) {
    errors.push({ code: 'ERR_CHUNK_INVALID_START_LINE', message: 'startLine must be a positive integer (1-indexed)' });
  }

  // endLine: required positive integer, >= startLine
  if (!Number.isInteger(record.endLine) || record.endLine < 1) {
    errors.push({ code: 'ERR_CHUNK_INVALID_END_LINE', message: 'endLine must be a positive integer (1-indexed)' });
  } else if (Number.isInteger(record.startLine) && record.startLine >= 1 && record.endLine < record.startLine) {
    errors.push({ code: 'ERR_CHUNK_INVALID_LINE_RANGE', message: 'endLine must be >= startLine' });
  }

  // contentHash: required, sha256:<64 lowercase hex chars>
  if (typeof record.contentHash !== 'string' || !HASH_RE.test(record.contentHash)) {
    errors.push({
      code: 'ERR_CHUNK_INVALID_CONTENT_HASH',
      message: 'contentHash must match pattern sha256:<64 lowercase hex chars>',
    });
  }

  // declares: required array of strings
  if (!Array.isArray(record.declares)) {
    errors.push({ code: 'ERR_CHUNK_INVALID_DECLARES', message: 'declares must be an array of strings' });
  } else if (record.declares.some((d) => typeof d !== 'string')) {
    errors.push({ code: 'ERR_CHUNK_INVALID_DECLARES', message: 'all entries in declares must be strings' });
  }

  // references: required array of strings
  if (!Array.isArray(record.references)) {
    errors.push({ code: 'ERR_CHUNK_INVALID_REFERENCES', message: 'references must be an array of strings' });
  } else if (record.references.some((r) => typeof r !== 'string')) {
    errors.push({ code: 'ERR_CHUNK_INVALID_REFERENCES', message: 'all entries in references must be strings' });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Return the capability descriptor for a chunker implementation.
 * Callers supply the impl's self-reported capability fields; this function
 * normalises missing fields to safe defaults.
 *
 * @param {{ languages?: string[], kinds?: string[], version?: string }} impl
 * @returns {{ languages: string[], kinds: string[], version: string }}
 */
export function chunkerCapability(impl) {
  return {
    languages: Array.isArray(impl.languages) ? impl.languages : [],
    kinds: Array.isArray(impl.kinds) ? impl.kinds : [],
    version: typeof impl.version === 'string' ? impl.version : '0.0.0',
  };
}
