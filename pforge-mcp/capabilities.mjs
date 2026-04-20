/**
 * Plan Forge — Machine-Readable API Surface (v2.3)
 *
 * Provides:
 *   - Enriched tool metadata (intent, prerequisites, errors, cost, workflows)
 *   - CLI command schema
 *   - Configuration schema
 *   - Auto-generated tools.json
 *   - forge_capabilities MCP tool
 *   - .well-known/plan-forge.json HTTP endpoint
 *
 * @module capabilities
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { isOpenBrainConfigured } from "./memory.mjs";

const VERSION = "2.3.0"; // capability-surface schema version (not the app version)

// App version — read from the repo's VERSION file at module load.
// Falls back gracefully if the file is missing (e.g. when Plan Forge is installed as a dependency).
const APP_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // pforge-mcp/capabilities.mjs → repo root is one level up
    const versionPath = join(here, "..", "VERSION");
    if (existsSync(versionPath)) {
      return readFileSync(versionPath, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return "unknown";
})();

// ─── Enriched Tool Metadata ───────────────────────────────────────────

export const TOOL_METADATA = {
  forge_smith: {
    intent: ["diagnose", "inspect", "health-check"],
    aliases: ["inspect-forge", "health-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge.json", ".github/"],
    sideEffects: [],
    errors: {
      NOT_GIT_REPO: { message: "Not inside a git repository", recovery: "Run from a git-initialized project" },
    },
    example: { input: {}, output: { summary: "8 passed, 1 failed, 2 warnings" } },
  },
  forge_validate: {
    intent: ["validate", "check", "verify"],
    aliases: ["check-setup", "validate-setup"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [".forge.json exists"],
    produces: [],
    consumes: [".forge.json", ".github/"],
    sideEffects: [],
    errors: {
      NO_CONFIG: { message: ".forge.json not found", recovery: "Run setup first" },
    },
    example: { input: {}, output: { result: "17 passed, 0 failed" } },
  },
  forge_sweep: {
    intent: ["scan", "audit", "completeness"],
    aliases: ["find-todos", "completeness-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["src/**", "tests/**"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { markers: 3, locations: ["src/api.ts:42 TODO", "..."] } },
  },
  forge_status: {
    intent: ["read", "status", "overview"],
    aliases: ["phase-status", "roadmap-status"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: ["docs/plans/DEPLOYMENT-ROADMAP.md exists"],
    produces: [],
    consumes: ["docs/plans/DEPLOYMENT-ROADMAP.md"],
    sideEffects: [],
    errors: {
      NO_ROADMAP: { message: "DEPLOYMENT-ROADMAP.md not found", recovery: "Create docs/plans/DEPLOYMENT-ROADMAP.md or run pforge new-phase" },
    },
    example: { input: {}, output: { phases: [{ name: "Phase 1", status: "complete" }] } },
  },
  forge_diff: {
    intent: ["compare", "drift-detect", "scope-check"],
    aliases: ["scope-drift", "check-drift"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: ["plan file exists", "git initialized"],
    produces: [],
    consumes: ["docs/plans/*.md"],
    sideEffects: [],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path" },
    },
    example: { input: { plan: "docs/plans/Phase-1.md" }, output: { drift: false, forbidden: 0 } },
  },
  forge_analyze: {
    intent: ["analyze", "score", "audit"],
    aliases: ["consistency-check", "plan-analysis"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "1.3.0",
    prerequisites: ["plan file exists"],
    produces: [],
    consumes: ["docs/plans/*.md", "src/**", "tests/**"],
    sideEffects: [],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path" },
      LOW_SCORE: { message: "Score below 60%", recovery: "Review gaps in traceability, coverage, tests, or gates" },
    },
    example: { input: { plan: "docs/plans/Phase-1.md" }, output: { score: 85, status: "passed" } },
  },
  forge_run_plan: {
    intent: ["execute", "automate", "run"],
    aliases: ["execute-plan", "run-plan"],
    cost: "high",
    maxConcurrent: 1,
    addedIn: "2.0.0",
    prerequisites: ["plan file exists", "gh copilot CLI installed (for auto mode)"],
    produces: [".forge/runs/<timestamp>/summary.json", ".forge/runs/<timestamp>/slice-N.json"],
    consumes: ["docs/plans/*.md", ".forge.json"],
    sideEffects: ["creates/modifies source files", "runs build/test commands", "spawns CLI workers"],
    quorum: {
      addedIn: "2.5.0",
      description: "Multi-model consensus: dispatch to 3+ models for dry-run analysis, synthesize best approach, then execute",
      parameters: {
        quorum: { type: "string", enum: ["false", "true", "auto"], default: "auto", description: "Quorum mode (default: 'auto' — threshold-based; 'true' forces all slices; 'false' disables)" },
        quorumThreshold: { type: "number", description: "Complexity score threshold for auto mode (1-10, default: 6)" },
      },
      config: ".forge.json → quorum { enabled, auto, threshold, models[], reviewerModel, dryRunTimeout }",
    },
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the path or run forge_status to see available plans" },
      NO_WORKER: { message: "No CLI workers available", recovery: "Install gh copilot CLI, or use mode: 'assisted'" },
      GATE_FAILED: { message: "Validation gate failed", recovery: "Check slice results, fix code, use resumeFrom to continue" },
      ABORTED: { message: "Run was aborted", recovery: "Re-run or use resumeFrom to continue from last slice" },
    },
    example: {
      input: { plan: "docs/plans/Phase-1.md", estimate: true },
      output: { status: "estimate", sliceCount: 4, estimatedCostUSD: 0.32, confidence: "heuristic" },
    },
  },
  forge_abort: {
    intent: ["stop", "cancel", "abort"],
    aliases: ["stop-run", "cancel-execution"],
    cost: "low",
    maxConcurrent: 1,
    addedIn: "2.0.0",
    prerequisites: ["active run in progress"],
    produces: [],
    consumes: [],
    sideEffects: ["stops execution after current slice"],
    errors: {
      NO_ACTIVE_RUN: { message: "No active plan execution to abort", recovery: "No action needed" },
    },
    example: { input: {}, output: { message: "Abort signal sent" } },
  },
  forge_plan_status: {
    intent: ["read", "status", "progress"],
    aliases: ["run-status", "check-progress"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.0.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/runs/"],
    sideEffects: [],
    errors: {
      NO_RUNS: { message: "No runs found", recovery: "Run forge_run_plan first" },
    },
    example: { input: {}, output: { status: "completed", passed: 4, failed: 0 } },
  },
  forge_cost_report: {
    intent: ["read", "cost", "billing"],
    aliases: ["cost-summary", "token-report"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.0.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/cost-history.json", ".forge/model-performance.json"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { runs: 5, total_cost_usd: 1.23, by_model: {}, forge_model_stats: { "claude-sonnet-4.6": { total_slices: 10, passed: 9, failed: 1, success_rate: 0.9, avg_cost_usd: 0.05 } } } },
  },
  forge_ext_search: {
    intent: ["search", "browse", "discover"],
    aliases: ["find-extensions", "browse-catalog"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["extensions/catalog.json"],
    sideEffects: [],
    errors: {},
    example: { input: { query: "azure" }, output: { results: [] } },
  },
  forge_ext_info: {
    intent: ["read", "detail", "info"],
    aliases: ["extension-detail"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["extensions/catalog.json"],
    sideEffects: [],
    errors: {
      NOT_FOUND: { message: "Extension not found", recovery: "Use forge_ext_search to find available extensions" },
    },
    example: { input: { name: "azure-infrastructure" }, output: { name: "azure-infrastructure", version: "1.0.0" } },
  },
  forge_new_phase: {
    intent: ["create", "scaffold", "plan"],
    aliases: ["new-plan", "create-phase"],
    cost: "low",
    maxConcurrent: 1,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: ["docs/plans/Phase-N-<name>-PLAN.md", "docs/plans/DEPLOYMENT-ROADMAP.md (updated)"],
    consumes: [],
    sideEffects: ["creates plan file", "updates roadmap"],
    errors: {},
    example: { input: { name: "user-auth" }, output: { file: "docs/plans/Phase-1-USER-AUTH-PLAN.md" } },
  },
  forge_capabilities: {
    intent: ["discover", "introspect", "api-surface"],
    aliases: ["get-capabilities", "discover-tools", "api-schema"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.3.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge.json", ".vscode/mcp.json"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { tools: 28, workflows: 4, memory: { configured: true } } },
  },
  forge_diagnose: {
    intent: ["analyze", "debug", "investigate"],
    aliases: ["bug-investigate", "multi-model-debug", "root-cause"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.15.0",
    prerequisites: ["file exists"],
    produces: [],
    consumes: ["src/**", "tests/**"],
    sideEffects: [],
    errors: {
      FILE_NOT_FOUND: { message: "Target file not found", recovery: "Check the file path" },
    },
    example: { input: { file: "src/api.ts" }, output: { diagnosis: "Root cause identified", models: 3 } },
  },
  forge_skill_status: {
    intent: ["read", "status", "skills"],
    aliases: ["skill-events", "recent-skills"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.16.0",
    prerequisites: [],
    produces: [],
    consumes: [],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { events: [] } },
  },
  forge_run_skill: {
    intent: ["execute", "skill", "automate"],
    aliases: ["invoke-skill", "execute-skill"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.16.0",
    prerequisites: ["skill exists"],
    produces: [],
    consumes: [".github/skills/*.md"],
    sideEffects: ["may modify source files depending on skill"],
    errors: {
      SKILL_NOT_FOUND: { message: "Skill not found", recovery: "Use forge_skill_status to list available skills" },
    },
    example: { input: { skill: "test-sweep" }, output: { status: "completed", steps: 5 } },
  },
  forge_org_rules: {
    intent: ["generate", "export", "org-standards"],
    aliases: ["org-rules-export", "org-instructions"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.15.0",
    prerequisites: [".forge.json exists"],
    produces: ["org-rules.instructions.md"],
    consumes: [".forge.json", ".github/instructions/*.instructions.md"],
    sideEffects: ["generates org-rules instruction file"],
    errors: {},
    example: { input: {}, output: { file: "org-rules.instructions.md", rules: 12 } },
  },
  forge_memory_capture: {
    intent: ["capture", "remember", "persist"],
    aliases: ["save-thought", "memory-broadcast"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.6.0",
    prerequisites: [],
    produces: [],
    consumes: [],
    sideEffects: ["broadcasts memory-captured hub event"],
    errors: {},
    example: { input: { content: "Use JWT for auth", type: "convention" }, output: { event: "memory-captured" } },
  },
  forge_crucible_submit: {
    intent: ["crucible", "submit", "smelt-start"],
    aliases: ["crucible-submit", "start-smelt"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.37.0",
    prerequisites: [],
    produces: [".forge/crucible/<id>.json"],
    consumes: [],
    sideEffects: ["creates smelt record", "broadcasts crucible-smelt-started event"],
    errors: {
      MISSING_RAW_IDEA: { message: "rawIdea is required", recovery: "Supply a non-empty rawIdea string" },
      INVALID_LANE: { message: "invalid lane", recovery: "Use tweak | feature | full, or omit to accept the heuristic" },
    },
    example: {
      input: { rawIdea: "add rate limiting to the login endpoint" },
      output: { id: "uuid", recommendedLane: "feature", firstQuestion: null },
    },
  },
  forge_crucible_ask: {
    intent: ["crucible", "interview", "ask"],
    aliases: ["crucible-ask", "smelt-ask"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.37.0",
    prerequisites: ["smelt exists and is in-progress"],
    produces: [".forge/crucible/<id>.json"],
    consumes: [".forge/crucible/<id>.json"],
    sideEffects: ["updates smelt record", "broadcasts crucible-smelt-updated event"],
    errors: {
      SMELT_NOT_FOUND: { message: "smelt not found: <id>", recovery: "Verify the smelt id via forge_crucible_list" },
      WRONG_STATUS: { message: "smelt is finalized/abandoned, cannot continue interview", recovery: "Start a new smelt with forge_crucible_submit" },
    },
    example: {
      input: { id: "uuid", answer: "yes, API-wide rate limit" },
      output: { done: true, nextQuestion: null, draftPreview: "# ..." },
    },
  },
  forge_crucible_preview: {
    intent: ["crucible", "preview", "draft"],
    aliases: ["crucible-preview", "smelt-preview"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.37.0",
    prerequisites: ["smelt exists"],
    produces: [],
    consumes: [".forge/crucible/<id>.json"],
    sideEffects: [],
    errors: {
      SMELT_NOT_FOUND: { message: "smelt not found: <id>", recovery: "Verify the smelt id via forge_crucible_list" },
    },
    example: {
      input: { id: "uuid" },
      output: { markdown: "# ...", phaseName: null, unresolvedFields: [] },
    },
  },
  forge_crucible_finalize: {
    intent: ["crucible", "finalize", "emit-plan"],
    aliases: ["crucible-finalize", "smelt-finalize"],
    cost: "low",
    maxConcurrent: 1,
    addedIn: "2.37.0",
    prerequisites: ["smelt exists and is in-progress"],
    produces: ["docs/plans/Phase-NN.md", ".forge/crucible/phase-claims.json"],
    consumes: [".forge/crucible/<id>.json", "docs/plans/Phase-*.md"],
    sideEffects: ["writes plan file", "claims phase number atomically", "broadcasts crucible-smelt-finalized event"],
    errors: {
      SMELT_NOT_FOUND: { message: "smelt not found: <id>", recovery: "Verify the smelt id" },
      WRONG_STATUS: { message: "smelt is finalized/abandoned, cannot finalize", recovery: "Only in-progress smelts can be finalized" },
      PHASE_CLAIMED: { message: "phase already claimed", recovery: "Retry — the phase-claim race resolver will pick the next number" },
    },
    example: {
      input: { id: "uuid" },
      output: { phaseName: "Phase-07", planPath: "docs/plans/Phase-07.md", hardenerInvoked: false },
    },
  },
  forge_crucible_list: {
    intent: ["crucible", "list", "smelts"],
    aliases: ["crucible-list", "list-smelts"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.37.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/crucible/"],
    sideEffects: [],
    errors: {},
    example: {
      input: { status: "in-progress" },
      output: { smelts: [{ id: "uuid", lane: "feature", rawIdea: "...", status: "in-progress" }] },
    },
  },
  forge_crucible_abandon: {
    intent: ["crucible", "abandon", "discard"],
    aliases: ["crucible-abandon", "smelt-abandon"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.37.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/crucible/<id>.json"],
    sideEffects: ["marks smelt abandoned", "releases phase-number claim if held"],
    errors: {},
    example: {
      input: { id: "uuid" },
      output: { abandoned: true },
    },
  },
  forge_tempering_scan: {
    intent: ["tempering", "coverage", "scan", "read-only"],
    aliases: ["tempering-scan", "coverage-scan"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.42.0",
    prerequisites: [],
    produces: [".forge/tempering/scan-<ts>.json", ".forge/tempering/config.json (first run)"],
    consumes: [
      "coverage/lcov.info",
      "coverage/coverage-final.json",
      "coverage/cobertura.xml",
      "TestResults/coverage.cobertura.xml",
      "coverage.xml",
      "coverage.json",
      "target/site/jacoco/jacoco.xml",
      "build/reports/jacoco/test/jacocoTestReport.xml",
      "coverage.out",
      "cover.out",
      "tarpaulin-report.json",
      "lcov.info",
    ],
    sideEffects: [
      "creates .forge/tempering/ on first run",
      "seeds config.json with enterprise defaults on first run (never overwrites)",
      "writes scan record",
      "broadcasts tempering-scan-started and tempering-scan-completed hub events",
      "captures scan summary to L3 via captureMemory (best-effort)",
    ],
    errors: {
      UNKNOWN_STACK: { message: "Could not detect project stack", recovery: "Ensure one of package.json / *.csproj / pyproject.toml / go.mod / Cargo.toml / pom.xml exists at the project root" },
      NO_COVERAGE: { message: "No coverage report found for detected stack", recovery: "Generate a coverage report with your test runner's coverage flag (e.g. vitest --coverage, dotnet test --collect:\"XPlat Code Coverage\", pytest --cov=. --cov-report=xml)" },
      PARSE_EMPTY: { message: "Coverage report parsed to zero records", recovery: "Verify the report is non-empty and matches the expected format" },
    },
    example: {
      input: {},
      output: {
        ok: true,
        scanId: "scan-2026-04-19T...",
        stack: "typescript",
        status: "amber",
        coverageVsMinima: [{ layer: "domain", minimum: 90, actual: 76, gap: 14, files: [] }],
      },
    },
  },
  forge_tempering_status: {
    intent: ["tempering", "status", "history"],
    aliases: ["tempering-status", "coverage-status"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.42.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/tempering/scan-*.json"],
    sideEffects: [],
    errors: {},
    example: {
      input: { limit: 5 },
      output: {
        ok: true,
        initialized: true,
        state: { totalScans: 3, latestStatus: "amber", gaps: 1, belowMinimum: 1, stale: false, staleCutoffDays: 7 },
        scans: [],
      },
    },
  },
  forge_tempering_run: {
    intent: ["tempering", "run", "execute", "unit-tests", "contract", "visual-diff", "mutation"],
    aliases: ["tempering-run", "run-tempering", "run-tests"],
    cost: "medium",
    maxConcurrent: 1,
    addedIn: "2.43.0",
    prerequisites: [
      "project stack is one of: typescript, dotnet, python, go, java, rust",
      "test runner available on PATH (npx/dotnet/pytest/go/mvn/cargo)",
    ],
    produces: [".forge/tempering/run-<ts>.json", ".forge/tempering/artifacts/<runId>/contract/report.json", ".forge/tempering/artifacts/<runId>/visual-diff/report.json"],
    consumes: [".forge/tempering/config.json", "presets/<stack>/tempering-adapter.mjs"],
    sideEffects: [
      "spawns a test-runner subprocess",
      "enforces config.runtimeBudgets.unitMaxMs (SIGTERM then SIGKILL)",
      "broadcasts tempering-run-started / tempering-run-scanner-started / tempering-run-scanner-completed / tempering-run-completed hub events",
      "captures an L3 memory entry on completion",
    ],
    errors: {
      MISSING_PROJECTDIR: { message: "projectDir required", recovery: "Pass `path` or invoke from a project directory" },
      NO_ADAPTER: { message: "No preset adapter for detected stack", recovery: "Install the matching preset or extend presets/<stack>/tempering-adapter.mjs" },
    },
    example: {
      input: { sliceRef: { plan: "Phase-FOO.md", slice: "04.1" } },
      output: { ok: true, runId: "run-2026-04-19T...", stack: "typescript", verdict: "pass", scanners: [{ scanner: "unit", pass: 412, fail: 0, skipped: 1 }, { scanner: "contract", pass: 8, fail: 0, violations: [] }, { scanner: "visual-diff", verdict: "pass", pass: 3, fail: 0 }] },
    },
  },
  forge_tempering_approve_baseline: {
    intent: ["approve", "baseline", "visual"],
    aliases: ["approve-baseline", "promote-baseline", "accept-visual"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.45.0",
    prerequisites: [],
    produces: [".forge/tempering/baselines/"],
    consumes: [".forge/tempering/screenshots/", ".forge/tempering/baselines/", ".forge/tempering/artifacts/"],
    sideEffects: ["filesystem-write", "broadcasts tempering-baseline-promoted hub event"],
    errors: {
      NO_SCREENSHOT: { message: "No screenshot found for the given hash", recovery: "Run forge_tempering_run first to capture screenshots, then approve" },
      ALREADY_BASELINE: { message: "Baseline already exists (will be overwritten)", recovery: "This is informational — promotion is idempotent" },
      INVALID_URL_HASH: { message: "urlHash or url is required", recovery: "Provide either urlHash from the visual-diff scanner output or the full URL" },
    },
    example: {
      input: { urlHash: "a1b2c3d4e5f67890" },
      output: { ok: true, urlHash: "a1b2c3d4e5f67890", baselinePath: ".forge/tempering/baselines/a1b2c3d4e5f67890.png" },
    },
  },
  // Phase TEMPER-06 Slice 06.1 — Bug Registry
  forge_bug_register: {
    intent: ["tempering", "bug", "register", "create"],
    aliases: ["bug-register", "register-bug"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.47.0",
    prerequisites: [".forge/tempering/ exists (auto-created)"],
    produces: [".forge/bugs/<bugId>.json"],
    consumes: [".forge/tempering/config.json", ".forge/tempering/run-*.json (for flakiness data)"],
    sideEffects: [
      "creates .forge/bugs/ on first run",
      "writes bug JSON record (real-bug only)",
      "broadcasts tempering-bug-registered hub event",
      "captures L3 memory via captureMemory (real-bug only)",
    ],
    errors: {
      MISSING_EVIDENCE: { message: "Evidence must include testName or assertionMessage+stackTrace", recovery: "Provide at least testName in the evidence object" },
      DUPLICATE_BUG: { message: "Bug with same fingerprint already exists", recovery: "Use forge_bug_list to find the existing bug" },
      CLASSIFIER_FAILED: { message: "Bug classifier could not determine classification", recovery: "Manually set classification or retry with more evidence" },
      SCANNER_NOT_RECOGNIZED: { message: "Scanner name not in known list", recovery: "Use one of the 9 supported scanner names" },
    },
    example: {
      input: { scanner: "visual-diff", evidence: { testName: "homepage", assertionMessage: "pixel diff > threshold" } },
      output: { ok: true, bugId: "bug-2026-04-19-001", classification: "real-bug" },
    },
  },
  forge_bug_list: {
    intent: ["tempering", "bug", "list", "query"],
    aliases: ["bug-list", "list-bugs", "bug-query"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.47.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/bugs/*.json"],
    sideEffects: [],
    errors: {},
    example: {
      input: { status: "open", severity: "high" },
      output: { ok: true, count: 2, bugs: [{ bugId: "bug-2026-04-19-001", scanner: "unit", severity: "high", status: "open" }] },
    },
  },
  forge_bug_update_status: {
    intent: ["tempering", "bug", "status", "update"],
    aliases: ["bug-update", "update-bug-status", "bug-transition"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.47.0",
    prerequisites: ["bug exists in .forge/bugs/"],
    produces: [],
    consumes: [".forge/bugs/<bugId>.json"],
    sideEffects: [
      "updates .forge/bugs/<bugId>.json",
      "broadcasts tempering-bug-status-changed hub event",
    ],
    errors: {
      BUG_NOT_FOUND: { message: "Bug ID not found in registry", recovery: "Use forge_bug_list to find valid bug IDs" },
      INVALID_TRANSITION: { message: "Status transition not allowed", recovery: "Check VALID_TRANSITIONS for allowed transitions from current status" },
    },
    example: {
      input: { bugId: "bug-2026-04-19-001", newStatus: "in-fix" },
      output: { ok: true, bugId: "bug-2026-04-19-001", newStatus: "in-fix" },
    },
  },
  forge_bug_validate_fix: {
    intent: ["validate-fix", "bug-validate", "closed-loop", "verify-fix"],
    aliases: ["bug-validate-fix", "validate-bug-fix"],
    cost: "medium",
    maxConcurrent: 1,
    addedIn: "2.47.0",
    prerequisites: [
      "Bug exists in .forge/bugs/",
      "Scanner named by bug.scanner is available in tempering/scanners/",
    ],
    produces: [],
    consumes: [".forge/bugs/<bugId>.json", ".forge/tempering/*.json"],
    sideEffects: [
      "re-runs scanner(s) that discovered the bug",
      "appends bug.validationAttempts[]",
      "on pass: updates bug status to 'fixed'",
      "on pass: dispatches commentValidatedFix to bug-adapter",
      "on pass: broadcasts tempering-bug-validated-fixed event",
      "on pass with OpenBrain configured: saves L3 thought",
    ],
    errors: {
      BUG_NOT_FOUND: { message: "Bug ID not found in registry", recovery: "Use forge_bug_list to find valid bug IDs" },
      ALREADY_FIXED: { message: "Bug already in terminal status", recovery: "No action needed — bug is already resolved" },
      SCANNER_UNAVAILABLE: { message: "Scanner that discovered the bug is no longer registered", recovery: "Use scannerOverride to specify an alternative scanner" },
    },
    example: {
      input: { bugId: "bug-2026-04-19-001" },
      output: { bugId: "bug-2026-04-19-001", verdict: "fixed", scanners: ["unit"], attempt: { at: "2026-04-19T12:00:00Z", scanners: ["unit"], result: "pass" } },
    },
  },
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools
  forge_review_add: {
    intent: ["review", "queue", "add", "human-judgment"],
    aliases: ["review-add", "add-review", "queue-add"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.49.0",
    writesFiles: true,
    risk: "low",
    prerequisites: [],
    produces: [".forge/review-queue/<itemId>.json"],
    consumes: [],
    sideEffects: [
      "creates .forge/review-queue/ on first run",
      "writes review item JSON record",
      "broadcasts review-queue-item-added hub event",
    ],
    errors: {
      ERR_INVALID_SOURCE: { message: "Source not in allowed set", recovery: "Use one of: crucible-stall, tempering-quorum-inconclusive, tempering-baseline, bug-classify, fix-plan-approval" },
      ERR_INVALID_SEVERITY: { message: "Severity not in allowed set", recovery: "Use one of: blocker, high, medium, low" },
      ERR_INVALID_TITLE: { message: "Title is required and must be non-empty", recovery: "Provide a descriptive title string" },
      ERR_INVALID_CONTEXT: { message: "Context must be an object", recovery: "Pass context as a JSON object, not a string" },
    },
    example: {
      input: { source: "crucible-stall", severity: "high", title: "Smelt stalled for 7+ days" },
      output: { _v: 1, itemId: "review-2026-04-19-001", source: "crucible-stall", severity: "high", status: "open" },
    },
  },
  forge_review_list: {
    intent: ["review", "queue", "list", "query"],
    aliases: ["review-list", "list-reviews", "review-query"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.49.0",
    writesFiles: false,
    prerequisites: [],
    produces: [],
    consumes: [".forge/review-queue/*.json"],
    sideEffects: [],
    errors: {},
    example: {
      input: { status: "open", severity: "high" },
      output: { ok: true, count: 1, items: [{ itemId: "review-2026-04-19-001", source: "crucible-stall", severity: "high", status: "open" }] },
    },
  },
  forge_review_resolve: {
    intent: ["review", "resolve", "approve", "reject", "defer"],
    aliases: ["review-resolve", "resolve-review"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.49.0",
    writesFiles: true,
    risk: "low",
    prerequisites: ["Review item exists and is open"],
    produces: [],
    consumes: [".forge/review-queue/<itemId>.json"],
    sideEffects: [
      "updates review item status to resolved/deferred",
      "broadcasts review-queue-item-resolved hub event",
      "captures L3 memory via captureMemory (structured tags only, no free-text note)",
    ],
    errors: {
      ERR_ITEM_NOT_FOUND: { message: "Review item not found", recovery: "Use forge_review_list to find valid item IDs" },
      ERR_ALREADY_RESOLVED: { message: "Item is already resolved or deferred", recovery: "No action needed — item is already resolved" },
      ERR_INVALID_RESOLUTION: { message: "Resolution not in allowed set", recovery: "Use one of: approve, reject, defer" },
      ERR_INVALID_RESOLVED_BY: { message: "resolvedBy is required and must be non-empty", recovery: "Provide the name/identifier of who resolved it" },
    },
    example: {
      input: { itemId: "review-2026-04-19-001", resolution: "approve", resolvedBy: "engineer-1" },
      output: { itemId: "review-2026-04-19-001", status: "resolved", resolution: "approve", resolvedBy: "engineer-1" },
    },
  },
  // Phase TEMPER-07 Slice 07.1 — Agent delegation routing
  forge_delegate_to_agent: {
    intent: ["delegate", "route", "agent", "analyze", "triage"],
    aliases: ["delegate-bug", "route-to-agent", "agent-delegate"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.50.0",
    writesFiles: true,
    risk: "low",
    prerequisites: ["Bug must exist in .forge/bugs/"],
    produces: [".forge/tempering/findings/<bugId>.json", ".forge/tempering/delegations.jsonl", ".forge/review-queue/<itemId>.json"],
    consumes: [".forge/bugs/<bugId>.json", ".forge/tempering/config.json"],
    sideEffects: [
      "appends delegation record to .forge/tempering/delegations.jsonl",
      "creates review queue item when mode=review-queue-item",
      "broadcasts tempering-bug-delegated hub event",
      "captures L3 memory (metadata only — bugId, agent, severity)",
    ],
    errors: {
      BUG_NOT_FOUND: { message: "Bug ID not found in .forge/bugs/", recovery: "Use forge_bug_list to find valid bug IDs" },
      NO_ROUTE: { message: "No routing rule matches this bug type/severity", recovery: "Bug may need manual triage — check type and severity" },
    },
    example: {
      input: { bugId: "BUG-20260419-001", mode: "analyst", dryRun: true },
      output: { ok: true, routed: true, bugId: "BUG-20260419-001", agent: "security", skill: "security-audit", mode: "analyst", dryRun: true, reviewItemId: null, analystPrompt: "## Agent Analysis Request..." },
    },
  },
  forge_generate_image: {
    intent: ["create", "generate", "image"],
    aliases: ["image-gen", "generate-artwork", "create-image"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.17.0",
    prerequisites: ["XAI_API_KEY or OPENAI_API_KEY set"],
    produces: ["<outputPath>"],
    consumes: [],
    sideEffects: ["creates image file on disk", "calls external API"],
    errors: {
      NO_API_KEY: { message: "No image generation API key found", recovery: "Set XAI_API_KEY or OPENAI_API_KEY in env or .forge/secrets.json" },
      GENERATION_FAILED: { message: "Image generation failed", recovery: "Check the prompt, try a different model, or verify API key" },
    },
    example: { input: { prompt: "minimalist logo", outputPath: "assets/logo.webp" }, output: { file: "assets/logo.webp", model: "grok-imagine-image" } },
  },
  forge_drift_report: {
    intent: ["drift-detect", "architecture-audit", "guardrail-score"],
    aliases: ["drift-check", "drift-score", "arch-drift"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: ["git initialized"],
    produces: [".forge/drift-history.jsonl"],
    consumes: [".github/instructions/*.instructions.md", "**/*.{js,ts,cs,py}"],
    sideEffects: ["appends to .forge/drift-history.jsonl", "may fire drift-alert hub event"],
    errors: {
      NO_SOURCE_FILES: { message: "No source files found to analyze", recovery: "Check path argument" },
      ANALYSIS_FAILED: { message: "Rule analysis failed", recovery: "Check file permissions and path" },
    },
    example: { input: { threshold: 70 }, output: { score: 85, violations: [], trend: "stable", delta: 0, historyLength: 1 } },
  },
  forge_incident_capture: {
    intent: ["capture-incident", "record-outage", "track-mttr"],
    aliases: ["incident-capture", "record-incident", "log-incident"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: [".forge directory exists or will be created"],
    produces: [".forge/incidents.jsonl"],
    consumes: [".forge.json"],
    sideEffects: ["appends to .forge/incidents.jsonl", "may fire incident-captured hub event", "may dispatch bridge notification to onCall target"],
    errors: {
      RESOLVED_BEFORE_CAPTURED: { message: "resolvedAt is earlier than capturedAt", recovery: "Check the resolvedAt timestamp — it must be after the incident was captured" },
      INVALID_SEVERITY: { message: "severity must be low, medium, high, or critical", recovery: "Use one of: low, medium, high, critical" },
    },
    example: {
      input: { description: "API latency spike on /checkout", severity: "high", files: ["src/api/checkout.ts"] },
      output: { id: "inc-1700000000000", description: "API latency spike on /checkout", severity: "high", capturedAt: "2024-01-01T00:00:00.000Z", resolvedAt: null, mttr: null },
    },
  },
  forge_deploy_journal: {
    intent: ["record-deploy", "log-deployment", "deploy-tracking"],
    aliases: ["deploy-journal", "deploy-log", "record-deployment"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: [".forge directory exists or will be created"],
    produces: [".forge/deploy-journal.jsonl"],
    consumes: [],
    sideEffects: ["appends to .forge/deploy-journal.jsonl", "may fire deploy-recorded hub event"],
    errors: {
      MISSING_VERSION: { message: "version is required", recovery: "Supply a version string (e.g., 'v2.31.0')" },
    },
    example: {
      input: { version: "v2.31.0", by: "CI", notes: "hotfix for checkout timeout", slice: "S3" },
      output: { id: "deploy-1700000000000", version: "v2.31.0", by: "CI", notes: "hotfix for checkout timeout", slice: "S3", deployedAt: "2024-01-01T00:00:00.000Z" },
    },
  },
  forge_regression_guard: {
    intent: ["regression-check", "gate-validation", "ci-guard"],
    aliases: ["regression-guard", "run-gates", "guard-regressions"],
    cost: "medium",
    maxConcurrent: 1,
    addedIn: "2.29.0",
    prerequisites: ["docs/plans/ contains at least one *-PLAN.md (or supply plan arg)"],
    produces: [".forge/telemetry/tool-calls.jsonl"],
    consumes: ["docs/plans/*.md"],
    sideEffects: ["executes shell commands from validation gates"],
    errors: {
      NO_PLANS_FOUND: { message: "No plan files found in docs/plans/", recovery: "Supply a plan path via the plan argument or create a plan file" },
      GATE_FAILED: { message: "One or more validation gates failed", recovery: "Review failed gate output and fix the issue, then re-run" },
    },
    example: {
      input: { files: ["src/api.ts", "src/auth.ts"], failFast: false },
      output: { gatesChecked: 3, passed: 3, failed: 0, blocked: 0, skipped: 0, success: true },
    },
  },
  forge_runbook: {
    intent: ["generate-runbook", "document-plan", "ops-runbook"],
    aliases: ["runbook-gen", "plan-runbook", "generate-ops-doc"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.30.0",
    prerequisites: ["plan file exists"],
    produces: [".forge/runbooks/<plan-name>-runbook.md"],
    consumes: ["docs/plans/*.md", ".forge/incidents.jsonl"],
    sideEffects: ["creates .forge/runbooks/ directory", "writes runbook markdown file"],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path argument" },
    },
    example: {
      input: { plan: "docs/plans/Phase-1-AUTH-PLAN.md", includeIncidents: true },
      output: { runbook: ".forge/runbooks/phase-1-auth-plan-runbook.md", slices: 4, generatedAt: "2024-01-01T00:00:00.000Z" },
    },
  },
  forge_hotspot: {
    intent: ["churn-analysis", "hotspot-detect", "risk-files"],
    aliases: ["hotspot", "churn", "change-frequency"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.31.0",
    prerequisites: ["git initialized"],
    produces: [".forge/hotspot-cache.json"],
    consumes: ["git log history"],
    sideEffects: ["writes .forge/hotspot-cache.json (24h cache TTL)"],
    errors: {
      GIT_LOG_FAILED: { message: "git log command failed", recovery: "Ensure you are inside a git repository with commit history" },
      NO_COMMITS: { message: "No commits found in the given time range", recovery: "Widen the --since filter or check the branch has history" },
    },
    example: {
      input: { top: 5, since: "3 months ago" },
      output: { generatedAt: "2024-01-01T00:00:00.000Z", since: "3 months ago", totalFiles: 42, showing: 5, hotspots: [{ file: "src/api.ts", commits: 28 }] },
    },
  },
  forge_health_trend: {
    intent: ["health", "trend", "monitoring", "health-dna"],
    aliases: ["health-analysis", "system-health", "health-report", "health-dna"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.32.0",
    prerequisites: [],
    produces: [".forge/health-dna.jsonl"],
    consumes: [".forge/drift-history.jsonl", ".forge/cost-history.json", ".forge/incidents.jsonl", ".forge/model-performance.json", ".forge/regression-history.jsonl"],
    sideEffects: ["writes .forge/health-dna.jsonl (project health fingerprint)"],
    errors: {
      NO_DATA: { message: "No operational data found for the requested time window", recovery: "Run forge tools (drift, run-plan, incident) to generate data, or widen the --days window" },
    },
    example: {
      input: { days: 30 },
      output: { days: 30, healthScore: 87, trend: "stable", dataPoints: 15, drift: { snapshots: 5, avg: 85 }, cost: { runs: 3, totalUsd: 1.23 }, incidents: { total: 2, open: 0 }, models: { totalSlices: 10 }, tests: { runs: 5, passRate: 1.0 }, healthDNA: { driftAvg: 85, testPassRate: 1.0, incidentRate: 0.07 } },
    },
  },
  forge_alert_triage: {
    intent: ["triage-alerts", "prioritize-incidents", "rank-alerts"],
    aliases: ["alert-triage", "triage", "prioritize-alerts"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.31.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/incidents.jsonl", ".forge/drift-history.jsonl"],
    sideEffects: [],
    errors: {
      NO_ALERTS: { message: "No open alerts found matching the filter criteria", recovery: "Lower --min-severity or check that incidents exist in .forge/incidents.jsonl" },
      INVALID_SEVERITY: { message: "minSeverity must be low, medium, high, or critical", recovery: "Use one of: low, medium, high, critical" },
    },
    example: {
      input: { minSeverity: "medium", max: 5 },
      output: { total: 3, showing: 3, minSeverity: "medium", alerts: [{ source: "incident", id: "inc-1700000000000", description: "API latency spike", severity: "high", priority: 2.4, timestamp: "2024-01-01T00:00:00.000Z", files: ["src/api.ts"] }], generatedAt: "2024-01-01T00:00:00.000Z" },
    },
    notes: "Read-only — does not write to any data store. Priority = severity_weight × recency_factor. Tiebreak: more recent timestamp ranks higher.",
  },
  forge_dep_watch: {
    intent: ["dep-scan", "cve-check", "dependency-audit"],
    aliases: ["dep-watch", "dependency-watch", "cve-scan"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: ["package.json or package-lock.json in project root"],
    produces: [".forge/deps-snapshot.json"],
    consumes: ["package.json", "package-lock.json"],
    sideEffects: ["writes .forge/deps-snapshot.json", "may fire dep-vulnerability hub event"],
    errors: {
      NO_PACKAGE_JSON: { message: "No package.json found in project root", recovery: "Ensure you are in a Node.js project with a package.json file" },
      AUDIT_FAILED: { message: "npm audit command failed", recovery: "Check npm is installed and network connectivity; non-npm projects return graceful degradation" },
    },
    example: {
      input: { path: ".", notify: true },
      output: { newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 42, snapshot: { capturedAt: "2024-01-01T00:00:00.000Z", depCount: 42 } },
    },
  },
  forge_secret_scan: {
    intent: ["secret-scan", "entropy-scan", "leak-detection"],
    aliases: ["secret-scan", "scan-secrets", "entropy-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.28.0",
    prerequisites: ["git initialized"],
    produces: [".forge/secret-scan-cache.json"],
    consumes: ["git diff output"],
    sideEffects: ["writes .forge/secret-scan-cache.json", "may annotate .forge/deploy-journal-meta.json sidecar"],
    securityNote: "Never logs actual secret values — only file paths, line numbers, entropy scores, and <REDACTED> placeholders. All findings are masked before caching or emitting telemetry.",
    errors: {
      GIT_UNAVAILABLE: { message: "git is not available or not a git repository", recovery: "Ensure you are inside a git repository — tool degrades gracefully returning { clean: null, scannedFiles: 0, findings: [], error: 'git unavailable' }" },
      DIFF_TIMEOUT: { message: "git diff timed out (30s limit)", recovery: "Narrow the --since range to reduce diff size" },
    },
    example: {
      input: { since: "HEAD~1", threshold: 4.0 },
      output: { scannedAt: "2024-01-01T00:00:00.000Z", since: "HEAD~1", threshold: 4.0, scannedFiles: 5, clean: false, findings: [{ file: "src/config.js", line: 5, type: "api_key", entropyScore: 4.8, masked: "<REDACTED>", confidence: "high" }] },
    },
  },
  forge_env_diff: {
    intent: ["env-diff", "environment-comparison", "env-key-gaps"],
    aliases: ["env-diff", "compare-env", "env-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.28.0",
    prerequisites: ["baseline .env file exists"],
    produces: [".forge/env-diff-cache.json"],
    consumes: [".env", ".env.*"],
    sideEffects: ["writes .forge/env-diff-cache.json — key names only, no values"],
    securityNote: "Compares key names only — never reads, logs, or caches environment variable values.",
    errors: {
      BASELINE_NOT_FOUND: { message: "baseline .env file does not exist", recovery: "Create the baseline file or pass --baseline pointing to an existing .env file" },
      TARGET_NOT_FOUND: { message: "one or more target .env files not found", recovery: "Check the --files argument or ensure .env.* files exist in the project root" },
    },
    example: {
      input: { baseline: ".env", files: ".env.staging,.env.production" },
      output: { scannedAt: "2024-01-01T00:00:00.000Z", baseline: ".env", filesCompared: 2, pairs: [{ file: ".env.staging", missingInTarget: ["STRIPE_KEY"], missingInBaseline: [] }], summary: { clean: false, totalGaps: 1, baselineKeyCount: 12 } },
    },
  },
  forge_fix_proposal: {
    intent: ["fix-proposal", "auto-fix", "liveguard-fix", "generate-fix-plan"],
    aliases: ["fix-proposal", "auto-fix", "generate-fix"],
    cost: "low",
    maxConcurrent: 3,
    addedIn: "2.29.0",
    prerequisites: ["LiveGuard data available (drift, incidents, secret scan, Crucible funnel, or tempering bugs)"],
    produces: ["docs/plans/auto/LIVEGUARD-FIX-<id>.md"],
    consumes: [".forge/drift-history.jsonl", ".forge/incidents.jsonl", ".forge/secret-scan-cache.json", ".forge/regression-gates.json", ".forge/crucible/*.json", ".forge/hub-events.jsonl", ".forge/bugs/*.json"],
    sideEffects: ["writes docs/plans/auto/LIVEGUARD-FIX-{incidentId}.md", "appends .forge/fix-proposals.json", "broadcasts fix-proposal-ready event"],
    securityNote: "Plans are generated locally. One proposal per incidentId to prevent spam.",
    errors: {
      NO_DATA: { message: "No LiveGuard data found", recovery: "Run drift, incident-capture, regression-guard, secret-scan, start a Crucible smelt, or register a tempering bug first" },
      ALREADY_EXISTS: { message: "Fix proposal already exists for this ID", recovery: "Check docs/plans/auto/ for existing plan" },
      CRUCIBLE_HEALTHY: { message: "Crucible funnel is healthy — no stalled or orphan smelts to fix", recovery: "Wait for the watcher to flag a smelt, or pass a specific smeltId to force a proposal" },
      MISSING_BUG_ID: { message: "bugId is required when source is tempering-bug", recovery: "Pass bugId from forge_bug_list" },
      BUG_TERMINAL_STATUS: { message: "Bug is already in a terminal status (fixed/wont-fix/duplicate)", recovery: "No fix plan needed — bug is already resolved" },
    },
    example: {
      input: { source: "incident", incidentId: "INC-001" },
      output: { fixId: "INC-001", plan: "docs/plans/auto/LIVEGUARD-FIX-INC-001.md", source: "incident", sliceCount: 2, alreadyExists: false },
    },
  },
  forge_quorum_analyze: {
    intent: ["quorum-analyze", "quorum-prompt", "multi-model-analysis"],
    aliases: ["quorum-analyze", "quorum-prompt", "multi-model"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.29.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/drift-history.jsonl", ".forge/incidents.jsonl", ".forge/deploy-journal.jsonl", ".forge/secret-scan-cache.json"],
    sideEffects: ["none — read-only prompt assembly, no LLM calls"],
    securityNote: "customQuestion is XSS-validated and length-capped at 500 chars. No data leaves the server.",
    errors: {
      QUESTION_TOO_LONG: { message: "customQuestion exceeds 500 chars", recovery: "Shorten the question" },
      XSS_DETECTED: { message: "customQuestion contains disallowed content", recovery: "Remove script tags or event handlers" },
    },
    example: {
      input: { source: "drift", customQuestion: "Why did drift score drop 15 points?" },
      output: { quorumPrompt: "## Context\n...\n\n## Question\nWhy did drift score drop 15 points?\n\n## Voting Instruction\n...", promptTokenEstimate: 250, suggestedModels: ["claude-opus-4.6", "grok-4.20", "gemini-3-pro-preview"], dataSnapshotAge: "12m ago", questionUsed: "Why did drift score drop 15 points?" },
    },
  },
  forge_liveguard_run: {
    intent: ["liveguard-run", "health-check", "full-scan", "liveguard-all"],
    aliases: ["liveguard-run", "lg-run", "full-check"],
    cost: "medium",
    maxConcurrent: 1,
    addedIn: "2.30.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/drift-history.jsonl", ".forge/incidents.jsonl", ".forge/regression-history.jsonl", ".forge/bugs/*.json", ".forge/tempering/config.json"],
    sideEffects: ["runs drift scan, sweep, secret scan, regression guard, dep watch, alert triage, health trend in sequence", "broadcasts liveguard-tool-completed event"],
    securityNote: "Composite tool — executes multiple LiveGuard tools. No data leaves the server.",
    errors: {
      PARTIAL_FAILURE: { message: "One or more sub-tools failed", recovery: "Check individual tool errors in the response" },
    },
    example: {
      input: { plan: "docs/plans/Phase-1-AUTH-PLAN.md" },
      output: { drift: { score: 100, appViolations: 0 }, sweep: { appMarkers: 0 }, secrets: { findings: 0 }, regression: { gates: 2, passed: 2, failed: 0 }, deps: { vulnerabilities: 0 }, alerts: { critical: 0, high: 0 }, health: { avgScore: 95, trend: "stable" }, overallStatus: "green" },
    },
  },
  forge_watch: {
    intent: ["observe", "watch", "monitor", "advise"],
    aliases: ["watcher", "tail-run", "observe-run"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.34.0",
    prerequisites: ["<targetPath>/.forge/runs/ exists"],
    produces: ["<watcherCwd>/.forge/watch-history.jsonl (when recordHistory=true)"],
    consumes: [
      "<targetPath>/.forge/runs/<runId>/events.log",
      "<targetPath>/.forge/runs/<runId>/slice-*.json",
      "<targetPath>/.forge/runs/<runId>/summary.json",
    ],
    sideEffects: [
      "appends to watcher's own .forge/watch-history.jsonl (NEVER target's)",
      "may emit watch-snapshot-completed/watch-anomaly-detected/watch-advice-generated hub events",
      "in 'analyze' mode, invokes a frontier model (default claude-opus-4.7)",
    ],
    securityNote: "Read-only by design — cannot modify any files in the target project. History is written only to watcher's own cwd.",
    errors: {
      MISSING_TARGET: { message: "targetPath is required", recovery: "Pass an absolute path to the project being watched" },
      NO_RUNS: { message: "No run directory found", recovery: "Verify the target has executed at least one pforge run" },
    },
    example: {
      input: { targetPath: "E:/GitHub/Rummag", mode: "snapshot" },
      output: { ok: true, runState: "in-progress", counts: { started: 5, completed: 4, failed: 0, escalated: 0 }, anomalies: [], recommendations: [], cursor: "2025-04-17T12:34:56.789Z" },
    },
  },
  forge_watch_live: {
    intent: ["observe", "stream", "tail", "monitor"],
    aliases: ["watcher-live", "live-tail", "stream-events"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.35.0",
    prerequisites: ["<targetPath>/.forge/runs/ exists"],
    produces: [],
    consumes: [
      "<targetPath>/.forge/server-ports.json (preferred — WebSocket subscription)",
      "<targetPath>/.forge/runs/<latest>/events.log (polling fallback)",
    ],
    sideEffects: [
      "opens read-only WebSocket subscription to target hub OR polls events.log",
      "captures up to 500 events for the response payload",
    ],
    securityNote: "Read-only subscriber — never sends commands or modifies target files.",
    errors: {
      MISSING_TARGET: { message: "targetPath is required", recovery: "Pass an absolute path to the project being watched" },
      TARGET_NOT_FOUND: { message: "Target path does not exist", recovery: "Verify path and try again" },
    },
    example: {
      input: { targetPath: "E:/GitHub/Rummag", durationMs: 30000 },
      output: { ok: true, mode: "websocket", events: 42, capturedEvents: 42 },
    },
  },
  forge_memory_report: {
    intent: ["memory-report", "memory-health", "memory-audit"],
    aliases: ["memory-report", "mem-report", "memory-health"],
    cost: "low",
    maxConcurrent: 4,
    addedIn: "2.36.0-beta.4",
    prerequisites: [],
    produces: [],
    consumes: [
      ".forge/liveguard-memories.jsonl",
      ".forge/openbrain-queue.jsonl",
      ".forge/openbrain-dlq.jsonl",
      ".forge/openbrain-stats.jsonl",
      ".forge/telemetry/memory-captures.jsonl",
      ".forge/memory-search-cache.jsonl",
    ],
    sideEffects: [],
    securityNote: "Read-only aggregator. No data leaves the server.",
    errors: {},
    example: {
      input: {},
      output: { _v: 1, queue: { pending: 3, delivered: 42, failed: 0, deferred: 1, dlq: 0 }, telemetry: { total: 64, dedupedCount: 7 }, cache: { totalEntries: 12, uniqueKeys: 9, freshEntries: 5 }, orphans: [] },
    },
  },
  forge_home_snapshot: {
    intent: ["shop-floor-overview", "health-summary", "home-tab-data"],
    aliases: ["home-snapshot", "shop-overview", "project-health"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.48.0",
    prerequisites: [],
    produces: [],
    consumes: [
      ".forge/crucible/**/*.json",
      ".forge/runs/**/events.log",
      ".forge/drift-history.jsonl",
      ".forge/incidents.jsonl",
      ".forge/fix-proposals.jsonl",
      ".forge/tempering/**/*.json",
      ".forge/hub-events.jsonl",
    ],
    sideEffects: [],
    securityNote: "Read-only aggregator. No data leaves the server.",
    errors: {
      IO_FAILURE: {
        message: "Failed to read project state",
        recovery: "Check file permissions and .forge directory integrity",
      },
    },
    example: {
      input: { activityTail: 25 },
      output: {
        ok: true,
        quadrants: {
          crucible: { total: 42, finalized: 30, stalled: 2, lastActivity: null },
          activeRuns: { inFlight: 1, lastSliceOutcome: "pass", lastRunId: "run_001", lastRunAgeMs: 12000 },
          liveguard: { driftScore: 87, openIncidents: 0, openFixProposals: 1, lastDriftAgeMs: 300000 },
          tempering: { coverageStatus: "ok", openBugs: 3, lastScanAgeMs: 60000 },
        },
        activityFeed: [],
      },
    },
  },
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools
  forge_notify_send: {
    intent: ["notify", "send", "webhook", "alert"],
    aliases: ["send-notification", "notify-send"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.50.0",
    prerequisites: [".forge/notifications/config.json exists with adapter configured"],
    produces: [],
    consumes: [".forge/notifications/config.json"],
    sideEffects: ["sends HTTP request to configured adapter endpoint", "emits notification-sent or notification-send-failed hub event"],
    errors: {
      ERR_ADAPTER_NOT_FOUND: { message: "Adapter not registered", recovery: "Check adapter name; available: webhook" },
      ERR_LITERAL_SECRET: { message: "URL contains literal secret", recovery: "Use ${env:VAR_NAME} template instead of literal URLs" },
      ERR_SEND_TIMEOUT: { message: "Adapter send timed out (5s)", recovery: "Check endpoint responsiveness" },
    },
    example: {
      input: { via: "webhook", payload: { type: "incident-opened", severity: "high" }, formattedMessage: "Critical incident opened" },
      output: { ok: true, adapter: "webhook", statusCode: 200, deliveryMs: 142 },
    },
  },
  forge_notify_test: {
    intent: ["notify", "test", "validate", "check"],
    aliases: ["test-notification", "notify-test"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.50.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/notifications/config.json"],
    sideEffects: ["optionally sends test HTTP request when dryRun=false"],
    errors: {},
    example: {
      input: { adapter: "webhook" },
      output: { ok: true, adapters: [{ name: "webhook", configValid: true }] },
    },
  },
  forge_search: {
    intent: ["search", "find", "query", "lookup"],
    aliases: ["search-forge", "find-artifact"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.51.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/runs/", ".forge/bugs/", ".forge/incidents/", ".forge/tempering/", ".forge/hub-events.jsonl", ".forge/review-queue.json", ".forge/liveguard-memories.jsonl", "docs/plans/"],
    sideEffects: [],
    writesFiles: false,
    network: false,
    risk: "low",
    errors: {
      ERR_BAD_SINCE: { message: "Invalid since value", recovery: "Use ISO timestamp or relative: 24h, 7d, 2w, 30m" },
    },
    example: {
      input: { query: "blocker", tags: ["review"], limit: 10 },
      output: { hits: [{ source: "bug", recordRef: "BUG-42", snippet: "…critical blocker in auth…", score: 2.1 }], total: 1, truncated: false, durationMs: 45 },
    },
  },
  // Phase FORGE-SHOP-05 Slice 05.1 — Unified timeline
  forge_timeline: {
    intent: ["timeline", "history", "chronological", "events", "what-happened"],
    aliases: ["timeline", "event-history", "forge-timeline"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.53.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/hub-events.jsonl", ".forge/runs/", ".forge/liveguard-memories.jsonl",
               ".forge/openbrain-queue.jsonl", ".forge/watch-history.jsonl",
               ".forge/tempering/", ".forge/bugs/", ".forge/incidents/"],
    sideEffects: [],
    writesFiles: false,
    network: false,
    risk: "low",
    errors: {
      ERR_BAD_SINCE: { message: "Invalid from/to value", recovery: "Use ISO timestamp or relative: 24h, 7d, 30m" },
      ERR_LIMIT_EXCEEDED: { message: "Limit exceeds max 2000", recovery: "Reduce limit to 2000 or less" },
    },
    example: {
      input: { from: "24h", sources: ["run", "bug"], groupBy: "correlation", limit: 100 },
      output: { threads: [{ correlationId: "abc-123", events: ["..."], firstTs: "...", lastTs: "...", sources: ["run"] }], total: 1, truncated: false, durationMs: 42 },
    },
  },
  // Issue #73 — Runtime-aware quorum viability
  forge_doctor_quorum: {
    intent: ["quorum viability", "model availability", "runtime check", "doctor", "preflight"],
    aliases: ["doctor-quorum", "quorum-doctor", "quorum-viability"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.54.0",
    prerequisites: [],
    produces: [],
    consumes: [],
    sideEffects: [],
    writesFiles: false,
    network: false,
    risk: "low",
    errors: {
      ERR_UNKNOWN_PRESET: { message: "Unknown preset name", recovery: "Use 'power', 'speed', or 'all'" },
    },
    example: {
      input: { preset: "all" },
      output: { runtime: "cli-gh", presets: [{ preset: "power", declared: 3, effective: 1, synthesisViable: false, recommendation: { preset: "speed", reason: "..." } }] },
    },
  },
  // Phase AUTO-UPDATE-01 Slice 2 — self-update from CLI/dashboard
  forge_self_update: {
    intent: ["update", "upgrade", "self-update", "install-latest"],
    aliases: ["auto-update", "update-now", "self-update"],
    cost: "high",
    maxConcurrent: 1,
    addedIn: "2.55.0",
    // v2.56.0 — explicit agent guidance. Was surfaced in capabilities but
    // agents were still reaching for `git clone` because neither the intent
    // field nor the description told them NOT to.
    whenToUse: "Preferred path for upgrading an existing Plan Forge install. Always pulls the latest tagged release from GitHub and overwrites framework files (pforge.ps1, pforge.sh, pforge-mcp/, .github/prompts, etc.). Does NOT touch .forge.json, copilot-instructions.md, project principles, or plan files.",
    preferOver: [
      "git clone https://github.com/srnichols/plan-forge.git  (that's the FIRST-TIME install path, not the update path)",
      "git pull in a sibling ../plan-forge clone  (master carries -dev suffix; self-update pulls clean release tags)",
      "Manually downloading a tarball",
    ],
    agentGuidance: "If a user asks you to 'update Plan Forge' or 'upgrade to v<X.Y.Z>', run `pforge self-update --force` from the project root. Do not clone the repo. Do not use `git pull` on any sibling clone. After it runs: (1) verify VERSION with `Get-Content VERSION`; (2) run `pforge smith` to confirm all expected framework files landed — smith will name-check pipeline prompts, hooks, and instructions and tell you exactly what (if anything) is still missing. If smith reports missing pipeline prompts, run `pforge update` a second time (self-update's first pass uses the in-progress CLI's older copy logic; the second pass uses the just-installed v2.59.1+ logic that handles `project-profile.prompt.md`).",
    prerequisites: ["network connectivity", "VERSION file"],
    produces: ["updated framework files", ".forge/update-audit.log entry"],
    consumes: ["VERSION", ".forge.json", ".forge/update-check.json"],
    sideEffects: ["modifies framework files", "writes audit log"],
    writesFiles: true,
    network: true,
    risk: "high",
    errors: {
      ERR_UPDATE_DURING_RUN: { message: "Cannot update during active plan run", recovery: "Wait for run to finish" },
      ERR_RATE_LIMITED: { message: "Update rate limited (1 per 5 min)", recovery: "Wait and retry" },
    },
    example: {
      input: {},
      output: { state: "done", detail: "Updated to v2.56.0" },
    },
  },
  forge_testbed_run: {
    intent: ["test", "validate", "testbed", "scenario", "end-to-end"],
    aliases: ["run-testbed", "testbed-scenario", "testbed-run"],
    cost: "high",
    maxConcurrent: 1,
    addedIn: "2.56.0",
    prerequisites: ["testbed repo exists", "scenario fixture in docs/plans/testbed-scenarios/"],
    produces: ["docs/plans/testbed-findings/*.json"],
    consumes: ["docs/plans/testbed-scenarios/*.json", ".forge.json"],
    sideEffects: ["writes defect log", "emits hub events", "acquires testbed lock"],
    writesFiles: true,
    network: false,
    risk: "medium",
    errors: {
      ERR_TESTBED_NOT_FOUND: { message: "Testbed repo not found", recovery: "Set testbed.path in .forge.json" },
      ERR_TESTBED_DIRTY: { message: "Testbed has uncommitted changes", recovery: "Commit or stash changes in testbed" },
      ERR_TESTBED_LOCKED: { message: "Another scenario is running", recovery: "Wait or remove stale .forge/testbed.lock" },
      ERR_SCENARIO_NOT_FOUND: { message: "Scenario fixture not found", recovery: "Check docs/plans/testbed-scenarios/" },
      ERR_TESTBED_HEAD_MISMATCH: { message: "Testbed HEAD does not match expected commit", recovery: "Check expectedHead in scenario fixture" },
    },
    example: {
      input: { scenarioId: "happy-path-01" },
      output: { scenarioId: "happy-path-01", status: "passed", durationMs: 60000 },
    },
  },
  forge_testbed_findings: {
    intent: ["query", "findings", "defect-log", "testbed"],
    aliases: ["testbed-findings", "list-findings"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "2.56.0",
    prerequisites: [],
    produces: ["findings list"],
    consumes: ["docs/plans/testbed-findings/*.json"],
    sideEffects: [],
    writesFiles: false,
    network: false,
    risk: "low",
    errors: {},
    example: {
      input: { status: "open", severity: "high" },
      output: { findings: [], total: 0, truncated: false },
    },
  },
  forge_testbed_happypath: {
    intent: ["test", "validate", "happy-path", "testbed", "smoke-test"],
    aliases: ["testbed-happypath", "run-happypath", "happy-path-test"],
    cost: "high",
    maxConcurrent: 1,
    addedIn: "2.57.0",
    prerequisites: ["testbed repo exists", "happy-path scenarios in docs/plans/testbed-scenarios/"],
    produces: ["docs/plans/testbed-findings/*.json"],
    consumes: ["docs/plans/testbed-scenarios/*.json"],
    sideEffects: ["writes defect log", "emits hub events", "acquires testbed lock"],
    writesFiles: true,
    network: false,
    risk: "medium",
    errors: {
      ERR_TESTBED_NOT_FOUND: { message: "Testbed repo not found", recovery: "Set testbed.path in .forge.json" },
      ERR_TESTBED_LOCKED: { message: "Another scenario is running", recovery: "Wait or remove stale .forge/testbed.lock" },
      ERR_NO_HAPPYPATH_SCENARIOS: { message: "No happy-path scenarios found", recovery: "Add happy-path scenarios to docs/plans/testbed-scenarios/" },
    },
    example: {
      input: { dryRun: true },
      output: { passed: 5, failed: 0, total: 5, results: [] },
    },
  },
};

export const WORKFLOWS = {
  "execute-plan": {
    description: "Run a plan with cost awareness",
    steps: [
      { tool: "forge_run_plan", args: { estimate: true }, decision: "Review estimated cost. If acceptable, proceed." },
      { tool: "forge_run_plan", args: { estimate: false }, decision: "Monitor at localhost:3100/dashboard" },
      { tool: "forge_plan_status", description: "Check final results" },
      { tool: "forge_cost_report", description: "Review actual cost" },
    ],
  },
  "diagnose-project": {
    description: "Full project health check",
    steps: [
      { tool: "forge_smith", description: "Environment + setup health" },
      { tool: "forge_validate", description: "File counts + placeholders" },
      { tool: "forge_sweep", description: "Completeness markers" },
    ],
  },
  "plan-and-execute": {
    description: "Create a new phase and execute it",
    steps: [
      { tool: "forge_new_phase", args: { name: "<feature>" }, description: "Create plan file" },
      { tool: "forge_analyze", description: "Score the plan after hardening" },
      { tool: "forge_run_plan", args: { estimate: true }, description: "Estimate cost" },
      { tool: "forge_run_plan", description: "Execute" },
    ],
  },
  "review-run": {
    description: "Review a completed run",
    steps: [
      { tool: "forge_plan_status", description: "Per-slice results" },
      { tool: "forge_cost_report", description: "Token + cost breakdown" },
      { tool: "forge_sweep", description: "Check for leftover markers" },
      { tool: "forge_analyze", description: "Consistency score" },
    ],
  },
  "quorum-execute": {
    description: "Run a plan with multi-model consensus on complex slices",
    steps: [
      { tool: "forge_run_plan", args: { estimate: true, quorum: "auto" }, decision: "Review estimate including quorum overhead. If acceptable, proceed." },
      { tool: "forge_run_plan", args: { quorum: "auto" }, decision: "Monitor at localhost:3100/dashboard — quorum legs visible in trace" },
      { tool: "forge_plan_status", description: "Check results including quorum scores per slice" },
      { tool: "forge_cost_report", description: "Review cost — includes quorum dry-run + reviewer tokens" },
    ],
  },
};

// ─── CLI Schema ───────────────────────────────────────────────────────

export const CLI_SCHEMA = {
  commands: {
    smith: { description: "Diagnose environment + setup health", args: [], flags: {}, examples: ["pforge smith"] },
    check: { description: "Validate setup files", args: [], flags: {}, examples: ["pforge check"] },
    status: { description: "Show phase status from roadmap", args: [], flags: {}, examples: ["pforge status"] },
    sweep: { description: "Scan for TODO/FIXME markers", args: [], flags: {}, examples: ["pforge sweep"] },
    "new-phase": {
      description: "Create a new phase plan + roadmap entry",
      args: [{ name: "name", type: "string", required: true, description: "Phase name (e.g., user-auth)" }],
      flags: { "--dry-run": { type: "boolean", description: "Preview without creating" } },
      examples: ["pforge new-phase user-auth", "pforge new-phase user-auth --dry-run"],
    },
    branch: {
      description: "Create git branch from plan's Branch Strategy",
      args: [{ name: "plan", type: "path", required: true }],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge branch docs/plans/Phase-1-AUTH-PLAN.md"],
      note: "CLI-only — not available as MCP tool. Use via terminal.",
    },
    commit: {
      description: "Auto-generate conventional commit from slice goal",
      args: [
        { name: "plan", type: "path", required: true },
        { name: "slice", type: "number", required: true },
      ],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge commit docs/plans/Phase-1.md 2"],
      note: "CLI-only — not available as MCP tool.",
    },
    "phase-status": {
      description: "Update phase status in DEPLOYMENT-ROADMAP.md",
      args: [
        { name: "plan", type: "path", required: true },
        { name: "status", type: "string", required: true, enum: ["planned", "in-progress", "complete", "paused"] },
      ],
      flags: {},
      examples: ["pforge phase-status docs/plans/Phase-1.md complete"],
      note: "CLI-only — not available as MCP tool.",
    },
    diff: {
      description: "Compare changes against plan's Scope Contract",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {},
      examples: ["pforge diff docs/plans/Phase-1-AUTH-PLAN.md"],
    },
    analyze: {
      description: "Cross-artifact consistency scoring (0-100)",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {},
      examples: ["pforge analyze docs/plans/Phase-1-AUTH-PLAN.md"],
    },
    "run-plan": {
      description: "Execute a hardened plan automatically or interactively",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {
        "--estimate": { type: "boolean", description: "Cost prediction only" },
        "--assisted": { type: "boolean", description: "Human codes, orchestrator validates gates" },
        "--model": { type: "string", description: "Model override (e.g., claude-sonnet-4.6)" },
        "--resume-from": { type: "number", description: "Skip completed slices, resume from N" },
        "--dry-run": { type: "boolean", description: "Parse and validate without executing" },
        "--quorum": { type: "boolean|auto", description: "Force quorum on all slices, or 'auto' for threshold-based" },
        "--quorum-threshold": { type: "number", description: "Override complexity threshold (1-10, default: 6)" },
      },
      examples: [
        "pforge run-plan docs/plans/Phase-1.md",
        "pforge run-plan docs/plans/Phase-1.md --estimate",
        "pforge run-plan docs/plans/Phase-1.md --assisted",
        "pforge run-plan docs/plans/Phase-1.md --model claude-sonnet-4.6",
        "pforge run-plan docs/plans/Phase-1.md --resume-from 3",
        "pforge run-plan docs/plans/Phase-1.md --quorum",
        "pforge run-plan docs/plans/Phase-1.md --quorum=auto",
        "pforge run-plan docs/plans/Phase-1.md --quorum=auto --quorum-threshold 8",
        "pforge run-plan docs/plans/Phase-1.md --estimate --quorum",
      ],
    },
    ext: {
      description: "Extension management",
      subcommands: {
        search: { description: "Search extension catalog", args: [{ name: "query", type: "string", required: false }] },
        add: { description: "Install extension", args: [{ name: "name", type: "string", required: true }] },
        info: { description: "Extension details", args: [{ name: "name", type: "string", required: true }] },
        list: { description: "List installed extensions", args: [] },
        remove: { description: "Remove extension", args: [{ name: "name", type: "string", required: true }] },
      },
      examples: ["pforge ext search azure", "pforge ext add azure-infrastructure", "pforge ext list"],
    },
    config: {
      description: "Read or write settable keys in .forge.json (v2.56.0+). Writes are atomic (tmp + rename). Use this instead of editing .forge.json by hand for schema-validated keys.",
      subcommands: {
        get: { description: "Read a value", args: [{ name: "key", type: "string", required: true }] },
        set: { description: "Write a value", args: [{ name: "key", type: "string", required: true }, { name: "value", type: "string", required: true }] },
        list: { description: "Show all settable keys and their current values", args: [] },
      },
      settableKeys: {
        "update-source": {
          jsonKey: "updateSource",
          allowed: ["auto", "github-tags", "local-sibling"],
          default: "auto",
          description: "Where `pforge update` pulls template bytes from. `auto` picks the newer of sibling clone and GitHub tag; `github-tags` ignores siblings; `local-sibling` always uses ../plan-forge (contributor workflow).",
        },
      },
      examples: [
        "pforge config get update-source",
        "pforge config set update-source github-tags",
        "pforge config list",
      ],
    },
    update: {
      description: "Update framework files from Plan Forge source. v2.56.0+ auto-selects source: picks newer of local sibling clone and latest GitHub tag (configurable via `updateSource` in .forge.json: auto|github-tags|local-sibling). Use `pforge self-update` to force-pull the latest GitHub release. Never clone the Plan Forge repo just to run an update — that's the first-time install path.",
      args: [{ name: "source", type: "path", required: false, description: "Optional explicit Plan Forge source path. Leave empty to use auto-mode." }],
      flags: {
        "--dry-run": { type: "boolean", description: "Preview changes without writing" },
        "--from-github": { type: "boolean", description: "Force GitHub tagged release source (ignore sibling clone)" },
        "--tag": { type: "string", description: "Specific tag to pull (e.g. v2.56.0); implies --from-github" },
        "--allow-dev": { type: "boolean", description: "Bypass the -dev-over-clean-release refusal guard" },
      },
      examples: [
        "pforge update                  # auto: newer of sibling or latest tag (v2.56.0+)",
        "pforge update --dry-run        # preview only, no writes",
        "pforge update --from-github    # force GitHub release source",
        "pforge self-update             # alias for latest GitHub release, overwrites existing install",
      ],
    },
    incident: {
      description: "Capture an incident — record description, severity, affected files, and optional resolution time for MTTR tracking",
      args: [{ name: "description", type: "string", required: true, description: "Short description of the incident" }],
      flags: {
        "--severity": { type: "string", enum: ["low", "medium", "high", "critical"], description: "Incident severity (default: medium)" },
        "--files": { type: "string", description: "Comma-separated list of affected file paths" },
        "--resolved-at": { type: "string", description: "ISO 8601 resolution timestamp for MTTR calculation (e.g., 2024-01-01T02:30:00Z)" },
      },
      examples: [
        'pforge incident "API latency spike on /checkout"',
        'pforge incident "Database connection pool exhausted" --severity high',
        'pforge incident "Deploy failed" --severity critical --files src/deploy.ts,infra/k8s.yaml',
        'pforge incident "Resolved: API latency" --resolved-at 2024-01-01T02:30:00Z',
      ],
    },
    triage: {
      description: "Triage open alerts — rank incidents and drift violations by priority (severity × recency). Read-only.",
      args: [],
      flags: {
        "--min-severity": { type: "string", enum: ["low", "medium", "high", "critical"], description: "Minimum severity to include (default: low)" },
        "--max": { type: "number", description: "Maximum number of alerts to return (default: 20)" },
      },
      examples: [
        "pforge triage",
        "pforge triage --min-severity high",
        "pforge triage --min-severity medium --max 10",
      ],
    },
    runbook: {
      description: "Generate a human-readable operational runbook from a hardened plan file — includes slices, scope, gates, and recent incidents",
      args: [{ name: "plan", type: "path", required: true, description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" }],
      flags: {
        "--no-incidents": { type: "boolean", description: "Exclude recent incidents from the runbook" },
      },
      examples: [
        "pforge runbook docs/plans/Phase-1-AUTH-PLAN.md",
        "pforge runbook docs/plans/Phase-1-AUTH-PLAN.md --no-incidents",
      ],
    },
    // ─── LiveGuard CLI commands (v2.27+) ───
    drift: {
      description: "Score codebase against architecture guardrails — track drift over time",
      args: [],
      flags: { "--threshold": { type: "number", description: "Minimum acceptable score (default 70)" } },
      examples: ["pforge drift", "pforge drift --threshold 80"],
    },
    "deploy-log": {
      description: "Record a deployment — version, deployer, optional notes, slice ref",
      args: [{ name: "version", type: "string", required: true }],
      flags: {
        "--notes": { type: "string", description: "Deployment notes" },
        "--slice": { type: "string", description: "Related slice reference" },
      },
      examples: ["pforge deploy-log 2.52.1", "pforge deploy-log 2.52.1 --notes \"packaging hotfix\""],
    },
    "secret-scan": {
      description: "Scan recent commits for leaked secrets using Shannon entropy analysis",
      args: [],
      flags: { "--depth": { type: "number", description: "Number of commits to scan (default 20)" } },
      examples: ["pforge secret-scan", "pforge secret-scan --depth 50"],
    },
    "env-diff": {
      description: "Compare environment variable keys across .env files — detect missing keys",
      args: [],
      flags: {},
      examples: ["pforge env-diff"],
    },
    "regression-guard": {
      description: "Run validation gates from plan files — guard against regressions when files change",
      args: [],
      flags: {},
      examples: ["pforge regression-guard"],
    },
    hotspot: {
      description: "Identify git churn hotspots — most frequently changed files",
      args: [],
      flags: { "--top": { type: "number", description: "Top N files (default 20)" } },
      examples: ["pforge hotspot", "pforge hotspot --top 10"],
    },
    "dep-watch": {
      description: "Dependency vulnerability + freshness watcher",
      args: [],
      flags: {},
      examples: ["pforge dep-watch"],
    },
    "fix-proposal": {
      description: "Generate a fix-proposal plan for a drift or incident finding",
      args: [{ name: "finding-id", type: "string", required: true }],
      flags: {},
      examples: ["pforge fix-proposal drift-2026-04-19-001"],
    },
    "quorum-analyze": {
      description: "Assemble a quorum analysis prompt from LiveGuard data for multi-model dispatch",
      args: [],
      flags: {},
      examples: ["pforge quorum-analyze"],
    },
    "health-trend": {
      description: "Health trend analysis — drift, cost, incidents, model performance over time",
      args: [],
      flags: { "--window": { type: "string", description: "Time window (7d, 30d, 90d; default 30d)" } },
      examples: ["pforge health-trend", "pforge health-trend --window 7d"],
    },
    "org-rules": {
      description: "Export org custom instructions from .github/instructions/ for GitHub org settings",
      args: [{ name: "subcommand", type: "string", required: true, enum: ["export"] }],
      flags: {
        "--format": { type: "string", enum: ["github"], description: "Output format" },
        "--output": { type: "path", description: "Write to file instead of stdout" },
      },
      examples: ["pforge org-rules export", "pforge org-rules export --output org-rules.md"],
    },
    // ─── Version + release CLI (v2.33+) ───
    "self-update": {
      description: "Check for and install the latest Plan Forge release from GitHub",
      args: [],
      flags: {
        "--force": { type: "boolean", description: "Skip prompts" },
        "--dry-run": { type: "boolean", description: "Show what would happen" },
      },
      examples: ["pforge self-update", "pforge self-update --dry-run"],
    },
    "version-bump": {
      description: "Update VERSION, package.json, docs/README/ROADMAP version badges",
      args: [{ name: "version", type: "string", required: true }],
      flags: {},
      examples: ["pforge version-bump 2.53.0"],
    },
    "migrate-memory": {
      description: "Merge legacy *-history.json ledgers into canonical .jsonl siblings (idempotent)",
      args: [],
      flags: { "--dry-run": { type: "boolean", description: "Preview without modifying files" } },
      examples: ["pforge migrate-memory", "pforge migrate-memory --dry-run"],
    },
    // ─── Testbed CLI (v2.52+) ───
    "testbed-happypath": {
      description: "Run all happy-path testbed scenarios sequentially with aggregated pass/fail summary",
      args: [],
      flags: {
        "--dry-run": { type: "boolean", description: "List scenarios without executing" },
        "--testbed-path": { type: "path", description: "Path to the testbed repository" },
      },
      examples: ["pforge testbed-happypath", "pforge testbed-happypath --dry-run"],
    },
    // ─── Generic MCP proxy (v2.53+) ───
    "mcp-call": {
      description: "Invoke any MCP tool by name via the local MCP server on :3100 — covers tools without dedicated CLI wrappers",
      args: [{ name: "tool", type: "string", required: true, description: "Tool name (e.g., forge_crucible_list or crucible-list)" }],
      flags: {
        "--json": { type: "string", description: "JSON payload to send as params" },
      },
      examples: [
        "pforge mcp-call forge_crucible_list",
        "pforge mcp-call forge_bug_register --json '{\"severity\":\"high\",\"title\":\"x\"}'",
        "pforge mcp-call crucible-submit --title=\"Pagination\" --description=\"...\"",
      ],
    },
    tour: {
      description: "Guided walkthrough of your installed Plan Forge files",
      args: [],
      flags: {},
      examples: ["pforge tour"],
    },
    help: { description: "Show help", args: [], flags: {}, examples: ["pforge help"] },
  },
  server: {
    description: "MCP server commands (run directly with node)",
    commands: {
      start: { description: "Start MCP server (stdio + Express + WebSocket)", command: "node pforge-mcp/server.mjs" },
      "dashboard-only": { description: "Start dashboard + REST API without MCP stdio", command: "node pforge-mcp/server.mjs --dashboard-only" },
    },
  },
};

// ─── Config Schema ────────────────────────────────────────────────────

export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: ".forge.json",
  type: "object",
  properties: {
    pipelineVersion: { type: "string", description: "Pipeline version", default: "2.0" },
    templateVersion: { type: "string", description: "Plan Forge template version" },
    projectName: { type: "string", description: "Project name (used for OpenBrain memory scoping)" },
    preset: { type: "string", enum: ["dotnet", "typescript", "python", "java", "go", "swift", "azure-iac", "custom"] },
    agents: { type: "array", items: { type: "string", enum: ["claude", "cursor", "codex"] }, description: "Configured agent adapters" },
    modelRouting: {
      type: "object",
      properties: {
        execute: { type: "string", description: "Model for slice execution" },
        review: { type: "string", description: "Model for reviews" },
        default: {
          type: "string",
          enum: ["auto", "claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5", "gpt-5.4", "gpt-5.2-codex", "gpt-5-mini", "gemini-3-pro-preview"],
          default: "auto",
        },
      },
    },
    maxParallelism: { type: "number", default: 3, minimum: 1, maximum: 10, description: "Max concurrent parallel slices" },
    maxRetries: { type: "number", default: 1, minimum: 0, maximum: 5, description: "Gate failure retry attempts" },
    maxRunHistory: { type: "number", default: 50, minimum: 1, description: "Max run directories to retain" },
    quorum: {
      type: "object",
      description: "Multi-model consensus configuration (v2.5)",
      properties: {
        enabled: { type: "boolean", default: false, description: "Master switch for quorum mode" },
        auto: { type: "boolean", default: true, description: "When enabled, only quorum high-complexity slices" },
        threshold: { type: "number", default: 6, minimum: 1, maximum: 10, description: "Complexity score threshold for auto mode" },
        models: { type: "array", items: { type: "string" }, default: ["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"], description: "Models for dry-run fan-out" },
        reviewerModel: { type: "string", default: "claude-opus-4.6", description: "Model for synthesis review" },
        dryRunTimeout: { type: "number", default: 300000, description: "Timeout per dry-run worker (ms)" },
        strictAvailability: { type: "boolean", default: false, description: "When true, fast-fail (exit 2) if any configured model is unavailable. When false (default), drop unavailable models and continue if ≥1 remain" },
      },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Installed extensions" },
    hooks: {
      type: "object",
      description: "LiveGuard hook configuration (v2.29)",
      properties: {
        preDeploy: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true, description: "Enable or disable the PreDeploy hook" },
            blockOnSecrets: { type: "boolean", default: true, description: "Block deploy when secrets detected" },
            warnOnEnvGaps: { type: "boolean", default: true, description: "Warn on env key gaps" },
            scanSince: { type: "string", default: "HEAD~1", description: "Git range for secret scan" },
          },
        },
        postSlice: {
          type: "object",
          properties: {
            silentDeltaThreshold: { type: "number", default: 5, description: "Drift delta below this is silent" },
            warnDeltaThreshold: { type: "number", default: 10, description: "Drift delta above this is a warning" },
            scoreFloor: { type: "number", default: 70, description: "Score below this triggers red warning" },
          },
        },
        preAgentHandoff: {
          type: "object",
          properties: {
            injectContext: { type: "boolean", default: true, description: "Inject LiveGuard context on session start" },
            runRegressionGuard: { type: "boolean", default: true, description: "Run regression guard on handoff" },
            cacheMaxAgeMinutes: { type: "number", default: 30, description: "Max cache age before re-running tools" },
            minAlertSeverity: { type: "string", default: "medium", description: "Minimum severity for injected alerts" },
          },
        },
      },
    },
    openclaw: {
      type: "object",
      description: "OpenClaw analytics bridge — optional POST on PreAgentHandoff (v2.29)",
      properties: {
        endpoint: { type: "string", description: "OpenClaw ingest endpoint URL" },
        apiKey: { type: "string", description: "API key (or use .forge/secrets.json OPENCLAW_API_KEY)" },
      },
    },
    // Phase-25 v2.57 inner-loop subsystems (all opt-in; existing users see no change)
    runtime: {
      type: "object",
      description: "Phase-25 v2.57 inner-loop runtime configuration (opt-in subsystems)",
      properties: {
        gateSynthesis: {
          type: "object",
          description: "Phase-25 L6 — adaptive gate synthesis from Tempering minima. Suggest-only by default; never mutates plans.",
          properties: {
            mode: { type: "string", enum: ["off", "suggest", "enforce"], default: "suggest", description: "off=silent, suggest=print advisory, enforce=track in .forge/gate-suggestions.jsonl (Phase-26)" },
            domains: { type: "array", items: { type: "string", enum: ["domain", "integration", "controller"] }, default: ["domain", "integration", "controller"], description: "Which Tempering profiles to emit suggestions for" },
          },
        },
        reviewer: {
          type: "object",
          description: "Phase-25 L4 — opt-in speed-quorum reviewer that scores slice diffs inside brain.gate-check. Advisory-only in v2.57.",
          properties: {
            enabled: { type: "boolean", default: false, description: "Master switch (opt-in)" },
            quorumPreset: { type: "string", enum: ["speed", "power"], default: "speed", description: "Which quorum preset to use (D5 default: speed)" },
            blockOnCritical: { type: "boolean", default: false, description: "When true, critical verdicts block the next slice. Advisory-only (false) in v2.57 per D6" },
            timeoutMs: { type: "number", default: 30000, minimum: 1, description: "Max time to wait for reviewer response" },
          },
        },
      },
    },
    brain: {
      type: "object",
      description: "Phase-25 L2/L4 memory subsystem configuration",
      properties: {
        federation: {
          type: "object",
          description: "Phase-25 L4-lite — cross-project read-only memory federation. Opt-in; absolute local paths only (D9).",
          properties: {
            enabled: { type: "boolean", default: false, description: "Master switch (opt-in)" },
            repos: { type: "array", items: { type: "string" }, default: [], description: "Absolute local repo paths. Relative paths and URL schemes (http/https/ssh/git) are rejected" },
          },
        },
      },
    },
  },
};

// ─── System Reference ─────────────────────────────────────────────────

const SYSTEM_REFERENCE = {
  name: "Plan Forge",
  description: "AI coding guardrails that convert rough ideas into hardened execution contracts. Spec-driven framework with autonomous execution, cost tracking, telemetry, and persistent memory.",
  version: VERSION,
  repository: "https://github.com/srnichols/plan-forge",
  website: "https://planforge.software",

  architecture: {
    description: "Single Node.js process serving MCP (stdio) + Express (HTTP) + WebSocket (events)",
    components: {
      "pforge-mcp/server.mjs": "MCP server + Express REST API + routes",
      "pforge-mcp/orchestrator.mjs": "DAG-based plan execution engine",
      "pforge-mcp/hub.mjs": "WebSocket event broadcasting server",
      "pforge-mcp/telemetry.mjs": "OTLP trace/span/log capture",
      "pforge-mcp/capabilities.mjs": "Machine-readable API surface (this module)",
      "pforge-mcp/memory.mjs": "OpenBrain persistent memory integration",
      "pforge-mcp/dashboard/": "Web UI (vanilla JS + Tailwind CDN + Chart.js)",
      "pforge.ps1": "CLI wrapper (PowerShell)",
      "pforge.sh": "CLI wrapper (Bash)",
    },
    ports: {
      3100: "Express HTTP (dashboard + REST API)",
      3101: "WebSocket hub (events + real-time)",
    },
  },

  pipeline: {
    description: "6-step planning and execution pipeline with 3-session isolation",
    steps: {
      "Step 0": { name: "Specify", prompt: "step0-specify-feature.prompt.md", agent: "specifier", description: "Define what and why" },
      "Step 1": { name: "Preflight", prompt: "step1-preflight-check.prompt.md", description: "Verify prerequisites" },
      "Step 2": { name: "Harden", prompt: "step2-harden-plan.prompt.md", agent: "plan-hardener", description: "Convert spec into binding execution contract with slices, gates, scope" },
      "Step 3": { name: "Execute", prompt: "step3-execute-slice.prompt.md", agent: "executor", description: "Build slice-by-slice. Also: pforge run-plan (automated)" },
      "Step 4": { name: "Sweep", prompt: "step4-completeness-sweep.prompt.md", description: "Eliminate TODO/stub/mock markers" },
      "Step 5": { name: "Review", prompt: "step5-review-gate.prompt.md", agent: "reviewer-gate", description: "Independent audit for drift, compliance, quality" },
    },
    sessionIsolation: "Steps 0-2 in Session 1, Steps 3-4 in Session 2, Step 5 in Session 3 (prevents context bleed)",
  },

  planFormat: {
    description: "Hardened plan Markdown format parsed by the orchestrator",
    sliceHeader: "### Slice N: Title [depends: Slice 1] [P] [scope: src/auth/**]",
    tags: {
      "[P]": "Parallel-eligible — can run concurrently with other [P] slices",
      "[depends: Slice N]": "Dependency — waits for specified slice(s) to complete",
      "[depends: Slice 1, Slice 3]": "Multiple dependencies",
      "[scope: path/**]": "File scope — limits worker to these paths, enables conflict detection",
    },
    sections: {
      "Scope Contract": "In Scope, Out of Scope, Forbidden Actions",
      "Validation Gate": "Build/test commands run at every slice boundary",
      "Stop Condition": "Halts execution if condition is met",
      "Build command / Test command": "Per-slice build and test commands",
    },
  },

  guardrails: {
    description: "15-18 instruction files per preset that auto-load based on the file being edited. Each includes Temper Guards (agent shortcut prevention) and Warning Signs (behavioral anti-patterns).",
    shared: ["architecture-principles", "context-fuel", "git-workflow", "ai-plan-hardening-runbook", "project-principles", "status-reporting"],
    features: {
      temperGuards: "Tables of common shortcuts agents take (excuses + rebuttals) embedded in each instruction file — prevents quality erosion within passing builds",
      warningSigns: "Observable behavioral anti-patterns listed in each instruction file — helps agents and reviewers detect violations during and after execution",
      contextFuel: "Meta-instruction that teaches agents context window management — when to load what, recognizing degradation, session boundaries",
    },
    perStack: {
      dotnet: ["api-patterns", "auth", "caching", "dapr", "database", "deploy", "errorhandling", "graphql", "messaging", "multi-environment", "naming", "observability", "performance", "security", "testing", "version"],
      typescript: ["...same + frontend"],
      swift: ["api-patterns", "auth", "caching", "database", "deploy", "errorhandling", "messaging", "multi-environment", "naming", "observability", "performance", "security", "testing", "version"],
    },
    mechanism: "YAML frontmatter applyTo glob pattern → Copilot loads matching files automatically",
  },

  agents: {
    description: "19 specialized AI reviewer/executor agents per app preset",
    stackSpecific: ["architecture-reviewer", "database-reviewer", "deploy-helper", "performance-analyzer", "security-reviewer", "test-runner"],
    crossStack: ["accessibility-reviewer", "api-contract-reviewer", "cicd-reviewer", "compliance-reviewer", "dependency-reviewer", "error-handling-reviewer", "multi-tenancy-reviewer", "observability-reviewer"],
    pipeline: ["specifier", "plan-hardener", "executor", "reviewer-gate", "shipper"],
    invocation: "Select from agent picker dropdown in VS Code, or reference via #file:.github/agents/<name>.agent.md",
  },

  skills: {
    description: "12 multi-step executable procedures with validation gates, MCP tool integration, Temper Guards, Exit Proof, and Warning Signs per Skill Blueprint spec",
    format: "Every skill follows the Skill Blueprint (docs/SKILL-BLUEPRINT.md): Frontmatter → Trigger → Steps → Safety Rules → Temper Guards → Warning Signs → Exit Proof → Persistent Memory",
    available: {
      "/database-migration": "Generate, review, test, and deploy schema migrations",
      "/staging-deploy": "Build, push, migrate, deploy, and verify on staging (forge_validate pre-flight)",
      "/test-sweep": "Run all test suites, aggregate results, forge_sweep completeness scan",
      "/dependency-audit": "Scan dependencies for vulnerabilities, outdated, license issues",
      "/code-review": "Comprehensive review: architecture, security, testing, patterns (forge_analyze + forge_diff)",
      "/release-notes": "Generate release notes from git history and CHANGELOG",
      "/api-doc-gen": "Generate or update OpenAPI spec, validate spec-to-code consistency (forge_analyze)",
      "/onboarding": "Walk a new developer through project setup, architecture, first task (forge_smith)",
      "/health-check": "Forge diagnostic: forge_smith → forge_validate → forge_sweep with structured report",
      "/forge-execute": "Guided plan execution: list plans → estimate cost → choose mode → execute → report",
      "/forge-quench": "Systematically reduce code complexity while preserving behavior — measure, understand (Chesterton's Fence), propose, prove, report",
    },
    invocation: "Type / in Copilot Chat to see available skills, or use forge_run_skill MCP tool",
  },

  promptTemplates: {
    description: "15 scaffolding prompts for generating consistent code patterns",
    available: [
      "new-entity", "new-service", "new-controller", "new-repository", "new-test",
      "new-dto", "new-middleware", "new-event-handler", "new-worker", "new-config",
      "new-error-types", "new-dockerfile", "new-graphql-resolver", "bug-fix-tdd",
      "project-principles",
    ],
    invocation: "Attach via #file:.github/prompts/<name>.prompt.md in Copilot Chat",
  },

  lifecycleHooks: {
    description: "Automatic hooks that run during Copilot agent sessions",
    hooks: {
      SessionStart: "Injects Project Principles, current phase, and forbidden patterns into context",
      PreToolUse: "Blocks file edits to paths listed in the active plan's Forbidden Actions",
      PostToolUse: "Auto-formats edited files, warns on TODO/FIXME/stub markers",
      Stop: "Warns if code was modified but no test run was detected in the session",
    },
    config: ".github/hooks/plan-forge.json",
  },

  presets: {
    available: ["dotnet", "typescript", "python", "java", "go", "swift", "azure-iac", "custom"],
    description: "Stack-specific guardrail configurations with domain-relevant instruction files, agents, and prompts",
    counts: {
      dotnet: { instructions: 17, agents: 19, prompts: 15, skills: 8 },
      typescript: { instructions: 18, agents: 19, prompts: 15, skills: 8 },
      swift: { instructions: 15, agents: 17, prompts: 13, skills: 8 },
      "azure-iac": { instructions: 12, agents: 18, prompts: 6, skills: 3 },
    },
  },

  executionModes: {
    auto: "gh copilot CLI executes each slice with full project context and model routing",
    assisted: "Human codes in VS Code Copilot; orchestrator prompts and validates gates",
    estimate: "Returns slice count, token estimate, and cost without executing",
    dryRun: "Parses and validates plan without executing",
    resumeFrom: "Skips completed slices and resumes from specified slice number",
  },

  glossary: {
    // Core concepts
    "Plan Forge": "The framework itself — AI coding guardrails that enforce spec-driven development",
    "Forge": "Shorthand for Plan Forge. Also: .forge/ directory (project data), .forge.json (project config)",
    "Plan": "A Markdown file in docs/plans/ describing a feature to build. Contains slices, scope contract, and validation gates",
    "Hardened Plan": "A plan that has been through Step 2 (hardening) — locked-down execution contract with slices, gates, forbidden actions. The AI cannot deviate from it",
    "Slice": "A single unit of execution within a plan. Each slice has tasks, a validation gate, and optional dependencies. Like a sprint task but machine-executable",
    "Validation Gate": "Build + test commands that must pass at every slice boundary before proceeding. The quality checkpoint",
    "Gate": "Short for Validation Gate",
    "Scope Contract": "Section of a plan defining what files are In Scope, Out of Scope, and Forbidden. Prevents scope creep",
    "Forbidden Actions": "Files or operations the AI must not touch during execution. Enforced by lifecycle hooks and scope checks",
    "Stop Condition": "A condition that halts execution — e.g., 'If migration fails, STOP'",

    // Pipeline
    "Pipeline": "The 6-step process: Specify → Preflight → Harden → Execute → Sweep → Review",
    "Step 0 (Specify)": "Define what and why — structured specification with acceptance criteria",
    "Step 2 (Harden)": "Convert spec into binding execution contract with slices, gates, and scope",
    "Step 3 (Execute)": "Build code slice-by-slice. Can be automated (pforge run-plan) or manual (Agent Mode)",
    "Step 5 (Review Gate)": "Independent audit session — checks for drift, scope violations, and quality",

    // Execution
    "Full Auto": "Execution mode where gh copilot CLI runs each slice automatically with no human intervention",
    "Assisted": "Execution mode where human codes in VS Code while orchestrator validates gates between slices",
    "Worker": "The CLI process that executes a slice — usually gh copilot, with fallback to claude or codex CLI",
    "DAG": "Directed Acyclic Graph — the dependency graph of slices. Determines execution order",
    "[P] tag": "Parallel-safe marker on a slice header. Enables concurrent execution with other [P] slices",
    "[depends: Slice N]": "Dependency marker. This slice waits for Slice N to complete before starting",
    "[scope: path/**]": "File scope marker. Restricts the worker to these file paths. Enables conflict detection for parallel slices",

    // Components
    "Smith": "The diagnostic tool (pforge smith). Inspects environment, VS Code config, setup health, version currency. Named after a blacksmith inspecting the forge",
    "Sweep": "Completeness scan (pforge sweep). Finds TODO, FIXME, HACK, stub, placeholder markers in code",
    "Analyze": "Cross-artifact consistency scoring (pforge analyze). Scores 0-100 across traceability, coverage, tests, gates",
    "Orchestrator": "The execution engine (pforge-mcp/orchestrator.mjs). Parses plans, schedules slices, spawns workers, validates gates",
    "Hub": "WebSocket event server (pforge-mcp/hub.mjs). Broadcasts slice lifecycle events to connected clients in real-time",
    "Dashboard": "Web UI at localhost:3100/dashboard. FORGE section (10 tabs: Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces, Skills, Watcher) + LIVEGUARD section (5 tabs: Health, Incidents, Triage, Security, Env)",

    // Infrastructure
    "Guardrails": "Instruction files (.github/instructions/*.instructions.md) that auto-load based on the file being edited. 15-18 per preset",
    "Preset": "Stack-specific configuration (dotnet, typescript, python, java, go, swift, azure-iac). Determines which guardrails, agents, and prompts are installed",
    "Extension": "A community add-on providing additional agents, prompts, or instructions for specific domains (e.g., azure-infrastructure)",
    "Lifecycle Hook": "Automatic actions during Copilot sessions — SessionStart, PreToolUse, PostToolUse, Stop",

    // Data
    "Run": "A single execution of a plan. Creates .forge/runs/<timestamp>/ with results, traces, and logs",
    "Trace": "OTLP-compatible JSON (trace.json) recording the full execution with spans, events, and timing",
    "Span": "A timed unit within a trace — run-plan (root), slice (child), gate (grandchild)",
    "Manifest": "Per-run manifest.json listing all artifacts (files) produced by that run",
    "Index": ".forge/runs/index.jsonl — append-only global run registry for instant lookup",
    "Cost History": ".forge/cost-history.json — aggregate token/cost data across all runs",

    // Memory
    "OpenBrain": "Optional companion MCP server providing persistent semantic memory across sessions",
    "Thought": "A unit of knowledge in OpenBrain — a decision, convention, lesson, or insight captured for future retrieval",
    "search_thoughts": "OpenBrain tool to find prior decisions relevant to current work",
    "capture_thought": "OpenBrain tool to save a decision or lesson for future sessions",

    // Quorum (v2.5)
    "Quorum Mode": "Multi-model consensus execution. Dispatches a slice to 3+ AI models for dry-run analysis, synthesizes the best approach, then executes with higher confidence",
    "Dry-Run": "A quorum analysis mode where the worker produces a detailed implementation plan without executing any code changes",
    "Quorum Dispatch": "The fan-out phase: sending the same slice to multiple models (Claude, GPT, Gemini) in parallel for independent analysis",
    "Quorum Reviewer": "A synthesis agent that merges multiple dry-run responses into a single unified execution plan",
    "Complexity Score": "A 1-10 rating of a slice's technical difficulty based on file scope, dependencies, security keywords, database operations, gate count, task count, and historical failure rate",
    "Quorum Auto": "Threshold-based mode where only slices scoring above the configured threshold (default: 6) use quorum. Others run normally",
  },
};

// ─── Capability Surface Builder ───────────────────────────────────────

/**
 * Build the full capability surface for forge_capabilities and .well-known.
 * @param {Array} [mcpTools] - Live TOOLS array from server.mjs. If omitted, builds from TOOL_METADATA keys.
 * @param {object} [options] - { cwd, hubPort }
 */
// ─── Phase-25 v2.57: Inner-Loop Subsystem Surface ────────────────────

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

export function buildCapabilitySurface(mcpTools, options = {}) {
  const { cwd = process.cwd(), hubPort = null } = options;

  // If no tools array provided, build minimal tool objects from TOOL_METADATA keys
  const tools = mcpTools || Object.keys(TOOL_METADATA).map((name) => ({ name, description: TOOL_METADATA[name]?.intent?.[0] || name }));

  // Enrich MCP tools with metadata
  const enrichedTools = tools.map((tool) => {
    const meta = TOOL_METADATA[tool.name] || {};
    return {
      ...tool,
      ...meta,
    };
  });

  // Read installed extensions
  let extensions = [];
  try {
    const extPath = resolve(cwd, ".forge/extensions/extensions.json");
    if (existsSync(extPath)) {
      extensions = JSON.parse(readFileSync(extPath, "utf-8"));
    }
  } catch { /* ignore */ }

  // Read .forge.json
  let projectConfig = {};
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      projectConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    }
  } catch { /* ignore */ }

  return {
    schemaVersion: VERSION,
    version: APP_VERSION,
    serverVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    tools: enrichedTools,
    cli: CLI_SCHEMA,
    workflows: WORKFLOWS,
    config: {
      schema: CONFIG_SCHEMA,
      current: projectConfig,
    },
    dashboard: {
      url: `http://127.0.0.1:3100/dashboard`,
      tabs: {
        Progress: "Real-time slice progress cards via WebSocket — pending → executing → pass/fail",
        Runs: "Run history table with date, plan, slices, status, cost, duration",
        Cost: "Total spend, model breakdown (doughnut chart), monthly trend (bar chart)",
        Actions: "One-click buttons: Smith, Sweep, Analyze, Status, Validate, Extensions",
        Replay: "Browse agent session logs per slice with error/file filters",
        Extensions: "Visual extension catalog browser with search/filter",
        Config: "Visual .forge.json editor (agents, model routing) with save confirmation",
        Traces: "OTLP trace waterfall with span detail, severity filters, attributes viewer",
        Skills: "Skill catalog and execution history with step-level detail",
        "LG Health": "LiveGuard drift score gauge, drift history chart, hotspot analysis — monitors plan alignment over time",
        "LG Incidents": "Open incidents feed and fix proposals from LiveGuard alerting pipeline",
        "LG Triage": "Alert triage view — severity grouping, quorum analysis launch, actionable summaries",
        "LG Security": "Secret scan results with Shannon entropy findings, confidence levels, and file locations",
        "LG Env": "Environment key diff — key-name-only comparison across .env files (values never displayed)",
      },
      standalone: "node pforge-mcp/server.mjs --dashboard-only",
      description: "Use --dashboard-only to run the dashboard without MCP stdio (for standalone monitoring, demos, or testing). FORGE section covers plan execution; LIVEGUARD section covers runtime safety",
    },
    restApi: {
      baseUrl: `http://127.0.0.1:3100`,
      endpoints: [
        { method: "GET", path: "/api/status", description: "Current run status (latest summary or in-progress)" },
        { method: "GET", path: "/api/runs", description: "Run history (last 50 summaries)" },
        { method: "GET", path: "/api/config", description: "Read .forge.json" },
        { method: "POST", path: "/api/config", description: "Write .forge.json (with validation)" },
        { method: "GET", path: "/api/cost", description: "Cost report from cost-history.json" },
        { method: "POST", path: "/api/tool/:name", description: "Invoke any pforge CLI command via HTTP" },
        { method: "GET", path: "/api/hub", description: "WebSocket hub status + connected clients" },
        { method: "GET", path: "/api/replay/:runIdx/:sliceId", description: "Session replay log for a slice" },
        { method: "GET", path: "/api/traces", description: "List all runs from index.jsonl" },
        { method: "GET", path: "/api/traces/:runId", description: "Single run trace detail (trace.json)" },
        { method: "GET", path: "/api/capabilities", description: "Full capability surface (same as forge_capabilities)" },
        { method: "GET", path: "/.well-known/plan-forge.json", description: "HTTP discovery endpoint — machine-readable surface for OpenClaw and external agents" },
        { method: "POST", path: "/api/runs/trigger", description: "Inbound run trigger — start a plan remotely (OpenClaw, CI). Auth: bridge.approvalSecret Bearer token. Body: { plan, quorum?, model?, resumeFrom?, estimate?, dryRun? }" },
        { method: "POST", path: "/api/runs/abort", description: "Abort an in-progress triggered run. Auth: bridge.approvalSecret Bearer token." },
        { method: "GET", path: "/api/memory", description: "OpenBrain connection status and endpoint" },
        { method: "POST", path: "/api/memory/search", description: "Search OpenBrain project memory. Body: { query, project?, limit? }" },
        { method: "POST", path: "/api/memory/capture", description: "Capture a thought into OpenBrain via REST (OpenClaw use). Auth: bridge.approvalSecret. Body: { content, project?, type?, source?, created_by? }" },
        { method: "GET", path: "/api/bridge/status", description: "Bridge status — channels, pending approvals, stats" },
        { method: "POST", path: "/api/bridge/approve/:runId", description: "Receive approval callback. Auth: bridge.approvalSecret. Body: { action: 'approve'|'reject', approver? }" },
        { method: "GET", path: "/api/bridge/approve/:runId", description: "Browser-friendly approval link for Telegram inline buttons. Query: ?action=approve|reject&token=<secret>" },
        // LiveGuard REST endpoints (v2.27.0)
        { method: "GET", path: "/api/drift", description: "Run architecture drift check against guardrail rules. Returns score, violations, trend." },
        { method: "GET", path: "/api/drift/history", description: "Drift score history from .forge/drift-history.jsonl" },
        { method: "POST", path: "/api/incident", description: "Capture an incident. Body: { description, severity?, files?, resolvedAt? }" },
        { method: "GET", path: "/api/incidents", description: "List all captured incidents from .forge/incidents.jsonl" },
        { method: "POST", path: "/api/regression-guard", description: "Run regression guard — execute validation gates from plan files. Body: { files?, plan?, failFast? }" },
        { method: "POST", path: "/api/deploy-journal", description: "Record a deployment. Body: { version, by?, notes?, slice? }" },
        { method: "GET", path: "/api/deploy-journal", description: "List all deploy journal entries from .forge/deploy-journal.jsonl" },
        { method: "GET", path: "/api/triage", description: "Prioritized alert triage — ranked cross-signal alert list. Query: ?minSeverity=&max=" },
        { method: "POST", path: "/api/runbook", description: "Generate operational runbook from a plan file. Body: { plan, includeIncidents? }" },
        { method: "GET", path: "/api/runbooks", description: "List all generated runbooks from .forge/runbooks/" },
        { method: "GET", path: "/api/hotspots", description: "Git churn hotspot analysis. Query: ?top=&since=" },
        { method: "GET", path: "/api/health-trend", description: "Health trend analysis — drift, cost, incidents, model performance over time. Query: ?days=&metrics=" },
        { method: "GET", path: "/api/deps/watch", description: "Latest dependency vulnerability snapshot from .forge/deps-snapshot.json" },
        { method: "POST", path: "/api/deps/watch/run", description: "Trigger a new dependency vulnerability scan. Auth: bridge.approvalSecret Bearer token. Body: { path?, notify? }" },
        { method: "POST", path: "/api/tool/org-rules", description: "Generate org-rules instruction file via REST" },
        { method: "POST", path: "/api/image/generate", description: "Generate an image via xAI Aurora or OpenAI DALL-E. Body: { prompt, outputPath, model?, size?, format?, quality? }" },
      ],
    },
    hub: hubPort
      ? {
          url: `ws://127.0.0.1:${hubPort}`,
          status: "running",
          connectionString: `ws://127.0.0.1:${hubPort}?label=<your-label>`,
          features: ["broadcast", "heartbeat (30s)", "event history (last 100)", "session registry", "client labels"],
          portFallback: "If 3101 unavailable, increments until free. Active port stored in .forge/server-ports.json",
        }
      : { status: "stopped" },
    telemetry: {
      traceFormat: "OTLP-compatible JSON in .forge/runs/<timestamp>/trace.json",
      spanKinds: ["SERVER (run-plan root)", "INTERNAL (slice orchestration)", "CLIENT (worker spawn, gate execution)"],
      severityLevels: { TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 },
      logRegistry: {
        manifest: ".forge/runs/<timestamp>/manifest.json — per-run artifact registry",
        index: ".forge/runs/index.jsonl — append-only global run index (corruption-tolerant)",
      },
      retention: "maxRunHistory config in .forge.json (default: 50), auto-prunes oldest runs",
    },
    orchestratorApi: {
      description: "Internal APIs exported from pforge-mcp/orchestrator.mjs for advanced integrations",
      exports: {
        parsePlan: { description: "Parse plan Markdown → DAG with slices, deps, scope, gates", args: "planPath" },
        runPlan: { description: "Execute a plan end-to-end (main orchestration entry)", args: "planPath, options" },
        detectWorkers: { description: "Detect available CLI workers (gh-copilot, claude, codex)", returns: "array" },
        spawnWorker: { description: "Spawn a CLI worker with prompt, model, timeout", args: "prompt, options" },
        runGate: { description: "Execute a validation gate command (allowlisted)", args: "command, cwd" },
        getCostReport: { description: "Generate cost report from .forge/cost-history.json", args: "cwd" },
        calculateSliceCost: { description: "Calculate cost for a single slice from token data", args: "tokens" },
        buildCostBreakdown: { description: "Build cost breakdown from all slice results", args: "sliceResults" },
        SequentialScheduler: { description: "Execute slices one-at-a-time in DAG order" },
        ParallelScheduler: { description: "Execute [P]-tagged slices concurrently (up to maxParallelism)" },
      },
      schedulerSelection: "Auto-detected: if plan has [P] tags → ParallelScheduler, else SequentialScheduler",
      conflictDetection: "Parallel slices with overlapping [scope:] patterns forced to sequential",
    },
    innerLoop: INNER_LOOP_SURFACE,
    extensions,
    memory: buildMemoryCapabilities(cwd),
    system: SYSTEM_REFERENCE,
  };
}

// ─── OpenBrain Memory Integration ─────────────────────────────────────

/**
 * Build OpenBrain memory capabilities section for the API surface.
 * Tells agents how to use persistent memory with Plan Forge.
 */
function buildMemoryCapabilities(cwd) {
  const configured = isOpenBrainConfigured(cwd);

  return {
    provider: "OpenBrain",
    configured,
    description: configured
      ? "Persistent semantic memory is active. Use search_thoughts before work and capture_thought after decisions."
      : "OpenBrain is not configured. Memory features are disabled. See CUSTOMIZATION.md for setup.",

    // Companion MCP tools (from OpenBrain server, not Plan Forge)
    companionTools: {
      search_thoughts: {
        description: "Search for prior decisions, patterns, and lessons relevant to current work",
        when: "Before starting any slice, review, or planning session",
        params: {
          query: "Natural language search (e.g., 'authentication patterns', 'database migration conventions')",
          project: "Scope to current project name (from .forge.json projectName)",
          type: "Filter by type: 'convention', 'decision', 'lesson', 'insight'",
          limit: "Max results (default: 10)",
        },
        examples: [
          { query: "project conventions", project: "MyApp", type: "convention", limit: 5 },
          { query: "authentication patterns EF Core", project: "MyApp" },
          { query: "prior phase mistakes lessons", project: "MyApp", type: "lesson" },
        ],
      },
      capture_thought: {
        description: "Save a decision, convention, or lesson for future sessions to find",
        when: "After completing a slice, making an architecture decision, or discovering a pattern",
        params: {
          content: "The thought (e.g., 'Decision: Used repository pattern for data access because...')",
          project: "Current project name",
          source: "Where captured (e.g., 'plan-forge-orchestrator/Phase-1/slice-3')",
          created_by: "Who captured (e.g., 'copilot-vscode', 'gh-copilot-worker')",
        },
        captureGuidelines: [
          "Capture architecture decisions and WHY alternatives were rejected",
          "Capture naming conventions and patterns established",
          "Capture gotchas and constraints discovered (saves time in future phases)",
          "Capture lessons from failures (what broke, what fixed it)",
          "Do NOT capture trivial facts or code that's already in version control",
        ],
        examples: [
          {
            content: "Decision: Used IProjectService interface with EF Core repository pattern. Rejected Active Record because the team prefers explicit separation of concerns.",
            project: "TimeTracker",
            source: "plan-forge-orchestrator/Phase-2/slice-1",
            created_by: "gh-copilot-worker",
          },
          {
            content: "Convention: All soft-deletes use IsActive=false, never physical DELETE. GetAllAsync filters by IsActive=true by default.",
            project: "TimeTracker",
            source: "plan-forge-orchestrator/Phase-1/slice-2",
            created_by: "gh-copilot-worker",
          },
        ],
      },
      capture_thoughts: {
        description: "Batch capture multiple thoughts in one call (more efficient than multiple capture_thought calls)",
        when: "After completing a run or phase with multiple decisions",
      },
      thought_stats: {
        description: "Get statistics about captured thoughts (count by project, type, source)",
        when: "To understand how much project knowledge has been accumulated",
      },
    },

    // How Plan Forge orchestrator integrates with OpenBrain
    orchestratorIntegration: {
      beforeSlice: "Worker prompts include search_thoughts instructions to load prior conventions and decisions",
      afterSlice: "Worker prompts include capture_thought instructions to persist architecture decisions and patterns",
      afterRun: "Summary includes _memoryCapture field with run summary thought + cost anomaly thought",
      costAnomaly: "If run cost exceeds 2x the historical average, a cost insight thought is auto-generated",
      autoCapture: {
        runSummary: {
          trigger: "After every run (pass or fail)",
          content: "Plan name, status, slices passed/failed, duration, cost, failed slice details",
          project: "From .forge.json projectName",
          source: "plan-forge-orchestrator/<plan-path>",
        },
        costAnomaly: {
          trigger: "After run if cost > 2x historical average",
          content: "Cost anomaly alert with current vs average cost",
          threshold: "2.0x average cost per run",
          requiresHistory: "At least 2 prior runs in cost-history.json",
        },
      },
      summaryField: "_memoryCapture in summary JSON (in-memory only, not written to disk — caller acts on it)",
    },

    // Recommended workflows combining Plan Forge + OpenBrain
    workflows: {
      "memory-enhanced-execution": {
        description: "Execute a plan with full memory context",
        steps: [
          { tool: "search_thoughts", args: { query: "project conventions", type: "convention" }, description: "Load conventions before planning" },
          { tool: "forge_run_plan", args: { estimate: true }, description: "Estimate with historical data" },
          { tool: "forge_run_plan", description: "Execute — workers auto-search/capture if OpenBrain configured" },
          { tool: "forge_cost_report", description: "Review cost" },
          { tool: "capture_thought", args: { content: "Phase N complete: <summary>" }, description: "Persist phase summary" },
        ],
      },
      "knowledge-review": {
        description: "Review accumulated project knowledge",
        steps: [
          { tool: "thought_stats", description: "See knowledge distribution" },
          { tool: "search_thoughts", args: { query: "decisions", type: "decision" }, description: "Review architecture decisions" },
          { tool: "search_thoughts", args: { query: "lessons mistakes", type: "lesson" }, description: "Review lessons learned" },
        ],
      },
    },
  };
}

/**
 * Write tools.json to pforge-mcp/ directory.
 */
export function writeToolsJson(mcpTools, outputDir) {
  const surface = buildCapabilitySurface(mcpTools);
  const toolsPath = resolve(outputDir, "tools.json");
  writeFileSync(toolsPath, JSON.stringify(surface.tools, null, 2));
  return toolsPath;
}

/**
 * Write cli-schema.json to pforge-mcp/ directory.
 */
export function writeCliSchema(outputDir) {
  const schemaPath = resolve(outputDir, "cli-schema.json");
  writeFileSync(schemaPath, JSON.stringify(CLI_SCHEMA, null, 2));
  return schemaPath;
}
