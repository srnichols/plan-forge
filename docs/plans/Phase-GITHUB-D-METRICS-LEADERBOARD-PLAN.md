# Phase GITHUB-D: Copilot Metrics API Ingestion + Unified Leaderboard

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (new ingestion module + dashboard tab) + Tests + Docs (Section 6 of the GitHub-stack chapter)
> **Estimated cost**: $2.00–$4.00 (8 slices, mostly small modules with HTTP mocks; no real Metrics API calls in tests)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship
> **Depends on**: Phase GITHUB-A (introspection + chapter scaffold)
> **Independent of**: Phase GITHUB-B (Coding Agent dispatch). Can run in parallel or before B.

---

## Feature Specification

### Problem Statement

The Plan-Forge dashboard already aggregates per-run, per-model, per-slice metrics from `forge_cost_report` and the trajectory store. GitHub's Copilot Metrics API (Public Preview, Oct 2025) exposes the **other half**: AI-assisted PR rate, acceptance rate, code review usage, suggestion-acceptance broken down by language and editor.

Today these two data sources don't meet anywhere. A user asking "what % of our PRs were AI-assisted last week, and what did that cost in Plan-Forge orchestration?" has to query two systems and reconcile by hand. This is exactly the gap the "Eval Frameworks (TBD)" line in many enterprise readouts identifies — the operational-metrics half is solved by GitHub's API, the semantic-eval half is solved by Plan-Forge tempering, and there's no unified surface.

This phase fills the gap: a one-command ingestion of the Copilot Metrics API into Plan-Forge's local store, a new dashboard tab that merges the two data planes, and a Section 6 in the GitHub-stack chapter that documents how to wire it up.

The work is **strictly opt-in and additive**:
- New `pforge github metrics` subcommand that uses the existing `gh` CLI for auth (no new secret-management).
- New dashboard tab registered alongside existing tabs (no existing tab changed).
- Tests use HTTP mocks (no real Copilot Metrics API calls).

### User Scenarios

**Scenario 1: Pull last 30 days of metrics into the local store**
1. User has `gh auth status` showing a token with `copilot:read` scope on their org.
2. They run: `pforge github metrics pull --org <org-name>`
3. Plan-Forge calls `GET /orgs/<org>/copilot/metrics?since=<30d-ago>` via the user's `gh` auth, normalizes the response, and writes to `.forge/github-metrics/<org>/<YYYY-MM-DD>.jsonl`.
4. Output: "Pulled 30 days, 1,247 events for org <name>. Latest: <ISO timestamp>."
5. Outcome: dashboard's new tab now shows live Copilot adoption alongside Plan-Forge orchestration cost.

**Scenario 2: View the unified leaderboard in the dashboard**
1. User opens the dashboard.
2. New "GitHub × Plan-Forge" tab shows three panels:
   - **Adoption** — sparkline of AI-assisted PR rate, acceptance rate, code review usage (from Metrics API).
   - **Orchestration** — sparkline of plan runs, total slices, $ spent (from forge_cost_report).
   - **Per-team** — table joining the two: team name | AI-assisted PRs | Plan-Forge runs | total spend | drift score.
3. Outcome: a single screen answers the executive question "are we getting value from our AI investment?" with both inputs (Copilot adoption) and outputs (Plan-Forge orchestration).

**Scenario 3: Pull on a schedule via GitHub Actions**
1. User adds a workflow: `pforge github metrics pull --org <org> --since 1d` runs daily at 03:00 UTC.
2. Workflow commits the resulting JSONL to a metrics branch (or pushes to S3 — left to the user).
3. Outcome: long-term metrics history independent of any single dev workstation.

**Scenario 4: User without `copilot:read` scope**
1. `gh api /orgs/<org>/copilot/metrics` returns 403.
2. `pforge github metrics pull` exits 1 with: "Token lacks `copilot:read` scope. Run `gh auth refresh -s copilot:read --hostname github.com`."
3. Outcome: clear error, fixable hint, no silent failure.

### Acceptance Criteria

#### Metrics ingestion (Slices 1–4)

