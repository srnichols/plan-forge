import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  embed as hashEmbed,
  createHashBagProvider,
  DIM,
  tokenize,
} from '../embedding/hash-bag.mjs';
import {
  getProvider,
  embed,
  __resetProviderForTests,
} from '../embedding/provider.mjs';

beforeEach(() => {
  __resetProviderForTests();
});

describe('hash-bag provider', () => {
  it('1. determinism — same input produces identical vectors', async () => {
    const a = await hashEmbed('hello world');
    const b = await hashEmbed('hello world');
    expect(a).toEqual(b);
  });

  it('2. normalization — L2 norm ≈ 1.0 for non-empty input', async () => {
    const v = await hashEmbed('some text for normalization');
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
    expect(Math.abs(sumSq - 1.0)).toBeLessThan(1e-6);
  });

  it('3. empty input — returns zero vector with no NaN', async () => {
    const v = await hashEmbed('');
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(512);
    for (let i = 0; i < v.length; i++) {
      expect(v[i]).toBe(0);
      expect(Number.isNaN(v[i])).toBe(false);
    }
  });

  it('4. bag semantics — order-independent', async () => {
    const a = await hashEmbed('a b c');
    const b = await hashEmbed('c b a');
    expect(a).toEqual(b);
  });

  it('5. dimension contract — dim=512, Float32Array', async () => {
    const provider = createHashBagProvider();
    expect(provider.dim).toBe(512);
    const v = await provider.embed('test');
    expect(v.length).toBe(512);
    expect(v).toBeInstanceOf(Float32Array);
  });
});

describe('provider resolver', () => {
  it('6. fallback when probe rejects', async () => {
    const provider = await getProvider({
      _probe: () => Promise.reject(new Error('ERR_MODULE_NOT_FOUND')),
    });
    expect(provider.name).toBe('hash-bag');
    expect(provider.dim).toBe(512);
  });

  it('7. selects transformers when probe resolves', async () => {
    const fakeProvider = { name: 'transformers-mini', dim: 384, embed: async () => new Float32Array(384) };
    // Mock the transformers-mini module so provider.mjs picks it up
    vi.doMock('../embedding/transformers-mini.mjs', () => ({
      createTransformersMiniProvider: () => fakeProvider,
      DIM: 384,
      name: 'transformers-mini',
    }));
    // Re-import provider to pick up the mock
    const { getProvider: gp, __resetProviderForTests: reset } = await import('../embedding/provider.mjs');
    reset();
    const provider = await gp({ _probe: async () => ({}) });
    expect(provider.name).toBe('transformers-mini');
    expect(provider.dim).toBe(384);
    vi.restoreAllMocks();
  });

  it('8. memoization — probe called only once', async () => {
    const probeSpy = vi.fn().mockRejectedValue(new Error('not found'));
    await getProvider({ _probe: probeSpy });
    await getProvider({ _probe: probeSpy });
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it('9. forceFallback override', async () => {
    const provider = await getProvider({
      forceFallback: true,
      _probe: async () => ({}), // would succeed
    });
    expect(provider.name).toBe('hash-bag');
  });

  it('10. top-level embed convenience', async () => {
    // With no @xenova/transformers, falls back to hash-bag
    const v = await embed('text');
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(512);
  });
});
