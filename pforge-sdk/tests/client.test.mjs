/**
 * client.test.mjs — Unit tests for pforge-sdk/client.
 *
 * All tests are pure unit tests — no real HTTP server required.
 * A lightweight `fetch` mock is installed via globalThis.fetch before each test.
 *
 * Run with: npx vitest run pforge-sdk/tests/client.test.mjs
 */

import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { PForgeClient, PForgeClientError, createClient } from '../src/client.mjs';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

/** Last request recorded by the mock. */
let lastRequest = null;

/**
 * Install a mock fetch that returns the given payload with the given status.
 *
 * @param {object|string} payload
 * @param {number} [status]
 */
function mockFetch(payload, status = 200) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url: String(url), method: init?.method ?? 'GET', init };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
    };
  };
}

/**
 * Install a mock fetch that simulates a network-level failure.
 * @param {string} [message]
 */
function mockFetchNetworkError(message = 'Network error') {
  globalThis.fetch = async () => { throw new Error(message); };
}

/**
 * Install a mock fetch that simulates a timeout (AbortError).
 */
function mockFetchTimeout() {
  globalThis.fetch = async (_url, init) => {
    // Trigger the AbortSignal immediately
    init?.signal?.dispatchEvent?.(new Event('abort'));
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
}

let savedFetch;
beforeEach(() => { savedFetch = globalThis.fetch; lastRequest = null; });
afterEach(() => { globalThis.fetch = savedFetch; });

// ---------------------------------------------------------------------------
// PForgeClientError
// ---------------------------------------------------------------------------

test('PForgeClientError is an Error subclass', () => {
  const err = new PForgeClientError('boom', 404, { detail: 'not found' });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof PForgeClientError);
  assert.equal(err.name, 'PForgeClientError');
  assert.equal(err.statusCode, 404);
  assert.deepEqual(err.body, { detail: 'not found' });
  assert.equal(err.message, 'boom');
});

// ---------------------------------------------------------------------------
// PForgeClient constructor
// ---------------------------------------------------------------------------

test('PForgeClient uses default baseUrl and timeoutMs', () => {
  const client = new PForgeClient();
  assert.equal(client.baseUrl, 'http://localhost:3100');
  assert.equal(client.timeoutMs, 30_000);
});

test('PForgeClient accepts custom baseUrl (trailing slash stripped)', () => {
  const client = new PForgeClient({ baseUrl: 'http://my-server:9000/' });
  assert.equal(client.baseUrl, 'http://my-server:9000');
});

test('PForgeClient accepts custom timeoutMs', () => {
  const client = new PForgeClient({ timeoutMs: 5_000 });
  assert.equal(client.timeoutMs, 5_000);
});

test('PForgeClient sets Authorization header when apiKey is provided', () => {
  const client = new PForgeClient({ apiKey: 'secret-token' });
  assert.deepEqual(client._headers, { Authorization: 'Bearer secret-token' });
});

test('PForgeClient has no Authorization header when apiKey is omitted', () => {
  const client = new PForgeClient();
  assert.deepEqual(client._headers, {});
});

// ---------------------------------------------------------------------------
// createClient factory
// ---------------------------------------------------------------------------

test('createClient returns a PForgeClient', () => {
  const client = createClient({ baseUrl: 'http://localhost:3100' });
  assert.ok(client instanceof PForgeClient);
});

test('createClient with no args uses defaults', () => {
  const client = createClient();
  assert.equal(client.baseUrl, 'http://localhost:3100');
});

// ---------------------------------------------------------------------------
// Method groups exposed
// ---------------------------------------------------------------------------

test('client has runs method group', () => {
  const client = new PForgeClient();
  assert.equal(typeof client.runs.list, 'function');
  assert.equal(typeof client.runs.latest, 'function');
  assert.equal(typeof client.runs.get, 'function');
  assert.equal(typeof client.runs.trigger, 'function');
  assert.equal(typeof client.runs.abort, 'function');
  assert.equal(typeof client.runs.replay, 'function');
});

test('client has memory method group', () => {
  const client = new PForgeClient();
  assert.equal(typeof client.memory.landing, 'function');
  assert.equal(typeof client.memory.report, 'function');
  assert.equal(typeof client.memory.search, 'function');
  assert.equal(typeof client.memory.capture, 'function');
  assert.equal(typeof client.memory.drain, 'function');
  assert.equal(typeof client.memory.presets, 'function');
});

