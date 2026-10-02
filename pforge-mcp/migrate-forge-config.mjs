/**
 * Plan Forge — add missing defaults to a project's .forge.json on update.
 *
 *   node migrate-forge-config.mjs --project <dir>
 *
 * Adds modelRouting.default and the LiveGuard hook blocks (preDeploy, postSlice,
 * preAgentHandoff, postRun) when absent. Values the project set — including
 * false or null — are never changed, and other keys are kept as they are.
 * Prints one line per added key; a file that needs nothing is not rewritten.
 * A missing or unreadable .forge.json is left alone (exit 0). Both `pforge update`
 * shells call this, so their migrations cannot drift (#299).
 *
 * @module migrate-forge-config
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTING_MODEL } from "./orchestrator/constants.mjs";

/** What setup writes for a new project. postRun's auditor is off until configured. */
export const DEFAULT_HOOKS = Object.freeze({
  preDeploy: { blockOnSecrets: true, warnOnEnvGaps: true, scanSince: "HEAD~1" },
  postSlice: { silentDeltaThreshold: 5, warnDeltaThreshold: 10, scoreFloor: 70 },
  preAgentHandoff: { injectContext: true, runRegressionGuard: true, cacheMaxAgeMinutes: 30, minAlertSeverity: "medium" },
  postRun: { invokeAuditor: { onFailure: false, everyNRuns: null } },
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** @returns {{ config: object, added: string[] }} */
export function migrateForgeConfig(input) {
  const config = clone(input);
  const added = [];
  if (!isObject(config.modelRouting)) config.modelRouting = {};
  if (!("default" in config.modelRouting)) {
    config.modelRouting.default = DEFAULT_ROUTING_MODEL;
    added.push("modelRouting.default");
  }
  if (!isObject(config.hooks)) config.hooks = {};
  for (const [name, value] of Object.entries(DEFAULT_HOOKS)) {
    if (name in config.hooks) continue;
    config.hooks[name] = clone(value);
    added.push(`hooks.${name}`);
  }
  return { config, added };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--project");
  const file = join(at > 0 ? process.argv[at + 1] : process.cwd(), ".forge.json");
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      parsed = null;
    }
    if (isObject(parsed)) {
      const { config, added } = migrateForgeConfig(parsed);
      if (added.length > 0) {
        const eol = raw.includes("\r\n") ? "\r\n" : "\n";
        writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`.replace(/\n/g, eol));
        process.stdout.write(`${added.join("\n")}\n`);
      }
    }
  }
}
