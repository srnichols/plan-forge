/**
 * Plan Forge — Brain Facade (v1.0)
 *
 * Unified recall/remember/forget API routing to L1 (session), L2 (durable),
 * and L3 (semantic/OpenBrain) tiers. This is a **dumb router** — no caching,
 * no intelligence. Smarts live in agents and skills.
 *
 * Backwards-compatible: existing direct readers continue to work unchanged.
 * The facade wraps, does not replace.
 *
 * @module brain
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { startSpan, endSpan, addEvent, Severity } from "./telemetry.mjs";

// ─── Key Validation ──────────────────────────────────────────────────────────

const VALID_SCOPES = ["session", "project", "cross"];
const KEY_PATTERN = /^(session|project|cross)\.[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Typed error for invalid brain keys.
 */
export class BrainKeyError extends Error {
  constructor(key, reason) {
    super(`Invalid brain key "${key}": ${reason}`);
    this.name = "BrainKeyError";
    this.key = key;
    this.reason = reason;
  }
}

/**
 * Validate a dotted-path brain key.
 * @param {string} key
 * @returns {void}
 * @throws {BrainKeyError}
 */
export function validateKey(key) {
  if (!key || typeof key !== "string") {
    throw new BrainKeyError(String(key), "key must be a non-empty string");
  }
  if (key.includes("..")) {
    throw new BrainKeyError(key, "path traversal (..) is forbidden");
  }
  if (/\s/.test(key)) {
    throw new BrainKeyError(key, "spaces are not allowed in keys");
  }
  if (!KEY_PATTERN.test(key)) {
    const scope = key.split(".")[0];
    if (!VALID_SCOPES.includes(scope)) {
      throw new BrainKeyError(key, `unknown scope prefix "${scope}" — expected one of: ${VALID_SCOPES.join(", ")}`);
    }
    throw new BrainKeyError(key, "invalid key format — use dotted path like scope.entity.id");
  }
}

/**
 * Parse a key into its components.
 * @param {string} key
 * @returns {{ scope: string, segments: string[], entity: string, id: string|null }}
 */
function parseKey(key) {
  const parts = key.split(".");
  const scope = parts[0];
  const segments = parts.slice(1);
  const entity = segments[0] || null;
  const id = segments.length > 1 ? segments.slice(1).join(".") : null;
  return { scope, segments, entity, id };
}

// ─── Tier Routing ────────────────────────────────────────────────────────────

/**
 * Resolve which tiers to read/write for a given scope.
 * @param {string} scope
 * @param {{ fallback?: string }} opts
 * @returns {{ readTiers: string[], writeTier: string }}
 */
function resolveTier(scope, opts = {}) {
  const fallback = opts.fallback || "none";
  switch (scope) {
    case "session":
      return { readTiers: ["l1"], writeTier: "l1" };
    case "project":
      return {
        readTiers: fallback === "l3" ? ["l2", "l3"] : ["l2"],
        writeTier: "l2",
      };
    case "project-durable":
      return { readTiers: ["l2", "l3"], writeTier: "l2+l3" };
    case "cross":
    case "cross-project":
      return { readTiers: ["l3"], writeTier: "l3" };
    default:
      return { readTiers: ["l2"], writeTier: "l2" };
  }
}

// ─── L1 Backend (Session / In-Process) ───────────────────────────────────────

const l1Store = new Map(); // Map<runId, Map<key, { value, mtime }>>

function l1Recall(key, runId) {
  if (!runId) return null;
  const runMap = l1Store.get(runId);
  if (!runMap) return null;
  const entry = runMap.get(key);
  return entry ? entry.value : null;
}

function l1Remember(key, value, runId, cwd) {
  if (!runId) {
    throw new Error("Cannot write to L1 without an active runId");
  }
  if (!l1Store.has(runId)) l1Store.set(runId, new Map());
  l1Store.get(runId).set(key, { value, mtime: Date.now() });

  // Mirror to disk
  try {
    const mirrorDir = resolve(cwd, ".forge", "runs", runId);
    mkdirSync(mirrorDir, { recursive: true });
    const mirrorPath = resolve(mirrorDir, "brain-state.json");
    const tmpPath = mirrorPath + ".tmp." + randomUUID().slice(0, 8);
    const state = {};
    for (const [k, v] of l1Store.get(runId)) {
      state[k] = v;
    }
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, mirrorPath);
  } catch { /* mirror write failure is non-fatal */ }

  return { ok: true, tier: "l1", ref: `memory://l1/${runId}/${key}` };
}

