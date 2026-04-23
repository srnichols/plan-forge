/**
 * Hash-bag embedding provider — deterministic, zero-dependency fallback.
 *
 * Produces a bag-of-words vector using FNV-1a hashing into a fixed-dimension
 * Float32Array, then L2-normalizes. Order-independent (bag semantics).
 *
 * Unicode / non-ASCII characters are stripped by the tokenizer regex.
 * This is acceptable for a lightweight fallback; the transformers provider
 * handles richer text.
 *
 * @module embedding/hash-bag
 */

export const DIM = 512;

/**
 * Tokenize text into lowercase alphanumeric tokens.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * FNV-1a 32-bit hash.
 * @param {string} str
 * @returns {number} Unsigned 32-bit integer.
 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embed text into a Float32Array of length {@link DIM}.
 * Always async for interface uniformity with other providers.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embed(text) {
  const v = new Float32Array(DIM);
  const tokens = tokenize(text);
  for (const tok of tokens) v[hash32(tok) % DIM] += 1;
  let sumSq = 0;
  for (let i = 0; i < DIM; i++) sumSq += v[i] * v[i];
  if (sumSq > 0) {
    const inv = 1 / Math.sqrt(sumSq);
    for (let i = 0; i < DIM; i++) v[i] *= inv;
  }
  return v;
}

/**
 * Create a provider object conforming to the embedding provider interface.
 * @returns {{ name: string, dim: number, embed: (text: string) => Promise<Float32Array> }}
 */
export function createHashBagProvider() {
  return { name: 'hash-bag', dim: DIM, embed };
}
