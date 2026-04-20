/**
 * Plan Forge — Testbed Scenarios
 *
 * Phase TESTBED-01 Slice 01
 *
 * Loads, validates, and lists scenario fixture files from
 * `docs/plans/testbed-scenarios/`. Each fixture is a JSON file
 * describing setup, execute, assertions, and teardown steps.
 *
 * @module testbed/scenarios
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";

// ─── Constants ────────────────────────────────────────────────────────
export const SCENARIO_KINDS = Object.freeze(["happy-path", "chaos", "perf", "long-horizon"]);

export const ASSERTION_KINDS = Object.freeze([
  "file-exists",
  "file-contains",
  "event-emitted",
  "correlationId-thread",
  "exit-code",
  "duration-under",
  "artefact-count",
]);

// ─── Validation ───────────────────────────────────────────────────────

/**
 * Validate a scenario fixture object.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateScenarioFixture(fixture) {
  const errors = [];

  if (!fixture.scenarioId) errors.push("missing required field: scenarioId");
  if (!fixture.kind) errors.push("missing required field: kind");
  if (fixture.kind && !SCENARIO_KINDS.includes(fixture.kind)) {
    errors.push(`invalid kind '${fixture.kind}'; expected one of: ${SCENARIO_KINDS.join(", ")}`);
  }

  if (!fixture.execute || !Array.isArray(fixture.execute)) {
    errors.push("missing or invalid field: execute (must be an array of steps)");
  }
  if (!fixture.assertions || !Array.isArray(fixture.assertions)) {
    errors.push("missing or invalid field: assertions (must be an array)");
  }

  if (fixture.assertions && Array.isArray(fixture.assertions)) {
    for (let i = 0; i < fixture.assertions.length; i++) {
      const a = fixture.assertions[i];
      if (!a.kind) {
        errors.push(`assertion[${i}]: missing kind`);
      } else if (!ASSERTION_KINDS.includes(a.kind)) {
        errors.push(`assertion[${i}]: unsupported kind '${a.kind}'; expected one of: ${ASSERTION_KINDS.join(", ")}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Scenario Directory ───────────────────────────────────────────────
function scenariosDir(projectRoot) {
  return resolve(projectRoot, "docs", "plans", "testbed-scenarios");
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Resolve the testbed path from input, config, or platform default.
 */
export function resolveTestbedPath(input, { projectRoot }) {
  // 1. Explicit argument
  if (input?.testbedPath) return input.testbedPath;

  // 2. .forge.json config
  try {
    const forgeJsonPath = resolve(projectRoot, ".forge.json");
    if (existsSync(forgeJsonPath)) {
      const config = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
      if (config.testbed?.path) return config.testbed.path;
    }
  } catch { /* ignore parse errors */ }

  // 3. Platform default (Windows only)
  if (process.platform === "win32") {
    return "E:\\GitHub\\plan-forge-testbed";
  }

  const err = new Error("Testbed path not configured. Set testbed.path in .forge.json or pass testbedPath argument.");
  err.code = "ERR_TESTBED_PATH_REQUIRED";
  throw err;
}

/**
 * Load a scenario fixture by ID.
 */
export function loadScenario(scenarioId, { projectRoot }) {
  const dir = scenariosDir(projectRoot);
  const filePath = join(dir, `${scenarioId}.json`);

  if (!existsSync(filePath)) {
    const err = new Error(`Scenario not found: ${scenarioId} (looked in ${dir})`);
    err.code = "ERR_SCENARIO_NOT_FOUND";
    throw err;
  }

  const raw = readFileSync(filePath, "utf-8");
  let fixture;
  try {
    fixture = JSON.parse(raw);
  } catch (parseErr) {
    const err = new Error(`Scenario file is not valid JSON: ${scenarioId}.json — ${parseErr.message}`);
    err.code = "ERR_SCENARIO_PARSE";
    throw err;
  }

  const validation = validateScenarioFixture(fixture);
  if (!validation.ok) {
    const err = new Error(`Invalid scenario fixture: ${validation.errors.join("; ")}`);
    err.code = "ERR_SCENARIO_INVALID";
    throw err;
  }

  return fixture;
}

/**
 * List all scenarios in the scenarios directory.
 */
export function listScenarios({ projectRoot }) {
  const dir = scenariosDir(projectRoot);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        return {
          scenarioId: data.scenarioId || basename(f, ".json"),
          kind: data.kind || "unknown",
          description: data.description || "",
        };
      } catch {
        return { scenarioId: basename(f, ".json"), kind: "unknown", description: "(parse error)" };
      }
    });
}
