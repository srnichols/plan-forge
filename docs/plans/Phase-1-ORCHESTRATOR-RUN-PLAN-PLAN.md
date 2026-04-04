# Phase 1: Orchestrator — `forge_run_plan` DAG-Based Execution

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 1
> **Status**: 🚧 In Progress (Slice 0 ✅)
> **Feature Branch**: `feature/v2.0-autonomous-execution`
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Step 3 (executing)
> **Review Findings Applied**: C1, C2, C3, C4, M1, M2, M6
> **Spike Results**: [SPIKE-RESULTS.md](./SPIKE-RESULTS.md)

---

## Specification (Step 0)

### Problem Statement
Developers using Plan Forge currently execute pipeline steps manually — switching between sessions, running CLI commands, checking results, deciding what's next. For an 8-slice plan, this is 30-60 minutes of active attention. This phase adds one-command execution: `pforge run-plan <plan>` kicks off the entire pipeline automatically.

### User Scenarios
1. **Full Auto**: `pforge run-plan docs/plans/Phase-7-INVENTORY-PLAN.md` → `gh copilot` CLI executes all slices with full guardrails
2. **Full Auto (specific model)**: `pforge run-plan <plan> --model claude-sonnet-4.6` → routes to Claude
3. **Assisted**: `pforge run-plan --assisted <plan>` → human codes in VS Code Copilot, orchestrator validates gates
4. **MCP tool**: Agent calls `forge_run_plan(plan)` → orchestrates from within Copilot/Claude session
5. **Estimation only**: `pforge run-plan --estimate <plan>` → shows slice count, estimated tokens, cost — without executing

### Acceptance Criteria
- **MUST**: DAG-based slice execution with build/test gates at every boundary
- **MUST**: Two execution modes: Full Auto (`gh copilot` CLI) and Assisted (human + automated gates)
- **MUST**: Results written to `.forge/runs/<timestamp>/` per slice (including session logs)
- **MUST**: Token usage logged per slice per model (parsed from JSONL output)
- **MUST**: `forge_run_plan` + `forge_abort` + `forge_plan_status` MCP tools
- **MUST**: `--estimate` flag for cost prediction without execution
- **MUST**: Event emitter pattern for orchestrator lifecycle (dependency injection)
- **MUST**: `.forge/SCHEMA.md` documenting all `.forge/` files
- **MUST**: Existing manual workflows unchanged
- **SHOULD**: Model routing from `.forge.json` configuration
- **SHOULD**: Auto-sweep + auto-analyze after all slices pass
- **SHOULD**: `--resume-from N` to continue after a failure fix
- **SHOULD**: Slice scope metadata parsing for Phase 6 conflict detection

### Execution Modes (from Slice 0 Spike)

| Mode | Worker | Command | Target Audience |
|------|--------|---------|----------------|
| **Full Auto** | `gh copilot` CLI | `gh copilot -- -p "<instructions>" --model <model> --allow-all --no-ask-user --output-format json` | All developers with Copilot license |
| **Assisted** | Human in VS Code | Orchestrator prompts → human codes → `pforge gate` validates | Everyone (interactive) |

**Fallback chain**: `gh copilot` → `claude` CLI → `codex` CLI → Assisted mode.

---

## Scope Contract

### In Scope
- `mcp/orchestrator.mjs` — DAG-based orchestration engine (new)
- `mcp/server.mjs` — add 3 MCP tools
- `mcp/package.json` — dependencies
- `pforge.ps1` — add `run-plan` command
- `pforge.sh` — add `run-plan` command (bash parity)
- `.forge/runs/` — run result storage (per-slice JSON + session logs)
- `.forge/SCHEMA.md` — schema document for all `.forge/` files
- `.forge.json` — add `modelRouting` schema
- `docs/plans/SPIKE-RESULTS.md` — CLI spawning spike results (Slice 0)
- Documentation: CLI-GUIDE, README, CHANGELOG, ROADMAP, index.html, faq.html

### Out of Scope
- Web dashboard (Phase 3-5)
- WebSocket hub (Phase 3)
- Parallel scheduler implementation (Phase 6 — but DAG parser is ready)
- OpenClaw integration
- Modifying pipeline prompts or agent definitions
- Running Step 5 Review Gate (separate session by design)

### Forbidden Actions
- Do NOT modify `pforge smith`, `pforge analyze`, `pforge sweep`, `pforge diff` behavior
- Do NOT modify `step*.prompt.md` or `*.agent.md` files
- Do NOT modify preset files (`presets/`)
- Do NOT add Python dependencies
- Do NOT require internet access for local execution

---

## Branch Strategy
**Branch**: `feature/v2.0-autonomous-execution` (existing)
**Merge**: Squash merge to `master` via PR

---

## Execution Slices

### Slice 0: CLI Spawning Spike + Execution Modes (60 min — Manual) ✅
> **Added by**: Review Finding C1 | **Status**: Complete

