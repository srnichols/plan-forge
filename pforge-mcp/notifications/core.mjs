/**
 * Plan Forge — Notification Core
 *
 * Phase FORGE-SHOP-03 Slice 03.1
 *
 * Central notification router: subscribes to hub events, matches routes,
 * dispatches to adapters with rate limiting and digest coalescing.
 *
 * Architecture:
 *   - Config loaded from `.forge/notifications/config.json`
 *   - Route matcher supports event glob + severity filtering
 *   - Token-bucket rate limiter per adapter
 *   - Digest coalescer buffers bursts into single summary
 *   - Env-var templates (`${env:VAR}`) resolved at dispatch time
 *   - Meta-event cascade guard (notification-* events never re-route)
 */

import { randomUUID } from "node:crypto";
import { readForgeJson } from "../orchestrator.mjs";
import { validateAdapterShape } from "./adapter-contract.mjs";

// ─── Constants ────────────────────────────────────────────────────────
const SEND_TIMEOUT_MS = 5_000;

const SEVERITY_ORDINAL = Object.freeze({ low: 1, medium: 2, high: 3, blocker: 4 });

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  adapters: {},
  routes: [],
  rateLimit: { perMinute: 10, digestAfter: 5 },
});

// ─── Env-var resolution ───────────────────────────────────────────────

const ENV_TEMPLATE_RE = /\$\{env:([^}]+)\}/g;
const LITERAL_URL_RE = /^https?:\/\//i;

/**
 * Resolve `${env:VAR_NAME}` templates in a string.
 * @param {string} str
 * @returns {string|null}
 */
export function resolveEnvTemplate(str) {
  if (typeof str !== "string") return str;
  if (LITERAL_URL_RE.test(str) && !ENV_TEMPLATE_RE.test(str)) {
    const err = new Error("Config contains literal URL instead of env-var template. Use ${env:VAR_NAME} pattern.");
    err.code = "ERR_LITERAL_SECRET";
    throw err;
  }
  return str.replace(ENV_TEMPLATE_RE, (_, varName) => process.env[varName] ?? "");
}

/**
 * Resolve all string values in an adapter config object.
 * @param {Object} config
 * @returns {Object}
 */
function resolveAdapterConfig(config) {
  if (!config || typeof config !== "object") return config;
  const resolved = {};
  for (const [k, v] of Object.entries(config)) {
    resolved[k] = typeof v === "string" ? resolveEnvTemplate(v) : v;
  }
  return resolved;
}

// ─── Route matcher ────────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a RegExp.
 * Only supports `*` (match anything) at the end.
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Parse a severity filter expression like ">=high" or "=blocker".
 * @param {string} expr
 * @returns {{ op: string, level: number }|null}
 */
function parseSeverityFilter(expr) {
  if (!expr || typeof expr !== "string") return null;
  const match = expr.match(/^(>=|<=|>|<|=)?\s*(\w+)$/);
  if (!match) return null;
  const op = match[1] || "=";
  const level = SEVERITY_ORDINAL[match[2]];
  if (level === undefined) return null;
  return { op, level };
}

/**
 * Check whether an event severity passes a filter.
 * @param {string|undefined} eventSeverity
 * @param {{ op: string, level: number }} filter
 * @returns {boolean}
 */
function severityPasses(eventSeverity, filter) {
  const val = SEVERITY_ORDINAL[eventSeverity];
  if (val === undefined) return false;
  switch (filter.op) {
    case "=":  return val === filter.level;
    case ">=": return val >= filter.level;
    case ">":  return val >  filter.level;
    case "<=": return val <= filter.level;
    case "<":  return val <  filter.level;
    default:   return false;
  }
}

/**
 * Match event against configured routes.
 * @param {Object} event
 * @param {Array} routes
 * @returns {string[]} - Deduplicated array of adapter names to dispatch to
 */
