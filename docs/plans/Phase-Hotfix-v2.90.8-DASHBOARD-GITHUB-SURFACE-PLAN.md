# Hotfix v2.90.8 — Dashboard Surface for the GitHub-Stack Work + Finish v2.90.1 Watchdog Wiring

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (orchestrator watchdog wiring + dashboard render layer) + Tests + Docs
> **Estimated cost**: $0.15–$0.30 (6 slices, mostly small dashboard render edits + the missing watchdog wiring)
> **VERSION target**: 2.90.7 → 2.90.8 (patch)
> **Depends on**: All prior 2.90.x hotfixes

---

## Pre-flight finding

While drafting this hotfix, an audit of `pforge-mcp/orchestrator.mjs` revealed that **v2.90.1 only shipped the resolver helper** (`DEFAULT_WORKER_OUTPUT_IDLE_MS` constant + `resolveWorkerOutputIdleMs()` env reader + 8 helper tests), NOT the actual watchdog wiring inside `spawnWorker` AND not the `slice-output-stalled` event emission. The 8 vitest cases test the helper in isolation; nothing actually kills a stalled subprocess yet.

This is a real gap caught by the next dogfood (writing this plan, surfacing it before any user reports a stall). Slice 2a of this hotfix closes it before Slice 2 builds the dashboard renderer that consumes the event.

---

## Feature Specification

### Problem Statement

The Phase GITHUB-A → D phases and the v2.90.1 → 2.90.6 hotfix series shipped real CLI + orchestrator + REST capability for the GitHub stack, but the dashboard surface did not keep pace:

- **Phase B** (Coding Agent dispatch) emits `copilotDispatchData = { issueNumber, issueUrl, prNumber, prUrl, prStatus, renderHint }` per slice and the dashboard already shows the `renderHint` string (`🤖 Issue #N → PR #M (status)`) — but it's plain text, not clickable.
- **Phase A** (`pforge github status` introspection) is CLI-only. No dashboard widget mirrors the 8 GitHub primitives' readiness state, even though the GH Metrics tab is the natural home.
- **Hotfix v2.90.1** (output watchdog) emits `slice-output-stalled { sliceId, sliceTitle, stallDurationMs, lastBytesAtIso }` events but the dashboard renders the failed slice with a generic ✗ — no diagnostic that tells the user "stalled at 8m of silence".
- **Hotfix v2.90.4** (Copilot Coding Agent assignable probe) is CLI-only. The most painful enablement-gap surfaced by the dogfood has no dashboard signal.

The fix is **strictly additive dashboard rendering** — every backend signal already exists. No new orchestrator state, no new events, no schema bumps. We are reading data the dashboard already receives or can fetch.

### User Scenarios

**Scenario 1: Operator dispatches a slice via Copilot Coding Agent**
1. `pforge run-plan plan.md --worker copilot-coding-agent` runs.
2. Slice card on dashboard now shows: `🤖` icon, the slice title, and **two clickable badges** below it: `Issue #150` (links to github.com/.../issues/150) and `PR pending` or `PR #M open|merged` (links when present).
3. One click takes the operator to the live GitHub artifact. No copying URLs from logs.

**Scenario 2: Operator's slice silently stalls**
1. Worker subprocess produces no output for 8 min.
2. Watchdog fires; `slice-output-stalled` event emits.
3. Slice card now shows a **yellow `⏱ stalled 8m 0s`** pill alongside the failed indicator.
4. Operator immediately knows it was a stall (not a content failure) and can adjust `PFORGE_WORKER_OUTPUT_IDLE_MS` if the workload legitimately needs more silence.

**Scenario 3: Operator opens GH Metrics tab**
1. Tab now has a new **"GitHub Stack Readiness"** section at the top, above the three existing panels.
2. Section shows the 8 `inspectGithubStack` checks with ✓/⚠/✗/⊘ glyphs and detail text — same data as `pforge github status`.
3. When `--gh-token`-backed checks are available (configured in `.forge/secrets.json`), the **`copilot-coding-agent-assignable`** probe row is shown and any `warn` is highlighted with the fix-hint inline.
4. Operator no longer needs to drop to the CLI to check GitHub-side enablement state.

