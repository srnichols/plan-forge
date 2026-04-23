/**
 * Pattern Detector Registry — Phase-38.6 Slice 1.
 *
 * Auto-discovers detector modules from `patterns/detectors/*.mjs`,
 * invokes each with the project context `{ graph, runs, costs }`,
 * and collects surfaced patterns.
 *
 * @module patterns/registry
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETECTORS_DIR = join(__dirname, "detectors");

/**
 * Discover and load all detector modules from the detectors/ directory.
 * Each module must export a default function: `(ctx) => Pattern[]`.
 * @returns {Promise<Array<{ name: string, detect: Function }>>}
 */
export async function loadDetectors() {
  let files;
  try {
    files = readdirSync(DETECTORS_DIR).filter(f => f.endsWith(".mjs"));
  } catch {
    return [];
  }

  const detectors = [];
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(join(DETECTORS_DIR, file)).href);
      const detect = mod.default || mod.detect;
      if (typeof detect === "function") {
        detectors.push({ name: file.replace(/\.mjs$/, ""), detect });
      }
    } catch {
      // skip malformed detector modules
    }
  }
  return detectors;
}

/**
 * @typedef {Object} Pattern
 * @property {string} id        - Unique pattern identifier (e.g. "gate-failure-recurrence:vitest-timeout")
 * @property {string} detector  - Name of the detector that surfaced this pattern
 * @property {string} severity  - "info" | "warning" | "error"
 * @property {string} title     - Human-readable title
 * @property {string} detail    - Longer description with evidence
 * @property {number} occurrences - How many times the pattern was observed
 * @property {string[]} plans   - Plan names where the pattern appeared
 */

/**
 * Run all registered detectors against the provided context.
 * @param {{ graph?: object, runs?: object[], costs?: object[] }} ctx
 * @returns {Promise<Pattern[]>}
 */
export async function runDetectors(ctx = {}) {
  const detectors = await loadDetectors();
  const patterns = [];

  for (const { name, detect } of detectors) {
    try {
      const results = await detect(ctx);
      if (Array.isArray(results)) {
        for (const r of results) {
          patterns.push({ ...r, detector: name });
        }
      }
    } catch {
      // non-fatal: skip failing detectors
    }
  }

  return patterns;
}
