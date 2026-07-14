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

/** Default worker output idle timeout: 8 minutes. Override with PFORGE_WORKER_OUTPUT_IDLE_MS. */
export const DEFAULT_WORKER_OUTPUT_IDLE_MS = 480_000;

/** Default worker total-run timeout: 30 minutes. Override with PFORGE_WORKER_TIMEOUT_MS. */
export const DEFAULT_WORKER_TIMEOUT_MS = 1_800_000;

/** Allowlist of commands permitted in validation gates. Shared by runGate() and lintGateCommands(). */
export const GATE_ALLOWED_PREFIXES = [
  // Build / test runners
  "npm", "npx", "node", "cargo", "go", "dotnet", "python", "python3",
  "pip", "mvn", "gradle", "make", "cmake", "bash", "sh", "pwsh",
  "powershell", "pytest", "mypy", "ruff", "eslint", "tsc", "vitest",
  "jest", "mocha",
  // Shell builtins & coreutils used in gate commands
  "cd", "cat", "ls", "rm", "mkdir", "cp", "mv", "diff", "wc",
  "head", "tail", "sort", "curl", "git", "grep", "test", "echo",
  "exit", "true", "false",
  // Project tools
  "pforge",
];

/**
 * Unix tools not available in cmd.exe on Windows.
 * Shared by runGate() (bash dispatch) and lintGateCommands() (portability lint).
 */
export const UNIX_TOOLS = ["grep", "sed", "awk", "wc", "head", "tail", "sort", "diff", "test", "tr", "xargs", "find"];

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

export const QUORUM_PRESETS = {
  // Bug #107: power = the premium tier (opus-4.8). Previously this preset
  // shipped opus-4.6 and the default shipped opus-4.7 — backwards.
  power: {
    models: ["claude-opus-4.8", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    reviewerModel: "claude-opus-4.8",
    dryRunTimeout: 300_000,
    threshold: 5,
    availableIn: {
      "cli-gh": ["claude-opus-4.8"],
      "cli-claude": ["claude-opus-4.8"],
      "cli-codex": ["gpt-5.3-codex"],
      "vs-code-copilot-chat": ["claude-opus-4.8"],
      "vs-code-agents-enterprise": ["claude-opus-4.8", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    },
    fallbacks: {
      "cli-gh": { preset: "speed", reason: "Only 1 of 3 power models available via gh-copilot without API keys" },
    },
  },
  speed: {
    // 2026-05-21 model refresh: grok-4-1-fast-reasoning was retired by xAI on
    // 2026-05-15. Swapped to grok-4.20-0309-non-reasoning (live, same family
    // as the power preset's grok, non-reasoning variant for speed-tier latency).
    models: ["claude-sonnet-4.6", "gpt-5.4-mini", "grok-4.20-0309-non-reasoning"],
    reviewerModel: "claude-sonnet-4.6",
    dryRunTimeout: 120_000,
    threshold: 7,
    availableIn: {
      "cli-gh": ["claude-sonnet-4.6", "gpt-5.4-mini"],
      "cli-claude": ["claude-sonnet-4.6"],
      "cli-codex": ["gpt-5.4-mini"],
      "vs-code-copilot-chat": ["claude-sonnet-4.6", "gpt-5.4-mini"],
      "vs-code-agents-enterprise": ["claude-sonnet-4.6", "gpt-5.4-mini", "grok-4.20-0309-non-reasoning"],
    },
    fallbacks: {},
  },
  "power-gov": {
    models: ["gpt-5.1", "gpt-4.1", "gpt-4.1-mini", "o3-mini", "gpt-4o"],
    reviewerModel: "gpt-4.1",
    dryRunTimeout: 300_000,
    threshold: 5,
    availableIn: {
      "microsoft-foundry": ["gpt-5.1", "gpt-4.1", "gpt-4.1-mini", "o3-mini", "gpt-4o"],
    },
    fallbacks: {},
  },
};

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
