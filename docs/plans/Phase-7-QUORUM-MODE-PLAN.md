# Phase 7: Quorum Mode — Multi-Model Consensus Execution

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 7  
> **Status**: ✅ Complete  
> **Version**: v2.5.0  
> **Feature Branch**: `feature/v2.5-quorum-mode`  
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ → Step 3 ✅ → Step 5 ☐  
> **Depends On**: v2.4 (telemetry spans), v2.0 (orchestrator, spawnWorker, ParallelScheduler)

---

## Specification (Step 0)

### Problem Statement

When executing complex slices (database migrations, auth flows, cross-module refactors), a single AI model may miss edge cases, choose a suboptimal architecture, or produce code that fails validation gates. The current retry mechanism re-invokes the *same* model with error context — it doesn't leverage the diversity of reasoning that different models provide. For high-complexity slices, developers would benefit from multi-model consensus: let three different models propose implementation plans, synthesize the best elements, then execute with higher confidence.

### User Scenarios

1. **Explicit quorum**: `pforge run-plan <plan> --quorum` → all slices dispatched to 3 models for dry-run consensus before execution
2. **Auto quorum**: `pforge run-plan <plan> --quorum=auto` → only slices scoring ≥7 complexity get quorum; others run normally
3. **MCP tool**: `forge_run_plan(plan, { quorum: "auto" })` → quorum-mode from within Copilot/Claude session
4. **Config-driven**: `.forge.json` `"quorum": { "enabled": true, "auto": true, "threshold": 7 }` → default quorum behavior for all runs
5. **Estimation**: `pforge run-plan --estimate --quorum <plan>` → shows per-slice quorum cost overhead alongside regular estimate
6. **Dashboard monitoring**: Progress tab shows quorum legs running in parallel; Replay tab lets you browse all 3 dry-run outputs + synthesized plan

### Acceptance Criteria

- **MUST**: `scoreSliceComplexity(slice)` returns 1-10 score based on configurable weighted signals
- **MUST**: `quorumDispatch(slice, models[])` spawns 3 parallel dry-run workers, collects responses
- **MUST**: `quorumReview(dryRunResults[], slice)` synthesizes responses into a unified execution plan
- **MUST**: Dry-run workers load all instructions.md, project profile, and principles (same guardrails as primary)
- **MUST**: Final execution uses synthesized plan as enhanced prompt, passes through normal gate validation
- **MUST**: `--quorum`, `--quorum=auto` CLI flags and `quorum` MCP tool parameter
- **MUST**: `.forge.json` `quorum` config block with `enabled`, `auto`, `threshold`, `models[]`, `reviewerModel`
- **MUST**: Cost tracked per quorum leg (dry-run tokens + reviewer tokens + execution tokens)
- **SHOULD**: Quorum legs modeled as child spans in `trace.json` for waterfall visualization
- **SHOULD**: Dashboard shows quorum status indicators on Progress tab
- **SHOULD**: `--estimate` includes quorum overhead calculation when `--quorum` is active
- **SHOULD**: Historical failure rate factored into complexity score (from `.forge/runs/` history)
- **COULD**: Quorum reviewer flags model disagreements as risk annotations in the execution prompt

---

## Scope Contract

### In Scope

- `pforge-mcp/orchestrator.mjs` — add `scoreSliceComplexity()`, `quorumDispatch()`, `quorumReview()`, wire into `executeSlice()`
- `pforge-mcp/server.mjs` — add `quorum` parameter to `forge_run_plan` tool schema
- `pforge-mcp/capabilities.mjs` — update tool metadata, add quorum workflow graph
- `pforge-mcp/telemetry.mjs` — quorum child spans (dry-run legs + reviewer)
- `pforge-mcp/dashboard/app.js` — quorum indicators on Progress tab, dry-run responses in Replay tab
- `pforge-mcp/dashboard/index.html` — quorum UI elements
- `pforge.ps1` / `pforge.sh` — add `--quorum` / `--quorum=auto` flags
- `.forge/SCHEMA.md` — document `quorum` config schema
- Documentation: CLI-GUIDE.md, README.md, CHANGELOG.md, ROADMAP.md, capabilities.md, index.html, faq.html

