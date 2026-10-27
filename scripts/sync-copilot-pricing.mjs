#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const SNAPSHOT_PATH = resolve("pforge-mcp", "copilot-pricing.json");
const SOURCE = "copilot-sdk listModels billing.tokenPrices (cents per 1M tokens)";
const UNITS = "USD per token";

function dollarsPerToken(centsPerMillion, batchSize = 1_000_000) {
  if (typeof centsPerMillion !== "number" || !Number.isFinite(centsPerMillion)) return undefined;
  const divisor = typeof batchSize === "number" && batchSize > 0 ? batchSize : 1_000_000;
  return centsPerMillion / 100 / divisor;
}

function normalizePrices(tokenPrices) {
  if (!tokenPrices || typeof tokenPrices !== "object") return null;
  const batchSize = tokenPrices.batchSize || 1_000_000;
  const entry = {
    input: dollarsPerToken(tokenPrices.inputPrice, batchSize),
    output: dollarsPerToken(tokenPrices.outputPrice, batchSize),
    cacheRead: dollarsPerToken(tokenPrices.cacheReadPrice ?? tokenPrices.cachePrice, batchSize),
    cacheWrite: dollarsPerToken(tokenPrices.cacheWritePrice, batchSize),
    contextMax: tokenPrices.contextMax ?? tokenPrices.maxPromptTokens ?? null,
  };
  if (tokenPrices.longContext) {
    const longBatch = tokenPrices.longContext.batchSize || batchSize;
    entry.longContext = {
      input: dollarsPerToken(tokenPrices.longContext.inputPrice, longBatch),
      output: dollarsPerToken(tokenPrices.longContext.outputPrice, longBatch),
      cacheRead: dollarsPerToken(tokenPrices.longContext.cacheReadPrice ?? tokenPrices.longContext.cachePrice, longBatch),
      cacheWrite: dollarsPerToken(tokenPrices.longContext.cacheWritePrice, longBatch),
      contextMax: tokenPrices.longContext.contextMax ?? tokenPrices.longContext.maxPromptTokens ?? null,
    };
  }
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

export function buildSnapshot(models) {
  const priced = {};
  for (const model of models || []) {
    const entry = normalizePrices(model?.billing?.tokenPrices);
    if (entry) priced[model.id] = entry;
  }
  return {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    units: UNITS,
    models: Object.fromEntries(Object.entries(priced).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Whether a model's announced Copilot retirement has passed, as a predicate over model ids.
 * The retirement date is UTC midnight, as in pforge-mcp/copilot-models.mjs.
 *
 * @param {Record<string, string>} retirements - model id -> YYYY-MM-DD (pforge-mcp/model-retirements.json)
 * @param {number} [now]
 * @returns {(model: string) => boolean}
 */
export function retiredAsOf(retirements, now = Date.now()) {
  return (model) => {
    const date = Object.hasOwn(retirements ?? {}, model) ? retirements[model] : undefined;
    return typeof date === "string" && Date.parse(`${date}T00:00:00Z`) <= now;
  };
}

/**
 * The snapshot after a refresh from `models`. The list is the signed-in account's own, filtered
 * by its Copilot plan, so what it shows is evidence (prices, new models) and what it lacks is not:
 * a model it does not list may be plan-gated, not retired (#393). Every priced entry the list
 * shows is replaced by the live one; an entry it does not show stays unless the model's announced
 * retirement has passed.
 *
 * @param {{ models?: object }|null} existing - the snapshot on disk, null when there is none
 * @param {object[]} models - the account's listModels()
 * @param {{ isRetired?: (model: string) => boolean }} [options]
 */
export function mergeSnapshot(existing, models, { isRetired = () => false } = {}) {
  const fresh = buildSnapshot(models);
  const kept = Object.entries(existing?.models ?? {}).filter(([id]) => !Object.hasOwn(fresh.models, id) && !isRetired(id));
  return {
    ...fresh,
    models: Object.fromEntries([...kept, ...Object.entries(fresh.models)].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function stableSnapshot(snapshot) {
  return JSON.stringify({ ...snapshot, generatedAt: "<ignored>" }, null, 2);
}

export async function loadCopilotModels() {
  let sdkPath;
  try {
    sdkPath = require.resolve("@github/copilot-sdk", { paths: [resolve("pforge-mcp")] });
  } catch (err) {
    throw new Error(`@github/copilot-sdk not found from pforge-mcp: ${err.message}`);
  }
  const { CopilotClient } = await import(pathToFileURL(sdkPath).href);
  const client = new CopilotClient();
  await client.start?.();
  try {
    return await client.listModels();
  } finally {
    await client.stop?.();
  }
}

export function readExistingSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

function readRetirements() {
  return JSON.parse(readFileSync(resolve("pforge-mcp", "model-retirements.json"), "utf8")).copilot ?? {};
}

async function main() {
  const check = process.argv.includes("--check");
  let models;
  try {
    models = await loadCopilotModels();
  } catch (err) {
    if (check) {
      console.log(`[sync-copilot-pricing] skipped: Copilot SDK unavailable or unauthenticated (${err.message})`);
      return;
    }
    throw err;
  }

  let existing = null;
  try {
    existing = readExistingSnapshot();
  } catch {
    if (check) throw new Error(`no snapshot to check at ${SNAPSHOT_PATH}`);
  }
  const snapshot = mergeSnapshot(existing, models, { isRetired: retiredAsOf(readRetirements()) });
  const live = buildSnapshot(models).models;
  const kept = Object.keys(snapshot.models).filter((id) => !Object.hasOwn(live, id));
  const keptNote = kept.length ? `; kept ${kept.length} the account's list does not show and no retirement has dropped: ${kept.join(", ")}` : "";

  if (check) {
    if (stableSnapshot(existing) !== stableSnapshot(snapshot)) {
      console.error("[sync-copilot-pricing] copilot-pricing.json is stale; run node scripts/sync-copilot-pricing.mjs");
      process.exit(1);
    }
    console.log(`[sync-copilot-pricing] OK — ${Object.keys(snapshot.models).length} priced models${keptNote}`);
    return;
  }

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[sync-copilot-pricing] wrote ${SNAPSHOT_PATH} (${Object.keys(snapshot.models).length} priced models${keptNote})`);
}

// Importable by scripts/check-model-drift.mjs (#303); runs only when invoked directly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[sync-copilot-pricing] failed: ${err.message}`);
    process.exit(1);
  });
}