**Scenario 4: A reader of Section 9 of the chapter**
1. The "Built with Plan-Forge" section already documents the dashboard's role.
2. Now the reader can open `localhost:3100/dashboard/#tab-github-metrics`, see the readiness widget on the right, scroll to a captured run with copilot-coding-agent slices, and click straight through to Issue #150 — no copy-paste.

### Acceptance Criteria

- [ ] **MUST**: Slice card render in `pforge-mcp/dashboard/app.js` (around line ~857, the `trajectoryHint` block) reads `s.trajectory.copilot` (or whatever the orchestrator already attaches) and emits **two clickable badges** when present: an Issue link badge and a PR link badge. Falls back to the existing one-liner string when only `renderHint` is present.
- [ ] **MUST**: Badges open in a new tab (`target="_blank" rel="noopener noreferrer"`) and use the existing dashboard pill styling for visual consistency.
- [ ] **MUST**: `pforge-mcp/dashboard/app.js` listens for the `slice-output-stalled` event (additive case in the WebSocket / event handler) and decorates the matching slice card with a yellow `⏱ stalled <Nm Ns>` pill. Pill survives subsequent re-renders until the run finishes.
- [ ] **MUST**: New module `pforge-mcp/dashboard/github-readiness-widget.mjs` exports `renderReadinessWidget(checks)` returning an HTML fragment. The 8 default checks plus the `copilot-coding-agent-assignable` row when present.
- [ ] **MUST**: New REST endpoint `GET /api/github-readiness?cwd=<dir>&gh-token=<bool>` returns the JSON output of `inspectGithubStack(cwd, { ghToken })`. The `gh-token=true` flag is opt-in; without it, the assignable probe row is `na`.
- [ ] **MUST**: GH Metrics tab template in `pforge-mcp/dashboard/index.html` (line 1744 area) gains a new `<section id="gm-readiness">` placeholder above the three existing panels.
- [ ] **MUST**: `loadGithubMetrics` (line 4042 area in `app.js`) calls `/api/github-readiness` and renders the widget into the placeholder.
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/dashboard-github-readiness.test.mjs` cover: widget renders all 8 checks, widget skips assignable probe when `gh-token=false`, widget shows assignable warn with fix-hint when `gh-token=true` and probe returns warn.
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/dashboard-copilot-dispatch-badges.test.mjs` cover: badge renders when `trajectory.copilot.issueUrl` present, falls back to `renderHint` text when absent, both badges click-through HTML is correct.
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/dashboard-stall-pill.test.mjs` cover: stall pill renders when event fires, stall duration formats correctly (Nm Ns), pill persists across re-render.
- [ ] **MUST**: Existing `pforge-mcp/tests/dashboard-*.test.mjs` (15 files) still pass — additive only, no regressions.
- [ ] **MUST**: `pforge-mcp/tests/server.test.mjs` tab count assertion stays correct (no new tab — adding a section to an existing tab).
- [ ] **MUST**: VERSION 2.90.7 → 2.90.8. CHANGELOG entry under `[2.90.8]`.
- [ ] **SHOULD**: Section 9 captured-runs table gains a v2.90.8 row when committed.
- [ ] **SHOULD**: A README-style note in the chapter Section 6 (Metrics API) mentions the new readiness widget at the top of the tab.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Slice has `renderHint` but no `copilot` block (legacy trajectory) | Fall back to text-only render (existing behavior). |
| `gh` CLI not installed | `/api/github-readiness` returns the readiness object with `gh-cli` row failing; widget renders the warning. |
| User has `--gh-token` configured but the API call fails (network) | Probe row shows `fail` with detail "could not reach GitHub API"; other 8 rows render normally. |
| Stall pill fires for a slice that has since transitioned to passed (race) | Pill is dropped on `slice-completed` event for the same slice ID. |
| Multiple `slice-output-stalled` events for the same slice | Latest stallDurationMs wins; pill text updates. |
| Dashboard server can't read the project root | `/api/github-readiness` returns 500; widget renders an error banner. |

### Out of Scope

- Adding a gate-linter findings panel (W1–W4 from v2.90.3 stay CLI-only — `pforge analyze` is the natural home).
- Real-time GitHub webhook ingestion (out of scope; we use polling via the existing trajectory store).
- Adding a separate "GitHub" top-level group to the dashboard — these surfaces all live inside existing tabs.
- Refactoring the existing `renderHint` string format (kept for backward compatibility).

---

## Scope Contract

### Inputs
- [pforge-mcp/dashboard/app.js](../../pforge-mcp/dashboard/app.js) — slice card renderer (~line 857), `loadGithubMetrics` (~line 4042), event-bus listener
- [pforge-mcp/dashboard/index.html](../../pforge-mcp/dashboard/index.html) — GH Metrics tab template (~line 1744)
- [pforge-mcp/dashboard/github-metrics-tab.mjs](../../pforge-mcp/dashboard/github-metrics-tab.mjs) — existing tab module (for shape reference)
- [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) — `copilotDispatchData` (~line 7768), `slice-output-stalled` event emitter (added in v2.90.1)
- [pforge-mcp/github-introspect.mjs](../../pforge-mcp/github-introspect.mjs) — `inspectGithubStack`
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — REST endpoint registration

### Outputs

**New files**:
- `pforge-mcp/dashboard/github-readiness-widget.mjs`
- `pforge-mcp/tests/dashboard-github-readiness.test.mjs`
- `pforge-mcp/tests/dashboard-copilot-dispatch-badges.test.mjs`
- `pforge-mcp/tests/dashboard-stall-pill.test.mjs`

**Modified files**:
- `pforge-mcp/dashboard/app.js` (additive: badges, stall pill, readiness loader)
- `pforge-mcp/dashboard/index.html` (additive: `<section id="gm-readiness">` placeholder)
- `pforge-mcp/server.mjs` (additive: `/api/github-readiness` endpoint)
- `docs/manual/plan-forge-on-the-github-stack.html` (Section 6 + Section 9 updates)
- `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Modifying `inspectGithubStack` or `copilotDispatchData` — both are stable surfaces shipped in prior phases
- ❌ Changing the existing `renderHint` string format
- ❌ Adding a new top-level dashboard tab
- ❌ Adding new orchestrator events (use what v2.90.1 already emits)
- ❌ Removing or weakening any existing dashboard test
- ❌ Bumping minor version (must stay patch per ongoing hotfix series direction)

