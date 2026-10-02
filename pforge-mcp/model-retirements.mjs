/**
 * GitHub Copilot model retirements, read from model-retirements.json (#303).
 *
 * One lookup shared by the run-history recommender and the run-start
 * warning, so neither re-reads the JSON or re-implements the date check.
 * The weekly Model Drift workflow keeps the JSON current.
 */

import { readFileSync } from "node:fs";

const RETIREMENTS_URL = new URL("./model-retirements.json", import.meta.url);

let cachedRetirements = null;

function copilotRetirements() {
  if (!cachedRetirements) {
    try {
      const parsed = JSON.parse(readFileSync(RETIREMENTS_URL, "utf8"));
      cachedRetirements = Object.freeze({ ...(parsed.copilot ?? {}) });
    } catch {
      // A missing or corrupt file must not break model routing; treat it as "nothing retired".
      cachedRetirements = Object.freeze({});
    }
  }
  return cachedRetirements;
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