function l1Forget(key, runId, cwd) {
  if (!runId) return { ok: true, removed: [] };
  const runMap = l1Store.get(runId);
  if (!runMap || !runMap.has(key)) return { ok: true, removed: [] };
  runMap.delete(key);

  // Update mirror
  try {
    const mirrorDir = resolve(cwd, ".forge", "runs", runId);
    const mirrorPath = resolve(mirrorDir, "brain-state.json");
    const tmpPath = mirrorPath + ".tmp." + randomUUID().slice(0, 8);
    const state = {};
    for (const [k, v] of runMap) {
      state[k] = v;
    }
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, mirrorPath);
  } catch { /* mirror update failure is non-fatal */ }

  return { ok: true, removed: ["l1"] };
}

// For testing: clear L1 store
export function _resetL1() {
  l1Store.clear();
}

// ─── L2 Backend (Durable / File-Based) ──────────────────────────────────────

/**
 * L2 routing table — maps key entity prefixes to existing reader functions.
 * The facade delegates to these readers; it does NOT re-implement file I/O.
 */
const L2_ROUTES = {
  bug: (deps, id) => deps.loadBug(deps.cwd, id),
  review: (deps, id) => {
    // Synthetic key: project.review.counts → aggregate counts from readReviewQueueState
    if (id === "counts" || id?.startsWith("counts.")) {
      if (deps.readReviewQueueState) return deps.readReviewQueueState(deps.cwd);
      return null;
    }
    return deps.readReviewItem(deps.cwd, id);
  },
  tempering: (deps, id) => {
    // project.tempering.perf-history → delegate to readPerfHistory
    if (id === "perf-history") {
      if (deps.readPerfHistory) return deps.readPerfHistory(deps.cwd);
      return null;
    }
    return deps.readTemperingState(deps.cwd);
  },
  run: (deps, id) => deps.findLatestRun(deps.cwd, id === "latest" ? null : id),
  "hub-events": (deps) => deps.readHubEvents(deps.cwd, {}),
  crucible: (deps) => {
    if (deps.readCrucibleState) return deps.readCrucibleState(deps.cwd);
    return null;
  },
  liveguard: (deps, id) => {
    // project.liveguard.drift → drift-history.jsonl
    // project.liveguard.incidents → incidents.jsonl
    // project.liveguard.fix-proposals → fix-proposals.jsonl
    // project.liveguard.state → all three combined
    if (deps.readForgeJsonl) {
      if (id === "drift") return deps.readForgeJsonl("drift-history.jsonl", [], deps.cwd);
      if (id === "incidents") return deps.readForgeJsonl("incidents.jsonl", [], deps.cwd);
      if (id === "fix-proposals") return deps.readForgeJsonl("fix-proposals.jsonl", [], deps.cwd);
      if (id === "state" || !id) {
        return {
          drift: deps.readForgeJsonl("drift-history.jsonl", [], deps.cwd),
          incidents: deps.readForgeJsonl("incidents.jsonl", [], deps.cwd),
          fixProposals: deps.readForgeJsonl("fix-proposals.jsonl", [], deps.cwd),
        };
      }
    }
    return null;
  },
};

function l2Recall(key, deps) {
  const { entity, id } = parseKey(key);
  const route = L2_ROUTES[entity];
  if (!route) return null;
  try {
    return route(deps, id);
  } catch {
    return null;
  }
}

function l2Remember(key, value, deps) {
  const { entity, id } = parseKey(key);
  try {
    const forgeDir = resolve(deps.cwd, ".forge");
    mkdirSync(forgeDir, { recursive: true });

    // Route writes to appropriate storage
    if (entity === "review" && id) {
      const reviewDir = resolve(forgeDir, "review-queue");
      mkdirSync(reviewDir, { recursive: true });
      const filePath = resolve(reviewDir, `${basename(id)}.json`);
      const tmpPath = filePath + ".tmp." + randomUUID().slice(0, 8);
      writeFileSync(tmpPath, JSON.stringify(value, null, 2));
      renameSync(tmpPath, filePath);
      return { ok: true, tier: "l2", ref: filePath };
    }

    // Generic L2 write — store under .forge/brain/<entity>/<id>.json
    const brainDir = resolve(forgeDir, "brain", entity || "_default");
    mkdirSync(brainDir, { recursive: true });
    const fileName = id ? `${basename(id)}.json` : "state.json";
    const filePath = resolve(brainDir, fileName);
    const tmpPath = filePath + ".tmp." + randomUUID().slice(0, 8);
    writeFileSync(tmpPath, JSON.stringify(value, null, 2));
    renameSync(tmpPath, filePath);
    return { ok: true, tier: "l2", ref: filePath };
  } catch (err) {
    return { ok: false, tier: "l2", error: err.message };
  }
}