- [ ] **MUST**: New file `pforge-mcp/github-metrics.mjs` exports:
  - `pullMetrics({ org, since, until?, ghCmd? })` — calls the Copilot Metrics API via `gh api`, normalizes the response, returns an array of normalized records.
  - `writeMetrics(records, { storeDir })` — writes to `.forge/github-metrics/<org>/<YYYY-MM-DD>.jsonl`, one record per line, idempotent (skips existing dates).
  - `loadMetrics({ storeDir, org, since, until })` — reads from disk, returns merged time series.
- [ ] **MUST**: `pforge github metrics pull --org <name> [--since <iso|Nd>] [--until <iso>] [--store <dir>]` subcommand on both `pforge.ps1` and `pforge.sh`.
  - `--since 30d` shorthand parsed as "30 days ago" (default 30d if omitted).
  - `--store` defaults to `.forge/github-metrics/`.
  - Exit 0 on success with summary; exit 1 on auth failure with hint; exit 2 on bad args.
- [ ] **MUST**: Pre-flight: call `inspectGithubStack(cwd)` and require `gh-cli` to pass. On fail, exit 1 with the diagnostic message.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/github-metrics.test.mjs` covers:
  - Successful pull (mocked `gh api` responses) → records normalized correctly
  - 403 response → clear error with `copilot:read` hint
  - Empty response (org has no Copilot data yet) → exit 0 with informational message
  - Idempotent writes — re-running the same window does not duplicate records
  - `loadMetrics` returns merged + sorted time series across multiple JSONL files
- [ ] **MUST**: A mock `gh` helper (reused from Phase B if available, otherwise new) provides scripted JSON responses for `gh api /orgs/.../copilot/metrics`.

#### Unified leaderboard tab (Slices 5–7)

- [ ] **MUST**: New dashboard tab "GitHub × Plan-Forge" registered in the existing tab structure. No existing tab changed.
- [ ] **MUST**: New REST endpoint `GET /api/github-metrics?org=<n>&since=<iso>&until=<iso>` returns the loaded metrics + a join with cost-service data on `team` (org or repo, depending on what's available).
- [ ] **MUST**: Tab renders three panels:
  1. **Adoption sparklines** — AI-assisted PR rate, acceptance rate, code review usage (last 30d).
  2. **Orchestration sparklines** — runs/day, slices/day, $/day from `forge_cost_report`.
  3. **Per-team table** — sortable, filterable, with team | adopted PRs | runs | $ spent.
- [ ] **MUST**: Empty-state UX — when no metrics have been pulled yet, panel shows "Run `pforge github metrics pull --org <name>` to populate" with a copy-button.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/github-metrics-dashboard.test.mjs` covers:
  - Endpoint returns 200 with merged data when JSONL store has data
  - Endpoint returns 200 with empty arrays when store is empty (not 404)
  - Tab DOM renders all three panels (Playwright smoke test if existing dashboard tests use Playwright; otherwise jsdom)

#### Documentation (Slice 8)

- [ ] **MUST**: Section 6 ("Metrics API + Plan-Forge unified leaderboard") of the GitHub-stack chapter is fleshed out: required token scope, command syntax, JSONL schema reference, dashboard screenshot, scheduled-pull example workflow.
- [ ] **MUST**: The "Coming next" callout for Section 6 is removed; Sections 5 / 7 / 8 callouts remain (those land in C and other phases).
- [ ] **MUST**: CHANGELOG entry under [Unreleased] → moved to a new VERSION heading. VERSION bumped.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User runs `pull` for the same window twice | Second run is a no-op (skipped messages logged); store unchanged. |
| `--since 30d` and `--until` overlap an existing window | New records merged; duplicates de-duped by `event_id` or `(org, day, metric)` key. |
| Org has Copilot Enterprise but no per-team data | Top-level org metrics still returned; per-team panel shows "no per-team data available". |
| User passes `--org` they don't have access to | 404 from API → exit 1 with "Org not found or access denied". |
| Metrics API rate-limit (5000/hr) hit | Exit 1 with `--retry-after <seconds>` printed. Calling code does not auto-retry. |
| Dashboard server can't read store dir | Endpoint returns 500 with file-system error in `_meta.error`; tab shows error banner. |

### Out of Scope

- Real-time streaming of metrics (Phase D pulls on demand or on schedule).
- Pulling metrics for repos outside the user's org (Copilot Metrics API limitation).
- Replacing `gh` auth with a custom secret store (we reuse `gh` to avoid duplicating secret management).
- A migration / backfill script for orgs that enabled Copilot before the API existed.
- Integration with Snowflake / BigQuery — JSONL is the only storage format.
- Per-user (developer-level) metrics — privacy concern; org/team only.

