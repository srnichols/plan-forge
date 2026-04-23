/**
 * Embedding provider resolver — auto-detects @xenova/transformers and
 * falls back to hash-bag if the package is absent.
 *
 * The resolved provider is **memoized at the Promise level** so concurrent
 * first calls share a single probe rather than racing.
 *
 * @module embedding/provider
 */

import { createHashBagProvider } from './hash-bag.mjs';

let providerPromise = null;

/**
 * Resolve the best available embedding provider.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceFallback=false] Force hash-bag regardless of package availability.
 * @param {((specifier: string) => Promise<any>)|null} [opts._probe=null]
 *   Dependency-injection seam for tests. When provided, this function is
 *   called instead of dynamic `import()` to check package presence.
 * @returns {Promise<{ name: string, dim: number, embed: (text: string) => Promise<Float32Array> }>}
 */
export async function getProvider({ forceFallback = false, _probe = null } = {}) {
  if (providerPromise && !forceFallback) return providerPromise;
  providerPromise = (async () => {
    if (!forceFallback) {
      try {
        const probe = _probe ?? ((s) => import(s));
        await probe('@xenova/transformers');
        const mod = await import('./transformers-mini.mjs');
        return mod.createTransformersMiniProvider();
      } catch {
        // @xenova/transformers not installed — fall through to hash-bag
      }
    }
    return createHashBagProvider();
  })();
  return providerPromise;
}

/**
 * Convenience: embed text using the auto-resolved provider.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embed(text) {
  const p = await getProvider();
  return p.embed(text);
}

/** @internal Reset memoized provider for test isolation. */
export function __resetProviderForTests() { providerPromise = null; }