---

## Slice Plan

> Memory note `plan-gate-command-rules.md` applies — gates are plain `npx ...` / `node -e ...`. No `bash -c`, no over-escaped regex.

### Slice 1 — Clickable Issue/PR badges in slice card
**Files in scope**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/tests/dashboard-copilot-dispatch-badges.test.mjs`
**Goal**: Replace the text-only `trajectoryHint` block with badge rendering when `s.trajectory.copilot` (or `s.trajectory` containing `issueUrl`/`prUrl`) is present. Fall back to the existing one-liner when those fields are absent. Both badges open in new tabs.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/dashboard-copilot-dispatch-badges.test.mjs
```
**Estimated cost**: $0.05

### Slice 2 — Finish v2.90.1's watchdog wiring (subprocess kill + event emission)
**Files in scope**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs`
**Goal**: Inside `spawnWorker`'s child-process branch, install an idle-timer that resets on stdout/stderr `data` events. When the timer fires: SIGKILL the subprocess, emit `slice-output-stalled { sliceId, sliceTitle, stallDurationMs, lastBytesAtIso }` via the existing event bus, and resolve `spawnWorker` with `{ exitCode: -1, stalled: true, stallDurationMs }`. Skip in `--dry-run` / `--estimate` mode. Add 4 new vitest cases to the existing test file: silent-killed, output-flows-no-kill, env-zero-disables-watchdog, event-fires-with-correct-shape.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs
```
**Estimated cost**: $0.05

