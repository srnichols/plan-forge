/** Plan Forge — Phase-55 S1: gate-synthesis sub-module (extracted from run-plan.mjs) */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getMinimaForDomain } from "../../tempering.mjs";
import { computeGateSuggestionKey, getGateSuggestionCounter } from "../../memory.mjs";
import { GATE_SUGGESTION_AUTO_INJECT_THRESHOLD } from "../constants.mjs";

export { GATE_SUGGESTION_AUTO_INJECT_THRESHOLD };

// ─── Phase-25 Slice 4: Adaptive gate synthesis (L6) ──────────────────

/**
 * Domain-keyword patterns used by `synthesizeGateSuggestions` to tag a slice
 * with a Tempering profile (domain / integration / controller). Order matters
 * — first match wins. Patterns are intentionally conservative; false positives
 * here produce advisory noise, false negatives are silent no-ops.
 */
const GATE_SYNTH_DOMAIN_PATTERNS = [
  { domain: "controller",  pattern: /\b(controller|endpoint|route|api|http|rest)\b/i },
  { domain: "integration", pattern: /\b(integration|e2e|end-to-end|contract|workflow|pipeline|migrat)\b/i },
  { domain: "domain",      pattern: /\b(domain|service|aggregate|entity|repository|model|business|validation)\b/i },
];

/**
 * Vitest/jest-style suggested gate commands per domain, keyed for portability.
 *
 * Uses the per-line `node -e "process.chdir(); execSync()"` pattern proven by
 * Phase 41 and Phase 51. This is dispatched by runGate() via the inline-node
 * fast path (execFileSync with shell:false) — no PowerShell or cmd.exe
 * parsing, so the script body survives Windows verbatim.
 *
 * Earlier versions emitted `bash -c "cd pforge-mcp && npx vitest run ..."`
 * here. That pattern was mangled by the Windows cmd→bash quoting shim
 * whenever it was combined with `&&` and a nested `node -e "..."` (Phase 51
 * S0 hit this; recovery cost a partial worker run). See memory note
 * /memories/repo/phase-51-gate-recovery.md.
 */
const GATE_SYNTH_TEMPLATES = {
  domain:      "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-domain>.test.mjs', {stdio:'inherit',shell:true});\"",
  integration: "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-integration>.test.mjs', {stdio:'inherit',shell:true});\"",
  controller:  "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-controller>.test.mjs', {stdio:'inherit',shell:true});\"",
};

/**
 * Load the `runtime.gateSynthesis` config block with defaults.
 * Schema: { mode: "off" | "suggest" | "enforce", domains: string[] }
 * Default: { mode: "suggest", domains: ["domain","integration","controller"] }
 * (Phase-25 D8.)
 */
export function loadGateSynthesisConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  const defaults = { mode: "suggest", domains: ["domain", "integration", "controller"] };
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      const block = cfg?.runtime?.gateSynthesis;
      if (block && typeof block === "object") {
        const mode = ["off", "suggest", "enforce"].includes(block.mode) ? block.mode : defaults.mode;
        const domains = Array.isArray(block.domains) && block.domains.length > 0
          ? block.domains.filter((d) => typeof d === "string" && d.length > 0)
          : defaults.domains;
        return { mode, domains };
      }
    }
  } catch { /* fall through */ }
  return { ...defaults };
}

/**
 * Classify a slice's domain profile by matching its title + files against
 * `GATE_SYNTH_DOMAIN_PATTERNS`. Returns `null` when no keyword matches.
 */
export function classifySliceDomain(slice) {
  if (!slice) return null;
  const fileList = Array.isArray(slice.files) ? slice.files : [];
  const haystack = [slice.title || "", ...fileList].join(" ").toLowerCase();
  for (const { domain, pattern } of GATE_SYNTH_DOMAIN_PATTERNS) {
    if (pattern.test(haystack)) return domain;
  }
  return null;
}

