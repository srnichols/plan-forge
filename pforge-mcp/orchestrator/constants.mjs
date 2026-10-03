/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) Slice 2
 * Pure orchestrator constants shared across sub-modules.
 */

/** Canonical list of all supported agent adapters. Update here — consumed by dashboard, setup, and docs. */
export const SUPPORTED_AGENTS = ["copilot", "claude", "cursor", "codex", "gemini", "windsurf", "generic"];

/**
 * Canonical event source identifiers — matches the `source` field defined in EVENTS.md common fields.
 * Use these when constructing event payloads to avoid magic strings.
 */
export const EVENT_SOURCE = Object.freeze({
  ORCHESTRATOR: "orchestrator",
  WORKER: "worker",
  HUB: "hub",
  BRIDGE: "bridge",
  LIVEGUARD: "liveguard",
  CRUCIBLE: "crucible",
  SKILL: "skill",
  WATCHER: "watcher",
  AUDIT: "audit",
});

/**
 * Canonical security risk levels — matches the `security_risk` field defined in EVENTS.md common fields.
 * Use these when constructing event payloads to avoid magic strings.
 */
export const SECURITY_RISK = Object.freeze({
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

/**
 * Per-event-type security_risk defaults for action-equivalent events.
 * Applied by appendEvent when the caller omits security_risk in data.
 * bridge-edit-blocked is enforced unconditionally (not just as default).
 */
export const SECURITY_RISK_FOR_TYPE = Object.freeze(new Map([
  ["slice-started",        SECURITY_RISK.LOW],
  ["slice-completed",      SECURITY_RISK.LOW],
  ["slice-failed",         SECURITY_RISK.LOW],
  ["skill-step-started",   SECURITY_RISK.LOW],
  ["skill-step-completed", SECURITY_RISK.LOW],
  ["tool-call",            SECURITY_RISK.NONE],
  ["bridge-edit-blocked",  SECURITY_RISK.HIGH],
  ["bridge-edit-approved", SECURITY_RISK.LOW],
]));

/** Default gate timeout: 10 minutes (raised from 2 min in v2.62.1). Override with PFORGE_GATE_TIMEOUT_MS. */
export const DEFAULT_GATE_TIMEOUT_MS = 600_000;
/** Output a validation gate may produce before execFileSync gives up (16 MiB). */
export const GATE_MAX_BUFFER = 16_777_216;

/** Default worker output idle timeout: 8 minutes. Override with PFORGE_WORKER_OUTPUT_IDLE_MS. */
export const DEFAULT_WORKER_OUTPUT_IDLE_MS = 480_000;

/** Default worker total-run timeout: 30 minutes. Override with PFORGE_WORKER_TIMEOUT_MS. */
export const DEFAULT_WORKER_TIMEOUT_MS = 1_800_000;

/**
 * After a timed-out worker is killed, how long to wait for its pipes to close
 * before destroying them. A grandchild that survived the kill (Windows, or a
 * CLI that spawns tools) otherwise keeps the slice waiting forever.
 */
export const WORKER_KILL_GRACE_MS = 10_000;

/**
 * Backoff before retrying a worker that never launched (meta #264), multiplied
 * by the attempt number. The measured cause is a Windows lock on the shared
 * `copilot.ps1` entrypoint when two orchestrators launch at the same moment, so
 * an immediate retry tends to land inside the same lock window.
 */
export const WORKER_LAUNCH_RETRY_BACKOFF_MS = 3_000;

/** Allowlist of commands permitted in validation gates. Shared by runGate() and lintGateCommands(). */
export const GATE_ALLOWED_PREFIXES = [
  // Build / test runners
  "npm", "npx", "node", "pnpm", "yarn", "cargo", "go", "dotnet", "python", "python3",
  "pip", "mvn", "gradle", "make", "cmake", "bash", "sh", "pwsh",
  "powershell", "pytest", "mypy", "ruff", "eslint", "tsc", "vitest",
  "jest", "mocha",
  // Shell builtins & coreutils used in gate commands
  "cd", "cat", "ls", "rm", "mkdir", "cp", "mv", "diff", "wc",
  "head", "tail", "sort", "curl", "git", "grep", "test", "echo",
  "exit", "true", "false",
  // Read-only PowerShell cmdlets emitted by the Windows-portable Plan Hardener.
  // All are inspection-only (no filesystem mutation), so they are safe in gates.
  "test-path", "get-content", "select-string", "get-childitem",
  "where-object", "foreach-object", "measure-object", "select-object",
  "compare-object", "out-string", "write-output", "write-host",
  "resolve-path", "join-path", "split-path", "get-item",
  // Project tools
  "pforge",
];

/**
 * Unix tools not available in cmd.exe on Windows.
 * Shared by runGate() (bash dispatch) and lintGateCommands() (portability lint).
 */
export const UNIX_TOOLS = ["grep", "sed", "awk", "wc", "head", "tail", "sort", "diff", "test", "tr", "xargs", "find"];

/**
 * Resolve the effective command token from a gate line, skipping leading
 * variable assignments so the allowlist check targets the real command.
 *
 * Handles both:
 *   - POSIX env-var assignments:  `NODE_ENV=test npm test`     → `npm`
 *   - PowerShell var assignments: `$p = Get-Content x`         → `get-content`
 *     (with or without spaces around `=`, e.g. `$p=Get-Content`)
 *
 * Shared by runGate() (runtime enforcement) and lintGateCommands() (pre-flight)
 * so a gate that lints clean also executes — see issue #229, where the Plan
 * Hardener's own Windows-portable `$var = ...` gates were rejected.
 *
 * @param {string} line - A single gate command line
 * @returns {string} the lowercased command token, or "" when none resolves
 */
export function resolveGateCommandToken(line) {
  if (!line || typeof line !== "string") return "";
  const tokens = line.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    // POSIX env assignment: NAME=value (command follows in the next token)
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
    // PowerShell assignment with spaces: `$var =` (consume name + the `=` token)
    if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(t) && tokens[i + 1] === "=") { i += 2; continue; }
    // PowerShell assignment without spaces: `$var=Get-Content` — the command
    // is attached after `=`, so resolve to that remainder, not the next token.
    const attached = t.match(/^\$[A-Za-z_][A-Za-z0-9_]*=(.+)$/);
    if (attached) return attached[1].toLowerCase();
    break;
  }
  return (tokens[i] || tokens[0] || "").toLowerCase();
}

