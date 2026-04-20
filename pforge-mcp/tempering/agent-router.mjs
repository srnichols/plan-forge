/**
 * Plan Forge — Tempering: Agent Router (Phase TEMPER-07 Slice 07.1)
 *
 * Routes tempering bugs to the appropriate agent/skill for read-only analysis.
 * All routing is deterministic — no LLM calls, no network IO.
 *
 * Design contracts:
 *   - deriveBugType is the LOCKED type-derivation contract (deterministic precedence).
 *   - resolveRoute is pure: null bug → null, no route → null + console.warn.
 *   - buildAnalystPrompt includes literal "do NOT edit files" (test-verifiable).
 *   - writeAnalystFinding uses atomic write (tmp + rename).
 *   - recordDelegation uses appendFileSync for crash-safe JSONL append.
 *   - loadAgentRoutingConfig returns { enabled: false } on any error.
 *
 * @module tempering/agent-router
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ─── Routing Table ────────────────────────────────────────────────────

export const ROUTING_TABLE = Object.freeze({
  "security|critical":    { agent: "security",      skill: "security-audit" },
  "security|major":       { agent: "security",      skill: "security-audit" },
  "performance|critical": { agent: "performance",   skill: null },
  "performance|major":    { agent: "performance",   skill: null },
  "functional|critical":  { agent: "test-runner",   skill: "test-sweep" },
  "functional|major":     { agent: "test-runner",   skill: null },
  "contract|*":           { agent: "api-contracts", skill: "api-doc-gen" },
  "visual|*":             { agent: "accessibility", skill: null },
});

// ─── Scanner → Bug Type Mapping ──────────────────────────────────────

const SCANNER_TYPE_MAP = Object.freeze({
  contract:             "contract",
  "visual-diff":        "visual",
  "performance-budget": "performance",
  "load-stress":        "performance",
  unit:                 "functional",
  integration:          "functional",
  "ui-playwright":      "functional",
  mutation:             "functional",
  flakiness:            "functional",
});

// ─── deriveBugType ───────────────────────────────────────────────────
/**
 * Deterministic bug-type derivation with strict precedence:
 *   1. bug.type (explicit field) — preferred, future-proof
 *   2. bug.classifierMeta.bugType
 *   3. Map from bug.scanner via SCANNER_TYPE_MAP
 *   4. null if unmappable
 *
 * @param {object} bug
 * @returns {string|null}
 */
export function deriveBugType(bug) {
  if (!bug) return null;
  if (typeof bug.type === "string" && bug.type) return bug.type;
  if (bug.classifierMeta?.bugType && typeof bug.classifierMeta.bugType === "string") {
    return bug.classifierMeta.bugType;
  }
  if (typeof bug.scanner === "string" && SCANNER_TYPE_MAP[bug.scanner]) {
    return SCANNER_TYPE_MAP[bug.scanner];
  }
  return null;
}

// ─── resolveRoute ────────────────────────────────────────────────────
/**
 * Pure route resolution. Tries `${type}|${severity}` then `${type}|*`.
 *
 * @param {object} bug - Must have severity; type derived via deriveBugType.
 * @returns {{ agent: string, skill: string|null }|null}
 */
export function resolveRoute(bug) {
  if (!bug) return null;
  const type = deriveBugType(bug);
  if (!type) return null;
  const severity = bug.severity || "medium";

  const exact = ROUTING_TABLE[`${type}|${severity}`];
  if (exact) return { ...exact };

  const wildcard = ROUTING_TABLE[`${type}|*`];
  if (wildcard) return { ...wildcard };

  console.warn(`[agent-router] No route for bugId=${bug.bugId || "?"} type=${type} severity=${severity}`);
  return null;
}

// ─── buildAnalystPrompt ──────────────────────────────────────────────
/**
 * Builds a structured read-only analysis prompt for the routed agent.
 * MUST include literal phrase "do NOT edit files" (test-verifiable).
 *
 * @param {object} bug
 * @param {{ agent: string, skill: string|null }} route
 * @returns {string}
 */
export function buildAnalystPrompt(bug, route) {
  const lines = [
    `## Agent Analysis Request`,
    ``,
    `**IMPORTANT: This is a read-only analysis. You MUST do NOT edit files.**`,
    ``,
    `**Bug ID:** ${bug.bugId || "unknown"}`,
    `**Scanner:** ${bug.scanner || "unknown"}`,
    `**Severity:** ${bug.severity || "unknown"}`,
    `**Agent:** ${route.agent}`,
  ];
  if (route.skill) {
    lines.push(`**Skill:** ${route.skill}`);
  }
  lines.push(``);
  if (bug.evidence) {
    lines.push(`### Evidence`);
    if (bug.evidence.testName) lines.push(`- **Test:** ${bug.evidence.testName}`);
    if (bug.evidence.assertionMessage) lines.push(`- **Assertion:** ${bug.evidence.assertionMessage}`);
    if (bug.evidence.stackTrace) lines.push(`- **Stack:** \`${bug.evidence.stackTrace.split("\n")[0]}\``);
    lines.push(``);
  }
  if (bug.affectedFiles?.length) {
    lines.push(`### Affected Files`);
    for (const f of bug.affectedFiles) lines.push(`- ${f}`);
    lines.push(``);
  }
  if (bug.reproSteps?.length) {
    lines.push(`### Reproduction Steps`);
    for (const s of bug.reproSteps) lines.push(`- ${s}`);
    lines.push(``);
  }
  lines.push(`### Instructions`);
  lines.push(`Analyze this bug from the perspective of the **${route.agent}** agent.`);
  lines.push(`Provide root-cause analysis, impact assessment, and recommended fix strategy.`);
  return lines.join("\n");
}

