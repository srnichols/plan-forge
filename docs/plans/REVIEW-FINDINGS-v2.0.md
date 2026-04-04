# v2.0 Plan Review Findings — April 4, 2026

> **Status**: Reviewed. All 6 plans need updates before execution.
> **Reviewer**: Architecture review via deep audit
> **Next Step**: Apply fixes below, then re-review before execution

---

## Critical Fixes (Must Apply Before Execution)

### C1: Worker Spawning Spike + Execution Modes (Phase 1)
**Add Slice 0** before all other slices: 60-min spike to test all worker spawning options and define execution modes.

**Test matrix:**
1. Can `claude` CLI (Anthropic) be invoked non-interactively? — reads `CLAUDE.md` with all guardrails ✅
2. Can `codex` CLI (OpenAI) be invoked non-interactively? — reads `.agents/skills/` ✅
3. Can `gh copilot` CLI (Microsoft) be invoked non-interactively with **context injection** (pipe guardrail content via stdin)? — normally stateless, doesn't read `.github/` files
4. Can VS Code Copilot be controlled programmatically? (likely answer: NO — UI extension)
5. Can the orchestrator run build/test commands directly without an agent? (validation-only for Assisted mode)

**Tool landscape (critical for audience targeting):**

| Tool | License | Reads Project Context? | Non-Interactive? |
|------|---------|----------------------|-----------------|
| VS Code + GitHub Copilot | Microsoft (Copilot license) | ✅ Full `.github/` suite | ❌ UI only |
| Copilot CLI (`gh copilot`) | Microsoft (same license) | ❌ Stateless — does NOT read `.github/` | ✅ But limited |
| GitHub CLI (`gh`) | Microsoft (same license) | N/A — not an AI agent | ✅ |
| Claude Code (`claude`) | Anthropic (separate) | ✅ Rich `CLAUDE.md` | ✅ Best worker |
| Codex CLI (`codex`) | OpenAI (separate) | ✅ `.agents/skills/` | ✅ Good worker |
| Cursor | Anysphere (separate) | ✅ `.cursor/rules` | ✅ |

**Critical spike finding #3 (Copilot CLI context injection):**
If `gh copilot` can accept piped context (guardrails + slice instructions via stdin), Microsoft-only teams get Full Auto mode. If not, they're limited to Assisted mode. This is the **highest-priority test** for the Microsoft enterprise audience.

**Define three execution modes based on spike results:**