### Open Questions

1. **JSONL schema lock-in?** Recommend version it: `{ schema: "1.0", ... }` first line of each file. Hardener decides format.
2. **Should the dashboard tab live under "Forge" group or its own "GitHub" group?** Recommend new "GitHub" group to make it discoverable; dashboard tab grid already supports groups.
3. **Should `forge_github_metrics` MCP tool be added?** Useful for in-IDE chats querying adoption. Recommend yes if Slice 4 has budget.
4. **Cache TTL for the dashboard endpoint?** Recommend 60s — metrics don't change minute-to-minute and dashboard polls.
5. **Per-team join key — repo or team?** Copilot Metrics API exposes `team_slug` when team filter is set. Recommend repo as primary, team as optional refinement.

### Complexity Estimate

- **Estimated effort**: Medium (8 slices, mostly small modules)
- **Estimated files**: ~12 (2 new modules, 3 new test files, 1 new dashboard tab + small render hint, 2 CLI dispatcher updates, 1 chapter expand, 1 CHANGELOG/VERSION)
- **Recommended pipeline**: **Standard pipeline** — Steps 0–6.

---

## Scope Contract

### Inputs

- Phase GITHUB-A artifacts: `inspectGithubStack`, the manual chapter scaffold
- Existing CLI dispatchers: [pforge.ps1](../../pforge.ps1), [pforge.sh](../../pforge.sh)
- Existing dashboard tab structure: `pforge-mcp/dashboard/`
- Existing cost-service data: `pforge-mcp/cost-service.mjs` (`getCostReport`)
- Existing trajectory store: `.forge/runs/`
- GitHub Copilot Metrics API documentation (referenced in Hardener notes)
- New chapter from Phase A: [docs/manual/plan-forge-on-the-github-stack.html](../manual/plan-forge-on-the-github-stack.html)

### Outputs

**New files** (~7):
- `pforge-mcp/github-metrics.mjs` — pull / write / load module
- `pforge-mcp/tests/github-metrics.test.mjs`
- `pforge-mcp/tests/github-metrics-dashboard.test.mjs`
- `pforge-mcp/dashboard/github-metrics-tab.mjs` — tab render hint
- `pforge-mcp/tests/fixtures/github-metrics/sample-30d.json`
- `pforge-mcp/tests/fixtures/github-metrics/empty-org.json`
- `pforge-mcp/tests/fixtures/github-metrics/auth-failure.json`

**Modified files** (~7):
- `pforge.ps1` + `pforge.sh` — add `github metrics pull` subcommand under existing `github` dispatch
- `pforge-mcp/server.mjs` — register new REST endpoint + (optional) `forge_github_metrics` MCP tool
- `pforge-mcp/tools.json` — register the MCP tool if Slice 4 includes it
- `docs/manual/plan-forge-on-the-github-stack.html` — replace Section 6 callout with full content
- `pforge-mcp/package.json` + `VERSION` — bump
- `CHANGELOG.md` — add entry

### Forbidden Actions

- ❌ Making any real Copilot Metrics API call in Slices 1–7 (tests must mock `gh api`)
- ❌ Modifying any existing dashboard tab
- ❌ Adding a new secret to the secrets registry (we reuse `gh` auth)
- ❌ Storing per-developer (PII) metrics
- ❌ Modifying [pforge-mcp/github-introspect.mjs](../../pforge-mcp/github-introspect.mjs) — Phase A surface frozen
- ❌ Modifying anything Phase B touches if Phase B is concurrently in flight (coordinate via branch merge order)

---

## Slice Plan

> Memory note `plan-gate-command-rules.md` applies — single-line `bash -c "..."` for any Unix-tool gate.