/**
 * Phase-25 MUST #9 — Suggest gates for slices that lack a domain-matched
 * validation gate. Pure function: reads Tempering minima (read-only),
 * inspects the parsed slices, emits suggestion records. Does NOT mutate the
 * plan — Slice 4 is "suggest-only" (D8); the enforce-mode promotion path is
 * tracked in Phase-26 Slice 7 via `.forge/gate-suggestions.jsonl`.
 *
 * @param {object} args
 * @param {Array<object>} args.slices - parsed plan slices
 * @param {string} [args.cwd=process.cwd()]
 * @param {object} [args.config] - override `loadGateSynthesisConfig(cwd)`
 * @returns {{
 *   mode: "off" | "suggest" | "enforce",
 *   suggestions: Array<{
 *     sliceNumber: (number|string),
 *     sliceTitle: string,
 *     domain: string,
 *     reason: string,
 *     suggestedCommand: string,
 *     minima: { coverageMin: (number|null), runtimeBudgetMs: (number|null) }
 *   }>,
 * }}
 */
export function synthesizeGateSuggestions({ slices, cwd = process.cwd(), config } = {}) {
  const cfg = config || loadGateSynthesisConfig(cwd);
  if (cfg.mode === "off") return { mode: cfg.mode, suggestions: [] };
  if (!Array.isArray(slices) || slices.length === 0) return { mode: cfg.mode, suggestions: [] };
  const enabledDomains = new Set(cfg.domains || []);
  const out = [];
  for (const slice of slices) {
    const domain = classifySliceDomain(slice);
    if (!domain) continue;
    if (!enabledDomains.has(domain)) continue;
    // If the slice already declares a gate we stay silent — no churn.
    const gateText = typeof slice.validationGate === "string"
      ? slice.validationGate.trim()
      : (Array.isArray(slice.validationGate) ? slice.validationGate.join("\n").trim() : "");
    if (gateText.length > 0) continue;
    const minima = getMinimaForDomain(cwd, domain);
    const suggestion = {
      sliceNumber: slice.number ?? "?",
      sliceTitle: slice.title || "",
      domain,
      reason: `Slice matches '${domain}' profile but declares no validation gate. Tempering coverage-min ${minima.coverageMin ?? "n/a"}%, runtime-budget ${minima.runtimeBudgetMs ?? "n/a"}ms apply.`,
      suggestedCommand: GATE_SYNTH_TEMPLATES[domain] || GATE_SYNTH_TEMPLATES.domain,
      minima: { coverageMin: minima.coverageMin, runtimeBudgetMs: minima.runtimeBudgetMs },
    };
    // Phase-26 Slice 7 (C4): attach per-suggestion accept counter + auto-inject
    // flag in `enforce` mode. The key is derived from `(domain, suggestedCommand)`
    // so accepts aggregate across plans. Auto-inject threshold: 5.
    const suggestionKey = computeGateSuggestionKey(suggestion);
    const acceptCount = getGateSuggestionCounter(suggestionKey, cwd);
    suggestion.suggestionKey = suggestionKey;
    suggestion.acceptCount = acceptCount;
    suggestion.autoInjected = cfg.mode === "enforce" && acceptCount >= GATE_SUGGESTION_AUTO_INJECT_THRESHOLD;
    out.push(suggestion);
  }
  return {
    mode: cfg.mode,
    suggestions: out,
    autoInjected: out.filter((s) => s.autoInjected).map((s) => ({
      suggestionKey: s.suggestionKey,
      sliceNumber: s.sliceNumber,
      sliceTitle: s.sliceTitle,
      domain: s.domain,
      suggestedCommand: s.suggestedCommand,
      acceptCount: s.acceptCount,
    })),
  };
}

/**
 * Format gate-synthesis suggestions for printing to stdout during plan
 * pre-flight. Returns `""` when there are no suggestions.
 */
export function formatGateSuggestions(result) {
  if (!result || !Array.isArray(result.suggestions) || result.suggestions.length === 0) return "";
  const lines = [
    "",
    `--- GATE SYNTHESIS (Phase-25 L6, mode="${result.mode}") ---`,
    `${result.suggestions.length} slice(s) lack a domain-matched validation gate.`,
    "Add the suggested commands to the slice's Validation Gate block, or set",
    "runtime.gateSynthesis.mode = \"off\" in .forge.json to silence this advisory.",
    "",
  ];
  for (const s of result.suggestions) {
    lines.push(`Slice ${s.sliceNumber} — "${s.sliceTitle}"`);
    lines.push(`  Domain:  ${s.domain}`);
    lines.push(`  Reason:  ${s.reason}`);
    lines.push(`  Suggest: ${s.suggestedCommand}`);
    lines.push("");
  }
  lines.push("--- END GATE SYNTHESIS ---");
  return lines.join("\n");
}