function l2Forget(key, deps) {
  const { entity, id } = parseKey(key);
  try {
    const forgeDir = resolve(deps.cwd, ".forge");

    if (entity === "review" && id) {
      const filePath = resolve(forgeDir, "review-queue", `${basename(id)}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return { ok: true, removed: ["l2"] };
      }
      return { ok: true, removed: [] };
    }

    // Generic brain storage
    const fileName = id ? `${basename(id)}.json` : "state.json";
    const filePath = resolve(forgeDir, "brain", entity || "_default", fileName);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return { ok: true, removed: ["l2"] };
    }
    return { ok: true, removed: [] };
  } catch {
    return { ok: true, removed: [] };
  }
}

// ─── Phase-25 Slice 6: Cross-project memory federation (L4-lite) ────────────

/**
 * Validate a federation repo entry. Per Phase-25 D9:
 *   - Must be an absolute path (POSIX `/...` or Windows `X:\...`)
 *   - URLs (http / https / ssh / git) are rejected
 *   - Must not contain `..` segments (path traversal)
 */
export function validateFederationRepo(repo) {
  if (typeof repo !== "string" || repo.length === 0) {
    return { ok: false, reason: "repo must be a non-empty string" };
  }
  if (/^(https?|ssh|git|ftp):/i.test(repo)) {
    return { ok: false, reason: "URL-style repos are rejected (absolute local paths only per D9)" };
  }
  if (repo.includes("..")) {
    return { ok: false, reason: "path traversal ('..') is forbidden" };
  }
  const isPosixAbs = repo.startsWith("/");
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(repo);
  if (!isPosixAbs && !isWinAbs) {
    return { ok: false, reason: "repo path must be absolute" };
  }
  return { ok: true };
}

/**
 * Load `.forge.json → brain.federation` from `cwd`.
 * Schema: { enabled?: boolean, repos: string[] }
 * Default: { enabled: false, repos: [] }  (opt-in per project)
 */
export function loadFederationConfig(cwd = process.cwd()) {
  const configPath = resolve(cwd, ".forge.json");
  const defaults = { enabled: false, repos: [] };
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      const block = cfg?.brain?.federation;
      if (block && typeof block === "object") {
        const enabled = block.enabled === true;
        const repos = Array.isArray(block.repos) ? block.repos.filter((r) => typeof r === "string") : [];
        return { enabled, repos };
      }
    }
  } catch { /* fall through */ }
  return { ...defaults };
}

/**
 * Phase-25 MUST #10 — Read a brain key across federated projects.
 *
 * Iterates `brain.federation.repos[]` (absolute local paths only per D9) and
 * attempts to read `<repo>/.forge/brain/<entity>/<id>.json` for each entry
 * that passes validation. Returns an array of `{ repo, value }` hits, or `[]`
 * when federation is disabled, mis-configured, or no repo holds the key.
 * READ-ONLY — never writes to federated repos.
 */
export function federationRead(key, opts = {}) {
  validateKey(key);
  const { scope, entity, id } = parseKey(key);
  if (scope !== "cross" && scope !== "cross-project") return [];
  if (!entity) return [];

  const cwd = opts.cwd || process.cwd();
  const cfg = opts.config || loadFederationConfig(cwd);
  if (!cfg.enabled) return [];
  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) return [];

  const hits = [];
  for (const repo of cfg.repos) {
    const v = validateFederationRepo(repo);
    if (!v.ok) continue; // silently skip — config errors surfaced via validateFederationConfig()
    const fileName = id ? `${basename(id)}.json` : "state.json";
    const filePath = resolve(repo, ".forge", "brain", entity, fileName);
    const repoRoot = resolve(repo);
    if (!filePath.startsWith(repoRoot)) continue;
    if (!existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      hits.push({ repo, value: parsed });
    } catch { /* skip unreadable/malformed */ }
  }
  return hits;
}

/**
 * Report federation config issues without throwing. Returns an array of
 * { repo, reason } for each invalid entry; empty when the config is clean
 * or federation is disabled.
 */
export function validateFederationConfig(cwd = process.cwd()) {
  const cfg = loadFederationConfig(cwd);
  if (!cfg.enabled) return [];
  const errors = [];
  for (const repo of cfg.repos) {
    const v = validateFederationRepo(repo);
    if (!v.ok) errors.push({ repo, reason: v.reason });
  }
  return errors;
}

// ─── L3 Backend (Semantic / OpenBrain) ──────────────────────────────────────

async function l3Recall(key, deps) {
  if (!deps.searchMemory) return null;
  try {
    return await deps.searchMemory(key);
  } catch {
    return null;
  }
}

function l3Remember(key, value, opts, deps) {
  try {
    const record = {
      content: typeof value === "string" ? value : JSON.stringify(value),
      type: opts.type || "decision",
      source: opts.source || "brain.remember",
      project: opts.project || basename(deps.cwd),
      captured_at: new Date().toISOString(),
      key,
      _status: "pending",
      _attempts: 0,
      _enqueuedAt: new Date().toISOString(),
      _nextAttemptAt: new Date().toISOString(),
      _v: 1,
    };
    if (opts.tags) record.tags = opts.tags;
    if (opts.ttlMs) record.expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();

    deps.appendForgeJsonl("openbrain-queue.jsonl", record, deps.cwd);
    return { ok: true, tier: "l3", ref: `openbrain://queue/${key}`, queued: true };
  } catch {
    return { ok: true, tier: "l3", ref: `openbrain://queue/${key}`, queued: true };
  }
}

function l3Forget(key, deps) {
  try {
    const record = {
      _action: "delete",
      key,
      _status: "pending",
      _attempts: 0,
      _enqueuedAt: new Date().toISOString(),
      _nextAttemptAt: new Date().toISOString(),
      _v: 1,
    };
    deps.appendForgeJsonl("openbrain-queue.jsonl", record, deps.cwd);
    return { ok: true, removed: ["l3-queued"] };
  } catch {
    return { ok: true, removed: [] };
  }
}

// ─── Default Dependencies ────────────────────────────────────────────────────

function buildDefaultDeps(overrides = {}) {
  const defaults = {
    cwd: overrides.cwd || process.cwd(),
    loadBug: () => null,
    readReviewItem: () => null,
    readReviewQueueState: () => null,
    readTemperingState: () => null,
    readPerfHistory: null,
    findLatestRun: () => null,
    readHubEvents: () => [],
    readCrucibleState: null,
    readForgeJsonl: null,
    searchMemory: null,
    appendForgeJsonl: () => {},
  };
  return { ...defaults, ...overrides };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Recall a value from the brain.
 *
 * @param {string} key — dotted-path with scope prefix (e.g., "project.bug.BUG-001")
 * @param {object} [opts] — { scope?, freshnessMs?, fallback?, runId? }
 * @param {object} [deps] — DI overrides for testing
 * @returns {Promise<any|null>}
 */
export async function recall(key, opts = {}, deps = {}) {
  validateKey(key);
  const d = buildDefaultDeps(deps);
  const { scope } = parseKey(key);
  const effectiveScope = opts.scope || scope;
  const { readTiers } = resolveTier(effectiveScope, opts);

  const trace = d.trace || null;
  const t0 = Date.now();
  let span = null;
  if (trace) {
    span = startSpan(trace, "brain.recall", trace.spans[0]?.spanId || null, "INTERNAL", {
      key,
      "tier-attempted": readTiers.join(","),
    });
  }

  let result = null;
  let servedFrom = "miss";

  for (const tier of readTiers) {
    if (tier === "l1") {
      result = l1Recall(key, opts.runId);
    } else if (tier === "l2") {
      const l2Result = l2Recall(key, d);
      if (l2Result != null) {
        // Freshness check
        if (opts.freshnessMs && readTiers.includes("l3")) {
          // L2 hit but possibly stale — we can't check mtime on routed readers,
          // so freshnessMs only applies to L1-backed data with mtime tracking.
          // For L2 routed data, treat as always fresh unless explicitly stale.
          result = l2Result;
          servedFrom = "l2";
          break;
        }
        result = l2Result;
        servedFrom = "l2";
        break;
      }
    } else if (tier === "l3") {
      result = await l3Recall(key, d);
      if (result != null) {
        servedFrom = "l3";
      }
    }
  }

  // Phase-25 Slice 6 (MUST #10): for cross.* keys that still missed, attempt
  // a read-only fan-out across federated repos. Opt-in via .forge.json →
  // brain.federation.enabled; silent no-op when disabled. Returns the first
  // hit; ties broken by repo array order (deterministic).
  if (result == null && (effectiveScope === "cross" || effectiveScope === "cross-project")) {
    try {
      const hits = federationRead(key, { cwd: d.cwd });
      if (hits.length > 0) {
        result = hits[0].value;
        servedFrom = "federation";
      }
    } catch { /* federation read never fails the call */ }
  }

  if (span) {
    span.attributes["tier-served"] = servedFrom;
    span.attributes["cache-hit"] = false;
    span.attributes.durationMs = Date.now() - t0;
    endSpan(span, result != null ? "OK" : "UNSET");
  }

  return result;
}

/**
 * Store a value in the brain.
 *
 * @param {string} key
 * @param {any} value
 * @param {object} [opts] — { scope?, tags?, ttlMs?, runId?, type?, source?, project? }
 * @param {object} [deps] — DI overrides
 * @returns {{ ok: boolean, tier: string, ref: string, queued?: boolean }}
 */
export function remember(key, value, opts = {}, deps = {}) {
  validateKey(key);
  if (value === undefined) {
    throw new BrainKeyError(key, "value must not be undefined (use null for explicit clear)");
  }
  const d = buildDefaultDeps(deps);
  const { scope } = parseKey(key);
  const effectiveScope = opts.scope || scope;
  const { writeTier } = resolveTier(effectiveScope, opts);

  const trace = d.trace || null;
  const t0 = Date.now();
  let span = null;
  if (trace) {
    span = startSpan(trace, "brain.remember", trace.spans[0]?.spanId || null, "INTERNAL", {
      key,
      "tier-attempted": writeTier,
    });
  }

  let result;

  if (writeTier === "l1") {
    result = l1Remember(key, value, opts.runId, d.cwd);
  } else if (writeTier === "l2") {
    result = l2Remember(key, value, d);
  } else if (writeTier === "l3") {
    result = l3Remember(key, value, opts, d);
  } else if (writeTier === "l2+l3") {
    // Dual-write: L2 first (synchronous), then queue L3 (async, never blocks)
    const l2Result = l2Remember(key, value, d);
    let l3Queued = false;
    try {
      l3Remember(key, value, opts, d);
      l3Queued = true;
    } catch { /* L3 queue failure is non-fatal */ }

    if (span && l3Queued) {
      addEvent(span, "brain.l3.dual_write_queued", Severity.WARN, { key });
    }
    result = { ...l2Result, queued: l3Queued };
  } else {
    result = { ok: false, tier: writeTier, ref: null };
  }

  if (span) {
    span.attributes["tier-served"] = result.tier || writeTier;
    span.attributes.durationMs = Date.now() - t0;
    endSpan(span, result.ok ? "OK" : "ERROR");
  }

  return result;
}

/**
 * Remove a value from the brain.
 *
 * @param {string} key
 * @param {object} [opts] — { scope?, runId? }
 * @param {object} [deps] — DI overrides
 * @returns {{ ok: boolean, removed: string[] }}
 */
export function forget(key, opts = {}, deps = {}) {
  validateKey(key);
  const d = buildDefaultDeps(deps);
  const { scope } = parseKey(key);
  const effectiveScope = opts.scope || scope;
  const { readTiers, writeTier } = resolveTier(effectiveScope, opts);

  const trace = d.trace || null;
  const t0 = Date.now();
  let span = null;
  if (trace) {
    span = startSpan(trace, "brain.forget", trace.spans[0]?.spanId || null, "INTERNAL", {
      key,
    });
  }

  const allRemoved = [];

  if (writeTier === "l1" || readTiers.includes("l1")) {
    const r = l1Forget(key, opts.runId, d.cwd);
    allRemoved.push(...r.removed);
  }
  if (writeTier === "l2" || writeTier === "l2+l3" || readTiers.includes("l2")) {
    const r = l2Forget(key, d);
    allRemoved.push(...r.removed);
  }
  if (writeTier === "l3" || writeTier === "l2+l3" || readTiers.includes("l3")) {
    const r = l3Forget(key, d);
    allRemoved.push(...r.removed);
  }

  if (span) {
    span.attributes.removed = allRemoved.join(",");
    span.attributes.durationMs = Date.now() - t0;
    endSpan(span, "OK");
  }

  return { ok: true, removed: allRemoved };
}

/**
 * Introspection helper — describe what a key resolves to.
 *
 * @param {string} key
 * @returns {{ layout: { scope: string, segments: string[], entity: string|null, id: string|null }, examples: string[] }}
 */
export function describeKey(key) {
  validateKey(key);
  const parsed = parseKey(key);
  const examples = [];

  if (parsed.scope === "session") {
    examples.push("session.run.abc123.slice.1", "session.run.abc123.context");
  } else if (parsed.scope === "project") {
    examples.push("project.bug.BUG-001", "project.review.REV-001", "project.tempering.state", "project.run.latest");
  } else if (parsed.scope === "cross") {
    examples.push("cross.pattern.auth-flow", "cross.convention.naming");
  }

  return { layout: parsed, examples };
}
