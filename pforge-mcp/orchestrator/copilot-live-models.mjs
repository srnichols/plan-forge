/**
 * Plan Forge — live GitHub Copilot model discovery.
 *
 * The weekly `copilot-pricing.json` snapshot says which models Copilot serves
 * in general; the signed-in user's own list (plan, org policy, region) can
 * differ, and new models appear between snapshot refreshes. At run start the
 * orchestrator asks the Copilot runtime for that list (`client.listModels()`),
 * caches it for a few hours, and applies it over the snapshot.
 *
 * Discovery never blocks a run: any failure returns the stale cache when one
 * exists, otherwise `source: "unavailable"`, and the snapshot stays in force.
 *
 * Cache: `.forge/copilot-models.json`. Disable: `PFORGE_LIVE_MODELS=0`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSdkClientInfo } from "./sdk-worker.mjs";
import { isUnavailableToUser } from "../copilot-models.mjs";
import { MS_PER_HOUR } from "../time-units.mjs";

const LIVE_MODELS_TTL_HOURS = 6;
export const LIVE_MODELS_TTL_MS = LIVE_MODELS_TTL_HOURS * MS_PER_HOUR;
const DEFAULT_TIMEOUT_MS = 20_000;
const CACHE_FILE = [".forge", "copilot-models.json"];
const ROUTER_MODEL_ID = "auto";

/**
 * Reduce an SDK ModelInfo to what routing needs. A model without a policy is
 * usable; only an explicit "disabled" policy makes it unavailable.
 *
 * @param {object} info
 * @returns {{ id: string, enabled: boolean, multiplier: number|null }|null}
 */
export function normalizeModelInfo(info) {
  if (typeof info?.id !== "string" || !info.id) return null;
  const multiplier = info.billing?.multiplier;
  return {
    id: info.id,
    enabled: info.policy?.state !== "disabled",
    multiplier: Number.isFinite(multiplier) ? multiplier : null,
  };
}

async function defaultListModels() {
  const { CopilotClient } = await import("@github/copilot-sdk");
  const client = new CopilotClient({ useLoggedInUser: true, clientInfo: buildSdkClientInfo() });
  try {
    await client.start();
    return await client.listModels();
  } finally {
    try { await client.stop(); } catch { /* best effort */ }
  }
}

function readCache(path) {
  try {
    if (!existsSync(path)) return null;
    const cache = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(cache?.models) || typeof cache.fetchedAt !== "string") return null;
    return cache;
  } catch {
    return null;
  }
}

function writeCache(path, cache) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2));
  } catch { /* a read-only .forge only costs the cache */ }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`listing Copilot models timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function listLiveModels(listModels, timeoutMs) {
  const infos = await withTimeout(Promise.resolve().then(listModels), timeoutMs);
  const models = (Array.isArray(infos) ? infos : [])
    .map(normalizeModelInfo)
    .filter((entry) => entry && entry.id !== ROUTER_MODEL_ID);
  if (models.length === 0) throw new Error("Copilot returned no models");
  return models;
}

/**
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {Function} [opts.listModels]  Injected for tests; defaults to the Copilot SDK.
 * @param {number} [opts.now]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ source: "live"|"cache"|"stale-cache"|"unavailable"|"disabled",
 *   models: { id: string, enabled: boolean, multiplier: number|null }[]|null,
 *   fetchedAt?: string, error?: string }>}
 */
export async function discoverCopilotModels({ cwd, listModels = defaultListModels, now = Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (process.env.PFORGE_LIVE_MODELS === "0") return { source: "disabled", models: null };
  const cachePath = resolve(cwd, ...CACHE_FILE);
  const cache = readCache(cachePath);
  if (cache && now - Date.parse(cache.fetchedAt) < LIVE_MODELS_TTL_MS) {
    return { source: "cache", models: cache.models, fetchedAt: cache.fetchedAt };
  }
  try {
    const models = await listLiveModels(listModels, timeoutMs);
    const fetchedAt = new Date(now).toISOString();
    writeCache(cachePath, { fetchedAt, models });
    return { source: "live", models, fetchedAt };
  } catch (err) {
    const error = String(err?.message || err);
    if (cache) return { source: "stale-cache", models: cache.models, fetchedAt: cache.fetchedAt, error };
    return { source: "unavailable", models: null, error };
  }
}

/**
 * Drop escalation-chain models the user cannot use. "auto" always stays, and a
 * chain that would lose every model is kept whole — an attempt that fails is
 * better than none.
 *
 * @param {string[]} chain
 * @returns {{ chain: string[], dropped: string[] }}
 */
export function availableEscalationChain(chain) {
  const dropped = chain.filter((model) => model !== ROUTER_MODEL_ID && isUnavailableToUser(model));
  if (dropped.length === 0) return { chain, dropped };
  const kept = chain.filter((model) => !dropped.includes(model));
  return kept.length > 0 ? { chain: kept, dropped } : { chain, dropped: [] };
}