### Slice 1 — github-metrics core module + tests
**Files in scope**: `pforge-mcp/github-metrics.mjs`, `pforge-mcp/tests/github-metrics.test.mjs`, `pforge-mcp/tests/fixtures/github-metrics/{sample-30d,empty-org,auth-failure}.json`
**Goal**: Implement `pullMetrics`, `writeMetrics`, `loadMetrics` with HTTP mocks. Cover all 5 listed test cases.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/github-metrics.test.mjs"
```
**Estimated cost**: $0.40

### Slice 2 — `pforge github metrics pull` CLI dispatch (PowerShell)
**Files in scope**: `pforge.ps1`
**Goal**: Extend existing `Invoke-Github` to recognise `metrics` as a sub-subcommand routing to `metrics pull`. Wire to the new module.
**Validation gate**:
```bash
bash -c "pwsh -NoProfile -File pforge.ps1 github metrics --help | grep -q pull"
```
**Estimated cost**: $0.20

### Slice 3 — `pforge github metrics pull` CLI dispatch (bash)
**Files in scope**: `pforge.sh`
**Goal**: Mirror Slice 2 in bash.
**Validation gate**:
```bash
bash pforge.sh github metrics --help | grep -q pull
```
**Estimated cost**: $0.15

### Slice 4 — Optional MCP tool: forge_github_metrics
**Files in scope**: `pforge-mcp/server.mjs`, `pforge-mcp/tools.json`
**Goal**: Register `forge_github_metrics` MCP tool wrapping `loadMetrics` (read-only). Skip if Hardener pulls scope.
**Validation gate**:
```bash
bash -c "grep -q 'forge_github_metrics' pforge-mcp/tools.json"
```
**Estimated cost**: $0.20
**Drop condition**: If Hardener review or earlier slices overrun, defer to Phase E backlog.

### Slice 5 — REST endpoint + dashboard tab module
**Files in scope**: `pforge-mcp/server.mjs` (additive endpoint), `pforge-mcp/dashboard/github-metrics-tab.mjs`
**Goal**: `GET /api/github-metrics` endpoint returns merged data. Dashboard tab module renders the three panels.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/github-metrics-dashboard.test.mjs"
```
**Estimated cost**: $0.40

### Slice 6 — Tab registration + empty-state UX
**Files in scope**: `pforge-mcp/dashboard/` (tab registry), `pforge-mcp/dashboard/github-metrics-tab.mjs`
**Goal**: Tab appears in the dashboard. Empty state shows the populate-command with copy-button.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/github-metrics-dashboard.test.mjs --grep 'tab|empty'"
```
**Estimated cost**: $0.30

### Slice 7 — Full dashboard test sweep
**Files in scope**: (verification only)
**Goal**: Run dashboard-related tests, ensure no regressions.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/dashboard-"
```
**Estimated cost**: $0.10

### Slice 8 — Chapter Section 6, VERSION bump, CHANGELOG
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Goal**: Replace Section 6 "Coming next" callout with full content. Bump VERSION (next minor after Phase B). CHANGELOG entry.
**Validation gate**:
```bash
bash -c "grep -q 'pforge github metrics pull' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'Copilot Metrics API' CHANGELOG.md"
```
**Estimated cost**: $0.30

---

## Branch Strategy

- Branch name: `feat/github-metrics-leaderboard`
- Base: `master` (or `feat/github-coding-agent-dispatch` if Phase B is in-flight and produces dashboard helpers Phase D needs — Hardener decides)
- Merge strategy: Squash merge after all 8 slices pass and Step 5 Review is clean

## Rollback Plan

- All slices are additive. New module, new endpoint, new tab, new CLI subcommand.
- No existing files lose functionality.
- JSONL store under `.forge/github-metrics/` is opt-in (created only on first `pull`).
- VERSION + CHANGELOG roll back trivially.
- No data migrations, no breaking changes — safe at any point.

---

## Open Decisions (resolve during Step 2 hardening)

1. JSONL schema versioning
2. Dashboard tab group placement (Forge vs new GitHub group)
3. Slice 4 inclusion (`forge_github_metrics` MCP tool)
4. Cache TTL for dashboard endpoint
5. Per-team join key precedence

---

## Notes for the Hardener (Step 2)

- This Phase is the **Phase D** of the GITHUB arc. Phase C (chapter content dogfood) is independent and may run before, after, or never depending on user approval.
- All `gh api` shell-outs MUST escape user-provided strings (`--org` value especially). Step 5 Review should grep for unescaped interpolation.
- Total estimated cost is $2.00–$4.00 across 8 slices.
- If Phase B and Phase D both modify `pforge-mcp/server.mjs` (Phase B for trajectory schema, Phase D for the new endpoint), Hardener must check merge order. Recommend Phase D second to inherit Phase B's server changes cleanly.