**Spike Results**: See [SPIKE-RESULTS.md](./SPIKE-RESULTS.md)

**Key Findings**:
- `gh copilot` CLI v1.0.5 is a full agent: non-interactive, context-aware, multi-model
- Loads `.github/instructions/` automatically — NOT stateless
- `--model` supports Claude, GPT, Gemini — one CLI replaces all
- JSONL output includes `outputTokens`, `usage` stats, `codeChanges`
- Simplifies architecture: one CLI, two modes (Full Auto + Assisted)

### Slice 1: DAG-Based Orchestration Engine (90 min — Claude)
> **Updated by**: Review Findings C2 (DAG), C3 (events), M6 (scope metadata)

**Goal**: `mcp/orchestrator.mjs` with plan parser, DAG scheduler, and event emitter

**Plan Parser** — `parsePlan(planPath)`:
- Extract slices, validation gates, scope contract from Markdown
- Parse optional dependency tags: `[depends: Slice 1]` in slice headers
- Parse optional `[P]` tag for parallel-eligible slices (Phase 6 uses this)
- Parse optional scope metadata: `[scope: src/auth/**, tests/auth/**]` (M6)
- If no scope declared, assume global (blocks parallel in Phase 6)
- Build dependency graph (DAG) from parsed slices

**DAG Scheduler** — pluggable interface:
- `SequentialScheduler` — Phase 1 implementation: respects dependency order, executes one at a time
- `ParallelScheduler` — Phase 6 placeholder: interface defined, implementation deferred
- Sequential execution = DAG with no parallel edges (trivially correct)

**Event Emitter** (C3) — dependency injection pattern:
- `orchestrator.on('slice-started', handler)` / `orchestrator.emit('slice-completed', data)`
- Events: `run-started`, `slice-started`, `slice-completed`, `slice-failed`, `run-completed`, `run-aborted`
- In Phase 1: default handler writes events to log file only
- Design: orchestrator constructor accepts optional event handler (DI)
- Phase 3: WebSocket hub subscribes to orchestrator events, broadcasts to clients

**Executor** — `executeSlice(slice, config)`:
- Primary worker: `gh copilot -- -p "<instructions>" --allow-all --no-ask-user --output-format json`
- Fallback: `claude -p` → `codex -p` → error
- Capture stdout/stderr for session logs
- Parse JSONL for token tracking
- Enforce configurable timeout (default: 10 min)

**Orchestrator** — `runPlan(planPath, options)`:
- Topological sort of DAG → execution order
- Execute via selected scheduler
- Emit events at each lifecycle point
- Check abort flag between slices

**Validation Gates**:
- [ ] Plan parser extracts slices from `docs/plans/examples/Phase-DOTNET-EXAMPLE.md`
- [ ] DAG parser handles `[depends: Slice N]` tags
- [ ] Scope metadata `[scope: ...]` parsed correctly (M6)
- [ ] Event emitter fires all lifecycle events
- [ ] `node mcp/orchestrator.mjs --test` runs without errors

### Slice 2: Run Result Storage + Token Tracking + Session Logs (60 min — Codex/Auto)
> **Updated by**: Review Findings C4 (session logs), M1 (token tracking consolidated from Phase 2)

**Goal**: `.forge/runs/<timestamp>/` with per-slice JSON results, session logs, and token tracking

**Run Result Files**:
- `run.json` — plan name, start time, model routing, slice count, execution mode
- `slice-N.json` — status, duration, output, tokens `{ tokens_in, tokens_out, model, cost_usd }`
- `slice-N-log.txt` — worker stdout/stderr capture (C4 — Phase 5 Session Replay depends on this)
- `summary.json` — total pass/fail, score, tokens, cost, duration

**Token Tracking** (M1 — consolidated from Phase 2 Slice 1):
- Parse JSONL events: `outputTokens` from `assistant.message`, `usage` from `result`
- Log per-slice: `{ tokens_in, tokens_out, model, cost_usd }`
- If token capture unavailable: log `"unknown"`, don't block execution

**Cost Estimation** (`--estimate` mode):
- Character count of plan + referenced files × heuristic multiplier per model
- Pre-execution prompt: "Estimated ~180K tokens, ~$0.85. Proceed?"

**Resume Support**:
- `--resume-from N` reads prior run results, skips completed slices
- Validates prior slice results still exist before resuming

**Validation Gates**:
- [ ] Run creates proper directory structure
- [ ] `slice-N-log.txt` captures worker stdout/stderr
- [ ] Token fields present in `slice-N.json` (or `"unknown"`)
- [ ] `summary.json` has all required fields including total cost
- [ ] `--resume-from` skips completed slices correctly

### Slice 3: MCP Tools (60 min — Codex/Auto)
**Goal**: Wire `forge_run_plan`, `forge_abort`, `forge_plan_status` into MCP server

- `forge_run_plan` — accepts plan path, execution mode, optional estimate flag
- `forge_abort` — sets abort flag checked between slices
- `forge_plan_status` — reads latest `.forge/runs/` and returns progress
- Estimation mode returns slice count + token estimate without executing