export function matchRoutes(event, routes) {
  if (!Array.isArray(routes) || !event?.type) return [];
  const matched = new Set();
  for (const route of routes) {
    const when = route?.when;
    if (!when?.event) continue;

    // Event type glob match
    const re = globToRegex(when.event);
    if (!re.test(event.type)) continue;

    // Severity filter (optional)
    if (when.severity) {
      const filter = parseSeverityFilter(when.severity);
      if (filter) {
        const eventSev = event.data?.severity || event.severity;
        if (!severityPasses(eventSev, filter)) continue;
      }
    }

    // Matched — collect adapter names
    const via = Array.isArray(route.via) ? route.via : [route.via];
    for (const v of via) {
      if (typeof v === "string") matched.add(v);
    }
  }
  return [...matched];
}

// ─── Token-bucket rate limiter ────────────────────────────────────────

export class TokenBucket {
  /**
   * @param {{ perMinute?: number }} config
   * @param {() => number} [nowFn]
   */
  constructor(config = {}, nowFn = () => Date.now()) {
    this._perMinute = config.perMinute || 10;
    this._nowFn = nowFn;
    /** @type {Map<string, { tokens: number, lastRefill: number }>} */
    this._buckets = new Map();
  }

  /**
   * Try to consume a token for the given adapter.
   * @param {string} adapterName
   * @returns {{ ok: boolean, reason?: string }}
   */
  tryConsume(adapterName) {
    const now = this._nowFn();
    let bucket = this._buckets.get(adapterName);
    if (!bucket) {
      bucket = { tokens: this._perMinute, lastRefill: now };
      this._buckets.set(adapterName, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefill;
    if (elapsedMs >= 60_000) {
      bucket.tokens = this._perMinute;
      bucket.lastRefill = now;
    } else {
      const refill = (elapsedMs / 60_000) * this._perMinute;
      bucket.tokens = Math.min(this._perMinute, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, reason: "token-bucket" };
  }

  shutdown() {
    this._buckets.clear();
  }
}

// ─── Digest coalescer ─────────────────────────────────────────────────

export class DigestTracker {
  /**
   * @param {{ digestAfter?: number }} config
   * @param {(digest: Object) => void} onDigest - Callback when digest fires
   */
  constructor(config = {}, onDigest = () => {}) {
    this._digestAfter = config.digestAfter || 5;
    this._onDigest = onDigest;
    /** @type {Map<string, { count: number, firstEvent: Object, timer: any }>} */
    this._windows = new Map();
  }

  /**
   * Track an event for digest coalescing.
   * @param {string} routeKey - adapter:eventType combo
   * @param {Object} event
   * @returns {boolean} true if event should be sent individually, false if coalesced
   */
  track(routeKey, event) {
    let window = this._windows.get(routeKey);
    if (!window) {
      window = { count: 0, firstEvent: event, timer: null };
      this._windows.set(routeKey, window);

      // Start 60s window timer
      window.timer = setTimeout(() => {
        const w = this._windows.get(routeKey);
        if (w && w.count >= this._digestAfter) {
          this._onDigest({
            type: "notification-digested",
            routeKey,
            digestCount: w.count,
            firstEvent: w.firstEvent,
          });
        }
        this._windows.delete(routeKey);
      }, 60_000);
      if (window.timer?.unref) window.timer.unref();
    }

    window.count += 1;

    // Under threshold: send individually
    if (window.count <= this._digestAfter) return true;

    // Over threshold: coalesce (don't send individually)
    return false;
  }

  shutdown() {
    for (const [, w] of this._windows) {
      if (w.timer) clearTimeout(w.timer);
    }
    this._windows.clear();
  }
}

// ─── Config loader ────────────────────────────────────────────────────

/**
 * Load notification config from `.forge/notifications/config.json`.
 * @param {string} projectRoot
 * @returns {Object}
 */
export function loadNotificationsConfig(projectRoot) {
  const config = readForgeJson("notifications/config.json", null, projectRoot);
  if (!config) return { ...DEFAULT_CONFIG };
  return {
    enabled: !!config.enabled,
    adapters: config.adapters || {},
    routes: Array.isArray(config.routes) ? config.routes : [],
    rateLimit: {
      perMinute: config.rateLimit?.perMinute ?? 10,
      digestAfter: config.rateLimit?.digestAfter ?? 5,
    },
  };
}

// ─── Format message ───────────────────────────────────────────────────

/**
 * Generate a human-readable message from an event.
 * @param {Object} event
 * @returns {string}
 */
function formatMessage(event) {
  const type = event?.type || "unknown";
  const sev = event?.data?.severity || event?.severity || "";
  const sevTag = sev ? ` [${sev}]` : "";
  const msg = event?.data?.message || event?.message || "";
  return msg ? `${type}${sevTag}: ${msg}` : `${type}${sevTag}`;
}

// ─── Core factory ─────────────────────────────────────────────────────

/**
 * Create the notification core instance.
 *
 * @param {Object} options
 * @param {Object|null} options.hub           - Hub instance (for broadcasting meta-events)
 * @param {string}      options.projectRoot   - Project root directory
 * @param {Object}      [options.adapters]    - Map of adapter name → adapter object
 * @param {Function}    [options.captureMemoryFn] - L3 memory capture
 * @param {() => number} [options.nowFn]      - Injectable clock for testing
 * @returns {{ ingest: Function, directSend: Function, testAdapter: Function, getStats: Function, shutdown: Function }}
 */
export function createNotificationCore({ hub = null, projectRoot, adapters = {}, captureMemoryFn = null, nowFn = () => Date.now() } = {}) {
  const config = loadNotificationsConfig(projectRoot);

  // Disabled → return no-op core
  if (!config.enabled) {
    return {
      ingest: () => {},
      directSend: () => ({ ok: false, error: "Notifications disabled" }),
      testAdapter: () => ({ ok: true, adapters: [], note: "Notifications disabled" }),
      getStats: () => ({ sent: 0, failed: 0 }),
      shutdown: () => {},
    };
  }

  const rateLimiter = new TokenBucket(config.rateLimit, nowFn);
  const warnedNullUrls = new Set();
  let sentCount = 0;
  let failedCount = 0;

  const digestTracker = new DigestTracker(config.rateLimit, (digest) => {
    try {
      hub?.broadcast({
        type: "notification-digested",
        routeKey: digest.routeKey,
        digestCount: digest.digestCount,
        timestamp: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
  });

  /**
   * Dispatch a single event to a single adapter.
   */
  async function dispatchToAdapter(adapterName, event) {
    const adapter = adapters[adapterName];
    if (!adapter) return;

    const adapterConfig = config.adapters?.[adapterName] || {};
    if (adapterConfig.enabled === false) return;

    // Resolve env vars
    let resolvedConfig;
    try {
      resolvedConfig = resolveAdapterConfig(adapterConfig);
    } catch (err) {
      if (err.code === "ERR_LITERAL_SECRET") {
        try { hub?.broadcast({ type: "notification-send-failed", adapter: adapterName, event: event.type, errorCode: "ERR_LITERAL_SECRET", timestamp: new Date().toISOString() }); } catch { /* */ }
        failedCount++;
        return;
      }
      throw err;
    }

    // Null URL warning (once per session per adapter)
    if (resolvedConfig.url === "" || resolvedConfig.url === undefined || resolvedConfig.url === null) {
      if (!warnedNullUrls.has(adapterName)) {
        console.warn(`[notifications] ${adapterName} enabled but URL is null or empty`);
        warnedNullUrls.add(adapterName);
      }
      return;
    }

    // Rate limit check
    const allowed = rateLimiter.tryConsume(adapterName);
    if (!allowed.ok) {
      try { hub?.broadcast({ type: "notification-rate-limited", adapter: adapterName, event: event.type, reason: allowed.reason, timestamp: new Date().toISOString() }); } catch { /* */ }
      return;
    }

    // Digest coalescing
    const routeKey = `${adapterName}:${event.type}`;
    const sendIndividually = digestTracker.track(routeKey, event);
    if (!sendIndividually) return;

    const correlationId = event.correlationId || randomUUID();
    const formattedMessage = formatMessage(event);
    const t0 = nowFn();

    try {
      const result = await Promise.race([
        adapter.send({ event, route: adapterName, formattedMessage, correlationId, config: resolvedConfig }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), SEND_TIMEOUT_MS)),
      ]);

      const deliveryMs = nowFn() - t0;
      if (result?.ok) {
        sentCount++;
        try { hub?.broadcast({ type: "notification-sent", adapter: adapterName, event: event.type, correlationId, deliveryMs, timestamp: new Date().toISOString() }); } catch { /* */ }
      } else {
        failedCount++;
        try { hub?.broadcast({ type: "notification-send-failed", adapter: adapterName, event: event.type, errorCode: result?.errorCode || "SEND_FAILED", correlationId, deliveryMs, timestamp: new Date().toISOString() }); } catch { /* */ }
        try { captureMemoryFn?.(`Notification delivery failed: ${adapterName} → ${result?.errorCode || "SEND_FAILED"}`, "gotcha", `notification/${adapterName}`, projectRoot); } catch { /* */ }
      }
    } catch (err) {
      const deliveryMs = nowFn() - t0;
      const errorCode = err.message === "TIMEOUT" ? "TIMEOUT" : (err.code || "SEND_FAILED");
      failedCount++;
      try { hub?.broadcast({ type: "notification-send-failed", adapter: adapterName, event: event.type, errorCode, correlationId, deliveryMs, timestamp: new Date().toISOString() }); } catch { /* */ }
      try { captureMemoryFn?.(`Notification delivery failed: ${adapterName} → ${errorCode}`, "gotcha", `notification/${adapterName}`, projectRoot); } catch { /* */ }
    }
  }

  /**
   * Main entry point — ingests hub events, matches routes, dispatches.
   * @param {Object} event
   */
  function ingest(event) {
    // Meta-event cascade guard
    if (event?.type?.startsWith("notification-")) return;

    // NODE_ENV guard — no side-effects during tests
    if (process.env.NODE_ENV === "test") return;

    const matched = matchRoutes(event, config.routes);
    for (const adapterName of matched) {
      dispatchToAdapter(adapterName, event).catch(() => { /* best-effort */ });
    }
  }

  /**
   * Direct send — bypasses routing rules (for forge_notify_send tool).
   */
  async function directSend({ via, payload, formattedMessage }) {
    const adapter = adapters[via];
    if (!adapter) return { ok: false, error: "ERR_ADAPTER_NOT_FOUND", adapter: via };

    const adapterConfig = config.adapters?.[via] || {};
    let resolvedConfig;
    try {
      resolvedConfig = resolveAdapterConfig(adapterConfig);
    } catch (err) {
      return { ok: false, error: err.code || "ERR_CONFIG", message: err.message };
    }

    const correlationId = randomUUID();
    const message = formattedMessage || formatMessage(payload);
    const t0 = nowFn();

    try {
      const result = await Promise.race([
        adapter.send({ event: payload, route: via, formattedMessage: message, correlationId, config: resolvedConfig }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), SEND_TIMEOUT_MS)),
      ]);
      const deliveryMs = nowFn() - t0;
      return { ...result, adapter: via, deliveryMs };
    } catch (err) {
      const deliveryMs = nowFn() - t0;
      return { ok: false, adapter: via, errorCode: err.message === "TIMEOUT" ? "TIMEOUT" : "SEND_FAILED", error: err.message, deliveryMs };
    }
  }

  /**
   * Test adapter configuration (for forge_notify_test tool).
   */
  function testAdapter({ adapter: adapterName } = {}) {
    const names = adapterName ? [adapterName] : Object.keys(adapters);
    const results = [];
    for (const name of names) {
      const adptr = adapters[name];
      if (!adptr) {
        results.push({ name, configValid: false, reason: "adapter-not-registered" });
        continue;
      }
      const shape = validateAdapterShape(adptr);
      if (!shape.valid) {
        results.push({ name, configValid: false, reason: `missing: ${shape.missing.join(", ")}` });
        continue;
      }
      const adapterConfig = config.adapters?.[name] || {};
      let resolvedConfig;
      try {
        resolvedConfig = resolveAdapterConfig(adapterConfig);
      } catch (err) {
        results.push({ name, configValid: false, reason: err.code || err.message });
        continue;
      }
      const validation = adptr.validate(resolvedConfig);
      results.push({ name, configValid: validation.ok, reason: validation.reason || undefined });
    }
    return { ok: true, adapters: results };
  }

  function getStats() {
    return { sent: sentCount, failed: failedCount };
  }

  function shutdown() {
    rateLimiter.shutdown();
    digestTracker.shutdown();
  }

  return { ingest, directSend, testAdapter, getStats, shutdown };
}
