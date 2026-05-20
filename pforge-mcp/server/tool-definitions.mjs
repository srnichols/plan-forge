// ─── Tool Definitions ─────────────────────────────────────────────────
// Pure data: MCP tool schemas (name, description, inputSchema)
// No imports needed — this file is a static registry.

export const TOOLS = [
  {
    name: "forge_smith",
    description: "Inspect the forge — diagnose environment, VS Code config, setup health, version currency, and common problems. Returns structured results with pass/fail/warning counts.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_github_status",
    description: "Inspect the GitHub-native AI surface a project has wired up — .github/copilot-instructions.md, AGENTS.md, .github/instructions/, .github/prompts/, .vscode/mcp.json (Plan-Forge entry), .github/workflows/, github.com remote, gh CLI. Read-only; no network calls. USE FOR: diagnosing missing GitHub Copilot / GHAS / MCP wiring; building a readiness report; in-IDE chat answering 'what GitHub primitives am I missing?'.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        extra: { type: "boolean", description: "Run optional depth checks (instruction-file applyTo, copilot-instructions length)" },
      },
    },
  },
  {
    name: "forge_github_metrics",
    description: "Fetch live GitHub repository metrics via the gh CLI — stars, forks, open issues, PR counts, and commit activity. Requires gh CLI authenticated. USE FOR: project health dashboards, sprint retrospectives, answering 'how active is this repo?'. Returns null fields gracefully when gh is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository slug owner/repo (auto-detected from git remote when omitted)" },
        period: { type: "string", description: "Lookback window: 7d, 30d, or 90d (default: 30d)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_delegate_review",
    description: "Delegate code review for the current branch's PR to the Copilot Coding Agent. Finds the open PR, creates a GitHub issue assigned to @copilot with structured review criteria, and returns the issue URL. The agent reviews the diff and posts findings. USE FOR: trigger AI code review, delegate PR review to Copilot, agentic review. DO NOT USE FOR: viewing review status (check the created issue), creating PRs (use gh pr create).",
    inputSchema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: { type: "string" },
          description: "Custom review criteria checklist items. Defaults to standard Plan Forge security, testing, and architecture checks.",
        },
        path: { type: "string", description: "Project root to detect git branch and PR (default: current)" },
      },
    },
  },
  {
    name: "forge_team_dashboard",
    description: "Show the multi-developer plan coordination dashboard — aggregates team-activity.jsonl by operator and returns per-developer stats (runs, success rate, cost) plus a conflict-risk assessment for teams where multiple developers are active concurrently. USE FOR: team coordination view, who is running what plan, concurrent developer risk. DO NOT USE FOR: individual run details (use forge_plan_status), raw activity feed (use forge_team_activity), cost breakdown (use forge_cost_report).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max activity entries to aggregate (default 50, max 200)" },
        since: { type: "string", description: "ISO date string — only aggregate entries after this date" },
        path: { type: "string", description: "Project root (default: current)" },
      },
    },
  },
  {
    name: "forge_team_activity",
    description: "Read recent Plan Forge run summaries from the team activity feed (.forge/team-activity.jsonl). Shows who ran what plan, when, and at what cost — across all developers sharing the same repo. USE FOR: see recent team plan runs, check what plans are in flight, review team plan cost. DO NOT USE FOR: individual slice details (use forge_plan_status), cost breakdown (use forge_cost_report).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries to return (default 20, max 100)" },
        since: { type: "string", description: "ISO date string to filter entries after this date" },
        path: { type: "string", description: "Project root (default: current)" },
      },
    },
  },
  {
    name: "forge_validate",
    description: "Validate Plan Forge setup — check that all required files exist, file counts match preset expectations, and no unresolved placeholders remain.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_sweep",
    description: "Run completeness sweep — scan code files for TODO, FIXME, HACK, stub, placeholder, and mock data markers. Returns locations of all deferred-work markers.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_status",
    description: "Show all phases from DEPLOYMENT-ROADMAP.md with their current status (planned, in-progress, complete, paused).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_diff",
    description: "Compare changed files against a plan's Scope Contract — detect drift, forbidden file edits, and unplanned changes.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_diff_classify",
    description: "Classify staged git diff changes by category (plan, test, docs, config, chore, scope, unknown). Advisory-only — never blocks. Returns a per-file classification and summary counts. Also available as a preCommit chain entry in plan-forge.json.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Git ref to diff against instead of --staged (e.g., HEAD~1)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_ext_search",
    description: "Search the Plan Forge community extension catalog. Returns matching extensions with names, descriptions, categories, and install commands.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword (optional — omit to list all)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_ext_info",
    description: "Show detailed information about a specific extension from the community catalog — author, version, category, provides, tags, and install command.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Extension name from the catalog" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "forge_new_phase",
    description: "Create a new phase plan file and add it to the deployment roadmap. Returns the created file path and roadmap entry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Phase name (e.g., 'user-auth', 'payment-gateway')" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "forge_analyze",
    description: "Cross-artifact analysis — validates requirement traceability, test coverage, scope compliance, and validation gates. Returns a consistency score (0-100) with detailed breakdown. With quorum=true, dispatches to multiple AI models (including API providers like xAI Grok) for multi-model consensus analysis.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan or source file to analyze (e.g., docs/plans/Phase-1-AUTH-PLAN.md or src/services/billing.ts)" },
        quorum: { type: "boolean", description: "If true, dispatch analysis to multiple models and synthesize findings. Default: false" },
        mode: { type: "string", enum: ["plan", "file"], description: "Analysis mode: 'plan' (plan consistency) or 'file' (code review). Default: auto-detected from filename" },
        models: { type: "string", description: "Comma-separated model list override (e.g., 'grok-3-mini,claude-sonnet-4.6,gpt-5.3-codex'). Default: quorum config models" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_diagnose",
    description: "Multi-model bug investigation — dispatches independent bug analysis to multiple AI models (including API providers like xAI Grok), then synthesizes root cause analysis with fix recommendations. Each model examines code paths, failure modes, edge cases, and race conditions independently.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to the source file to investigate (e.g., src/services/billing.ts)" },
        models: { type: "string", description: "Comma-separated model list override (e.g., 'grok-3-mini,grok-4,claude-sonnet-4.6'). Default: quorum config models" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["file"],
    },
  },
  {
    name: "forge_run_plan",
    description: "Execute a hardened plan — spawn CLI workers for each slice, validate at every boundary, track tokens. Supports Full Auto (gh copilot CLI) and Assisted (human + automated gates) modes. Use --estimate for cost prediction without executing. To bypass the Crucible gate: pass manualImport:true (MCP) or --manual-import (CLI).",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the hardened plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        mode: { type: "string", enum: ["auto", "assisted"], description: "Execution mode: 'auto' (CLI worker) or 'assisted' (human + gates). Default: auto" },
        model: { type: "string", description: "Model override (e.g., claude-sonnet-4.6, gpt-5.2-codex). Default: auto" },
        estimate: { type: "boolean", description: "If true, return cost estimate without executing" },
        resumeFrom: { type: "number", description: "Slice number to resume from (skips completed slices)" },
        dryRun: { type: "boolean", description: "If true, parse and validate plan without executing" },
        quorum: { type: "string", enum: ["false", "true", "auto", "power", "speed"], description: "Quorum mode: 'false' (off), 'true' (all slices), 'auto' (threshold-based), 'power' (flagship models: Opus + GPT-5.3 + Grok 4.20), 'speed' (fast models: Sonnet + GPT-5.4-mini + Grok 4.1-fast). Default: auto" },
        quorumThreshold: { type: "number", description: "Override complexity threshold for auto quorum (1-10). Default: 6" },
        manualImport: { type: "boolean", description: "v2.37 Crucible — bypass the crucibleId frontmatter gate. Logged to .forge/crucible/manual-imports.jsonl." },
        manualImportSource: { type: "string", enum: ["human", "speckit", "grandfather"], description: "v2.37 Crucible — audit tag for --manual-import bypass. Default: human." },
        manualImportReason: { type: "string", description: "v2.37 Crucible — optional free-form note recorded in the manual-import audit log." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_abort",
    description: "Abort the currently running plan execution. The abort takes effect between slices — the current slice will finish first.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_plan_status",
    description: "Get the status of the latest plan execution run. Shows per-slice results, token usage, duration, and overall status from .forge/runs/.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Filter by plan name (optional — shows latest if omitted)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_cost_report",
    description: "Cost tracking report — shows total spend, per-model breakdown, and monthly aggregation from .forge/cost-history.json. Includes token counts, run history, and forge_model_stats (success rate per model from model-performance.json).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_estimate_quorum",
    description: "Returns projected cost of a plan under all four quorum modes (auto / power / speed / false) in a single call. Agents MUST call this tool before presenting any dollar amount for a plan — hand-computed quorum costs drift by an order of magnitude. Backed by cost-service.mjs, the same code path that powers `pforge run-plan --estimate`.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string", description: "Path to the plan Markdown file, relative to the project root." },
        resumeFrom: { type: "string", description: "Optional slice number to start from — excludes already-shipped slices from the estimate." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["planPath"],
    },
  },
  {
    name: "forge_estimate_slice",
    description: "Returns projected cost for a single slice under a chosen quorum mode. Cheaper than forge_estimate_quorum (which estimates the whole plan). Backed by cost-service.mjs estimateSlice(). Un-calibrated — no run-level historical correction factor applied.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string", description: "Path to the plan Markdown file, relative to the project root." },
        sliceNumber: { type: ["string", "number"], description: "Slice identifier (numeric or alphanumeric, e.g. 4 or '2A')." },
        mode: { type: "string", enum: ["auto", "power", "speed", "false"], description: "Quorum mode to project under (default: 'auto')." },
        model: { type: "string", description: "Base model for pricing (default: 'claude-sonnet-4.5')." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["planPath", "sliceNumber"],
    },
  },
  {
    name: "forge_capabilities",
    description: "Machine-readable API surface — returns all MCP tools with semantic metadata (intent, prerequisites, errors, cost), CLI commands, workflow graphs, config schema, dashboard info, and installed extensions. Agents call this once on session start for full discoverability.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_watch",
    description: "WATCHER (v2.34) — read-only observer that tails another project's pforge run. Run this from a SECOND VS Code Copilot session with Plan-Forge as the workspace, pointing targetPath at the project being executed. Returns snapshot of current run state (slices passed/failed/in-progress, token counts, gate errors) plus heuristic anomaly detection. Mode 'analyze' additionally invokes a frontier model (default: claude-opus-4.7) for narrative advice. The watcher CANNOT modify any files in the target project.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "Absolute path to the project being watched (e.g., E:/GitHub/Rummag)" },
        runId: { type: "string", description: "Specific run directory under .forge/runs/ (default: latest)" },
        mode: { type: "string", enum: ["snapshot", "analyze"], description: "snapshot = file reads only, no AI cost. analyze = invokes watcher model for advice." },
        model: { type: "string", description: "Override watcher model (default: claude-opus-4.7)" },
        tailEvents: { type: "number", description: "Trailing events to include (1-200, default: 25). Lower = cheaper analyze prompts." },
        sinceTimestamp: { type: "string", description: "(v2.35) ISO timestamp cursor — only flag events newer than this. Pass back the previous report's `cursor` field for continuous monitoring." },
        recordHistory: { type: "boolean", description: "(v2.35) Append snapshot to watcher's own .forge/watch-history.jsonl (default: true)" },
      },
      required: ["targetPath"],
    },
  },
  {
    name: "forge_watch_live",
    description: "WATCHER LIVE TAIL (v2.35) — stream events from another project's pforge run for a fixed duration. Connects to the target's WebSocket hub if running (`.forge/server-ports.json`); falls back to file polling otherwise. Read-only by design — only subscribes, never sends commands. Returns aggregate stats and the captured event stream. By default events are projected to a lite shape `{ ts, type, correlationId }` to keep payloads small; pass `verbose: true` for full event objects.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "Absolute path to the project being watched" },
        durationMs: { type: "number", description: "How long to listen, in ms (1000-3600000, default: 60000)" },
        pollIntervalMs: { type: "number", description: "Polling interval if hub not running (default: 3000ms)" },
        maxCapturedEvents: { type: "number", description: "Buffer size for captured events (1..10000, default: 500)" },
        verbose: { type: "boolean", description: "If true, return full event objects (pre-ACI behaviour). Default false → lite projection { ts, type, correlationId }." },
      },
      required: ["targetPath"],
    },
  },
  {
    name: "forge_memory_report",
    description: "GX.3 (v2.36): aggregate the health of every memory surface — L2 jsonl files (record counts, schema _v distribution), OpenBrain queue state (pending/delivered/failed/deferred/DLQ), drain stats trend, capture telemetry (per-tool/per-type volume + dedup rate), search cache health, and orphans under .forge/. Read-only — never mutates files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_skill_status",
    description: "Get recent skill execution events from the WebSocket hub history. Shows which skills were run, per-step results, and timing.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "Filter by skill name (optional — shows all recent if omitted)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_run_skill",
    description: "Execute a skill programmatically — parse the SKILL.md, run steps with validation gates, emit events to the hub, return structured results. Use for automated skill execution with progress tracking.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill name (e.g., 'health-check', 'test-sweep') or path to SKILL.md" },
        args: { type: "string", description: "Arguments to pass to the skill (optional)" },
        dryRun: { type: "boolean", description: "If true, parse and validate skill without executing" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["skill"],
    },
  },
  {
    name: "forge_org_rules",
    description: "Export org custom instructions — consolidate .github/instructions/*.instructions.md files into a single block for GitHub org-level Copilot custom instructions (Layer 1 of the two-layer model). Strips per-file frontmatter since org instructions apply universally. USE FOR: export org rules, generate org-level Copilot instructions, consolidate coding standards, org governance, GitHub org custom instructions.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        format: { type: "string", description: "Output format: github (default, plain text for org settings), markdown (formatted with headers), or json (structured)", enum: ["github", "markdown", "json"] },
        output: { type: "string", description: "File path to write output relative to project dir (optional — returns content if omitted)" },
      },
    },
  },
  {
    name: "forge_crucible_submit",
    description: "Submit a raw idea to the Crucible — starts a new smelt (idea → spec workflow). Returns a smelt id, a recommended lane (tweak / feature / full), and the first interview question. USE FOR: kicking off Crucible from an AI agent or CLI with a one-line description of a change, bug, or feature. Agent-submitted smelts are subject to the recursion guardrail (default depth=1, set source='agent').",
    inputSchema: {
      type: "object",
      properties: {
        rawIdea: { type: "string", description: "The raw idea text — a sentence or short paragraph describing the change." },
        lane: { type: "string", enum: ["tweak", "feature", "full"], description: "Override the recommended lane. Omit to accept the heuristic's choice." },
        source: { type: "string", enum: ["human", "agent"], description: "Who submitted the smelt. Default: human." },
        parentSmeltId: { type: "string", description: "Parent smelt id if this was spawned from another smelt (used for recursion depth tracking)." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["rawIdea"],
    },
  },
  {
    name: "forge_crucible_ask",
    description: "Advance the Crucible interview — supply an answer and get the next question, or mark the smelt ready for preview/finalize when the interview is complete. Call without `answer` to fetch the current question. USE FOR: the interactive Q&A loop that turns a raw idea into a hardened spec.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id returned by forge_crucible_submit." },
        questionId: { type: "string", description: "Optional — the id of the question this answer is for. When supplied, the server validates it matches the pending question and refuses with ASK_QUESTION_MISMATCH on drift (Issue #138). Omit to trust the server's pending question." },
        answer: { type: "string", description: "Answer to the current question. Omit to fetch the current question without advancing." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_preview",
    description: "Render the current draft of a smelt as a Markdown plan. Returns the draft, the tentative phase name (null until finalized), and a list of unresolved fields (slots still awaiting an answer). USE FOR: reviewing before finalize, or for the dashboard's live-preview pane.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_finalize",
    description: "Finalize a smelt — atomically claim the next phase number, write docs/plans/Phase-NN.md with a `crucibleId:` frontmatter stamp, and mark the smelt finalized. Refuses to overwrite an existing plan unless `overwrite:true` is passed (Issue #137). Returns the chosen phase name and the plan path. USE FOR: closing the idea→spec workflow when the interview is done.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id. Must be status=in-progress." },
        overwrite: { type: "boolean", description: "Issue #137 — when true, replaces an existing docs/plans/Phase-NN.md. When false (default), refuses if the file exists and instead writes a side-by-side `Phase-NN.crucible-draft.md`." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_list",
    description: "List Crucible smelts, newest-first, optionally filtered by status. USE FOR: dashboard smelt-list panel, resuming in-progress smelts across sessions, auditing recently finalized smelts.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["in-progress", "finalized", "abandoned"], description: "Filter by smelt status. Omit to return all." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_crucible_abandon",
    description: "Abandon a smelt — marks it status=abandoned and releases any phase-number claim it held. Idempotent: re-abandoning a smelt is a no-op. USE FOR: discarding a smelt that was started by mistake or superseded by another idea.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id to abandon." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_import",
    description: "Import a Spec Kit project into a Plan Forge Crucible smelt — deterministic, LLM-free field mapping. Returns a smelt id, generated plan path, mapped fields, and any missing-field warnings. USE FOR: importing Spec Kit specs into Plan Forge from Cursor/Claude Code/Codex (no Copilot Chat required), CI pipelines, or any non-Copilot agent. Supports dry-run mode for validation without writing files.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["spec-kit"], description: "Spec format to import from. Currently only 'spec-kit' is supported." },
        dir: { type: "string", description: "Directory containing Spec Kit artifacts (spec.md, plan.md, tasks.md, constitution.md). Defaults to auto-detected Spec Kit paths under the project root." },
        dryRun: { type: "boolean", description: "When true, performs mapping and validation but writes nothing to disk. Returns the same shape as a real import." },
        syncPrinciples: { type: "boolean", description: "When true, writes constitution.md content (transformed) to docs/plans/PROJECT-PRINCIPLES.md. Returns PROJECT_PRINCIPLES_EXISTS error if the file already exists." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["source"],
    },
  },
  {
    name: "forge_crucible_status",
    description: "List Crucible smelts by source and status, or inspect a single smelt. Omit smeltId to list all smelts under .forge/crucible/ (id, source, status, created). Supply smeltId for full smelt detail. USE FOR: auditing imported smelts, checking import results, browsing the smelt archive.",
    inputSchema: {
      type: "object",
      properties: {
        smeltId: { type: "string", description: "Smelt id for single-smelt detail view. Omit to list all smelts." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_tempering_scan",
    description: "Tempering (read-only) — scan an existing coverage report (lcov.info / coverage-final.json / cobertura.xml / jacoco.xml / go cover.out / tarpaulin JSON) and report per-layer coverage vs. configured minima. On first run, seeds .forge/tempering/config.json with enterprise defaults. Does NOT execute any tests. USE FOR: diagnosing coverage gaps, pre-deploy readiness checks, dashboard feeds. Writes .forge/tempering/scan-<ts>.json.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        correlationId: { type: "string", description: "Optional correlation id to thread this scan to an upstream smelt / plan / run. When omitted, one is minted." },
      },
    },
  },
  {
    name: "forge_tempering_status",
    description: "Return the latest N Tempering scan summaries — used by the dashboard feed and `forge_smith` panel. Read-only; never triggers a scan. USE FOR: checking freshness, listing recent coverage status, wiring Tempering into other tools.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        limit: { type: "number", description: "Max scans to return (1..100, default 10)." },
      },
    },
  },
  {
    name: "forge_tempering_run",
    description: "Tempering execution harness — runs the enabled test scanners (unit, integration, UI/Playwright, and API contract/OpenAPI/GraphQL) through each stack's preset adapter (typescript/dotnet/python/go/java/rust; php/swift/azure-iac stub until extension). Enforces config.runtimeBudgets with SIGTERM→SIGKILL, writes .forge/tempering/run-<ts>.json and .forge/tempering/artifacts/<runId>/contract/report.json, emits tempering-run-started / tempering-run-scanner-started / tempering-run-scanner-completed / tempering-run-completed hub events. USE FOR: post-slice verification, pre-deploy gates, CI adapters. Forbidden: does NOT edit source, does NOT create bugs (that lands in TEMPER-06), does NOT recurse into plan-forge itself.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        correlationId: { type: "string", description: "Optional correlation id to thread this run to an upstream smelt / plan / slice. When omitted, one is minted." },
        sliceRef: {
          type: "object",
          description: "Optional plan+slice context. Surfaced in the run record and hub events so dashboards can group runs by slice.",
          properties: {
            plan: { type: "string" },
            slice: { type: "string" },
          },
        },
        lastGreenSha: { type: "string", description: "Git SHA of the most recent green run; when present and config.execution.regressionFirst is true, the adapter is hinted to run tests covering changed files first." },
        fullMutation: { type: "boolean", description: "Force mutation scanner regardless of scheduling gate. Default: false." },
        trigger: { type: "string", enum: ["post-slice", "nightly", "manual"], description: "Trigger context for scheduling decisions (mutation scanner gating). Default: manual." },
        objective: {
          type: "object",
          description: "Optional objective guard (A7). If provided, the harness runs `command` before and after the scanner suite and accepts the candidate only if the metric moves in the `acceptIf` direction. Worker never sees the baseline number.",
          properties: {
            command: { type: "string", description: "Shell command (run in projectDir) that prints a single numeric value on stdout. Non-zero exit = rejected." },
            acceptIf: { type: "string", enum: ["greater", "less"], description: "Accept the candidate when the post-run metric is greater (default) or less than the baseline." },
          },
          required: ["command"],
        },
      },
    },
  },
  {
    name: "forge_tempering_approve_baseline",
    description: "Promote the current screenshot for a URL to the visual-diff baseline. Copies the latest screenshot to .forge/tempering/baselines/ and writes a JSON sidecar with promotion metadata. Idempotent — re-promoting overwrites. USE FOR: accepting intentional visual changes after a visual regression is flagged by forge_tempering_run.",
    inputSchema: {
      type: "object",
      properties: {
        urlHash: { type: "string", description: "Hash of the URL to approve (from visual-diff scanner output)" },
        url: { type: "string", description: "Full URL to approve (alternative to urlHash — hash will be derived)" },
        runId: { type: "string", description: "Specific run ID to promote from (optional — defaults to most recent)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  // Phase-39 Slice 4 — Audit loop MCP tools
  {
    name: "forge_tempering_drain",
    description: "Tempering drain loop — wraps forge_tempering_run in a round-loop that re-probes until convergence or max-rounds cap fires. Writes per-round deltas to .forge/tempering/drain-history.jsonl and a final audit artifact to .forge/audits/dev-<ts>.json. USE FOR: recursive audit loops, post-plan convergence checks, drain-until-clean semantics. DO NOT USE FOR: single-shot tempering runs (use forge_tempering_run), editing source, creating bugs directly.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        maxRounds: { type: "number", description: "Maximum drain rounds (default: 5, max: 20)" },
        scanners: { type: "array", items: { type: "string" }, description: "Scanner names to run each round (default: all enabled)" },
        correlationId: { type: "string", description: "Optional correlation ID" },
        sliceRef: {
          type: "object",
          description: "Optional plan+slice context",
          properties: {
            plan: { type: "string" },
            slice: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "forge_triage_route",
    description: "Triage a single tempering finding into one of three lanes: 'bug' (product defect), 'spec' (feature/spec gap), or 'classifier' (noise). Pure routing — no side effects. Fail-safe: unknown classifier output always routes to 'bug' with low confidence. USE FOR: per-finding triage after a tempering run, building custom drain loops. DO NOT USE FOR: batch triage (use forge_tempering_drain), registering bugs (use forge_bug_register after triage).",
    inputSchema: {
      type: "object",
      required: ["finding"],
      properties: {
        finding: {
          type: "object",
          description: "A finding from a tempering scanner: { class, route, severity, evidence }",
          properties: {
            class: { type: "string" },
            route: { type: "string" },
            severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
            evidence: { type: "object" },
          },
          required: ["class", "severity"],
        },
        classifierResult: {
          type: "object",
          description: "Output from the bug classifier. If omitted, fail-safe routes to 'bug' lane.",
          properties: {
            classification: { type: "string" },
            reason: { type: "string" },
            confidence: { type: "number" },
            source: { type: "string" },
          },
        },
      },
    },
  },
  // Phase CLASSIFIER-ISSUE — GitHub issue creation for classifier-lane findings
  {
    name: "forge_classifier_issue",
    description: "File a GitHub issue proposing a classifier rule update when a tempering finding routes to the 'classifier' lane (infra noise). Deduplicates by finding class + reason hash — repeated occurrences comment on the existing issue instead of creating a duplicate. USE FOR: closing the audit loop when routeFinding returns lane='classifier', tracking recurring noise patterns in GitHub. DO NOT USE FOR: product bugs (use forge_bug_register), spec gaps (submit to Crucible), self-repair defects (use forge_meta_bug_file).",
    inputSchema: {
      type: "object",
      required: ["payload"],
      properties: {
        payload: {
          type: "object",
          description: "Classifier-lane payload from forge_triage_route (lane must be 'classifier'): { findingClass, route, currentClassification, reason, rule, proposedAction, evidence }",
          properties: {
            findingClass: { type: "string" },
            route: { type: "string" },
            currentClassification: { type: "string" },
            reason: { type: "string" },
            rule: { type: "string" },
            proposedAction: { type: "string" },
            evidence: { type: "object" },
          },
          required: ["findingClass"],
        },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  // Phase TEMPER-06 Slice 06.1 — Bug Registry MCP tools
  {
    name: "forge_bug_register",
    description: "Register a bug discovered by a tempering scanner. Classifies real-bug vs infra and writes .forge/bugs/<bugId>.json for real bugs. Infra-classified failures are not written to disk — they are only tracked in the run record.",
    inputSchema: {
      type: "object",
      required: ["scanner", "evidence"],
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        scanner: { type: "string", enum: ["unit", "integration", "ui-playwright", "visual-diff", "flakiness", "mutation", "load-stress", "contract", "performance-budget"], description: "Scanner that discovered the bug" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Bug severity (default: medium)" },
        evidence: { type: "object", description: "Bug evidence: { testName, assertionMessage, stackTrace, ... }" },
        affectedFiles: { type: "array", items: { type: "string" }, description: "Files affected by this bug" },
        reproSteps: { type: "array", items: { type: "string" }, description: "Steps to reproduce" },
        correlationId: { type: "string", description: "Correlation ID to thread to run/plan" },
        sliceRef: { type: "object", description: "Plan+slice context", properties: { plan: { type: "string" }, slice: { type: "string" } } },
      },
    },
  },
  {
    name: "forge_bug_list",
    description: "List bugs from the registry with optional filters. Returns all bugs matching the given criteria from .forge/bugs/.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        status: { type: "string", description: "Filter by status: open|in-fix|fixed|wont-fix|duplicate" },
        severity: { type: "string", description: "Filter by severity: critical|high|medium|low" },
        scanner: { type: "string", description: "Filter by scanner name" },
        since: { type: "string", description: "Only bugs after this ISO date" },
        until: { type: "string", description: "Only bugs before this ISO date" },
      },
    },
  },
  {
    name: "forge_bug_update_status",
    description: "Transition a bug's status (open → in-fix → fixed, or open → wont-fix/duplicate) with transition validation. Terminal states (fixed, wont-fix, duplicate) cannot be changed. Accepts either 'newStatus' or 'status' as the field name (#116).",
    inputSchema: {
      type: "object",
      required: ["bugId"],
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        bugId: { type: "string", description: "Bug ID to update" },
        newStatus: { type: "string", description: "New status: open|in-fix|fixed|wont-fix|duplicate" },
        status: { type: "string", description: "Alias for newStatus (#116). One of newStatus|status is required." },
        note: { type: "string", description: "Optional note about the transition" },
      },
    },
  },
  // Phase TEMPER-06 Slice 06.3 — Closed-loop fix validation
  {
    name: "forge_bug_validate_fix",
    description: "Re-run the scanner(s) that discovered a bug to verify the fix. On pass: marks bug as 'fixed', dispatches commentValidatedFix to bug-adapter, broadcasts tempering-bug-validated-fixed event. On fail: appends attempt to bug.validationAttempts[], status unchanged.",
    inputSchema: {
      type: "object",
      required: ["bugId"],
      properties: {
        bugId: { type: "string", description: "Bug registry ID to validate" },
        scannerOverride: { type: "array", items: { type: "string" }, description: "Override scanner list (default: uses bug.scanner)" },
        testNameOverride: { type: "string", description: "Override test name filter (default: uses bug.evidence.testName)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_memory_capture",
    description: "Capture a thought, decision, or lesson into OpenBrain persistent memory. USE FOR: recording architecture decisions, patterns chosen, gotchas discovered, conventions established, or any cross-session knowledge that future AI sessions should know. Requires OpenBrain to be configured in .vscode/mcp.json or .claude/mcp.json.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought, decision, or lesson to capture. Be specific — future agents will read this." },
        project: { type: "string", description: "Project name to scope the memory (default: read from .forge.json)" },
        type: { type: "string", description: "Memory type: decision | lesson | convention | pattern | gotcha (default: decision)", enum: ["decision", "lesson", "convention", "pattern", "gotcha"] },
        source: { type: "string", description: "Source identifier (e.g. 'openclaw-trigger', 'plan-forge/slice-3'). Default: 'forge_memory_capture'" },
        created_by: { type: "string", description: "Who captured this (e.g. 'openclaw', 'copilot-agent'). Default: 'forge_memory_capture'" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["content"],
    },
  },
  {
    name: "forge_brain_test",
    description: "Round-trip test against OpenBrain (L3 memory). Captures a unique marker thought via capture_thought, then immediately searches for it via search_thoughts. Returns { ok, marker, hit, durationMs }. USE FOR: confirming the SSE endpoint is reachable, auth key is valid, and capture+search are wired end-to-end — before running bulk replays or after restoring an OpenBrain database. Requires OpenBrain to be configured as an SSE server in .vscode/mcp.json or .claude/mcp.json and a valid OPENBRAIN_KEY env var (or query-form key in the URL).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project tag for the marker thought (default: 'plan-forge')" },
        indexDelayMs: { type: "number", description: "ms to wait between capture and search (default: 500). Increase if your OpenBrain backend has indexing lag." },
        path: { type: "string", description: "Project directory used to locate mcp.json (default: server CWD)" },
      },
    },
  },
  {
    name: "forge_brain_replay",
    description: "Bulk-load records into OpenBrain via capture_thought from a local source. Source can be (a) a queue jsonl file like .forge/openbrain-queue.archive.jsonl, (b) a single markdown file (split per H2 heading), or (c) a directory of markdown files. Returns counts + small samples; full per-record receipt log is written to .forge/openbrain-replay-<ts>.jsonl. USE FOR: rebuilding L3 memory after a database wipe, importing curated notes, or replaying a queue that never drained. Pass dryRun=true to validate normalization without writing.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Path (absolute or relative to project dir) to a .jsonl queue file, .md file, or directory of .md files." },
        project: { type: "string", description: "Project tag applied to every record (default: 'plan-forge')" },
        dryRun: { type: "boolean", description: "If true, normalize + count without sending to OpenBrain. Useful for previewing what would be sent." },
        rate: { type: "number", description: "ms between capture calls (default: 50). Increase to be gentler on the server." },
        maxRetries: { type: "number", description: "Per-record retry count on transient failures (default: 3)" },
        maxRecords: { type: "number", description: "Cap on records sent in one call (default: 500). Use to chunk large markdown directories." },
        path: { type: "string", description: "Project directory used to locate mcp.json + write the receipt log (default: server CWD)" },
      },
      required: ["source"],
    },
  },
  {
    name: "forge_generate_image",
    description: "Generate an image using AI image models (xAI Grok Aurora or OpenAI DALL-E). Provide a text description and get a generated image saved to disk. Supports format conversion — request WebP, PNG, AVIF, or JPEG regardless of what the API returns. Useful for creating logos, diagrams, UI mockups, icons, and illustrations during plan execution. Requires XAI_API_KEY (Grok) or OPENAI_API_KEY (DALL-E).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed text description of the image to generate. Be specific about style, colors, composition, and content." },
        outputPath: { type: "string", description: "File path to save the image (relative to project dir). The file extension determines the output format — e.g., 'assets/logo.webp' converts to WebP, 'docs/hero.png' converts to PNG." },
        model: { type: "string", description: "Image model to use. Default: grok-imagine-image", enum: ["grok-imagine-image", "grok-imagine-image-pro", "dall-e-3", "dall-e-4", "gpt-image-1"] },
        size: { type: "string", description: "Image dimensions. Default: 1024x1024", enum: ["1024x1024", "1024x768", "768x1024"] },
        format: { type: "string", description: "Output format override (if different from file extension). Default: inferred from outputPath extension.", enum: ["jpg", "png", "webp", "avif"] },
        quality: { type: "number", description: "Encoding quality 1-100. Default: 85. Lower = smaller file, less detail.", minimum: 1, maximum: 100 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["prompt", "outputPath"],
    },
  },
  {
    name: "forge_drift_report", // LiveGuard — emitToolTelemetry in handler
    description: "Score the codebase against architecture guardrail rules. Tracks drift over time in .forge/drift-history.jsonl. Fires a bridge notification when score drops below threshold. With autoIncident, auto-captures incidents and generates fix proposals for high/critical violations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to scan (default: project root)" },
        threshold: { type: "number", description: "Alert threshold 0-100. Fires drift-alert when score drops below this value. Default: 70", minimum: 0, maximum: 100 },
        rules: { type: "array", items: { type: "string" }, description: "Guardrail rule IDs to check. Default: all rules (empty-catch, any-type, sync-over-async, sql-injection, deferred-work)" },
        autoIncident: { type: "boolean", description: "Auto-capture incidents for high/critical violations and generate fix proposals. Default: false" },
      },
      required: [],
    },
  },
  {
    name: "forge_incident_capture", // LiveGuard — emitToolTelemetry in handler
    description: "Capture an incident — record description, severity, affected files, and optional resolution timestamp for MTTR tracking. Appends to .forge/incidents.jsonl. Dispatches a bridge notification to the onCall target configured in .forge.json when an incident is captured.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short description of the incident (e.g., 'API latency spike on /checkout')" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Incident severity level. Default: medium" },
        files: { type: "array", items: { type: "string" }, description: "Affected file paths (optional, for traceability)" },
        resolvedAt: { type: "string", description: "ISO 8601 resolution timestamp for MTTR calculation. Omit at capture time — supply via a second call when the incident is resolved." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["description"],
    },
  },
  {
    name: "forge_regression_guard", // LiveGuard — emitToolTelemetry in handler
    description: "Run regression guard — extract validation gate commands from plan files, execute them against the current codebase, and report passed/failed/blocked results. Guards against regressions when files change. Accepts a list of changed files and an optional plan to scope the check. Falls back to testCommand slice fields when no bash-block gates are present.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Changed file paths to guard (included in result for traceability). If omitted, all plan gates are checked." },
        plan: { type: "string", description: "Path to a specific plan file to extract gates from (e.g., docs/plans/Phase-1-AUTH-PLAN.md). If omitted, all plan files in docs/plans/ are scanned." },
        failFast: { type: "boolean", description: "If true, stop on first gate failure. Default: false" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_runbook", // LiveGuard — emitToolTelemetry in handler
    description: "Generate a human-readable operational runbook from a hardened plan file. Parses slices, scope contract, build/test commands, and validation gates into a structured Markdown document. Optionally appends recent incidents from .forge/incidents.jsonl for operational context. Saves to .forge/runbooks/<plan-name>-runbook.md and returns the output path.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        includeIncidents: { type: "boolean", description: "Include recent incidents from .forge/incidents.jsonl for operational context. Default: true" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_hotspot", // LiveGuard — emitToolTelemetry in handler
    description: "Identify git churn hotspots — files that change most frequently. Helps prioritize refactoring, testing, and review effort. Caches results in .forge/hotspot-cache.json (24h TTL). Accepts --top N and --since filters.",
    inputSchema: {
      type: "object",
      properties: {
        top: { type: "number", description: "Number of hotspot files to return. Default: 10", minimum: 1, maximum: 100 },
        since: { type: "string", description: "Git log --since filter (e.g., '3 months ago', '2024-01-01'). Default: '6 months ago'" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_health_trend", // LiveGuard — emitToolTelemetry in handler
    description: "Health trend analysis — aggregates drift scores, cost history, incident frequency, and model performance over a configurable time window. Returns per-metric summaries, an overall health score (0–100), and trend direction. Data sourced from .forge/ operational files.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days of history to analyze. Default: 30" },
        metrics: { type: "string", description: "Comma-separated metric filter (drift,cost,incidents,models). Default: all" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_alert_triage", // LiveGuard — emitToolTelemetry in handler
    description: "Triage open alerts — read incidents and drift violations, rank by priority (severity × recency), and return a prioritized list. Read-only: does not modify any data store. Tiebreak: more recent alerts rank higher when priority scores are equal.",
    inputSchema: {
      type: "object",
      properties: {
        minSeverity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Minimum severity to include. Default: low (all)" },
        max: { type: "number", description: "Maximum number of alerts to return. Default: 20", minimum: 1, maximum: 200 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_deploy_journal", // LiveGuard — emitToolTelemetry in handler
    description: "Record a deployment — log version, deployer, optional notes, and optional slice reference. Appends to .forge/deploy-journal.jsonl. Used by forge_incident_capture to correlate incidents with the most recent deploy.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Deployed version (e.g., 'v2.31.0', '1.0.0-rc.1')" },
        by: { type: "string", description: "Who or what triggered the deploy (e.g., 'CI', 'alice'). Default: 'unknown'" },
        notes: { type: "string", description: "Free-form deploy notes (e.g., 'hotfix for checkout timeout')" },
        slice: { type: "string", description: "Plan slice reference (e.g., 'S3', 'Slice 7.2')" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["version"],
    },
  },
  {
    name: "forge_dep_watch", // LiveGuard — emitToolTelemetry in handler
    description: "Scan project dependencies for known vulnerabilities using npm audit. Compares against previous snapshot in .forge/deps-snapshot.json to detect new and resolved CVEs. Fires a bridge notification when new vulnerabilities are found. Non-npm projects degrade gracefully.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        notify: { type: "boolean", description: "Send bridge notification for new vulnerabilities. Default: true" },
      },
      required: [],
    },
  },
  {
    name: "forge_diff_classify",
    description: "Classify staged git diff against 6 safety categories: leaked-secret (critical), prompt-injection-echo (high), license-incompatible-paste (high), eval-exec-introduced (medium), unexpected-network-call (low), large-binary-dump (medium). Returns { severity, findings[], totalAdded, truncated }. Blocking threshold: severity >= high. USE FOR: PreCommit chain gate, post-worker diff review, CI gate. DO NOT USE FOR: static analysis (use a linter), deep code review (use forge_delegate_review).",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string", description: "Git diff text to classify. If omitted, runs git diff --cached in the project directory." },
        maxLines: { type: "number", description: "Maximum diff lines to process (default: 3000)." },
        path: { type: "string", description: "Project directory (default: current)." },
      },
    },
  },
  {
    name: "forge_secret_scan", // LiveGuard — emitToolTelemetry in handler
    description: "Post-commit entropy analysis — scan git diff output for high-entropy strings that may be leaked secrets. Uses Shannon entropy with key-name heuristics. Never logs actual secret values — only file paths, line numbers, entropy scores, and <REDACTED> placeholders. Caches results in .forge/secret-scan-cache.json. Annotates deploy journal sidecar when last deploy matches HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Git ref or range to scan (e.g., 'HEAD~1', 'abc123..def456'). Default: HEAD~1" },
        threshold: { type: "number", description: "Minimum Shannon entropy to flag (3.5–5.0). Default: 4.0", minimum: 3.5, maximum: 5.0 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_env_diff", // LiveGuard — emitToolTelemetry in handler
    description: "Compare environment variable keys across .env files — detect missing keys between baseline and target environments. Compares key names only (never values). Caches results in .forge/env-diff-cache.json. Integrates with forge_runbook to surface environment key gaps.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: { type: "string", description: "Baseline .env file path (relative to project root). Default: .env" },
        files: { type: "string", description: "Comma-separated target .env file paths to compare against baseline (e.g., '.env.staging,.env.production'). Default: auto-detect .env.* files" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_fix_proposal",
    description: "Generate a 1-3 slice fix plan from regression, drift, incident, secret-scan, Crucible (stalled/orphan), or tempering-bug failure. Writes to docs/plans/auto/LIVEGUARD-FIX-<id>.md. Capped at one proposal per id.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Data source: 'regression', 'drift', 'incident', 'secret', 'crucible', or 'tempering-bug'. Default: auto-detect from latest data" },
        incidentId: { type: "string", description: "Incident ID to generate fix for (required for incident source)" },
        smeltId: { type: "string", description: "Crucible smelt ID to target (optional for crucible source; auto-selects worst offender when omitted)" },
        bugId: { type: "string", description: "Bug registry ID (required when source is 'tempering-bug')" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_quorum_analyze",
    description: "Assemble a structured 3-section quorum prompt from any LiveGuard data source. No LLM calls — returns the prompt for multi-model dispatch. Supports customQuestion freeform override (max 500 chars) and analysisGoal presets.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Data source: 'drift', 'incident', 'triage', 'runbook', 'fix-proposal'. Required." },
        targetFile: { type: "string", description: "Specific data file path (relative to .forge/). Defaults to most recent for source type." },
        analysisGoal: { type: "string", description: "Preset question: 'root-cause', 'risk-assess', 'fix-review', 'runbook-validate'. Ignored when customQuestion is provided." },
        customQuestion: { type: "string", description: "Freeform question override (max 500 chars). Replaces the analysisGoal preset entirely." },
        quorumSize: { type: "number", description: "Number of model votes to request in the prompt. Default: 3." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_liveguard_run",
    description: "Run all applicable LiveGuard checks in a single call and return a unified health report. Executes: drift, sweep, secret-scan, regression-guard, dep-watch, alert-triage, and health-trend. Optionally runs diff if a plan is specified. NOTE: May take 2-3 minutes for .NET projects (dep-watch runs `dotnet list package --vulnerable`). Set client timeout to at least 300 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Plan file path for scope diff (optional). If omitted, diff is skipped." },
        threshold: { type: "number", description: "Drift alert threshold 0-100. Default: 70" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_home_snapshot",
    description: "Read-only aggregated snapshot of the four shop-floor subsystems (Crucible, active runs, LiveGuard, Tempering) plus a trimmed activity feed. Use as a one-call health overview. Pass `drill` to fetch only one quadrant for a smaller payload, or `activityCursor` to paginate older activity entries.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "Project directory (default: current)" },
        activityTail: { type: "number", description: "Recent hub events to include (default: 25, clamped 1..200)" },
        drill: {
          type: "string",
          enum: ["crucible", "activeRuns", "liveguard", "tempering", "activity"],
          description: "Return ONLY this quadrant for a smaller, focused payload. Omit for the full snapshot.",
        },
        activityCursor: {
          type: "string",
          description: "ISO timestamp from a prior call's `activityPagination.nextCursor`. Returns the next page of older activity entries.",
        },
      },
      required: [],
    },
  },
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools
  {
    name: "forge_review_add",
    description: "Add an item to the review queue. Used by producers (crucible/tempering/bug classifier) when human judgment is required.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["crucible-stall", "tempering-quorum-inconclusive", "tempering-baseline", "bug-classify", "fix-plan-approval"] },
        severity: { type: "string", enum: ["blocker", "high", "medium", "low"] },
        title: { type: "string" },
        context: { type: "object" },
        correlationId: { type: "string" },
        path: { type: "string" },
      },
      required: ["source", "severity", "title"],
    },
  },
  {
    name: "forge_review_list",
    description: "List review queue items with optional filters and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "resolved", "deferred"] },
        source: { type: "string" },
        severity: { type: "string" },
        correlationId: { type: "string" },
        limit: { type: "number" },
        cursor: { type: "number" },
        path: { type: "string" },
      },
    },
  },
  {
    name: "forge_review_resolve",
    description: "Resolve an open review queue item (approve/reject/defer). Emits hub event and captures L3 memory.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        resolution: { type: "string", enum: ["approve", "reject", "defer"] },
        resolvedBy: { type: "string" },
        note: { type: "string" },
        path: { type: "string" },
      },
      required: ["itemId", "resolution", "resolvedBy"],
    },
  },
  // Phase TEMPER-07 Slice 07.1 — Agent delegation tool
  {
    name: "forge_delegate_to_agent",
    description: "Route a tempering bug to the appropriate agent/skill for read-only analysis.",
    inputSchema: {
      type: "object",
      properties: {
        bugId: { type: "string" },
        targetPath: { type: "string" },
        mode: { type: "string", enum: ["analyst", "review-queue-item"] },
        dryRun: { type: "boolean" },
      },
      required: ["bugId", "mode"],
    },
  },
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools
  {
    name: "forge_notify_send",
    description: "Send a notification directly via a named adapter, bypassing routing rules. Use for ad-hoc agent dispatches.",
    inputSchema: {
      type: "object",
      properties: {
        via: { type: "string", description: "Adapter name (webhook, slack, teams, etc.)" },
        payload: { type: "object", description: "Event payload to send" },
        formattedMessage: { type: "string", description: "Pre-formatted message text (optional)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["via", "payload"],
    },
  },
  {
    name: "forge_notify_test",
    description: "Test notification adapter configuration. Validates config and optionally sends a test payload.",
    inputSchema: {
      type: "object",
      properties: {
        adapter: { type: "string", description: "Adapter name to test (default: all)" },
        dryRun: { type: "boolean", description: "If true, only validate config without sending (default: true)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  // Phase FORGE-SHOP-04 Slice 04.1 — Global search
  {
    name: "forge_search",
    description: "Search across forge artifacts — runs, bugs, incidents, tempering, hub events, review queue, memories, and plans. Reads existing L2 files and optional L3 OpenBrain index. Returns ranked results with snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search (case-insensitive, whitespace-tokenized)" },
        tags: { type: "array", items: { type: "string" }, description: "Filter: hit must have ALL listed tags" },
        since: { type: "string", description: "ISO timestamp or relative (24h, 7d, 2w, 30m)" },
        correlationId: { type: "string", description: "Filter + score boost on exact match" },
        sources: { type: "array", items: { type: "string" }, description: "Limit to source types (run, bug, incident, tempering, hub-event, review, memory, plan)" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
      },
      required: ["query"],
    },
  },
  // Phase FORGE-SHOP-05 Slice 05.1 — Unified timeline
  {
    name: "forge_timeline",
    description: "Unified chronological view across all forge event sources with correlationId grouping. Merges hub-events, runs, memories, openbrain, watch, tempering, bugs, incidents, and forge-master sessions into a single timeline.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start of window: ISO timestamp or relative (24h, 7d, 30m). Default: now - 24h" },
        to: { type: "string", description: "End of window: ISO timestamp or relative. Default: now" },
        correlationId: { type: "string", description: "Filter to a single correlation thread" },
        sources: { type: "array", items: { type: "string" }, description: "Limit to source types: hub-event, run, memory, openbrain, watch, tempering, bug, incident, forge-master" },
        events: { type: "array", items: { type: "string" }, description: "Filter by event type (glob supported: slice-*, tempering-*)" },
        groupBy: { type: "string", enum: ["time", "correlation"], description: "Default: time (flat chronological). correlation: group by correlationId" },
        limit: { type: "number", description: "Max results (default 500, max 2000)" },
      },
      required: [],
    },
  },
  // Issue #73 — Runtime-aware quorum viability
  {
    name: "forge_doctor_quorum",
    description: "Preflight quorum viability check — probes all models in a preset against the current runtime and reports availability, synthesis viability, and fallback recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["power", "speed", "all"], description: "Quorum preset to check. 'all' checks both presets. Default: all" },
      },
      required: [],
    },
  },
  {
    name: "forge_testbed_run",
    description: "Run a testbed scenario against an external testbed repository. Executes preflight checks, setup, execution steps, and assertions, then writes defect findings. Use dryRun to validate without executing.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", description: "Scenario fixture ID (filename stem under docs/plans/testbed-scenarios/)" },
        testbedPath: { type: "string", description: "Path to testbed repository (default: from .forge.json testbed.path)" },
        dryRun: { type: "boolean", description: "If true, skip execute and teardown steps (default: false)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["scenarioId"],
    },
  },
  {
    name: "forge_master_ask",
    description: "Ask Forge-Master to reason about Plan Forge workflows — ideate features via Crucible, troubleshoot failures, query run status, or get operational guidance. Classifies intent, fetches memory context, and orchestrates read-only tool calls. Returns reply text, tool call history, token counts, and session ID for conversation continuity.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Your question or request for Forge-Master" },
        sessionId: { type: "string", description: "Session ID for conversation continuity (omit for new session)" },
        maxToolCalls: { type: "number", description: "Max tool calls per turn (default: 5, max: 10)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["message"],
    },
  },
  {
    name: "forge_testbed_findings",
    description: "Query testbed defect-log findings. Returns findings filtered by status, severity, or date. Read-only — does not modify any files.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (open, fixed, wontfix, duplicate)" },
        severity: { type: "string", description: "Filter by severity (blocker, high, medium, low, polish)" },
        since: { type: "string", description: "Filter by date — only findings on or after this ISO 8601 date (e.g. 2026-04-01)" },
        limit: { type: "number", description: "Max findings to return (default: 50)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    // Roadmap C2 — forge_export_plan
    name: "forge_export_plan",
    description: "Convert a loose Copilot cloud agent session plan (numbered or bulleted steps) into a hardened Plan Forge Phase-X-PLAN.md. Parses steps, extracts file paths, generates per-slice validation gates, and outputs a complete plan with scope contract, forbidden actions template, and acceptance criteria.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Markdown text of the loose plan to convert" },
        phaseName: { type: "string", description: "Override the derived phase slug (UPPERCASE-SLUG, e.g. AUTH-RBAC). Default: derived from title." },
        outputPath: { type: "string", description: "If set, write the plan to this file path (absolute or relative to cwd)" },
        sourceNote: { type: "string", description: "Attribution note in the plan header. Default: 'Exported from loose plan via forge_export_plan'" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["input"],
    },
  },
  {
    // Roadmap C3 — forge_sync_memories
    name: "forge_sync_memories",
    description: "Generate .github/copilot-memory-hints.md from forge decisions (trajectory notes, auto-skills, brain L2 entries). Copilot Memory auto-discovers this file as a project knowledge source. Soft-sync approach — no API calls required. USE FOR: populate Copilot Memory with project decisions, regenerate memory hints after plan runs, export trajectory notes, sync brain decisions to Copilot. DO NOT USE FOR: uploading to Copilot Spaces (use forge_sync_spaces), reading individual trajectories.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun:  { type: "boolean", description: "Return rendered Markdown without writing the file (default: false)" },
        force:   { type: "boolean", description: "Re-write even if content is unchanged (default: false)" },
        limit:   { type: "number",  description: "Max entries per section — trajectories, auto-skills, decisions (default: 10)" },
        since:   { type: "string",  description: "ISO 8601 date/datetime string: only include hints newer than this" },
        output:  { type: "string",  description: "Override output path (default: .github/copilot-memory-hints.md, relative to project root)" },
        path:    { type: "string",  description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    // v3.0.0 — forge_sync_instructions
    name: "forge_sync_instructions",
    description: "Generate .github/copilot-instructions.md from forge project context (project profile, project principles, .forge.json config). GitHub Copilot reads this file automatically. Completes the Copilot integration trilogy: sync-memories → sync-instructions. USE FOR: populate Copilot with project-specific instructions, regenerate instructions after adding project profile or principles, export project context to Copilot. DO NOT USE FOR: uploading to Copilot Spaces (use forge_sync_spaces), reading memory hints (use forge_sync_memories).",
    inputSchema: {
      type: "object",
      properties: {
        dryRun:        { type: "boolean", description: "Return rendered Markdown without writing the file (default: false)" },
        force:         { type: "boolean", description: "Re-write even if content is unchanged (default: false)" },
        noPrinciples:  { type: "boolean", description: "Skip the Project Principles section (default: false)" },
        noProfile:     { type: "boolean", description: "Skip the Project Profile section (default: false)" },
        noExtras:      { type: "boolean", description: "Skip extra .github/instructions/*.instructions.md files (default: false)" },
        output:        { type: "string",  description: "Override output path (default: .github/copilot-instructions.md, relative to project root)" },
        path:          { type: "string",  description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_testbed_happypath",
    description: "Run all happy-path testbed scenarios sequentially. Returns aggregated pass/fail results with per-scenario details. Use dryRun to validate without executing.",
    inputSchema: {
      type: "object",
      properties: {
        testbedPath: { type: "string", description: "Path to testbed repository (default: from .forge.json testbed.path)" },
        dryRun: { type: "boolean", description: "If true, skip execute and teardown steps (default: false)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_meta_bug_file",
    description: "File a self-repair meta-bug against Plan Forge itself. Creates (or deduplicates) a GitHub issue for plan, orchestrator, or prompt defects discovered during execution. Auto-attaches trajectory context when slice reference is provided.",
    inputSchema: {
      type: "object",
      required: ["class", "title", "symptom"],
      properties: {
        class: { type: "string", enum: ["plan-defect", "orchestrator-defect", "prompt-defect"], description: "Category of the meta-bug" },
        title: { type: "string", description: "Short title describing the defect" },
        symptom: { type: "string", description: "Observable symptom that revealed the defect" },
        workaround: { type: "string", description: "Workaround applied during execution" },
        filePaths: { type: "array", items: { type: "string" }, description: "Files affected by or related to the defect" },
        slice: { type: "string", description: "Slice reference (e.g. '3') — triggers auto-pull of trajectory excerpt" },
        plan: { type: "string", description: "Plan name or path for context" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Defect severity (default: medium)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  // Phase-38.3 — Knowledge graph query tool
  {
    name: "forge_graph_query",
    description: "Query the Plan Forge knowledge graph. Returns subgraph of nodes and edges matching the query. Supports phase, file, recent-changes, and neighbor traversal queries.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["phase", "file", "recent-changes", "neighbors"], description: "Query type" },
        filter: { type: "string", description: "Phase name, file path, node ID, or keyword depending on query type" },
        since: { type: "string", description: "ISO timestamp or relative (90d, 30d, 7d) for recent-changes queries" },
        edgeType: { type: "string", description: "Filter neighbors by edge type (optional)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["type"],
    },
  },
  // Phase-38.6 — Pattern surfacing tool (advisory lane only)
  {
    name: "forge_patterns_list",
    description: "List recurring patterns detected across plan runs. Returns gate-failure recurrences, model failure rates, slice flap patterns, and cost anomalies. Advisory only — never injected into plan hardener or executor.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO timestamp — only patterns observed after this date (optional)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  // Phase LATTICE Slice 7 — Lattice code-graph tools
  {
    name: "forge_lattice_index",
    description: "Build or update the Lattice code-graph index — walks tracked source files, chunks them, and persists JSONL to .forge/lattice/. USE FOR: initial index build, re-indexing after large changes, warming the Anvil cache for fast re-runs. DO NOT USE FOR: reading index data (use forge_lattice_query, forge_lattice_callers, or forge_lattice_blast).",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Paths to index relative to project root (default: ['.'])" },
        since: { type: "string", description: "Only re-index files changed since this git revision (e.g. HEAD~1)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_lattice_stat",
    description: "Return a bounded summary of the Lattice index — chunk count, edge count, language distribution, Anvil hit rate, and index byte size. Read-only. USE FOR: confirming index health before querying, dashboards. DO NOT USE FOR: full index reads.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_lattice_query",
    description: "Search the Lattice chunk index by name, language, kind, or file path. Filters are ANDed. USE FOR: finding function/class declarations, locating code by language or file path. DO NOT USE FOR: call-graph traversal (use forge_lattice_blast).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match against chunk name or filePath" },
        language: { type: "string", description: "Exact language filter (e.g. js, ts, py)" },
        kind: { type: "string", description: "Exact kind filter (e.g. function, class, file)" },
        filePath: { type: "string", description: "Substring match against chunk filePath" },
        limit: { type: "number", description: "Max results (default: 25)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_lattice_callers",
    description: "Find all chunks that reference (call) a given symbol name. USE FOR: impact analysis — who depends on this function? DO NOT USE FOR: deep call-graph traversal (use forge_lattice_blast).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Symbol name to find callers of" },
        limit: { type: "number", description: "Max results (default: 25)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_lattice_blast",
    description: "BFS traversal of the Lattice call graph — expands callees, callers, or both from a seed chunk up to a given depth. USE FOR: deep impact analysis, understanding call chains, finding all transitive dependencies. DO NOT USE FOR: simple symbol lookup (use forge_lattice_query).",
    inputSchema: {
      type: "object",
      properties: {
        chunkId: { type: "string", description: "Seed chunk id (exact 16-char hex)" },
        name: { type: "string", description: "Seed chunk name (all matching chunks are enqueued)" },
        direction: { type: "string", enum: ["callees", "callers", "both"], description: "Traversal direction (default: both)" },
        depth: { type: "number", description: "Max BFS hops (default: 3)" },
        limit: { type: "number", description: "Max nodes returned (default: 50)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_local_search",
    description: "Semantic search over local .forge/ thought stores — searches openbrain-queue.jsonl, openbrain-queue.archive.jsonl, openbrain-dlq.jsonl, and liveguard-memories.jsonl using TF-IDF cosine similarity. Automatically upgrades to neural embeddings (all-MiniLM-L6-v2) when @xenova/transformers is installed. USE FOR: recalling prior decisions and patterns when OpenBrain (L3 Postgres) is not configured; offline semantic memory search; auditing what thoughts have been captured locally. DO NOT USE FOR: querying a live OpenBrain/Postgres instance (use forge_search with memory source); searching code (use forge_search or forge_lattice_query).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query (required)" },
        limit: { type: "number", description: "Max hits to return (default: 5, max: 20)" },
        threshold: { type: "number", description: "Minimum similarity score 0..1 (default: 0.02)" },
        backend: { type: "string", enum: ["auto", "tfidf", "neural"], description: "Embedding backend: auto (neural if available, else tfidf), tfidf (always), neural (always — returns error if @xenova/transformers not installed). Default: auto." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Which .forge/ JSONL files to scan (default: all four stores). Allowed: openbrain-queue.jsonl, openbrain-queue.archive.jsonl, openbrain-dlq.jsonl, liveguard-memories.jsonl.",
        },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["query"],
    },
  },
  {
    name: "forge_embedding_status",
    description: "Report the current embedding backend status for local semantic search — whether @xenova/transformers (neural, all-MiniLM-L6-v2) or TF-IDF is active, how many thoughts are in the local corpus, and the configured backend override in .forge.json. USE FOR: diagnosing which search backend is active; checking whether to run 'pforge embeddings install'; monitoring embedding health in the dashboard. Returns: { ok, backend, neuralAvailable, neuralVersion, model, corpusSize, configuredBackend, installHint, message }.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_local_recall_status",
    description: "Inspect and manage the persistent TF-IDF index cache used by forge_local_search. Reports cache existence, corpus size, freshness (stale vs fresh), and build timestamp. Supports three subcommands: 'status' (default) — return cache diagnostics; 'warm' — pre-build the index so the first forge_local_search call has zero rebuild cost; 'clear' — delete the cache file to force a fresh rebuild. USE FOR: diagnosing why forge_local_search is slow; pre-warming the cache in CI; clearing a corrupt index. Returns: { ok, indexExists, version, builtAt, corpusSize, staleness, cacheFile, message } for status; { ok, action, ... } for warm/clear.",
    inputSchema: {
      type: "object",
      properties: {
        subcommand: { type: "string", enum: ["status", "warm", "clear"], description: "Operation: 'status' (default) — show cache info; 'warm' — pre-build index; 'clear' — delete cache." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_audit_export",
    description: "Export audit events from .forge/runs/ as structured records. Reads events.log files written by the orchestrator — streaming, never loads all events into memory. Returns up to `limit` records with pagination metadata. USE FOR: compliance audits, feeding events into Splunk/Datadog/Grafana, answering 'what happened during run X?', exporting gate-pass/gate-fail timelines. Returns: { ok, records[], total, truncated, format, filters, message }. Use the CLI `pforge audit export` for unbounded streaming to stdout.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO date lower bound (inclusive). e.g. '2026-05-01' or '2026-05-01T12:00:00Z'" },
        until: { type: "string", description: "ISO date upper bound (inclusive)." },
        type: {
          type: "array",
          items: { type: "string" },
          description: "Event types to include (repeatable). e.g. ['gate-pass','gate-fail','slice-start','slice-complete']. Default: all types.",
        },
        run: { type: "string", description: "Scope to a single run directory ID (e.g. '2026-05-07T18-24-13-482Z_Phase-53')." },
        format: { type: "string", enum: ["json", "csv"], description: "Output format: 'json' (default) returns array of record objects; 'csv' returns array of CSV row strings with a header row first." },
        limit: { type: "number", description: "Maximum records to return (default: 100, max: 500)." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
];
