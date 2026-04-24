/**
 * Pattern Detector Registry — Phase-38.6 Slice 1.
 *
 * Auto-discovers detector modules from `patterns/detectors/*.mjs`,
 * invokes each with the project context `{ graph, runs, costs }`,
 * and collects surfaced patterns.
 *
 * @module patterns/registry
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETECTORS_DIR = join(__dirname, "detectors");

/**
 * Load run summaries from .forge/runs/&lt;id&gt;/summary.json for detector context.
 * Shapes each entry as { plan, results: [{ number, title, gateStatus, gateError, failedCommand }] }
 * — the shape detectors expect.
 * @param {string} cwd
 * @returns {object[]}
 */
function loadRunsFromDisk(cwd) {
  const runsDir = join(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return [];
  const runs = [];
  let dirs = [];
  try {
    dirs = readdirSync(runsDir);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    const summaryPath = join(runsDir, dir, "summary.json");
    if (!existsSync(summaryPath)) continue;
    try {
      const s = JSON.parse(readFileSync(summaryPath, "utf8"));
      const srs = Array.isArray(s.sliceResults) ? s.sliceResults : [];
      const results = srs.map((sr) => ({
        number: sr.sliceId,
        title: sr.title,
        gateStatus: sr.status === "failed" ? "failed" : "passed",
        gateError: sr.gateError,
        gateOutput: sr.gateOutput,
        failedCommand: sr.failedCommand,
      }));
      // Dir format: <iso-timestamp>_<plan-name>. Strip the timestamp prefix
      // so runs of the same plan cluster under the same `plan` key — required
      // for detectors that need ≥2 distinct plans.
      const dirPlan = dir.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_?/, "");
      runs.push({
        plan: s.planName || dirPlan || dir,
        timestamp: s.startedAt || s.completedAt || null,
        results,
        cost: s.cost || null,
      });
    } catch {
      // skip malformed summary.json
    }
  }
  return runs;
}

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
 * If ctx omits `runs` but provides `cwd`, runs are auto-loaded from
 * .forge/runs/&lt;id&gt;/summary.json. Callers can still inject `runs` explicitly
 * (e.g. for tests) to bypass disk loading.
 * @param {{ cwd?: string, graph?: object, runs?: object[], costs?: object[] }} ctx
 * @returns {Promise<Pattern[]>}
 */
export async function runDetectors(ctx = {}) {
  const detectors = await loadDetectors();
  const patterns = [];

  // Auto-load runs from disk when caller only supplied cwd.
  // Explicit runs passed by the caller take precedence (used by tests).
  const resolvedCtx = { ...ctx };
  if (!Array.isArray(resolvedCtx.runs) && resolvedCtx.cwd) {
    resolvedCtx.runs = loadRunsFromDisk(resolvedCtx.cwd);
  }

  for (const { name, detect } of detectors) {
    try {
      const results = await detect(resolvedCtx);
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
