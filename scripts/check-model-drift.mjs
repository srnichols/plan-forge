#!/usr/bin/env node
/**
 * Copilot model and pricing drift check (#303).
 *
 *   node scripts/check-model-drift.mjs [--report <file.md>] [--within-days 30]
 *
 * Without waiting for a release, reports:
 *   - retiring    a model Plan Forge defaults to retires within N days, or has
 *                 already retired (pforge-mcp/model-retirements.json);
 *   - unavailable a Copilot-served default is missing from the live Copilot model list
 *                 and nobody has recorded why (scripts/model-availability.json);
 *   - pricing     pforge-mcp/copilot-pricing.json differs from the live AI-credit prices
 *                 (models added or repriced), or still prices a model whose retirement has passed.
 * The live list is the signed-in account's own, filtered by its Copilot plan and policy, so
 * a model it lacks may be plan-gated, not retired (#393). Such a default is a note when its
 * gating is recorded, and a priced model the list lacks stays in the snapshot until its
 * retirement date passes; neither is drift.
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
import { buildSnapshot, loadCopilotModels, readExistingSnapshot, retiredAsOf } from "./sync-copilot-pricing.mjs";

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

/**
 * Splits the defaults the live list lacks into those whose absence somebody has explained (a note,
 * with its evidence) and those nobody has (drift). The list is one account's view, filtered by plan.
 *
 * @param {string[]} missing
 * @param {Record<string, { reason: string, detail: string, checked: string }>} [notListed] - scripts/model-availability.json
 * @returns {{ drift: string[], notes: { model: string, reason: string, detail: string, checked: string }[] }}
 */
export function splitUnavailable(missing, notListed = {}) {
  const drift = [];
  const notes = [];
  for (const model of missing) {
    if (Object.hasOwn(notListed, model)) notes.push({ model, ...notListed[model] });
    else drift.push(model);
  }
  return { drift, notes };
}

/**
 * Models added, removed or repriced between two pricing snapshots' `models` maps. A model the live
 * map lacks is removed only when its retirement has passed; otherwise it is kept, because the
 * account's list omits models its plan hides (#393).
 */
export function diffPricing(saved, fresh, { isRetired = () => false } = {}) {
  const keys = new Set([...Object.keys(saved), ...Object.keys(fresh)]);
  const out = { added: [], removed: [], changed: [], kept: [] };
  for (const id of [...keys].sort()) {
    if (!Object.hasOwn(saved, id)) out.added.push(id);
    else if (!Object.hasOwn(fresh, id)) (isRetired(id) ? out.removed : out.kept).push(id);
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

function noteLines(notes) {
  return notes.map((n) => `- \`${n.model}\` is ${n.reason}: ${String(n.detail).replace(/\.$/, "")}. Checked ${n.checked}.`);
}

/** Markdown report; empty sections are omitted. Notes follow the drift and never count as drift. */
export function renderReport({ retiring, unavailable, notes = [], pricing, liveError, withinDays }) {
  const lines = ["## Copilot model and pricing drift", ""];
  if (retiring.length) lines.push(`### Defaults retiring within ${withinDays} days`, "", ...retiringLines(retiring), "", "Move these defaults in `pforge-mcp/orchestrator/constants.mjs` (and the restatements the model-defaults contract test pins).", "");
  if (unavailable.length) lines.push("### Defaults missing from the live Copilot model list", "", ...unavailable.map((m) => `- \`${m}\``), "", "If a plan or policy hides one from this account, record the evidence in `scripts/model-availability.json`; if Copilot retired it, add it to `pforge-mcp/model-retirements.json`.", "");
  const priced = pricing ? pricingLines(pricing) : [];
  if (priced.length) lines.push("### AI-credit pricing changed", "", ...priced, "");
  if (liveError) lines.push("### Live checks skipped", "", `The Copilot model list was unavailable (${liveError}). Set a \`COPILOT_GITHUB_TOKEN\` secret with Copilot access so the weekly check can compare availability and pricing.`, "");
  if (lines.length === 2) lines.push("No drift: every default is available and not retiring soon, and the pricing snapshot is current.", "");
  if (notes.length) lines.push("### Defaults this account cannot see (recorded, not drift)", "", ...noteLines(notes), "", "The list is this account's own, filtered by its Copilot plan. Run the check with a token from a plan that has these models for an authoritative answer.", "");
  if (pricing?.kept?.length) lines.push("### Priced models kept: not in this account's list, no retirement has passed", "", pricing.kept.map((id) => `\`${id}\``).join(", "), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Decides what drifted, from what the live list shows. Pure: the model list, the snapshot and the
 * clock are arguments, so a check can be run against any account's list.
 *
 * @param {object} input
 * @param {string[]} input.defaults - every model Plan Forge picks on the user's behalf
 * @param {Record<string, string>} input.retirements - pforge-mcp/model-retirements.json
 * @param {{ notListed?: object }} [input.registry] - scripts/model-availability.json
 * @param {object[]|null} input.models - the account's listModels(), null when it could not be read
 * @param {{ models: object }} input.existing - the pricing snapshot on disk
 * @param {number} [input.now]
 * @param {number} [input.withinDays]
 * @param {string|null} [input.liveError]
 */
export function evaluateDrift({ defaults, retirements, registry = {}, models, existing, now = Date.now(), withinDays = DEFAULT_WITHIN_DAYS, liveError = null }) {
  const retiring = retiringDefaults({ defaults, retirements, now, withinDays });
  if (!models) {
    return { retiring, unavailable: [], notes: [], pricing: null, liveError: liveError ?? "no model list", withinDays };
  }
  const { drift, notes } = splitUnavailable(unavailableDefaults({ defaults, liveIds: models.map((m) => m.id) }), registry.notListed);
  const pricing = diffPricing(existing.models, buildSnapshot(models).models, { isRetired: retiredAsOf(retirements, now) });
  return { retiring, unavailable: drift, notes, pricing, liveError: null, withinDays };
}

/** 1 when anything drifted, 3 when nothing did but the live checks could not run, else 0. */
export function exitCodeFor({ retiring, unavailable, pricing, liveError }) {
  const pricingDrift = pricing && ["added", "removed", "changed"].some((kind) => pricing[kind].length > 0);
  if (retiring.length || unavailable.length || pricingDrift) return EXIT_DRIFT;
  return liveError ? EXIT_LIVE_SKIPPED : EXIT_CLEAN;
}

async function loadLiveModels() {
  try {
    return { models: await loadCopilotModels(), liveError: null };
  } catch (err) {
    return { models: null, liveError: err.message.split("\n")[0] };
  }
}

function readJson(...segments) {
  return JSON.parse(readFileSync(join(REPO, ...segments), "utf8"));
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const withinDays = Number(opt("--within-days") ?? DEFAULT_WITHIN_DAYS);
  const result = evaluateDrift({
    defaults: defaultedModels(),
    retirements: readJson("pforge-mcp", "model-retirements.json").copilot,
    registry: readJson("scripts", "model-availability.json"),
    existing: readExistingSnapshot(),
    withinDays,
    ...(await loadLiveModels()),
  });
  const report = renderReport(result);
  if (opt("--report")) writeFileSync(opt("--report"), report);
  process.stdout.write(report);
  return exitCodeFor(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`check-model-drift: ${err.message}`);
    process.exitCode = 2;
  });
}
