/**
 * Embedding subsystem barrel export.
 * @module embedding
 */

export { getProvider, embed, __resetProviderForTests } from './provider.mjs';
export { DIM as HASH_BAG_DIM, createHashBagProvider } from './hash-bag.mjs';
export {
  addEntry, query, evictLRU, save, load, size,
  cosineSimilarity, MAX_ENTRIES, __resetCacheForTests,
} from './cache.mjs';