test('client has crucible method group', () => {
  const client = new PForgeClient();
  assert.equal(typeof client.crucible.list, 'function');
  assert.equal(typeof client.crucible.submit, 'function');
  assert.equal(typeof client.crucible.preview, 'function');
  assert.equal(typeof client.crucible.finalize, 'function');
  assert.equal(typeof client.crucible.abandon, 'function');
});

test('client has liveguard method group', () => {
  const client = new PForgeClient();
  assert.equal(typeof client.liveguard.drift, 'function');
  assert.equal(typeof client.liveguard.driftHistory, 'function');
  assert.equal(typeof client.liveguard.incidents, 'function');
  assert.equal(typeof client.liveguard.healthTrend, 'function');
  assert.equal(typeof client.liveguard.hotspots, 'function');
});

// ---------------------------------------------------------------------------
// Discovery methods
// ---------------------------------------------------------------------------

test('client.version() calls GET /api/version', async () => {
  const client = new PForgeClient();
  mockFetch({ version: '3.10.3' });
  const result = await client.version();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/version');
  assert.equal(lastRequest.method, 'GET');
  assert.deepEqual(result, { version: '3.10.3' });
});

test('client.status() calls GET /api/status', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true });
  await client.status();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/status');
});

test('client.capabilities() calls GET /api/capabilities', async () => {
  const client = new PForgeClient();
  mockFetch({ tools: [] });
  await client.capabilities();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/capabilities');
});

test('client.discover() calls GET /.well-known/plan-forge.json', async () => {
  const client = new PForgeClient();
  mockFetch({ version: '3.10.3' });
  await client.discover();
  assert.equal(lastRequest.url, 'http://localhost:3100/.well-known/plan-forge.json');
});

// ---------------------------------------------------------------------------
// Runs method group
// ---------------------------------------------------------------------------

test('client.runs.list() calls GET /api/runs', async () => {
  const client = new PForgeClient();
  mockFetch([]);
  await client.runs.list();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/runs');
  assert.equal(lastRequest.method, 'GET');
});

test('client.runs.latest() calls GET /api/runs/latest', async () => {
  const client = new PForgeClient();
  mockFetch({});
  await client.runs.latest();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/runs/latest');
});

test('client.runs.get(3) calls GET /api/runs/3', async () => {
  const client = new PForgeClient();
  mockFetch({});
  await client.runs.get(3);
  assert.equal(lastRequest.url, 'http://localhost:3100/api/runs/3');
});

test('client.runs.trigger({ plan }) calls POST /api/runs/trigger', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true });
  await client.runs.trigger({ plan: 'Phase-55-PLAN.md' });
  assert.equal(lastRequest.url, 'http://localhost:3100/api/runs/trigger');
  assert.equal(lastRequest.method, 'POST');
});

test('client.runs.abort() calls POST /api/runs/abort', async () => {
  const client = new PForgeClient();
  mockFetch({ aborted: true });
  await client.runs.abort();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/runs/abort');
  assert.equal(lastRequest.method, 'POST');
});

test('client.runs.replay(1, "s2") calls GET /api/replay/1/s2', async () => {
  const client = new PForgeClient();
  mockFetch([]);
  await client.runs.replay(1, 's2');
  assert.equal(lastRequest.url, 'http://localhost:3100/api/replay/1/s2');
});

// ---------------------------------------------------------------------------
// Search & timeline
// ---------------------------------------------------------------------------

test('client.search(string) passes q as query parameter', async () => {
  const client = new PForgeClient();
  mockFetch({ hits: [] });
  await client.search('run-plan');
  assert.ok(lastRequest.url.includes('/api/search?q=run-plan'));
});

test('client.search({ q, limit }) includes limit param', async () => {
  const client = new PForgeClient();
  mockFetch({ hits: [] });
  await client.search({ q: 'drift', limit: 5 });
  assert.ok(lastRequest.url.includes('q=drift'));
  assert.ok(lastRequest.url.includes('limit=5'));
});

test('client.timeline({ cursor, limit }) builds query string', async () => {
  const client = new PForgeClient();
  mockFetch({ events: [] });
  await client.timeline({ cursor: 'abc123', limit: 20 });
  assert.ok(lastRequest.url.includes('cursor=abc123'));
  assert.ok(lastRequest.url.includes('limit=20'));
});

