#!/usr/bin/env node
/**
 * Copilot model and pricing drift check (#303).
 *
 *   node scripts/check-model-drift.mjs [--report <file.md>] [--within-days 30]
 *
 * Without waiting for a release, reports:
 *   - retiring    a model Plan Forge defaults to retires within N days, or has
 *                 already retired (pforge-mcp/model-retirements.json);
 *   - unavailable a Copilot-served default is missing from the live Copilot model list;
 *   - pricing     pforge-mcp/copilot-pricing.json differs from the live AI-credit prices
 *                 (models added, removed or repriced).
 * The live checks need Copilot access (COPILOT_GITHUB_TOKEN / GH_TOKEN, or a signed-in
 * gh). Without it they are skipped and reported as such; the retirement check still runs.
 *
 * Exit: 0 no drift, 1 drift found, 3 no drift found but the live checks were skipped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultedModels } from "../pforge-mcp/orchestrator/constants.mjs";
import { isDirectApiOnlyModel } from "../pforge-mcp/orchestrator/worker-spawn.mjs";
import { buildSnapshot, loadCopilotModels, readExistingSnapshot } from "./sync-copilot-pricing.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DAY_MS = 86_400_000;
const DEFAULT_WITHIN_DAYS = 30;
export const EXIT_CLEAN = 0;
export const EXIT_DRIFT = 1;
export const EXIT_LIVE_SKIPPED = 3;

/** Defaults that retire within `withinDays` of `now` (or already have), soonest first. */
export function retiringDefaults({ defaults, retirements, now = Date.now(), withinDays = DEFAULT_WITHIN_DAYS }) {
  return defaults
    .filter((model) => retirements[model])
    .map((model) => ({ model, retires: retirements[model], daysLeft: Math.ceil((Date.parse(retirements[model]) - now) / DAY_MS) }))
    .filter((r) => r.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Copilot-served defaults the live model list does not offer. */
export function unavailableDefaults({ defaults, liveIds, isDirectApiOnly = isDirectApiOnlyModel }) {
  const live = new Set(liveIds);
  return defaults.filter((model) => !isDirectApiOnly(model) && !live.has(model));
}

/** Models added, removed or repriced between two pricing snapshots' `models` maps. */
export function diffPricing(saved, fresh) {
  const keys = new Set([...Object.keys(saved), ...Object.keys(fresh)]);
  const out = { added: [], removed: [], changed: [] };
  for (const id of [...keys].sort()) {
    if (!(id in saved)) out.added.push(id);
    else if (!(id in fresh)) out.removed.push(id);
    else if (JSON.stringify(saved[id]) !== JSON.stringify(fresh[id])) out.changed.push(id);
  }
  return out;
}

function retiringLines(retiring) {
  return retiring.map((r) => `- \`${r.model}\` ${r.daysLeft < 0 ? `retired ${-r.daysLeft} day(s) ago` : `retires in ${r.daysLeft} day(s)`} (${r.retires})`);
}

function pricingLines(pricing) {
  const parts = [["Added", pricing.added], ["Removed", pricing.removed], ["Repriced", pricing.changed]]
    .filter(([, ids]) => ids.length)
    .map(([label, ids]) => `- ${label}: ${ids.map((id) => `\`${id}\``).join(", ")}`);
  return parts.length ? [...parts, "", "Refresh with `node scripts/sync-copilot-pricing.mjs` and commit `pforge-mcp/copilot-pricing.json`."] : [];
}

/** Markdown report; empty sections are omitted. */
export function renderReport({ retiring, unavailable, pricing, liveError, withinDays }) {
  const lines = ["## Copilot model and pricing drift", ""];
  if (retiring.length) lines.push(`### Defaults retiring within ${withinDays} days`, "", ...retiringLines(retiring), "", "Move these defaults in `pforge-mcp/orchestrator/constants.mjs` (and the restatements the model-defaults contract test pins).", "");
  if (unavailable.length) lines.push("### Defaults missing from the live Copilot model list", "", ...unavailable.map((m) => `- \`${m}\``), "");
  const priced = pricing ? pricingLines(pricing) : [];
  if (priced.length) lines.push("### AI-credit pricing changed", "", ...priced, "");
  if (liveError) lines.push("### Live checks skipped", "", `The Copilot model list was unavailable (${liveError}). Set a \`COPILOT_GITHUB_TOKEN\` secret with Copilot access so the weekly check can compare availability and pricing.`, "");
  if (lines.length === 2) lines.push("No drift: every default is available and not retiring soon, and the pricing snapshot is current.");
  return `${lines.join("\n").trimEnd()}\n`;
}

async function liveChecks(defaults) {
  try {
    const models = await loadCopilotModels();
    const fresh = buildSnapshot(models);
    return {
      unavailable: unavailableDefaults({ defaults, liveIds: models.map((m) => m.id) }),
      pricing: diffPricing(readExistingSnapshot().models, fresh.models),
      liveError: null,
    };
  } catch (err) {
    return { unavailable: [], pricing: null, liveError: err.message.split("\n")[0] };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const withinDays = Number(opt("--within-days") ?? DEFAULT_WITHIN_DAYS);
  const defaults = defaultedModels();
  const retirements = JSON.parse(readFileSync(join(REPO, "pforge-mcp", "model-retirements.json"), "utf8")).copilot;
  const retiring = retiringDefaults({ defaults, retirements, withinDays });
  const live = await liveChecks(defaults);
  const report = renderReport({ retiring, withinDays, ...live });
  if (opt("--report")) writeFileSync(opt("--report"), report);
  process.stdout.write(report);
  const pricingDrift = live.pricing && Object.values(live.pricing).some((ids) => ids.length);
  if (retiring.length || live.unavailable.length || pricingDrift) return EXIT_DRIFT;
  return live.liveError ? EXIT_LIVE_SKIPPED : EXIT_CLEAN;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`check-model-drift: ${err.message}`);
    process.exitCode = 2;
  });
}
