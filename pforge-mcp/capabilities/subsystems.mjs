/**
 * Plan Forge — Inner-Loop Subsystem Surface sub-module
 *
 * Contains the INNER_LOOP_SURFACE declarative description of Phase-25/26
 * inner-loop feedback subsystems. Extracted from capabilities.mjs (Slice 3,
 * Phase-51 capabilities split).
 *
 * @module capabilities/subsystems
 */

/**
 * Declarative description of the inner-loop subsystems added in Phase-25.
 * Surfaces via `forge_capabilities` so IDEs + MCP consumers (including the
 * Dashboard Config tab) auto-discover the subsystems and their opt-in state.
 * All new subsystems default off/suggest/read-only per the Phase-25 opt-in
 * invariant — existing users see zero behavior change.
 */
export const INNER_LOOP_SURFACE = Object.freeze({
  schemaVersion: "1.1",
  description: "Inner-loop feedback subsystems. Phase-25 (v2.57) shipped reflexion/trajectory/autoSkills/gateSynthesis/postmortem/federation/reviewer. Phase-26 (v2.58) adds competitive/autoFix/costAnomaly. All subsystems are opt-in for existing users; new projects receive the best-defaults preset via setup.ps1/setup.sh.",
  subsystems: {
    reflexion: {
      level: "L7",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "On gate-fail retry, injects a Markdown reflexion block (gate name, model, durationMs, stderrTail ≤2KB) into the next attempt's prompt so the worker can reason about its prior failure.",
      configKey: null,
      dashboardTab: "Traces",
      module: "pforge-mcp/memory.mjs → buildReflexionBlock()",
    },
    trajectory: {
      level: "L8",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "On slice pass, extracts a sentinel-wrapped trajectory note (≤500 words) from the worker output and writes it to .forge/trajectories/<slice>/<iso>.md for postmortem + federation consumers.",
      configKey: null,
      storage: ".forge/trajectories/",
      dashboardTab: "Replay",
      module: "pforge-mcp/memory.mjs → writeTrajectory()",
    },
    autoSkills: {
      level: "L2",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "Captures slice patterns as auto-skill Markdown files under .forge/auto-skills/ and promotes them once reuseCount reaches the promotion threshold (default 3). Skills are injected into future matching slices.",
      configKey: null,
      storage: ".forge/auto-skills/",
      promotionThreshold: 3,
      dashboardTab: "Skills",
      module: "pforge-mcp/memory.mjs → retrieveAutoSkills() / writeAutoSkill()",
    },
    gateSynthesis: {
      level: "L6",
      addedIn: "2.57.0",
      enabledByDefault: true,
      mode: "suggest",
      description: "Scans plan slices against Tempering domain minima. When a slice matches a profile (domain/integration/controller) but declares no validation gate, prints a suggested command. Never mutates plans. Enforce-mode tracking deferred to Phase-26.",
      configKey: "runtime.gateSynthesis",
      configDefaults: { mode: "suggest", domains: ["domain", "integration", "controller"] },
      dashboardTab: "Config",
      module: "pforge-mcp/orchestrator.mjs → synthesizeGateSuggestions()",
    },
    postmortem: {
      level: "L5",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "After every run (pass or fail), writes a JSON postmortem with retriesPerSlice, gateFlaps, costDelta, driftDelta, topFailureReason. Retention 10 per plan (D7). Step-2 hardener reads the newest 3 to fold signal back into scope decisions.",
      storage: ".forge/plans/<plan-basename>/postmortem-*.json",
      retentionCount: 10,
      dashboardTab: "Runs",
      module: "pforge-mcp/orchestrator.mjs → buildPlanPostmortem() / writePlanPostmortem()",
    },
    federation: {
      level: "L4-lite",
      addedIn: "2.57.0",
      enabledByDefault: false,
      description: "Read-only cross-project memory fan-out. On brain.recall for a cross.* key that misses L3, reads peer projects' .forge/brain/<entity>/<id>.json. Absolute local paths only; URLs and relative paths rejected.",
      configKey: "brain.federation",
      configDefaults: { enabled: false, repos: [] },
      securityPosture: "absolute-local-paths-only (D9); '..' rejected; defense-in-depth checks resolved path lives under declared repo root",
      dashboardTab: "Config",
      module: "pforge-mcp/brain.mjs → federationRead()",
    },
    reviewer: {
      level: "L4",
      addedIn: "2.57.0",
      enabledByDefault: false,
      advisoryOnly: true,
      description: "Opt-in speed-quorum reviewer that scores slice diffs inside brain.gate-check. Advisory-only in v2.57; critical verdicts do NOT block unless operators explicitly set blockOnCritical=true.",
      configKey: "runtime.reviewer",
      configDefaults: { enabled: false, quorumPreset: "speed", blockOnCritical: false, timeoutMs: 30000 },
      dashboardTab: "Config",
      module: "pforge-mcp/brain.mjs → invokeReviewer()",
    },

    // ─── Phase-26 v2.58 additions ────────────────────────────────
    // Each subsystem ships in advisory posture by default. None take a
    // destructive action without an explicit opt-in.
    competitive: {
      level: "L9",
      addedIn: "2.58.0",
      enabledByDefault: false,
      description: "Opt-in worktree-based competitive execution. Two or more strategies race to complete a slice under isolated worktrees; the winner is elected by gate + reviewer verdict + token-cost tie-breaker. Other worktrees are cleaned up. Off by default — opt in via innerLoop.competitive.enabled.",
      configKey: "innerLoop.competitive",
      configDefaults: { enabled: false, maxParallel: 2, timeoutSec: 1800 },
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → runCompetitiveSlice()",
    },
    autoFix: {
      level: "L6",
      addedIn: "2.58.0",
      enabledByDefault: true,
      advisoryOnly: true,
      description: "Drafts patch files under .forge/proposed-fixes/*.patch when a gate-fail trajectory suggests a small, local correction. Never auto-applies without applyWithoutReview=true.",
      configKey: "innerLoop.autoFix",
      configDefaults: { enabled: true, applyWithoutReview: false },
      storage: ".forge/proposed-fixes/",
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → applyFixProposal() / rollbackFixProposal()",
    },
    costAnomaly: {
      level: "L5",
      addedIn: "2.58.0",
      enabledByDefault: true,
      advisoryOnly: true,
      description: "Detects slices whose token cost drifts above the per-model median by more than the configured ratio. Advisory only — surfaces on Dashboard → Inner Loop → Cost anomalies; never halts a run.",
      configKey: "innerLoop.costAnomaly",
      configDefaults: { enabled: true, ratio: 2.0, medianWindow: 20 },
      storage: ".forge/cost-anomalies.jsonl",
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → detectCostAnomaly() / computeMedian()",
    },
  },
});