// ---------------------------------------------------------------------------
// Memory method group
// ---------------------------------------------------------------------------

test('client.memory.report() calls GET /api/memory/report', async () => {
  const client = new PForgeClient();
  mockFetch({});
  await client.memory.report();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/memory/report');
});

test('client.memory.search({ q }) calls POST /api/memory/search', async () => {
  const client = new PForgeClient();
  mockFetch({ hits: [] });
  await client.memory.search({ q: 'drift' });
  assert.equal(lastRequest.url, 'http://localhost:3100/api/memory/search');
  assert.equal(lastRequest.method, 'POST');
});

test('client.memory.capture(thought) calls POST /api/memory/capture', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true });
  await client.memory.capture({ content: 'recall this' });
  assert.equal(lastRequest.url, 'http://localhost:3100/api/memory/capture');
  assert.equal(lastRequest.method, 'POST');
});

// ---------------------------------------------------------------------------
// Generic tool dispatcher
// ---------------------------------------------------------------------------

test('client.tool(name, input) calls POST /api/tool/:name', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true, result: 'ran' });
  const result = await client.tool('forge_run_plan', { plan: 'Phase-55-PLAN.md' });
  assert.equal(lastRequest.url, 'http://localhost:3100/api/tool/forge_run_plan');
  assert.equal(lastRequest.method, 'POST');
  assert.deepEqual(result, { ok: true, result: 'ran' });
});

test('client.tool(name) with no input defaults to empty object body', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true });
  await client.tool('forge_status');
  assert.equal(lastRequest.url, 'http://localhost:3100/api/tool/forge_status');
});

test('client.tool() with empty toolName rejects with PForgeClientError', async () => {
  const client = new PForgeClient();
  await assert.rejects(
    () => client.tool(''),
    (err) => err instanceof PForgeClientError,
  );
});

test('client.tool() with non-string toolName rejects with PForgeClientError', async () => {
  const client = new PForgeClient();
  await assert.rejects(
    () => client.tool(42),
    (err) => err instanceof PForgeClientError,
  );
});

test('client.tool encodes special characters in tool name', async () => {
  const client = new PForgeClient();
  mockFetch({ ok: true });
  await client.tool('forge_run plan');
  assert.ok(lastRequest.url.includes('/api/tool/forge_run%20plan'));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('4xx response throws PForgeClientError with correct statusCode', async () => {
  const client = new PForgeClient();
  mockFetch({ error: 'not found' }, 404);
  await assert.rejects(
    () => client.version(),
    (err) => {
      assert.ok(err instanceof PForgeClientError, 'should be PForgeClientError');
      assert.equal(err.statusCode, 404);
      assert.deepEqual(err.body, { error: 'not found' });
      return true;
    },
  );
});

test('5xx response throws PForgeClientError with correct statusCode', async () => {
  const client = new PForgeClient();
  mockFetch({ error: 'internal server error' }, 500);
  await assert.rejects(
    () => client.tool('forge_run_plan'),
    (err) => {
      assert.ok(err instanceof PForgeClientError);
      assert.equal(err.statusCode, 500);
      return true;
    },
  );
});

test('network error throws PForgeClientError with statusCode 0', async () => {
  const client = new PForgeClient();
  mockFetchNetworkError('ECONNREFUSED');
  await assert.rejects(
    () => client.version(),
    (err) => {
      assert.ok(err instanceof PForgeClientError);
      assert.equal(err.statusCode, 0);
      assert.ok(err.message.includes('ECONNREFUSED'));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Response body parsing
// ---------------------------------------------------------------------------

test('plain-text response body is returned as string', async () => {
  const client = new PForgeClient();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'pong',
  });
  const result = await client.version();
  assert.equal(result, 'pong');
});

// ---------------------------------------------------------------------------
// baseUrl with trailing slash is normalised
// ---------------------------------------------------------------------------

test('baseUrl trailing slash does not double-slash the path', async () => {
  const client = new PForgeClient({ baseUrl: 'http://localhost:3100/' });
  mockFetch({ version: '3.10.3' });
  await client.version();
  assert.equal(lastRequest.url, 'http://localhost:3100/api/version');
});