### Out of Scope

- Modifying pipeline prompts (`step*.prompt.md`) or agent definitions (`*.agent.md`)
- Modifying preset files (`presets/`)
- Adding external service dependencies
- Real-time model performance benchmarking (deferred to v3.0 Agent-per-slice routing)
- Cross-run model quality comparison dashboards

### Forbidden Actions

- Do NOT modify `pforge smith`, `pforge analyze`, `pforge sweep`, `pforge diff` behavior
- Do NOT modify `step*.prompt.md` or `*.agent.md` files
- Do NOT modify preset files (`presets/`)
- Do NOT add Python dependencies
- Do NOT change existing non-quorum execution paths (all current behavior unchanged when quorum is off)

---

## Architecture

```
executeSlice(slice, options)
  │
  ├─ quorum off  → spawnWorker() → gate → done              (existing path, unchanged)
  │
  └─ quorum on   → scoreSliceComplexity(slice)
                      │
                      ├─ score < threshold (auto mode) → existing path
                      │
                      └─ score ≥ threshold (or forced)  → quorumDispatch(slice, models)
                           │
                           ├─ spawnWorker(dryRunPrompt, claude-opus-4.6)    ─┐
                           ├─ spawnWorker(dryRunPrompt, gpt-5.3-codex)      ─┼─ Promise.all()
                           └─ spawnWorker(dryRunPrompt, gemini-3.1-pro)     ─┘
                                      │
                                quorumReview(3 responses, slice)
                                (synthesis agent → unified execution plan)
                                      │
                                spawnWorker(enhancedPrompt, primaryModel)
                                      │
                                    gate → done
```

### Complexity Scoring Signals

| Signal | Weight | Source | Rationale |
|--------|--------|--------|-----------|
| File count in scope | 20% | `slice.scope[]` pattern count | More files = more coordination |
| Cross-module dependencies | 20% | `slice.depends[]` count | Inter-slice coupling = integration risk |
| Security-sensitive keywords | 15% | Deliverables containing `auth`, `token`, `RBAC`, `encryption`, `secret`, `CORS` | Security code demands precision |
| Database/migration keywords | 15% | Deliverables containing `migration`, `schema`, `ALTER`, `CREATE TABLE`, `seed` | Schema changes are hard to reverse |
| Acceptance criteria count | 10% | Number of lines in `### Validation Gate` | More gates = more complex verification |
| Task count | 10% | `slice.tasks.length` | More tasks = more work per slice |
| Historical failure rate | 10% | `.forge/runs/` — past failure rate for slices with similar titles/keywords | Empirical difficulty signal |

**Score mapping**: Raw weighted sum normalized to 1-10 scale. Configurable threshold in `.forge.json` (default: 7).

### Dry-Run Prompt Template

```
You are in QUORUM DRY-RUN mode. Do NOT execute any code changes.
Do NOT create, modify, or delete any files.

Instead, produce a detailed implementation plan for the slice below:

1. **Files to create or modify** — exact paths, one per line
2. **Implementation approach** — for each file, describe the key changes (classes, methods, patterns)
3. **Edge cases and failure modes** — what could go wrong, how to handle it
4. **Testing strategy** — how to verify the validation gate passes
5. **Risk assessment** — rate confidence (high/medium/low) and explain concerns

--- ORIGINAL SLICE INSTRUCTIONS ---
<slice prompt injected here>
```

### Reviewer Synthesis Prompt Template

```
You are the QUORUM REVIEWER. Three AI models independently analyzed the same coding task
and produced implementation plans. Your job is to synthesize the BEST execution plan.

Rules:
- Pick the BEST approach for each file/component (not necessarily from the same model)
- When models DISAGREE on architecture, choose the approach with better error handling and testability
- Flag any RISK AREAS where all three models expressed concerns
- Produce a CONCRETE execution plan (not vague guidance) — the output will be used as instructions for the executing agent

--- MODEL A (Claude Opus 4.6) ---
<response A>

--- MODEL B (GPT-5.3-Codex) ---
<response B>

--- MODEL C (Gemini 3.1 Pro) ---
<response C>

--- ORIGINAL SLICE ---
<slice prompt>

Produce the unified execution plan now.
```