/**
 * Check whether a resolved command token is on the gate allowlist.
 * Matches an exact prefix or a path-suffixed form (e.g. `/usr/bin/node`).
 * @param {string} cmdToken - A lowercased command token (see resolveGateCommandToken)
 * @returns {boolean}
 */
export function isGatePrefixAllowed(cmdToken) {
  if (!cmdToken) return false;
  return GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`));
}

// API providers (Grok, OpenAI direct, etc.) are text-completion endpoints
// without tool-call / filesystem access. They are valid for reviewer,
// analysis, quorum-dry-run, and image roles — NOT for code-writing.
export const API_ALLOWED_ROLES = new Set(["reviewer", "quorum-dry-run", "analysis", "image"]);

/**
 * Phase-26 Slice 7 (C4 / D8): a gate suggestion auto-injects into enforce-mode
 * output after this many user accepts have been recorded for the same
 * `(domain, suggestedCommand)` tuple in `.forge/gate-suggestions.jsonl`.
 */
export const GATE_SUGGESTION_AUTO_INJECT_THRESHOLD = 5;

/** Subdirectory under `.forge/` for dry-run patches ready for reviewer. */
export const PROPOSED_FIX_DIR = "proposed-fixes";

/** Default multiplier — a slice ≥ 2× median is an anomaly. */
export const COST_ANOMALY_MULTIPLIER = 2;

/** Phase-25 D7: keep last 10 postmortems per plan basename; age out older. */
export const POSTMORTEM_RETENTION_COUNT = 10;

/**
 * Frontier model the watcher uses for 'analyze' narration.
 * Single-sourced: this value was previously declared independently in
 * hooks.mjs and review-watcher.mjs and restated in two tool descriptions,
 * which is how the descriptions drifted to a stale 4.7.
 */
export const DEFAULT_WATCHER_MODEL = "claude-opus-5.5";

/** xAI flagship appended by the opt-in Grok quorum add-in (quorum.includeGrok). */
export const DEFAULT_GROK_ADDIN_MODEL = "grok-4.7";

/** Grok IDs currently served by GitHub Copilot. Excludes any listed in model-retirements.json. */
export const COPILOT_SERVED_GROK_MODELS = Object.freeze(["grok-4.6", "grok-4.7"]);

/**
 * Quorum fan-out when .forge.json names no preset and no models. Shared by
 * loadQuorumConfig() and the .forge.json schema so the documented default
 * cannot drift from the runtime one. Grok 4.7 is Copilot-served on Copilot
 * hosts, with direct xAI API fallback when routing prefers direct API.
 */
export const DEFAULT_QUORUM_MODELS = Object.freeze(["claude-opus-5.5", "gpt-6-sol", DEFAULT_GROK_ADDIN_MODEL]);

/** Synthesis reviewer paired with DEFAULT_QUORUM_MODELS. */
export const DEFAULT_QUORUM_REVIEWER_MODEL = "claude-opus-5.5";

/** Worker model when .forge.json has no modelRouting block. */
export const DEFAULT_ROUTING_MODEL = "claude-opus-5.5";

/**
 * Base model for cost projections (forge_estimate_slice / forge_estimate_quorum)
 * when the caller names none. Mirrors the gh-copilot defaultModel in
 * worker-capabilities.json; a contract test keeps the two in step.
 */
export const DEFAULT_ESTIMATE_MODEL = "claude-sonnet-5.5";

/**
 * Forge-Master intent router (forgeMaster.routerModel). A fast xAI
 * direct-API model: classification needs speed, not reasoning. The separate
 * pforge-master package restates it; a contract test keeps the two in step.
 */
export const DEFAULT_FORGE_MASTER_ROUTER_MODEL = "grok-4.20-0309-non-reasoning";

/**
 * Retry escalation when .forge.json has no escalationChain and run history is
 * too thin to rank models: auto first, then cross-vendor flagships.
 */
export const DEFAULT_ESCALATION_CHAIN = Object.freeze(["auto", "claude-opus-5.5", "gpt-6-astra"]);

// 2026-09-30 model refresh (GitHub Copilot supported-models + vendor pricing):
// Opus 4.7 retires from Copilot on 2026-10-02, Sonnet 4.6 retired 2026-09-01,
// and GPT-5.4 mini retires 2026-10-19. Claude Opus 5.5 ($4/$20) replaces both
// Opus legs; GPT-6 Astra is OpenAI's flagship. Grok 4.7 is Copilot-served and
// still supports xAI direct API fallback. Both power and speed can now run as
// full three-member quorums on gh-copilot hosts without API keys.
export const QUORUM_PRESETS = {
  // Bug #107: power = the premium tier. The default quorum (quorum.mjs) uses
  // the same Anthropic and xAI members with GPT-6 Sol as its OpenAI leg.
  power: {
    models: ["claude-opus-5.5", "gpt-6-astra", "grok-4.7"],
    reviewerModel: "claude-opus-5.5",
    dryRunTimeout: 300_000,
    threshold: 5,
    availableIn: {
      "cli-gh": ["claude-opus-5.5", "gpt-6-astra", "grok-4.7"],
      "cli-claude": ["claude-opus-5.5"],
      "cli-codex": ["gpt-6-astra"],
      "vs-code-copilot-chat": ["claude-opus-5.5", "gpt-6-astra", "grok-4.7"],
      "vs-code-agents-enterprise": ["claude-opus-5.5", "gpt-6-astra", "grok-4.7"],
    },
    fallbacks: {
      "cli-gh": { preset: "speed", reason: "Fewer than 2 power models are available through gh-copilot on this machine" },
    },
  },
  speed: {
    models: ["claude-sonnet-5.5", "gpt-6-luna", "gemini-3.8-flash"],
    reviewerModel: "claude-sonnet-5.5",
    dryRunTimeout: 120_000,
    threshold: 7,
    availableIn: {
      "cli-gh": ["claude-sonnet-5.5", "gpt-6-luna", "gemini-3.8-flash"],
      "cli-claude": ["claude-sonnet-5.5"],
      "cli-codex": ["gpt-6-luna"],
      "vs-code-copilot-chat": ["claude-sonnet-5.5", "gpt-6-luna", "gemini-3.8-flash"],
      "vs-code-agents-enterprise": ["claude-sonnet-5.5", "gpt-6-luna", "gemini-3.8-flash"],
    },
    fallbacks: {},
  },
  "power-gov": {
    // Azure Government Foundry catalog (learn.microsoft.com "Foundry Models sold by
    // Azure in Azure Government", updated 2026-09-01). OpenAI-only; o3-mini is gone.
    models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.1"],
    reviewerModel: "gpt-5.6-terra",
    dryRunTimeout: 300_000,
    threshold: 5,
    availableIn: {
      "microsoft-foundry": ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.1"],
    },
    fallbacks: {},
  },
};

/**
 * Every model Plan Forge picks on the user's behalf, once each: the routing,
 * estimate, watcher and quorum defaults, the escalation chain, and the power
 * and speed quorum presets. The model-defaults contract and the weekly model
 * drift check (#303) both walk this list.
 */
export function defaultedModels() {
  return [...new Set([
    DEFAULT_WATCHER_MODEL,
    DEFAULT_GROK_ADDIN_MODEL,
    DEFAULT_ROUTING_MODEL,
    DEFAULT_ESTIMATE_MODEL,
    DEFAULT_QUORUM_REVIEWER_MODEL,
    ...DEFAULT_QUORUM_MODELS,
    ...DEFAULT_ESCALATION_CHAIN.filter((m) => m !== "auto"),
    ...["power", "speed"].flatMap((p) => [...QUORUM_PRESETS[p].models, QUORUM_PRESETS[p].reviewerModel]),
  ])];
}

/**
 * 7-day default for “stalled” in-progress smelts. Long enough that Smith and
 * watcher all flag the same smelts.
 */
export const CRUCIBLE_STALL_CUTOFF_DAYS = 7;

export const REVIEW_SOURCES = Object.freeze(new Set([
  "stall",
  "tempering",
  "bug",
  "visual-baseline",
  "fix-plan",
]));
export const REVIEW_SEVERITIES = Object.freeze(new Set(["blocker", "high", "medium", "low"]));
export const REVIEW_STATUSES = Object.freeze(new Set(["open", "resolved", "deferred"]));
export const REVIEW_RESOLUTIONS = Object.freeze(new Set(["approve", "reject", "defer"]));
