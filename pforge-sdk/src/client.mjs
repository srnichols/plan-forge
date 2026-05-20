/**
 * pforge-sdk/client — Typed REST client for the Plan Forge MCP server.
 *
 * Zero runtime dependencies. Uses the global `fetch` (Node ≥ 18).
 *
 * @example
 * import { PForgeClient } from 'pforge-sdk/client';
 *
 * const client = new PForgeClient();                  // → http://localhost:3100
 * const { version } = await client.version();
 * const result      = await client.tool('forge_run_plan', { plan: 'Phase-55-PLAN.md' });
 */

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3100';
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal fetch wrapper that throws a structured PForgeClientError on non-2xx.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
async function request(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const message = err.name === 'AbortError'
      ? `Request timed out after ${timeoutMs}ms: ${url}`
      : `Network error for ${url}: ${err.message}`;
    throw new PForgeClientError(message, 0, null);
  }
  clearTimeout(timer);

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new PForgeClientError(
      `HTTP ${response.status} from ${url}`,
      response.status,
      body,
    );
  }
  return body;
}

function buildJson(method, payload, extraHeaders = {}) {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class PForgeClientError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode  HTTP status (0 = network-level failure)
   * @param {unknown} body       Parsed response body (may be null)
   */
  constructor(message, statusCode, body) {
    super(message);
    this.name = 'PForgeClientError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Method-group builders (keep PForgeClient class surface narrow)
// ---------------------------------------------------------------------------

/**
 * @param {(path: string, init?: RequestInit) => Promise<unknown>} get
 * @param {(path: string, payload: unknown) => Promise<unknown>} post
 * @returns {RunsClient}
 */
function makeRunsClient(get, post) {
  return {
    /** @returns {Promise<unknown>} */
    list: () => get('/api/runs'),
    /** @returns {Promise<unknown>} */
    latest: () => get('/api/runs/latest'),
    /**
     * @param {number|string} runIdx
     * @returns {Promise<unknown>}
     */
    get: (runIdx) => get(`/api/runs/${runIdx}`),
    /**
     * @param {{ plan: string, mode?: string, quorum?: string }} opts
     * @returns {Promise<unknown>}
     */
    trigger: (opts) => post('/api/runs/trigger', opts),
    /** @returns {Promise<unknown>} */
    abort: () => post('/api/runs/abort', {}),
    /**
     * @param {number|string} runIdx
     * @param {number|string} sliceId
     * @returns {Promise<unknown>}
     */
    replay: (runIdx, sliceId) => get(`/api/replay/${runIdx}/${sliceId}`),
  };
}

/**
 * @param {(path: string, init?: RequestInit) => Promise<unknown>} get
 * @param {(path: string, payload: unknown) => Promise<unknown>} post
 * @returns {MemoryClient}
 */
function makeMemoryClient(get, post) {
  return {
    /** @returns {Promise<unknown>} */
    landing: () => get('/api/memory'),
    /** @returns {Promise<unknown>} */
    report: () => get('/api/memory/report'),
    /**
     * @param {{ q: string, limit?: number }} opts
     * @returns {Promise<unknown>}
     */
    search: (opts) => post('/api/memory/search', opts),
    /**
     * @param {{ content: string, tags?: string[] }} thought
     * @returns {Promise<unknown>}
     */
    capture: (thought) => post('/api/memory/capture', thought),
    /** @returns {Promise<unknown>} */
    drain: () => post('/api/memory/drain', {}),
    /** @returns {Promise<unknown>} */
    presets: () => get('/api/memory/presets'),
  };
}

/**
 * @param {(path: string, init?: RequestInit) => Promise<unknown>} get
 * @param {(path: string, payload: unknown) => Promise<unknown>} post
 * @returns {CrucibleClient}
 */
function makeCrucibleClient(get, post) {
  return {
    /** @returns {Promise<unknown>} */
    list: (status) => get(`/api/crucible/list${status ? `?status=${status}` : ''}`),
    /**
     * @param {{ idea: string }} opts
     * @returns {Promise<unknown>}
     */
    submit: (opts) => post('/api/crucible/submit', opts),
    /** @returns {Promise<unknown>} */
    preview: () => get('/api/crucible/preview'),
    /** @returns {Promise<unknown>} */
    finalize: (opts) => post('/api/crucible/finalize', opts ?? {}),
    /** @returns {Promise<unknown>} */
    abandon: () => post('/api/crucible/abandon', {}),
  };
}

/**
 * @param {(path: string, init?: RequestInit) => Promise<unknown>} get
 * @returns {LiveGuardClient}
 */
function makeLiveGuardClient(get, post) {
  return {
    /** @returns {Promise<unknown>} */
    drift: () => get('/api/drift'),
    /** @returns {Promise<unknown>} */
    driftHistory: () => get('/api/drift/history'),
    /** @returns {Promise<unknown>} */
    incidents: () => get('/api/incidents'),
    /**
     * @param {object} incident
     * @returns {Promise<unknown>}
     */
    captureIncident: (incident) => post('/api/incident', incident),
    /** @returns {Promise<unknown>} */
    healthTrend: () => get('/api/health-trend'),
    /** @returns {Promise<unknown>} */
    hotspots: () => get('/api/hotspots'),
    /** @returns {Promise<unknown>} */
    secretScan: () => get('/api/secret-scan'),
    /** @returns {Promise<unknown>} */
    runSecretScan: () => post('/api/secret-scan/run', {}),
  };
}

// ---------------------------------------------------------------------------
// PForgeClient
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PForgeClientOptions
 * @property {string} [baseUrl]    Base URL of the Plan Forge MCP server (default: http://localhost:3100)
 * @property {number} [timeoutMs]  Request timeout in milliseconds (default: 30000)
 * @property {string} [apiKey]     Optional bearer token sent as Authorization header
 */

export class PForgeClient {
  /**
   * @param {PForgeClientOptions} [opts]
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._headers = opts.apiKey
      ? { Authorization: `Bearer ${opts.apiKey}` }
      : {};

    // Bind method groups
    const _get = this._get.bind(this);
    const _post = this._post.bind(this);

    /** @type {ReturnType<typeof makeRunsClient>} */
    this.runs = makeRunsClient(_get, _post);
    /** @type {ReturnType<typeof makeMemoryClient>} */
    this.memory = makeMemoryClient(_get, _post);
    /** @type {ReturnType<typeof makeCrucibleClient>} */
    this.crucible = makeCrucibleClient(_get, _post);
    /** @type {ReturnType<typeof makeLiveGuardClient>} */
    this.liveguard = makeLiveGuardClient(_get, _post);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _get(path) {
    return request(
      `${this.baseUrl}${path}`,
      { method: 'GET', headers: { ...this._headers } },
      this.timeoutMs,
    );
  }

  _post(path, payload) {
    return request(
      `${this.baseUrl}${path}`,
      buildJson('POST', payload, { ...this._headers }),
      this.timeoutMs,
    );
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /** Server version string. @returns {Promise<{ version: string }>} */
  version() { return this._get('/api/version'); }

  /** Liveness + last error. @returns {Promise<unknown>} */
  status() { return this._get('/api/status'); }

  /** Full capability catalog. @returns {Promise<unknown>} */
  capabilities() { return this._get('/api/capabilities'); }

  /** Public discovery manifest. @returns {Promise<unknown>} */
  discover() { return this._get('/.well-known/plan-forge.json'); }

  // -------------------------------------------------------------------------
  // Plans & Workers
  // -------------------------------------------------------------------------

  /** Enumerate hardened plans. @returns {Promise<unknown>} */
  plans() { return this._get('/api/plans'); }

  /** Active worker processes. @returns {Promise<unknown>} */
  workers() { return this._get('/api/workers'); }

  // -------------------------------------------------------------------------
  // Cost
  // -------------------------------------------------------------------------

  /** Cost report. @returns {Promise<unknown>} */
  cost() { return this._get('/api/cost'); }

  // -------------------------------------------------------------------------
  // Search & Timeline
  // -------------------------------------------------------------------------

  /**
   * Cross-surface search.
   * @param {string|{ q: string, limit?: number }} query
   * @returns {Promise<unknown>}
   */
  search(query) {
    const q = typeof query === 'string' ? query : query.q;
    const limit = typeof query === 'object' && query.limit ? `&limit=${query.limit}` : '';
    return this._get(`/api/search?q=${encodeURIComponent(q)}${limit}`);
  }

  /**
   * Unified event timeline (cursor-paged).
   * @param {{ cursor?: string, limit?: number }} [opts]
   * @returns {Promise<unknown>}
   */
  timeline(opts = {}) {
    const params = new URLSearchParams();
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this._get(`/api/timeline${qs ? `?${qs}` : ''}`);
  }

  // -------------------------------------------------------------------------
  // Traces
  // -------------------------------------------------------------------------

  /** @returns {Promise<unknown>} */
  traces() { return this._get('/api/traces'); }

  /**
   * @param {string} runId
   * @returns {Promise<unknown>}
   */
  trace(runId) { return this._get(`/api/traces/${runId}`); }

  // -------------------------------------------------------------------------
  // Config & Secrets
  // -------------------------------------------------------------------------

  /** Read merged .forge.json config. @returns {Promise<unknown>} */
  config() { return this._get('/api/config'); }

  /** Read .forge/secrets.json keys (values masked). @returns {Promise<unknown>} */
  secrets() { return this._get('/api/secrets'); }

  // -------------------------------------------------------------------------
  // Generic MCP tool dispatcher
  // -------------------------------------------------------------------------

  /**
   * Invoke any Plan Forge MCP tool over REST.
   *
   * @example
   * const result = await client.tool('forge_run_plan', { plan: 'Phase-55-PLAN.md' });
   *
   * @param {string} toolName  The `forge_*` tool name (e.g. `forge_run_plan`)
   * @param {object} [input]   Tool input matching the tool's `inputSchema`
   * @returns {Promise<unknown>}
   */
  tool(toolName, input = {}) {
    if (!toolName || typeof toolName !== 'string') {
      return Promise.reject(new PForgeClientError('toolName must be a non-empty string', 0, null));
    }
    return this._post(`/api/tool/${encodeURIComponent(toolName)}`, input);
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a PForgeClient with the given options.
 * Convenience alternative to `new PForgeClient(opts)`.
 *
 * @param {PForgeClientOptions} [opts]
 * @returns {PForgeClient}
 */
export function createClient(opts) {
  return new PForgeClient(opts);
}
