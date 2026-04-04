# Phase 1: Orchestrator — `forge_run_plan` Sequential Execution

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 1
> **Status**: 📋 Planned
> **Feature Branch**: `feature/v2.0-autonomous-execution`
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Execution pending

---

## Specification (Step 0)

### Problem Statement
Developers using Plan Forge currently execute pipeline steps manually — switching between sessions, running CLI commands, checking results, deciding what's next. For an 8-slice plan, this is 30-60 minutes of active attention. This phase adds one-command execution: `pforge run-plan <plan>` kicks off the entire pipeline automatically.

### User Scenarios
1. **CLI execution**: `pforge run-plan docs/plans/Phase-7-INVENTORY-PLAN.md` → system executes all slices, validates at every boundary, reports results
2. **MCP tool**: Agent calls `forge_run_plan(plan)` → orchestrates from within Copilot/Claude session
3. **Estimation only**: `pforge run-plan --estimate <plan>` → shows slice count, estimated tokens, cost — without executing

### Acceptance Criteria
- **MUST**: Sequential slice execution with build/test gates at every boundary
- **MUST**: Results written to `.forge/runs/<timestamp>/` per slice
- **MUST**: Token usage logged per slice per model
- **MUST**: `forge_run_plan` + `forge_abort` + `forge_plan_status` MCP tools
- **MUST**: `--estimate` flag for cost prediction without execution
- **MUST**: Existing manual workflows unchanged
- **SHOULD**: Model routing from `.forge.json` configuration
- **SHOULD**: Auto-sweep + auto-analyze after all slices pass
- **SHOULD**: `--resume-from N` to continue after a failure fix

---

## Scope Contract

### In Scope
- `mcp/orchestrator.mjs` — orchestration engine (new)
- `mcp/server.mjs` — add 3 MCP tools
- `mcp/package.json` — dependencies
- `pforge.ps1` — add `run-plan` command
- `pforge.sh` — add `run-plan` command (bash parity)
- `.forge/runs/` — run result storage
- `.forge.json` — add `modelRouting` schema
- Documentation: CLI-GUIDE, README, CHANGELOG, ROADMAP, index.html, faq.html

### Out of Scope
- Web dashboard (Phase 3-5)
- WebSocket hub (Phase 3)
- Parallel execution (Phase 6)
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

### Slice 1: Orchestration Engine Core (90 min — Claude)
**Goal**: `mcp/orchestrator.mjs` with plan parser + sequential executor

- `parsePlan(planPath)` — extract slices, validation gates, scope contract from Markdown
- `executeSlice(slice, config)` — spawn worker process, capture output, enforce timeout
- `runPlan(planPath, options)` — orchestrate full sequential execution
- Worker spawning via `child_process.spawn` with Copilot CLI / Claude CLI

**Validation Gates**:
- [ ] Plan parser extracts slices from `docs/plans/examples/Phase-DOTNET-EXAMPLE.md`
- [ ] `node mcp/orchestrator.mjs --test` runs without errors

### Slice 2: Run Result Storage (45 min — Codex/Auto)
**Goal**: `.forge/runs/<timestamp>/` with per-slice JSON results

- Create `run.json` (plan name, start time, model routing, slice count)
- Create `slice-N.json` per slice (status, duration, output, tokens)
- Create `summary.json` on completion (total pass/fail, score, tokens, duration)
- `--resume-from N` reads prior results, skips completed slices

**Validation Gates**:
- [ ] Run creates proper directory structure
- [ ] `summary.json` has all required fields

### Slice 3: MCP Tools (60 min — Codex/Auto)
**Goal**: Wire `forge_run_plan`, `forge_abort`, `forge_plan_status` into MCP server

- `forge_run_plan` — accepts plan path, optional estimate flag
- `forge_abort` — sets abort flag checked between slices
- `forge_plan_status` — reads latest `.forge/runs/` and returns progress
- Estimation mode returns slice count + token estimate without executing

**Validation Gates**:
- [ ] All 3 tools appear in MCP tool list (total: 12 tools)
- [ ] Estimation mode works without executing

### Slice 4: CLI Commands (60 min — Codex/Auto)
**Goal**: `pforge run-plan` in PowerShell + Bash

- `Invoke-RunPlan` / `cmd_run_plan` — delegates to orchestrator
- Flags: `--estimate`, `--resume-from N`, `--dry-run`, `--model <name>`
- Help text + command router
- Progress output with emoji status per slice

**Validation Gates**:
- [ ] `pforge help` shows `run-plan`
- [ ] `pforge run-plan --estimate <plan>` returns estimate
- [ ] Bash parity confirmed

### Slice 5: Model Routing Configuration (45 min — Codex/Auto)
**Goal**: `.forge.json` `modelRouting` config

- Schema: `{ "execute": "codex", "review": "claude", "default": "auto" }`
- Orchestrator reads config, applies per-slice
- `--model` flag overrides for one-off runs
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

### Slice 7: Token Tracking + Cost Estimation (60 min — Claude)
**Goal**: Log actual tokens, provide pre-run estimates

- Capture token usage from worker CLI output
- Log per-slice: `{ tokens_in, tokens_out, model, cost_usd }`
- `--estimate` mode: character count × heuristic multiplier
- Pre-execution prompt: "Estimated ~180K tokens, ~$0.85. Proceed?"

**Validation Gates**:
- [ ] Token counts captured (or "unknown" if unavailable)
- [ ] Estimate produces reasonable numbers
- [ ] Summary shows total cost

### Slice 8: Documentation + Smith Update (60 min — Claude)
**Goal**: Update all docs, add to smith, full audit

- CLI-GUIDE.md: `pforge run-plan` section
- README.md: update MCP tool count (12)
- CHANGELOG.md: v2.0 entry
- ROADMAP.md: mark v2.0 shipped
- index.html: orchestrator feature card
- faq.html: "Can I run a plan automatically?" FAQ
- Smith: check `.forge/runs/`, report last run status
- Full codebase audit

**Validation Gates**:
- [ ] All docs reference `run-plan`
- [ ] `pforge smith` reports orchestrator status
- [ ] No orphaned references

---

## Definition of Done
- [ ] All 8 slices pass validation gates
- [ ] `pforge run-plan --estimate` works end-to-end
- [ ] `forge_run_plan` MCP tool callable from Copilot Chat
- [ ] Token tracking logs to `.forge/runs/`
- [ ] Auto-sweep + auto-analyze after completion
- [ ] Full documentation audit passes
- [ ] PR to master, squash merge

## Stop Conditions
- If Copilot CLI / Claude CLI cannot be invoked non-interactively → STOP, re-evaluate worker spawning
- If token capture impossible → degrade gracefully (log "unknown"), don't block
- If execution time per slice exceeds 10 min consistently → add configurable timeout

## Persistent Memory (if OpenBrain is configured)
- **Before execution**: `search_thoughts("orchestrator patterns", project)` — load prior run insights
- **After completion**: `capture_thought("Phase 1 run: N slices, score X, tokens Y")` — persist for trend tracking