// ─── writeAnalystFinding ─────────────────────────────────────────────
/**
 * Atomic write of analyst finding to `.forge/tempering/findings/<bugId>.json`.
 *
 * @param {string} targetPath - Project root (cwd)
 * @param {object} bug
 * @param {{ agent: string, skill: string|null }} route
 * @param {*} finding - Free-form finding payload from agent analysis
 */
export function writeAnalystFinding(targetPath, bug, route, finding) {
  const dir = resolve(targetPath, ".forge", "tempering", "findings");
  mkdirSync(dir, { recursive: true });

  const record = {
    _v: 1,
    bugId: bug.bugId,
    agent: route.agent,
    skill: route.skill || null,
    finding,
    createdAt: new Date().toISOString(),
  };

  const finalPath = resolve(dir, `${bug.bugId}.json`);
  const tmpPath = resolve(dir, `.${bug.bugId}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
  try {
    renameSync(tmpPath, finalPath);
  } catch {
    writeFileSync(finalPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
  }
}

// ─── recordDelegation ────────────────────────────────────────────────
/**
 * Append a delegation record to `.forge/tempering/delegations.jsonl`.
 *
 * @param {string} targetPath - Project root (cwd)
 * @param {string} bugId
 * @param {{ agent: string, skill: string|null }} route
 * @param {string} mode - "analyst" | "review-queue-item"
 * @param {string|null} reviewItemId
 */
export function recordDelegation(targetPath, bugId, route, mode, reviewItemId) {
  const dir = resolve(targetPath, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });

  const record = {
    _v: 1,
    bugId,
    agent: route.agent,
    skill: route.skill || null,
    mode,
    reviewItemId: reviewItemId || null,
    timestamp: new Date().toISOString(),
  };

  appendFileSync(
    resolve(dir, "delegations.jsonl"),
    JSON.stringify(record) + "\n",
    "utf-8",
  );
}

// ─── loadAgentRoutingConfig ──────────────────────────────────────────
/**
 * Reads `.forge/tempering/config.json` and returns `config.agentRouting`.
 * Returns `{ enabled: false }` on missing file, malformed JSON, or missing key.
 *
 * @param {string} targetPath - Project root (cwd)
 * @returns {{ enabled: boolean, [key: string]: any }}
 */
export function loadAgentRoutingConfig(targetPath) {
  try {
    const configPath = resolve(targetPath, ".forge", "tempering", "config.json");
    if (!existsSync(configPath)) return { enabled: false };
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed?.agentRouting || { enabled: false };
  } catch {
    return { enabled: false };
  }
}

// ─── Phase FORGE-SHOP-06 Slice 06.2 — Delegate Sync Responder ───────

/**
 * Register the `tempering.delegate-sync` hub responder.
 * Looks up a bug by ID, resolves its route, builds the analyst prompt,
 * and records the delegation. Returns the prompt and routing info.
 *
 * @param {object} hub - Hub instance with onAsk
 * @param {string} cwd - Project root
 * @param {object} [deps] - DI overrides: { readForgeJsonl }
 */
export function registerDelegateSyncResponder(hub, cwd, deps = {}) {
  const _readJsonl = deps.readForgeJsonl || ((filePath, defaultValue = []) => {
    const fullPath = resolve(cwd, ".forge", filePath);
    try {
      if (existsSync(fullPath)) {
        return readFileSync(fullPath, "utf-8")
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      }
      return defaultValue;
    } catch { return defaultValue; }
  });

  hub.onAsk("tempering.delegate-sync", async (payload) => {
    const { bugId } = payload || {};
    if (!bugId) {
      return { ok: false, error: "missing-bugId" };
    }

    const bugs = _readJsonl("tempering/bugs.jsonl", []);
    const bug = bugs.find((b) => b.bugId === bugId);
    if (!bug) {
      return { ok: false, error: "bug-not-found" };
    }

    const route = resolveRoute(bug);
    if (!route) {
      return { ok: false, error: "no-route", bugId };
    }

    const prompt = buildAnalystPrompt(bug, route);
    recordDelegation(cwd, bugId, route, "sync-ask", null);

    return {
      ok: true,
      prompt,
      bugId,
      agent: route.agent,
      skill: route.skill,
    };
  });
}
