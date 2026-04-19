/**
 * Plan Forge — Tempering: Bug Adapter Contract + Dispatcher (Phase TEMPER-06 Slice 06.2)
 *
 * Defines the adapter contract, validates extension adapters, and dispatches
 * bug operations to both the local JSONL adapter (always) and any configured
 * external adapter (GitHub, GitLab, Jira, etc.).
 *
 * Design contracts:
 *   - Local (JSONL) is canonical; external is advisory.
 *   - Never throws. Returns structured results.
 *   - Extension adapters loaded from `.forge/extensions/<provider>/tempering-bug-adapter.mjs`.
 *
 * @module tempering/bug-adapters/contract
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ─── Contract Definition ─────────────────────────────────────────────

/**
 * The 4-function contract every bug adapter must implement.
 * Each function is async, accepts (bug, config, opts), and returns { provider, ok, ... }.
 */
export const ADAPTER_CONTRACT = {
  registerBug: "async (bug, config, opts) => { provider, ok, ... }",
  updateBugStatus: "async (bug, config, opts) => { provider, ok, ... }",
  commentValidatedFix: "async (bug, config, opts) => { provider, ok, ... }",
  syncStatusFromProvider: "async (bugId, config, opts) => { provider, ok, ... }",
};

const CONTRACT_FN_NAMES = Object.keys(ADAPTER_CONTRACT);

// ─── Operation → function name mapping ───────────────────────────────

const OPERATION_MAP = {
  register: "registerBug",
  updateStatus: "updateBugStatus",
  commentValidatedFix: "commentValidatedFix",
  syncStatus: "syncStatusFromProvider",
};

// ─── Validator ───────────────────────────────────────────────────────

/**
 * Validate that an adapter module implements all required contract functions.
 *
 * @param {object} adapter - The adapter module
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAdapter(adapter) {
  const errors = [];

  if (!adapter || typeof adapter !== "object") {
    return { ok: false, errors: ["Adapter is null or not an object"] };
  }

  for (const fnName of CONTRACT_FN_NAMES) {
    if (typeof adapter[fnName] !== "function") {
      errors.push(`Missing or non-function: ${fnName}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Extension Loader ────────────────────────────────────────────────

/**
 * Load a community extension adapter from `.forge/extensions/<provider>/tempering-bug-adapter.mjs`.
 * Returns the adapter module or null if not found/invalid.
 *
 * @param {string} provider - Extension provider name
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @returns {Promise<object|null>}
 */
export async function loadExtensionAdapter(provider, { cwd } = {}) {
  try {
    const base = cwd || process.cwd();
    const adapterPath = resolve(base, ".forge", "extensions", provider, "tempering-bug-adapter.mjs");

    if (!existsSync(adapterPath)) {
      return null;
    }

    const adapterUrl = pathToFileURL(adapterPath).href;
    const adapter = await import(adapterUrl);

    const validation = validateAdapter(adapter);
    if (!validation.ok) {
      console.warn(`[tempering] Extension adapter "${provider}" failed validation: ${validation.errors.join(", ")}`);
      return null;
    }

    return adapter;
  } catch (err) {
    console.warn(`[tempering] Failed to load extension adapter "${provider}": ${err.message}`);
    return null;
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────

/**
 * Dispatch a bug operation to the appropriate adapters.
 *
 * Always invokes the JSONL fallback first (local is canonical).
 * Then, if configured, invokes the external adapter (GitHub, extension, etc.).
 *
 * @param {string} operation - One of: "register", "updateStatus", "commentValidatedFix", "syncStatus"
 * @param {object} bug - Bug record
 * @param {object} config - Forge config
 * @param {object} [opts] - { cwd, fetch, execSync, ... }
 * @returns {Promise<{ local: object, external: object|null }>}
 */
export async function dispatch(operation, bug, config, opts = {}) {
  const fnName = OPERATION_MAP[operation];
  if (!fnName) {
    return {
      local: { provider: "jsonl", ok: false, error: `UNKNOWN_OPERATION: ${operation}` },
      external: null,
    };
  }

  // 1. Always invoke local JSONL adapter
  let localResult;
  try {
    const jsonl = await import("./jsonl-fallback.mjs");
    localResult = await jsonl[fnName](bug, config, opts);
  } catch {
    localResult = { provider: "jsonl", ok: false, error: "JSONL_IMPORT_FAILED" };
  }

  // 2. Determine if external adapter is needed
  const integration = config?.bugRegistry?.integration;
  if (!integration || integration === "jsonl") {
    return { local: localResult, external: null };
  }

  // For register, require autoCreateIssues to be true
  if (operation === "register" && !config?.bugRegistry?.autoCreateIssues) {
    return { local: localResult, external: null };
  }

  // 3. Load external adapter
  let externalAdapter = null;

  if (integration === "github") {
    try {
      externalAdapter = await import("./github.mjs");
    } catch {
      return {
        local: localResult,
        external: { provider: "github", ok: false, error: "ADAPTER_IMPORT_FAILED" },
      };
    }
  } else {
    // Community extension
    externalAdapter = await loadExtensionAdapter(integration, { cwd: opts.cwd });
    if (!externalAdapter) {
      return {
        local: localResult,
        external: { provider: integration, ok: false, error: "EXTENSION_NOT_FOUND" },
      };
    }
  }

  // 4. Invoke external adapter (never throw)
  let externalResult;
  try {
    externalResult = await externalAdapter[fnName](bug, config, opts);
  } catch (err) {
    externalResult = { provider: integration, ok: false, error: `ADAPTER_ERROR: ${err.message}` };
  }

  return { local: localResult, external: externalResult };
}