| Mode | Worker | Guardrails? | Target Audience |
|------|--------|------------|----------------|
| **Full Auto (Claude)** | Claude Code CLI | ✅ Rich CLAUDE.md (all 16 guardrails) | Independent devs, overnight builds |
| **Full Auto (Copilot)** | Copilot CLI + context injection | ⚠️ Injected (if spike #3 passes) | Microsoft employees (same license, no new tools) |
| **Assisted** | Human in VS Code Copilot | ✅ Full `.github/` suite | Everyone — interactive coding + automated validation gates |

**Assisted mode workflow:**
1. Developer starts `pforge run-plan --assisted <plan>`
2. Orchestrator shows: "Slice 1 ready. Execute in your Copilot session, then press Enter."
3. Developer writes code in VS Code Copilot Agent Mode (their preferred tool)
4. Developer presses Enter (or runs `pforge gate <plan> 1`)
5. Orchestrator runs validation gates: build + test + sweep
6. If gates pass → "Slice 1 complete. Slice 2 ready."
7. If gates fail → "Slice 1 failed: test X broke. Fix and re-run gate."
8. Repeat until all slices pass → auto-analyze → report

**Why Assisted mode matters:** VS Code Copilot is the #1 usage pattern. Users shouldn't need to switch to CLI agents just because the orchestrator can't spawn VS Code sessions. Assisted mode lets them stay in their preferred tool while the orchestrator enforces quality.

### C2: DAG-Based Executor from Day 1 (Phase 1, Slice 1)
Redesign `runPlan()` as a DAG scheduler, not a sequential loop. Sequential execution = DAG with no parallel tags. This prevents Phase 6 from being a rewrite. Add:
- Slice dependency parsing (optional `[depends: Slice 1]` in plan headers)
- `[P]` tag detection (used by Phase 6)
- Pluggable scheduler interface: `SequentialScheduler` (Phase 1) and `ParallelScheduler` (Phase 6)

### C3: Event Emitter in Phase 1 (Phase 1, Slice 1)
Add event emitter pattern to `orchestrator.mjs`:
- `orchestrator.on('slice-started', handler)` / `orchestrator.emit('slice-completed', data)`
- In Phase 1: events write to log only (no hub yet)
- In Phase 3: hub subscribes to orchestrator events and broadcasts to WebSocket clients
- Design: dependency injection — orchestrator accepts optional event handler

### C4: Session Log Capture (Phase 1, Slice 2)
Add to Run Result Storage: capture worker stdout/stderr to `.forge/runs/<timestamp>/slice-N-log.txt`. Phase 5 Session Replay depends on this. Also define complete `.forge/runs/` schema including token fields (merge old Slice 7 content).

### C5: Express + stdio + WebSocket Architecture (Phase 3 + 4)
**Architecture Decision**: Single Node.js process.
- MCP SDK uses stdio for agent communication (unchanged)
- Express serves dashboard on HTTP port 3100
- WebSocket hub on port 3101
- Both HTTP and WS start in `server.mjs` alongside MCP stdio handler
- Environment variables: `PLAN_FORGE_HTTP_PORT`, `PLAN_FORGE_WS_PORT`
- If port unavailable: increment and retry (3100→3101→3102...)
- Store active port in `.forge/server-ports.json`

### C6: REST API Endpoints (Phase 4)
Add new slice to Phase 4: "REST API Layer"
- `GET /api/status` — current run status
- `GET /api/runs` — run history
- `GET /api/config` — read `.forge.json`
- `POST /api/config` — write `.forge.json` (with validation)
- `POST /api/tool/:name` — invoke any forge tool (proxy to MCP)
- Phase 5 Config Editor uses POST /api/config
- Phase 4 Quick Actions uses POST /api/tool/:name

---

## Medium Fixes (Apply During Plan Updates)

### M1: Consolidate Token Tracking (Phase 1 + Phase 2)
Move Phase 2 Slice 1 (Enhanced Token Capture) into Phase 1 Slice 2 (Run Result Storage). Phase 1 captures tokens from CLI output. Phase 2 starts at cost calculation (Slice 2). Eliminates duplication.

### M2: `.forge/SCHEMA.md` (Phase 1)
Create schema document listing all `.forge/` files:
- `.forge.json` — project config
- `.forge/runs/<timestamp>/` — run results (run.json, slice-N.json, slice-N-log.txt, summary.json)
- `.forge/cost-history.json` — aggregate cost data
- `.forge/server-ports.json` — active HTTP/WS ports
- `.forge/extensions/` — installed extensions
- `.forge/capabilities.json` — machine-readable discovery
- `.forge/phase.lock` — team lock (Phase 6)

### M3: Port Fallback Strategy (Phase 3)
Document in Phase 3 Slice 1: check port availability, increment on conflict, store in `.forge/server-ports.json`. Phase 4 reads this file to connect dashboard to correct WS port.

### M4: Event Schema Versioning (Phase 3)
Add `version: "1.0"` to all events. Dashboard (Phase 4) checks version compatibility. Document in `mcp/EVENTS.md`.

### M5: Project Discovery Algorithm (Phase 4)
Specify in Phase 4 Slice 3:
1. Check env `PLAN_FORGE_PROJECTS` (colon-separated paths)
2. Check `~/.planforge/projects.json` (JSON array)
3. Default to `$(pwd)` only
4. Validate each path has `.forge.json`

### M6: Scope Metadata for Slices (Phase 1 → Phase 6)
Add optional scope parsing to Phase 1 DAG parser: `### Slice 1: Title [scope: src/auth/**, tests/auth/**]`. Phase 6 conflict detection reads this. If no scope declared, assume global (blocks parallel).

### M7: Diff Viewer Graceful Empty State (Phase 5)
Phase 5 Slice 1 (Diff Viewer): if no analyze output exists, show "Run `pforge analyze` first" with a button to trigger it. Cache results in `.forge/analyze-cache.json`.

### M8: Team Lock Mechanism (Phase 6)
Specify in Phase 6 Slice 5: `.forge/phase.lock` with `{ user, timestamp, phase, process_id }`. Acquire before run, release after. Stale lock cleanup after 1 hour. Identity from `git config user.name`.

---

## Slice Recount After Fixes

| Phase | Before | After | Delta | Notes |
|-------|--------|-------|-------|-------|
| Phase 1 | 8 slices | 9 slices | +1 | Added Slice 0 (spike + execution modes), merged Slices 2+7 |
| Phase 2 | 5 slices | 4 slices | -1 | Removed Slice 1 (consolidated into Phase 1) |
| Phase 3 | 4 slices | 4 slices | 0 | Added architecture docs to existing slices |
| Phase 4 | 9 slices | 10 slices | +1 | Added REST API slice |
| Phase 5 | 6 slices | 6 slices | 0 | Added dependencies/empty states to existing slices |
| Phase 6 | 6 slices | 6 slices | 0 | Simplified (Phase 1 DAG handles core) |
| **Total** | **38** | **39** | **+1** | |

---

## Apply These Fixes

Next session: update each plan file with the fixes above, then re-run the architecture review to confirm all issues resolved.
