# Phase 6: Parallel Execution + Team Features

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 6
> **Status**: ✅ Complete
> **Feature Branch**: `feature/v2.0-parallel-execution`
> **Depends On**: Phase 3 (WebSocket Hub) ✅, Phase 4 (Dashboard) ✅
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Step 3 ✅ (executed)
> **Review Findings Applied**: M6 (scope metadata), M8 (team lock)

---

## Specification (Step 0)

### Problem Statement
Phase 1 executes slices sequentially. But hardened plans already mark independent slices with `[P]` (parallel-safe). This phase enables concurrent slice execution for faster plan completion, plus team coordination features so multiple developers don't conflict.

### Acceptance Criteria
- **MUST**: `[P]`-tagged slices execute in parallel (up to configurable worker pool)
- **MUST**: Merge checkpoints — parallel branches converge at defined sync points
- **MUST**: Conflict detection — warn if parallel slices touch overlapping files
- **MUST**: Dashboard shows parallel execution lanes
- **SHOULD**: Team activity feed — who's running what
- **SHOULD**: Lock mechanism — prevent two developers from running overlapping phases
- **MAY**: Git branch-per-slice isolation with auto-merge at checkpoints

---

## Scope Contract

### In Scope
- `mcp/orchestrator.mjs` — parallel execution engine, worker pool
- `mcp/hub.mjs` — multi-worker event routing
- `mcp/dashboard/` — parallel lane visualization, team feed
- `.forge.json` — `maxParallelism` config
- `.forge/runs/` — parallel slice tracking

### Out of Scope
- OpenClaw integration (v2.3)
- Full multi-agent orchestration with auto-escalation (v3.0)
- User authentication (future)

### Forbidden Actions
- Do NOT break sequential execution (parallel is opt-in via `[P]` tags)
- Do NOT auto-merge without conflict check
- Do NOT allow parallel slices to edit the same file

---

## Execution Slices

### Slice 1: Worker Pool Manager (90 min — Claude)
**Goal**: Manage concurrent worker processes with configurable limits

- `WorkerPool` class: spawn N workers, track availability, queue slices
- Config: `maxParallelism` in `.forge.json` (default: 3)
- Worker lifecycle: spawn → assign slice → monitor → complete → return to pool
- Graceful shutdown: finish running slices, don't start new ones

**Validation Gates**:
- [ ] Pool spawns correct number of workers
- [ ] Queuing works when all workers busy

### Slice 2: Parallel Slice Detection + Scheduling (60 min — Claude)
**Goal**: Parse plan for `[P]` tags and build execution DAG

- Scan slices for `[P]` (parallel-safe) and `[merge-point]` markers
- Build directed acyclic graph (DAG): which slices depend on which
- Sequential slices: execute in order (existing behavior)
- Parallel slices: assign to worker pool simultaneously
- Merge points: wait for all parallel branches before proceeding

**Validation Gates**:
- [ ] DAG correctly identifies parallel groups
- [ ] Merge points block until all dependencies complete

### Slice 3: Conflict Detection (45 min — Codex/Auto)
**Goal**: Warn before parallel slices touch overlapping files

- Read each slice's scope (from plan or heuristic from slice description)
- Before parallel dispatch: check for file path overlaps
- If overlap detected: warn and fall back to sequential for those slices
- Log conflicts to run results

**Validation Gates**:
- [ ] Overlap detection catches known conflicts
- [ ] Fallback to sequential works

### Slice 4: Dashboard Parallel Lanes (60 min — Claude)
**Goal**: Visual representation of parallel execution in dashboard

- Render parallel slices side-by-side (lanes) instead of sequential cards
- Show merge point as a convergence bar
- Real-time updates per lane via WebSocket
- Timeline view: Gantt-style with parallel bars

**Validation Gates**:
- [ ] Parallel slices render in lanes
- [ ] Merge points visualize correctly

### Slice 5: Team Activity Feed (60 min — Claude)
**Goal**: Dashboard view showing who's running what

- Simple identity: read from git config (user.name, user.email)
- Broadcast activity events to hub: "Scott started Phase 7", "Alex completed review"
- Dashboard panel: activity stream with timestamps
- Lock mechanism: warn if two users run overlapping phases

**Validation Gates**:
- [ ] Activity events broadcast to hub
- [ ] Dashboard shows activity feed
- [ ] Lock warning works

### Slice 6: Documentation (30 min — Codex/Auto)
**Goal**: Document parallel execution and team features

- CLI-GUIDE: parallel execution docs
- CUSTOMIZATION: `maxParallelism` config
- CHANGELOG: v2.2 entry
- ROADMAP: mark v2.2 shipped

**Validation Gates**:
- [ ] Docs updated
- [ ] Config documented

---

## Definition of Done
- [ ] Parallel execution works for `[P]`-tagged slices
- [ ] Conflict detection prevents file overlap issues
- [ ] Dashboard shows parallel lanes
- [ ] Team activity feed functional
- [ ] Sequential execution unchanged (backward compatible)

## Stop Conditions
- If parallel worker spawning causes resource contention → reduce default maxParallelism to 2
- If git branch-per-slice creates merge complexity → defer to v3.0