### Configuration Schema (`.forge.json`)

```json
{
  "quorum": {
    "enabled": false,
    "auto": true,
    "threshold": 7,
    "models": ["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"],
    "reviewerModel": "claude-opus-4.6",
    "dryRunTimeout": 300000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Master switch for quorum mode |
| `auto` | boolean | `true` | When enabled, only quorum high-complexity slices |
| `threshold` | number (1-10) | `7` | Complexity score threshold for auto mode |
| `models` | string[] | `["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"]` | Models for dry-run fan-out |
| `reviewerModel` | string | `"claude-opus-4.6"` | Model for synthesis review |
| `dryRunTimeout` | number (ms) | `300000` (5 min) | Timeout per dry-run worker |

---

## Branch Strategy

**Branch**: `feature/v2.5-quorum-mode`  
**Merge**: Squash merge to `master` via PR

---

## Execution Slices

### Slice 1: Complexity Scoring Engine (60 min — Claude)

**Goal**: `scoreSliceComplexity(slice, cwd)` function with weighted signal analysis

**Implementation**:
- Parse slice metadata: `scope`, `depends`, `tasks`, `validationGate`, title/deliverables
- Keyword detection for security and database signals (regex against tasks + deliverables)
- Historical failure rate: scan `.forge/runs/*/summary.json` for slices with matching title keywords
- Weighted sum → normalize to 1-10 scale
- `loadQuorumConfig(cwd)` — read `.forge.json` `quorum` block with defaults

**Exports**: `scoreSliceComplexity(slice, cwd)`, `loadQuorumConfig(cwd)`

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all existing tests pass
```
- [ ] Slice with 1 task, no deps, no security keywords → score ≤ 3
- [ ] Slice with 6+ tasks, 3 deps, auth keywords, migration keywords → score ≥ 7
- [ ] Missing `.forge/runs/` → historical weight = 0 (no crash)
- [ ] `loadQuorumConfig` with no `.forge.json` → returns defaults
- [ ] `loadQuorumConfig` with partial config → merges with defaults

### Slice 2: Quorum Dispatch — Parallel Dry-Run Fan-Out (90 min — Claude) [depends: Slice 1]

**Goal**: `quorumDispatch(slice, config, options)` spawns 3 workers in parallel dry-run mode

**Implementation**:
- Build dry-run prompt: prepend dry-run template to `buildSlicePrompt(slice)` output
- Include OpenBrain memory block if enabled (same as primary path)
- Spawn 3 workers via `Promise.all([spawnWorker(dryPrompt, {model: m}) for m of config.models])`
- Each worker runs with `dryRunTimeout` (default 5 min, separate from execution timeout)
- Collect: `{ model, output, tokens, duration, exitCode }` per leg
- If a model fails/times out, continue with remaining responses (minimum 2 required for quorum)
- Emit `quorum-dispatch-started` and `quorum-leg-completed` events

**Exports**: `quorumDispatch(slice, config, options)`

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all existing + new tests pass
```
- [ ] Fan-out spawns 3 workers with correct model flags
- [ ] Dry-run prompt includes all slice instructions + scope + gate info
- [ ] Timeout per leg uses `dryRunTimeout` config (not execution timeout)
- [ ] 1 leg failure → continues with 2 (no crash)
- [ ] 2 leg failures → falls back to normal execution (no quorum)
- [ ] Events emitted for dispatch lifecycle

### Slice 3: Quorum Reviewer — Synthesis Agent (90 min — Claude) [depends: Slice 2]

**Goal**: `quorumReview(dryRunResults[], slice, config, options)` synthesizes responses into execution plan

**Implementation**:
- Build reviewer prompt: concatenate all dry-run outputs with model labels + original slice
- Spawn reviewer worker: `spawnWorker(reviewerPrompt, { model: config.reviewerModel })`
- Parse reviewer output as the enhanced execution plan
- Build final prompt: reviewer synthesis + original slice tasks + scope + gates
- Emit `quorum-review-completed` event with reviewer tokens + cost
- Return `{ enhancedPrompt, reviewerTokens, reviewerCost, modelResponses[] }`

**Exports**: `quorumReview(dryRunResults, slice, config, options)`

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all existing + new tests pass
```
- [ ] Reviewer prompt includes all 3 model responses with labels
- [ ] Reviewer prompt includes original slice instructions
- [ ] Enhanced prompt is non-empty and includes slice metadata
- [ ] Cost tracked separately for reviewer invocation
- [ ] Falls back to best single dry-run if reviewer fails

### Slice 4: Wire into executeSlice + runPlan (60 min — Codex/Auto) [depends: Slice 3]

**Goal**: Integrate quorum into the main execution path without changing existing behavior

**Changes to `executeSlice()`**:
- Accept `quorumConfig` in options
- Before worker spawn: if quorum enabled, call `scoreSliceComplexity()`
- If score ≥ threshold (or quorum forced): call `quorumDispatch()` → `quorumReview()` → use enhanced prompt
- If score < threshold (auto mode): skip quorum, run normally
- Enhanced prompt replaces `sliceInstructions` for the final `spawnWorker()` call
- Gate validation unchanged — runs after final execution regardless of quorum

**Changes to `runPlan()`**:
- Accept `quorum` option: `false | true | "auto"`
- Load quorum config from `.forge.json`
- CLI flag overrides: `--quorum` (force all), `--quorum=auto` (threshold-based)
- Pass `quorumConfig` to `executeSlice()`

**Changes to estimation**:
- `buildEstimate()` includes quorum overhead when quorum is active: 3× dry-run tokens + reviewer tokens per qualifying slice

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all existing + new tests pass
```
- [ ] `quorum: false` → existing behavior unchanged (zero regressions)
- [ ] `quorum: true` → all slices go through quorum dispatch
- [ ] `quorum: "auto"` → only high-score slices go through quorum
- [ ] `--estimate --quorum` shows quorum overhead in cost
- [ ] Retry after quorum-failed gate still works (uses enhanced prompt)

### Slice 5: Telemetry Spans + Dashboard Indicators (60 min — Codex/Auto) [depends: Slice 4]

**Goal**: Quorum legs visible in traces and dashboard

**Telemetry (`telemetry.mjs`)**:
- New event types: `quorum-dispatch-started`, `quorum-leg-completed`, `quorum-review-completed`
- Dry-run legs modeled as `CLIENT` child spans of the slice span
- Reviewer modeled as `INTERNAL` child span between dry-run and execution
- Span attributes: `quorum.model`, `quorum.score`, `quorum.threshold`, `quorum.legIndex`

**Dashboard (`app.js` + `index.html`)**:
- Progress tab: quorum badge on slices running in quorum mode (shows score + model count)
- Replay tab: expandable section for dry-run responses per model
- Traces tab: quorum legs visible in waterfall as nested spans

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all tests pass
```
- [ ] Quorum spans appear in `trace.json` as children of slice span
- [ ] Dashboard renders quorum indicators without errors
- [ ] Non-quorum runs render unchanged (no visual regressions)

### Slice 6: CLI Flags + MCP Parameter + Config (45 min — Codex/Auto) [depends: Slice 4]

**Goal**: User-facing flags and configuration

**CLI (`pforge.ps1` + `pforge.sh`)**:
- `pforge run-plan <plan> --quorum` → force quorum on all slices
- `pforge run-plan <plan> --quorum=auto` → threshold-based
- `pforge run-plan <plan> --quorum-threshold 8` → override threshold
- Help text updated

**MCP (`server.mjs`)**:
- `forge_run_plan` input schema: add `quorum` (enum: `false | true | "auto"`) and `quorumThreshold` (number)

**Capabilities (`capabilities.mjs`)**:
- Update `forge_run_plan` metadata: new parameters, cost hint updated for quorum
- Add `quorum-execute` workflow graph: estimate → quorum-run → status → cost-report
- Update config schema with `quorum` block

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all tests pass
```
- [ ] `pforge help` shows `--quorum` flag
- [ ] `forge_run_plan` tool schema includes `quorum` parameter
- [ ] `forge_capabilities` returns quorum config schema
- [ ] `.forge/SCHEMA.md` documents quorum config

### Slice 7: Documentation + CHANGELOG (60 min — Claude) [depends: Slice 5, Slice 6]

**Goal**: Full documentation update

**Files to update**:
- `CHANGELOG.md` — v2.5.0 entry with quorum mode details
- `ROADMAP.md` — mark v2.5 as ✅, update description
- `README.md` — quorum mode section, update feature list
- `docs/CLI-GUIDE.md` — `--quorum` flag documentation
- `docs/capabilities.md` — quorum tools, config, workflow
- `docs/index.html` — quorum mode feature card
- `docs/faq.html` — "What is Quorum Mode?" FAQ entry
- `VERSION` — bump to 2.5.0
- `pforge-mcp/server.mjs` — version string to 2.5.0

**Validation Gates**:
```bash
node pforge-mcp/orchestrator.mjs --test    # all tests pass
```
- [ ] All docs reference quorum mode
- [ ] No stale version numbers
- [ ] `docs/capabilities.md` updated with quorum workflow
- [ ] CHANGELOG has v2.5.0 section

---

## Definition of Done

- [ ] `scoreSliceComplexity()` returns 1-10 with weighted signals
- [ ] `quorumDispatch()` fans out to 3 models in parallel dry-run
- [ ] `quorumReview()` synthesizes into unified execution plan
- [ ] `executeSlice()` seamlessly integrates quorum when enabled
- [ ] `--quorum` and `--quorum=auto` CLI flags work end-to-end
- [ ] `forge_run_plan` MCP tool accepts `quorum` parameter
- [ ] `.forge.json` `quorum` config block with all fields
- [ ] Cost tracked per quorum leg (dry-run + reviewer + execution)
- [ ] Telemetry spans for quorum legs visible in trace waterfall
- [ ] Dashboard shows quorum indicators and dry-run responses
- [ ] Estimation includes quorum overhead when active
- [ ] All 65+ existing self-tests pass (zero regressions)
- [ ] New self-tests for complexity scoring, dispatch, review
- [ ] Documentation fully updated with quorum references
- [ ] PR to master, squash merge

## Stop Conditions

- If fewer than 2 of 3 dry-run models respond → fall back to normal execution (no quorum for that slice)
- If reviewer synthesis is empty or fails → use best single dry-run output as enhanced prompt
- If quorum adds >5x cost over threshold → warn user in estimation and require explicit `--quorum` (not auto)
- If all 3 models are unavailable → degrade to normal execution with warning

## Cost Estimates

| Component | Tokens (est. per slice) | Cost (est.) |
|-----------|------------------------|-------------|
| 3× dry-run prompts | ~15K in + ~9K out each | $0.40–0.80 |
| Reviewer synthesis | ~30K in + ~5K out | $0.20–0.40 |
| **Total quorum overhead** | | **$0.60–1.20 per slice** |
| Normal execution | ~5K in + ~3K out | $0.10–0.20 |

- 10-slice plan, full quorum: ~$7–14 extra
- 10-slice plan, auto mode (2-3 high-complexity): ~$2–4 extra

## Persistent Memory (if OpenBrain is configured)

- **Before quorum**: `search_thoughts("quorum patterns", project)` — load prior quorum insights
- **After quorum**: `capture_thought("Quorum slice N: score X, models agreed on Y, disagreed on Z")` — persist consensus quality data
- **Cost anomaly**: If quorum cost > 3× historical average → capture anomaly thought