**Validation Gates**:
- [ ] All 3 tools appear in MCP tool list (total: 12 tools)
- [ ] Estimation mode works without executing

### Slice 4: CLI Commands (60 min — Codex/Auto)
**Goal**: `pforge run-plan` in PowerShell + Bash

- `Invoke-RunPlan` / `cmd_run_plan` — delegates to orchestrator
- Flags: `--estimate`, `--resume-from N`, `--dry-run`, `--model <name>`, `--assisted`
- Help text + command router
- Progress output with emoji status per slice

**Validation Gates**:
- [ ] `pforge help` shows `run-plan`
- [ ] `pforge run-plan --estimate <plan>` returns estimate
- [ ] `--assisted` flag triggers interactive mode
- [ ] Bash parity confirmed

### Slice 5: Model Routing Configuration (45 min — Codex/Auto)
**Goal**: `.forge.json` `modelRouting` config

- Schema: `{ "execute": "gpt-5.2-codex", "review": "claude-sonnet-4.6", "default": "auto" }`
- Orchestrator reads config, passes `--model` flag to `gh copilot`
- `--model` CLI flag overrides for one-off runs
- Fallback to "auto" if model unavailable

**Validation Gates**:
- [ ] Config read and applied
- [ ] Override works
- [ ] Missing config defaults gracefully

### Slice 6: Auto-Sweep + Auto-Analyze (30 min — Codex/Auto)
**Goal**: After all slices pass, run sweep + analyze automatically

- Sweep: capture results, warn on markers
- Analyze: capture consistency score
- Write to `summary.json`
- Report: "All slices pass. Sweep: clean. Score: 91/100."

**Validation Gates**:
- [ ] Sweep runs after last slice
- [ ] Analyze score in summary
- [ ] Clear report output

### Slice 7: `.forge/SCHEMA.md` (30 min — Codex/Auto)
> **Added by**: Review Finding M2

**Goal**: Create schema document listing all `.forge/` files with formats and ownership

**Schema entries**:
- `.forge.json` — project config (preset, agents, modelRouting, extensions)
- `.forge/runs/<timestamp>/run.json` — run metadata
- `.forge/runs/<timestamp>/slice-N.json` — per-slice result with tokens
- `.forge/runs/<timestamp>/slice-N-log.txt` — worker session log
- `.forge/runs/<timestamp>/summary.json` — aggregate run results
- `.forge/cost-history.json` — aggregate cost data (Phase 2)
- `.forge/server-ports.json` — active HTTP/WS ports (Phase 3)
- `.forge/extensions/` — installed extensions
- `.forge/capabilities.json` — machine-readable discovery
- `.forge/phase.lock` — team lock (Phase 6)

**Validation Gates**:
- [ ] `.forge/SCHEMA.md` exists and documents all files
- [ ] Each entry has: file path, format (JSON/Markdown/text), created-by phase, schema description
- [ ] Cross-referenced with actual `.forge/` files created by this phase

### Slice 8: Documentation + Smith Update (60 min — Claude)
**Goal**: Update all docs, add to smith, full audit

- CLI-GUIDE.md: `pforge run-plan` section (both execution modes)
- README.md: update MCP tool count (12)
- CHANGELOG.md: v2.0 entry
- ROADMAP.md: mark Phase 1 complete
- index.html: orchestrator feature card
- faq.html: "Can I run a plan automatically?" FAQ
- Smith: check `.forge/runs/`, report last run status
- Full codebase audit

**Validation Gates**:
- [ ] All docs reference `run-plan` and execution modes
- [ ] `pforge smith` reports orchestrator status
- [ ] No orphaned references

---

## Definition of Done
- [ ] All 9 slices (0-8) pass validation gates
- [ ] CLI spawning spike documented with test results
- [ ] DAG-based executor with pluggable scheduler interface
- [ ] Event emitter fires lifecycle events (DI pattern)
- [ ] `pforge run-plan --estimate` works end-to-end
- [ ] `forge_run_plan` MCP tool callable from Copilot Chat
- [ ] Token tracking logs to `.forge/runs/` (parsed from JSONL)
- [ ] Session logs captured to `slice-N-log.txt`
- [ ] `.forge/SCHEMA.md` documents all `.forge/` files
- [ ] Auto-sweep + auto-analyze after completion
- [ ] Full documentation audit passes
- [ ] PR to master, squash merge

## Stop Conditions
- If `gh copilot` CLI unavailable AND no fallback CLIs → degrade to Assisted mode only
- If token capture impossible → degrade gracefully (log "unknown"), don't block
- If execution time per slice exceeds 10 min consistently → add configurable timeout

## Persistent Memory (if OpenBrain is configured)
- **Before execution**: `search_thoughts("orchestrator patterns", project)` — load prior run insights
- **After completion**: `capture_thought("Phase 1 run: N slices, score X, tokens Y")` — persist for trend tracking
