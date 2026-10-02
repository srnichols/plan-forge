/**
 * GitHub Copilot's model catalog and retirement dates, for runtime routing.
 *
 *   copilot-pricing.json      models Copilot currently serves (Model Drift workflow, weekly)
 *   model-retirements.json    announced retirement dates (#303)
 *
 * Shared by the run-history recommender and the run-start warning so
 * neither re-reads the JSON or re-implements the checks.
 */

import { readFileSync } from "node:fs";

const modelMaps = new Map();

/** Read one top-level object from a JSON file next to this module, cached. */
function readModelMap(file, key) {
  if (!modelMaps.has(file)) {
    let map = {};
    try {
      map = JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))[key] ?? {};
    } catch {
      // A missing or corrupt file must not break model routing; callers see an empty map.
    }
    modelMaps.set(file, Object.freeze({ ...map }));
  }
  return modelMaps.get(file);
}

const copilotRetirements = () => readModelMap("model-retirements.json", "copilot");
const copilotCatalog = () => readModelMap("copilot-pricing.json", "models");

/**
 * @param {unknown} model
 * @returns {boolean} True when GitHub Copilot currently serves `model`.
 */
export function isServedByCopilot(model) {
  return typeof model === "string" && Object.hasOwn(copilotCatalog(), model);
}

/**
 * @param {unknown} model
 * @returns {string|null} The YYYY-MM-DD date GitHub Copilot retires `model`, or null.
 */
export function retirementDate(model) {
  if (typeof model !== "string" || !model) return null;
  return Object.hasOwn(copilotRetirements(), model) ? copilotRetirements()[model] : null;
}

/**
 * @param {unknown} model
 * @param {Date} [now]
 * @returns {boolean} True once `model`'s Copilot retirement date (UTC midnight) has passed.
 */
export function isRetiredModel(model, now = new Date()) {
  const date = retirementDate(model);
  return date !== null && Date.parse(`${date}T00:00:00Z`) <= now.getTime();
}

/**
 * @param {Iterable<unknown>|null|undefined} models
 * @param {Date} [now]
 * @returns {{ model: string, date: string }[]} Retired entries of `models`, first-seen order, no duplicates.
 */
export function retiredModels(models, now = new Date()) {
  const found = [];
  const seen = new Set();
  for (const model of models ?? []) {
    if (seen.has(model) || !isRetiredModel(model, now)) continue;
    seen.add(model);
    found.push({ model, date: retirementDate(model) });
  }
  return found;
}

/**
 * A model the recommender may pick on the user's behalf: Copilot serves it
 * now and its retirement date (if any) has not passed. Run history outlives
 * models, and some leave the catalog without a dated retirement notice.
 *
 * @param {unknown} model
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isRecommendableModel(model, now = new Date()) {
  return isServedByCopilot(model) && !isRetiredModel(model, now);
}
