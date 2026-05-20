/**
 * adapter-contract.test.mjs — Unit tests for pforge-sdk/src/notifications/adapter-contract.mjs
 *
 * Run with: npx vitest run pforge-sdk/tests/adapter-contract.test.mjs
 */

import { describe, it, expect } from 'vitest';
import {
  ERR_NOT_IMPLEMENTED,
  validateAdapterShape,
} from '../src/notifications/adapter-contract.mjs';

// ─── ERR_NOT_IMPLEMENTED ──────────────────────────────────────────────────────

describe('ERR_NOT_IMPLEMENTED', () => {
  it('is a non-empty string', () => {
    expect(typeof ERR_NOT_IMPLEMENTED).toBe('string');
    expect(ERR_NOT_IMPLEMENTED.length).toBeGreaterThan(0);
  });

  it('equals "ERR_NOT_IMPLEMENTED"', () => {
    expect(ERR_NOT_IMPLEMENTED).toBe('ERR_NOT_IMPLEMENTED');
  });
});

// ─── validateAdapterShape — valid adapters ────────────────────────────────────

describe('validateAdapterShape — valid adapter', () => {
  const validAdapter = {
    name: 'webhook',
    send: async () => ({ ok: true }),
    validate: () => ({ ok: true }),
  };

  it('returns { valid: true, missing: [] } for a fully-conformant adapter', () => {
    const result = validateAdapterShape(validAdapter);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('accepts any function for send (async or sync)', () => {
    const syncAdapter = { ...validAdapter, send: () => ({ ok: true }) };
    expect(validateAdapterShape(syncAdapter).valid).toBe(true);
  });

  it('accepts any string name', () => {
    const namedAdapter = { ...validAdapter, name: 'slack-webhook' };
    expect(validateAdapterShape(namedAdapter).valid).toBe(true);
  });
});

// ─── validateAdapterShape — missing fields ────────────────────────────────────

describe('validateAdapterShape — missing fields', () => {
  it('reports missing "name" when name is absent', () => {
    const result = validateAdapterShape({ send: async () => {}, validate: () => {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('name');
  });

  it('reports missing "send" when send is absent', () => {
    const result = validateAdapterShape({ name: 'x', validate: () => {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('send');
  });

  it('reports missing "validate" when validate is absent', () => {
    const result = validateAdapterShape({ name: 'x', send: async () => {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('validate');
  });

  it('reports all three fields missing when adapter is an empty object', () => {
    const result = validateAdapterShape({});
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('name');
    expect(result.missing).toContain('send');
    expect(result.missing).toContain('validate');
    expect(result.missing).toHaveLength(3);
  });

  it('reports missing "name" when name is a number instead of a string', () => {
    const result = validateAdapterShape({ name: 42, send: async () => {}, validate: () => {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('name');
  });

  it('reports missing "send" when send is not a function', () => {
    const result = validateAdapterShape({ name: 'x', send: 'not-a-function', validate: () => {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('send');
  });

  it('reports missing "validate" when validate is not a function', () => {
    const result = validateAdapterShape({ name: 'x', send: async () => {}, validate: {} });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('validate');
  });
});

// ─── validateAdapterShape — null / non-object inputs ─────────────────────────

describe('validateAdapterShape — null / non-object input', () => {
  it('returns { valid: false } for null', () => {
    const result = validateAdapterShape(null);
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it('returns { valid: false } for undefined', () => {
    const result = validateAdapterShape(undefined);
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } for a string', () => {
    const result = validateAdapterShape('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } for a number', () => {
    const result = validateAdapterShape(42);
    expect(result.valid).toBe(false);
  });

  it('missing array contains "adapter object" sentinel for null input', () => {
    const result = validateAdapterShape(null);
    expect(result.missing).toContain('adapter object');
  });
});

// ─── validateAdapterShape — extra fields are allowed ─────────────────────────

describe('validateAdapterShape — extra fields', () => {
  it('valid adapter with extra properties still passes', () => {
    const adapter = {
      name: 'slack',
      send: async () => ({ ok: true }),
      validate: () => ({ ok: true }),
      description: 'Posts to Slack',
      version: '1.0.0',
    };
    expect(validateAdapterShape(adapter).valid).toBe(true);
  });
});