### Slice 3 — `slice-output-stalled` pill in dashboard
**Files in scope**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/tests/dashboard-stall-pill.test.mjs`
**Goal**: Add an event handler for `slice-output-stalled` that records `{ sliceId, stallDurationMs }` into a dashboard-state map, and a render decorator on the matching slice card emitting a yellow `⏱ stalled <Nm Ns>` pill. Drop on `slice-completed` for the same slice.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/dashboard-stall-pill.test.mjs
```
**Estimated cost**: $0.05

### Slice 4 — Readiness widget module + REST endpoint
**Files in scope**: `pforge-mcp/dashboard/github-readiness-widget.mjs`, `pforge-mcp/server.mjs`, `pforge-mcp/tests/dashboard-github-readiness.test.mjs`
**Goal**: Build the widget renderer (8 default checks + assignable probe when present). Add `GET /api/github-readiness` endpoint to `server.mjs` that wraps `inspectGithubStack`. Test the widget with mock check arrays.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/dashboard-github-readiness.test.mjs
```
**Estimated cost**: $0.05

### Slice 5 — Wire widget into GH Metrics tab + index.html template
**Files in scope**: `pforge-mcp/dashboard/index.html`, `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/github-metrics-tab.mjs`
**Goal**: Add `<section id="gm-readiness">` placeholder to the GH Metrics tab template. Update `loadGithubMetrics` (line 4042) to call `/api/github-readiness` and render the widget into the placeholder.
**Validation gate**:
```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('pforge-mcp/dashboard/index.html','utf8'); const app=fs.readFileSync('pforge-mcp/dashboard/app.js','utf8'); const checks={placeholder:/id=\"gm-readiness\"/.test(html), loaderWired:/api\/github-readiness/.test(app)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
npx --prefix pforge-mcp vitest run pforge-mcp/tests/server.test.mjs -t "tab structure"
```
**Estimated cost**: $0.05

### Slice 6 — Docs + version + CHANGELOG
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Goal**: Add a v2.90.8 row to Section 9 captured-runs table. Add a paragraph to Section 6 mentioning the new readiness widget at the top of the tab. Update Section 9's "what we got wrong" v2.90.1 bullet to note the wiring was completed in v2.90.8. Bump VERSION 2.90.7 → 2.90.8. CHANGELOG entry.
**Validation gate**:
```bash
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const html=fs.readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8'); const checks={version:v==='2.90.8', changelog:/2\.90\.8/.test(cl) && /dashboard/i.test(cl), section9row:/2\.90\.8/.test(html), section6note:/readiness widget|Readiness widget/i.test(html)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.05
```
**Estimated cost**: $0.05

---

## Branch Strategy
- Branch: `hotfix/v2.90.8-dashboard-github-surface`
- Base: `master`
- Squash merge after Step 5 review

## Rollback Plan
- All slices are additive UI/render code. No data model changes.
- Slice 1 (badges) falls back to existing renderHint text — safe rollback.
- Slice 2 (stall pill) just listens to an event; ignoring it = no UI change.
- Slice 3+4 (readiness widget): the new section can be deleted from the tab template; the REST endpoint can be removed from `server.mjs` without affecting other tabs.
- Full rollback: `git revert <merge-commit>`.

## Notes for the Hardener
- This hotfix has zero new orchestrator behavior. It surfaces capabilities that already shipped in Phase B + Phase A + Hotfix v2.90.1 + Hotfix v2.90.4 to the dashboard.
- The `slice-output-stalled` event was specified in v2.90.1 — verify it actually fires by checking `pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs`. If the event was scoped out of v2.90.1's actual implementation, this Phase needs to add it as Slice 2a before Slice 2 can land.
- Dashboard tests use jsdom (existing pattern). The Slice 2 test is the trickiest because it needs to simulate event flow — look at `dashboard-update-banner.test.mjs` for the right pattern.
- Slice 4's tab-structure assertion: total tab count stays at 34 (no new tab; just a new section in an existing tab).
