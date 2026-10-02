#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function buildSnapshot(models) {
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

function stableSnapshot(snapshot) {
  return JSON.stringify({ ...snapshot, generatedAt: "<ignored>" }, null, 2);
}

async function loadCopilotModels() {
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

function readExistingSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

async function main() {
  const check = process.argv.includes("--check");
  let snapshot;
  try {
    snapshot = buildSnapshot(await loadCopilotModels());
  } catch (err) {
    if (check) {
      console.log(`[sync-copilot-pricing] skipped: Copilot SDK unavailable or unauthenticated (${err.message})`);
      return;
    }
    throw err;
  }

  if (check) {
    const existing = readExistingSnapshot();
    if (stableSnapshot(existing) !== stableSnapshot(snapshot)) {
      console.error("[sync-copilot-pricing] copilot-pricing.json is stale; run node scripts/sync-copilot-pricing.mjs");
      process.exit(1);
    }
    console.log(`[sync-copilot-pricing] OK — ${Object.keys(snapshot.models).length} priced models`);
    return;
  }

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[sync-copilot-pricing] wrote ${SNAPSHOT_PATH} (${Object.keys(snapshot.models).length} priced models)`);
}

main().catch((err) => {
  console.error(`[sync-copilot-pricing] failed: ${err.message}`);
  process.exit(1);
});
