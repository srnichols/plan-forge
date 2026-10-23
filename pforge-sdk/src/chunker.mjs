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

const chunkError = (code, message) => ({ code, message });
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1;

function requiredString(field, code) {
  return (record) => (isNonEmptyString(record[field])
    ? []
    : [chunkError(code, `${field} is required and must be a non-empty string`)]);
}

function checkKind({ kind }) {
  return CHUNK_KINDS.includes(kind)
    ? []
    : [chunkError('ERR_CHUNK_INVALID_KIND', `kind must be one of: ${CHUNK_KINDS.join(', ')}`)];
}

// name may be empty (file-kind chunks) but must be a string.
function checkName({ name }) {
  return typeof name === 'string'
    ? []
    : [chunkError('ERR_CHUNK_MISSING_NAME', 'name is required and must be a string')];
}

/**
 * A start/end pair: each must satisfy `isValid`, and when both do, end must not
 * come before start. A start that is itself invalid hides the range check.
 */
function rangeRule({ startKey, endKey, isValid, requirement, codes }) {
  return (record) => {
    const start = record[startKey];
    const end = record[endKey];
    const errors = [];
    if (!isValid(start)) errors.push(chunkError(codes.start, `${startKey} must be ${requirement}`));
    if (!isValid(end)) {
      errors.push(chunkError(codes.end, `${endKey} must be ${requirement}`));
    } else if (isValid(start) && end < start) {
      errors.push(chunkError(codes.range, `${endKey} must be >= ${startKey}`));
    }
    return errors;
  };
}

function checkContentHash({ contentHash }) {
  return typeof contentHash === 'string' && HASH_RE.test(contentHash)
    ? []
    : [chunkError('ERR_CHUNK_INVALID_CONTENT_HASH', 'contentHash must match pattern sha256:<64 lowercase hex chars>')];
}

function stringListRule(field, code) {
  return (record) => {
    const value = record[field];
    if (!Array.isArray(value)) return [chunkError(code, `${field} must be an array of strings`)];
    if (value.some((entry) => typeof entry !== 'string')) {
      return [chunkError(code, `all entries in ${field} must be strings`)];
    }
    return [];
  };
}

// The order here is the order errors are reported in.
const CHUNK_RULES = [
  requiredString('filePath', 'ERR_CHUNK_MISSING_FILE_PATH'),
  requiredString('language', 'ERR_CHUNK_MISSING_LANGUAGE'),
  checkKind,
  checkName,
  rangeRule({
    startKey: 'startByte',
    endKey: 'endByte',
    isValid: isNonNegativeInteger,
    requirement: 'a non-negative integer',
    codes: {
      start: 'ERR_CHUNK_INVALID_START_BYTE',
      end: 'ERR_CHUNK_INVALID_END_BYTE',
      range: 'ERR_CHUNK_INVALID_BYTE_RANGE',
    },
  }),
  rangeRule({
    startKey: 'startLine',
    endKey: 'endLine',
    isValid: isPositiveInteger,
    requirement: 'a positive integer (1-indexed)',
    codes: {
      start: 'ERR_CHUNK_INVALID_START_LINE',
      end: 'ERR_CHUNK_INVALID_END_LINE',
      range: 'ERR_CHUNK_INVALID_LINE_RANGE',
    },
  }),
  checkContentHash,
  stringListRule('declares', 'ERR_CHUNK_INVALID_DECLARES'),
  stringListRule('references', 'ERR_CHUNK_INVALID_REFERENCES'),
];

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
      errors: [chunkError('ERR_CHUNK_INVALID_RECORD', 'chunk record must be a plain object')],
    };
  }

  const errors = CHUNK_RULES.flatMap((rule) => rule(record));
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
