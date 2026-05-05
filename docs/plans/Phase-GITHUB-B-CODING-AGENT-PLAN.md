# Phase GITHUB-B: Copilot Coding Agent Dispatch + SARIF → Plan Ingestion

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (new dispatch worker + new ingestion command) + Tests + Docs (Sections 3 & 4 of the GitHub-stack chapter)
> **Estimated cost**: $3.00–$6.00 (10 slices, mostly small modules with vitest mocks; no real GitHub API calls)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship
> **Depends on**: Phase GITHUB-A (introspection + chapter scaffold) — landed `d7e9cf8`

---

## Feature Specification

### Problem Statement

Phase GITHUB-A delivered the GitHub-native readiness check and the manual chapter scaffold. It identified two flagship integrations as the next step:

1. **Copilot Coding Agent dispatch** — `pforge run-plan --worker copilot-coding-agent` should create a GitHub Issue per slice, assign to `@copilot`, poll the resulting PR, and capture the trajectory back into the Plan-Forge dashboard. This is the demo that makes Plan-Forge's "GitHub-native" story tangible: an SE can show a Plan-Forge plan, dispatch it, and end up with N PRs opened by Copilot Coding Agent — every step orchestrated by Plan-Forge.

2. **SARIF → Plan ingestion** — `pforge plan-from-sarif <file>` should take a CodeQL SARIF result and generate a Plan-Forge plan with one slice per finding, severity-ordered. This makes the GHAS story end-to-end: CodeQL finds the issues, Plan-Forge plans the remediation, Copilot Coding Agent (or any worker) executes the slices, and the existing PreDeploy LiveGuard hook (`forge_secret_scan` + `forge_env_diff`) gates deployment.

Without these, the GitHub-stack chapter has Sections 1 and 2 but no Section 3 (dispatch flow) or Section 4 (GHAS chain). With them, the chapter becomes a working demo, not a description.

The work is **strictly opt-in and additive**:
- The new worker is a new entry in `worker-capabilities.json`. Existing workers are untouched.
- The new `plan-from-sarif` command is a new top-level subcommand. Existing commands are untouched.
- Tests use a mock `gh` CLI binary placed in a per-test PATH override. **No real GitHub API calls in this Phase.** Live dispatch against the real Plan-Forge repo happens in Phase GITHUB-C under explicit user control.

### User Scenarios

**Scenario 1: Run a plan via Copilot Coding Agent**
1. User has a GitHub-hosted repo with `pforge github status` reporting all-green and `gh auth status` showing a valid token.
2. They run: `pforge run-plan docs/plans/Phase-X-PLAN.md --worker copilot-coding-agent`
3. For each slice, Plan-Forge creates a GitHub Issue (title from slice header, body from slice goal + scope + gate), assigns to `@copilot`, and starts polling for the resulting PR (60s interval, 30min default ceiling).
4. The dashboard's Runs tab shows each slice's issue URL and PR URL as they materialize. The trajectory captures issue IDs, PR IDs, and the mapping back to slice IDs.
5. Outcome: a real GitHub Issues + PRs experience driven entirely from the plan file. Captured as a re-runnable trajectory.

**Scenario 2: Remediate a CodeQL scan**
1. User runs `gh code-scanning list --repo <owner>/<repo> --json` (or downloads the SARIF) and saves to `scan.sarif`.
2. They run: `pforge plan-from-sarif scan.sarif --output docs/plans/Phase-N-CODEQL-REMEDIATION-PLAN.md`
3. Plan-Forge generates a plan: one slice per finding, ordered by `securitySeverity` descending then by file path. Each slice's Files-in-scope is the SARIF location's `physicalLocation.artifactLocation.uri`. Each slice's Goal is the SARIF rule `shortDescription`.
4. Existing pipeline takes over: harden, execute, sweep, review, ship.
5. Outcome: the "CVE / Security Squad" pattern (from many enterprise readouts) becomes a plan file that any worker — Copilot Coding Agent, Claude Code, Cursor — can execute.

**Scenario 3: Dry-run / planning estimate**
1. User runs: `pforge run-plan --estimate docs/plans/Phase-X-PLAN.md --worker copilot-coding-agent`
2. Plan-Forge reports: "10 slices × Copilot Coding Agent (subscription, $0 per dispatch, ~5–15 min per PR) = ~50–150 min wall clock; $0 in API cost."
3. Outcome: user understands the time/cost tradeoff before dispatching.

**Scenario 4: User on a non-GitHub repo runs `--worker copilot-coding-agent`**
1. `pforge run-plan --worker copilot-coding-agent` runs `inspectGithubStack()` first.
2. If `github-remote` returns `na` or `warn`, exit 1 with a clear error: "copilot-coding-agent worker requires a GitHub repo. Run 'pforge github status' for diagnostics."
3. Outcome: no surprises. The worker fails fast with a fixable error.

### Acceptance Criteria

#### Coding Agent Dispatch (Slices 1–5)

- [ ] **MUST**: New file `pforge-mcp/workers/copilot-coding-agent.mjs` exports `dispatchSlice(slice, opts)` and `pollPullRequest(issueNumber, opts)`.
  - `dispatchSlice` shells out to `gh issue create` with `--assignee @copilot`, `--title` from slice, `--body` from slice goal + scope + gate text. Returns `{ issueNumber, issueUrl }`.
  - `pollPullRequest` calls `gh pr list --search "linked:<issueNumber>"` on a configurable interval (default 60s) up to a timeout (default 30min). Returns `{ prNumber, prUrl, status: "open"|"merged"|"closed" }` or `{ status: "timeout" }`.
- [ ] **MUST**: New entry `copilot-coding-agent` in `pforge-mcp/worker-capabilities.json` with: `command: "gh"`, `probe: "gh auth status"`, `costModel: "subscription"`, `concurrency: 5`, `requires: ["github-remote", "gh-cli"]` (which the orchestrator validates against `inspectGithubStack`).
- [ ] **MUST**: Orchestrator dispatch path in `pforge-mcp/orchestrator.mjs` recognises `--worker copilot-coding-agent` and routes to the new module instead of spawning a CLI worker subprocess. Routing is additive — existing workers untouched.
- [ ] **MUST**: Trajectory schema gains optional `github` block per slice: `{ issueNumber, issueUrl, prNumber?, prUrl?, prStatus? }`. Captured at dispatch and again after polling completes.
- [ ] **MUST**: Pre-flight check inside `pforge run-plan --worker copilot-coding-agent`: call `inspectGithubStack(cwd)` and require `github-remote` and `gh-cli` to pass. On fail, exit 1 with the diagnostic message.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/copilot-coding-agent.test.mjs` covers dispatchSlice and pollPullRequest using a **mock `gh` CLI** — a small Node script in tmpdir that gets prepended to PATH and emits scripted JSON responses for `gh issue create`, `gh pr list`, `gh auth status`. ≥ 90% line coverage.
- [ ] **MUST**: An integration test in `pforge-mcp/tests/run-plan-copilot-dispatch.test.mjs` runs a 2-slice fixture plan end-to-end with the mock `gh`, asserts both issues created, both PRs polled, trajectory contains the github block.
- [ ] **MUST**: `pforge run-plan --worker copilot-coding-agent --dry-run` works without `gh` being installed — it prints the issue body that would be created for each slice.
- [ ] **SHOULD**: `pforge run-plan --estimate --worker copilot-coding-agent` adds a "wall clock" estimate (slices × per-PR-budget) and reports `$0` API cost (subscription).
- [ ] **SHOULD**: Dashboard's Runs tab renders the per-slice github block (issue URL + PR URL as clickable links) when present in the trajectory.

#### SARIF → Plan Ingestion (Slices 6–9)

- [ ] **MUST**: New file `pforge-mcp/sarif-to-plan.mjs` exports `sarifToPlan(sarifJson, opts)` returning a Plan-Forge plan markdown string.
- [ ] **MUST**: New CLI command `pforge plan-from-sarif <sarif-file> [--output <plan-file>]`. Default output: `docs/plans/Phase-SARIF-<timestamp>-PLAN.md`. Both `pforge.ps1` and `pforge.sh` dispatch to it.
- [ ] **MUST**: Plan generation rules:
  1. One slice per SARIF `result`.
  2. Slices ordered by `securitySeverity` descending (critical → high → medium → low), tie-broken by file path.
  3. Each slice's title: `Slice N — [<rule.id>] <result.message.text>`.
  4. Each slice's Files-in-scope: `result.locations[*].physicalLocation.artifactLocation.uri` (deduplicated).
  5. Each slice's Goal: `rule.shortDescription.text` + " — see " + first location's region.
  6. Each slice's Gate: a regression-guard placeholder (`echo "TODO: add validation gate for ${rule.id}"`) — Hardener fills in real gates per rule type during Step 2.
  7. Plan header includes severity histogram and source SARIF file path.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/sarif-to-plan.test.mjs` covers:
  - Empty SARIF → exit code 1, "no findings" message
  - Single-finding SARIF → 1-slice plan, severity in header
  - Multi-finding SARIF with mixed severity → ordering verified
  - SARIF with no `securitySeverity` → falls back to `level` (error/warning/note)
  - Malformed SARIF JSON → exit code 2 with parse error message
- [ ] **MUST**: Three sample SARIF fixtures committed to `pforge-mcp/tests/fixtures/sarif/` (built programmatically in test setup OR as small JSON files — these don't have `.git/` problems).
- [ ] **MUST**: Generated plans pass `parsePlan` without errors (verified by a test that round-trips fixture → plan → parse).
- [ ] **SHOULD**: Generated plan includes a "Source: <sarif-path>" line and a "Generated: <iso-timestamp>" line in the front-matter section.

#### Documentation (Slice 10)

- [ ] **MUST**: Section 3 ("Dispatching to Copilot Coding Agent") of `docs/manual/plan-forge-on-the-github-stack.html` is fleshed out: pre-requisites, command syntax, what gets created, how trajectories capture issue/PR mapping, screenshot of the dashboard's github block.
- [ ] **MUST**: Section 4 ("GHAS-driven remediation") is fleshed out: SARIF download → `pforge plan-from-sarif` → Hardener → run-plan → PreDeploy LiveGuard hook chain. Include a worked example with a 3-finding fixture.
- [ ] **MUST**: The "Coming next" callouts for Sections 3 and 4 are removed from the chapter; the Sections 5–8 callouts remain.
- [ ] **MUST**: CHANGELOG entry under [Unreleased] → moved to a new `[2.86.0]` heading on Slice 10. VERSION bumped.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| `gh` CLI returns non-zero on `issue create` | Capture stderr, fail the slice with the gh error, do not invoke pollPullRequest. Other slices in the plan continue or abort per existing run-plan policy. |
| Copilot Coding Agent never opens a PR within timeout | `pollPullRequest` returns `{ status: "timeout" }`. Slice marked failed in trajectory with detail "Copilot did not open a PR within 30 min". |
| Copilot opens a PR but it's draft / never marked ready | Polling treats `draft: true` as not-yet-complete. After timeout, returns timeout. |
| User has `gh` installed but not authenticated | Pre-flight check via `gh auth status` fails. Exit 1 with hint: "Run `gh auth login` first." |
| SARIF file path doesn't exist | Exit 2 with "SARIF file not found: <path>". |
| SARIF has 100+ findings | Generated plan is large but parseable. Hardener will warn about size during Step 2. |
| SARIF result has no location | Slice Files-in-scope = ["(no location in SARIF)"]; flagged for Hardener attention. |
| User runs `--worker copilot-coding-agent` against a private repo without GHAS | Works fine — `gh issue create` doesn't require GHAS. Only the dispatch + poll flow runs. |
| Two slices reference the same file | Allowed by Plan-Forge today; Coding Agent will open two separate PRs. May conflict at merge time — out of scope for Phase B. |

### Out of Scope

- **Phase GITHUB-C work** (deferred): writing the chapter dogfooded by dispatching to real Copilot Coding Agent against the live Plan-Forge repo.
- **Phase GITHUB-D work** (deferred): Metrics API ingestion, unified leaderboard.
- Auto-merging PRs Copilot opens (always requires human review per existing pipeline).
- GHAS Security Campaigns workflow integration (a `MAY` for a future phase).
- SARIF formats other than CodeQL output (Snyk, Semgrep, etc. — Hardener may add adapters in Step 2).
- Automated SARIF download from the GitHub API (user runs `gh code-scanning list` themselves).
- Concurrent PR polling across slices — Phase B polls sequentially; concurrency is a Phase D-or-later feature.

### Open Questions

1. **Issue body template — single canonical or per-stack?** Recommend single canonical with a "## Context" section pulling from copilot-instructions.md. Hardener decides.
2. **PR detection: search by `linked:<issueNumber>` or by branch name pattern?** `linked:` is more reliable but requires the issue to be linked. Recommend search first, fall back to branch pattern `copilot/issue-<n>`.
3. **Should `plan-from-sarif` also accept SARIF from stdin?** Recommend yes — `gh code-scanning list ... --json | pforge plan-from-sarif -`. Trivial to add.
4. **Trajectory schema bump: backward compatible?** New `github` block is optional, so yes — but worth a note in CHANGELOG.
5. **Section 3 + 4 docs in same slice as code, or separate slice?** Plan currently has Slice 10 as docs-only. Hardener may split into 10a/10b.

### Complexity Estimate

- **Estimated effort**: Medium-large (10 slices, mostly small modules, all tests use mocks)
- **Estimated files**: ~14 (3 new modules, 3 new test files, 3 SARIF fixtures, 2 CLI dispatcher updates, 1 worker-capabilities.json update, 1 chapter expand, 1 CHANGELOG/VERSION)
- **Recommended pipeline**: **Standard pipeline** — Steps 0–6. Step 5 Review should specifically audit the `gh` CLI shell-out paths for command-injection (slice titles → `--title` arg).

---

## Scope Contract

### Inputs

- Phase GITHUB-A artifacts: [pforge-mcp/github-introspect.mjs](../../pforge-mcp/github-introspect.mjs), the manual chapter scaffold, the audience tiles
- Existing orchestrator worker dispatch: [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) (`spawnWorker`, `detectWorkers`)
- Existing worker registry: [pforge-mcp/worker-capabilities.json](../../pforge-mcp/worker-capabilities.json)
- Existing CLI dispatchers: [pforge.ps1](../../pforge.ps1), [pforge.sh](../../pforge.sh)
- Existing trajectory writer: `pforge-mcp/orchestrator.mjs` `appendTrajectory(...)` (or equivalent)
- New chapter: [docs/manual/plan-forge-on-the-github-stack.html](../manual/plan-forge-on-the-github-stack.html)
- SARIF v2.1.0 spec (used implicitly via fixture-driven testing)

### Outputs

**New files** (~7):
- `pforge-mcp/workers/copilot-coding-agent.mjs` — dispatch + poll module
- `pforge-mcp/sarif-to-plan.mjs` — SARIF parser + plan generator
- `pforge-mcp/tests/copilot-coding-agent.test.mjs` — vitest with mock `gh` CLI
- `pforge-mcp/tests/run-plan-copilot-dispatch.test.mjs` — integration test
- `pforge-mcp/tests/sarif-to-plan.test.mjs` — vitest with SARIF fixtures
- `pforge-mcp/tests/fixtures/sarif/empty.sarif.json`
- `pforge-mcp/tests/fixtures/sarif/single-high.sarif.json`
- `pforge-mcp/tests/fixtures/sarif/multi-mixed.sarif.json`

**Modified files** (~7):
- `pforge-mcp/orchestrator.mjs` — recognise `copilot-coding-agent` worker name; route to new module; pre-flight via `inspectGithubStack`
- `pforge-mcp/worker-capabilities.json` — register the new worker
- `pforge.ps1` + `pforge.sh` — add `plan-from-sarif` subcommand
- `docs/manual/plan-forge-on-the-github-stack.html` — replace Section 3 + 4 callouts with full content
- `pforge-mcp/package.json` + `VERSION` — bump to `2.86.0`
- `CHANGELOG.md` — add entry

### Forbidden Actions

- ❌ Making any real `gh` API call in Slices 1–9 (tests must mock `gh` via PATH override)
- ❌ Modifying any existing worker definition or worker dispatch path beyond adding the new worker
- ❌ Modifying [pforge-mcp/github-introspect.mjs](../../pforge-mcp/github-introspect.mjs) — Phase A surface is frozen
- ❌ Touching the `stack-notes.html` appendix (different concept — see Phase A plan)
- ❌ Changing the existing `pforge run-plan` CLI surface for non-Copilot workers
- ❌ Auto-merging PRs even in test scenarios
- ❌ Adding any non-mocked external dependency (no real GitHub API library — pure shell-out to `gh` for safety + isolation)

---

## Slice Plan

> **Note for Hardener**: Memory note `plan-gate-command-rules.md` applies — write gate commands as plain `node ...` / `pwsh ...` / `npx ...` / `grep ...` invocations; the orchestrator auto-routes Unix tools through Git Bash on Windows. **DO NOT** wrap commands in `bash -c "..."` yourself — that bypasses auto-routing and resolves to WSL bash on Windows, which has no Windows `node`/`npx` on PATH (lesson learned from this Phase's first run, postmortem 2026-05-05). Memory note `test-fixtures-git-restrictions.md` applies — SARIF fixtures use `.json` extensions (no `.git/` paths so they're safe to commit, unlike the github-introspect fixtures which had to be programmatic).

### Slice 1 — copilot-coding-agent module + mock-gh harness
**Files in scope**: `pforge-mcp/workers/copilot-coding-agent.mjs`, `pforge-mcp/tests/copilot-coding-agent.test.mjs`, `pforge-mcp/tests/helpers/mock-gh.mjs`
**Goal**: Implement `dispatchSlice` and `pollPullRequest`. Build a mock-gh helper that creates a tmpdir-based `gh` script, exports it via PATH override, returns scripted responses. Vitest covers happy path + 5 edge cases.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/copilot-coding-agent.test.mjs
```
**Estimated cost**: $0.50

### Slice 2 — Worker registry entry
**Files in scope**: `pforge-mcp/worker-capabilities.json`
**Goal**: Add `copilot-coding-agent` entry with command/probe/costModel/concurrency/requires fields.
**Validation gate**:
```bash
node -e "const w=require('./pforge-mcp/worker-capabilities.json'); if(!w.workers || !w.workers['copilot-coding-agent']) { console.error('missing worker entry'); process.exit(1) } else { console.log('ok') }"
```
**Estimated cost**: $0.10

### Slice 3 — Orchestrator pre-flight + dispatch routing
**Files in scope**: `pforge-mcp/orchestrator.mjs` (additive only), `pforge-mcp/tests/run-plan-copilot-dispatch.test.mjs`
**Goal**: When `--worker copilot-coding-agent` is selected, run `inspectGithubStack` pre-flight and route slice execution to the new module. Integration test runs a 2-slice fixture plan end-to-end.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/run-plan-copilot-dispatch.test.mjs
```
**Estimated cost**: $0.60

### Slice 4 — Trajectory schema + dashboard render hint
**Files in scope**: `pforge-mcp/orchestrator.mjs` (trajectory append), `pforge-mcp/dashboard/` (1 small render hint file)
**Goal**: Capture github block in trajectory at dispatch and after polling. Dashboard's Runs tab renders issue/PR URLs when present.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/run-plan-copilot-dispatch.test.mjs -t trajectory
```
**Estimated cost**: $0.30

### Slice 5 — `--dry-run` and `--estimate` polish
**Files in scope**: `pforge-mcp/orchestrator.mjs` (estimate path), `pforge-mcp/cost-service.mjs` (subscription mode for new worker)
**Goal**: `--dry-run` prints issue bodies. `--estimate` prints wall-clock + $0 cost.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/copilot-coding-agent.test.mjs -t estimate
```
**Estimated cost**: $0.20

### Slice 6 — sarif-to-plan core module
**Files in scope**: `pforge-mcp/sarif-to-plan.mjs`, `pforge-mcp/tests/sarif-to-plan.test.mjs`, `pforge-mcp/tests/fixtures/sarif/{empty,single-high,multi-mixed}.sarif.json`
**Goal**: Parse SARIF, generate plan markdown, sort by severity, dedupe locations. Vitest covers all 5 listed cases.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/sarif-to-plan.test.mjs
```
**Estimated cost**: $0.50

### Slice 7 — `pforge plan-from-sarif` CLI dispatch
**Files in scope**: `pforge.ps1`, `pforge.sh`
**Goal**: Add `plan-from-sarif` subcommand to both dispatchers; route to `node pforge-mcp/sarif-to-plan.mjs`. Support stdin via `-` arg.
**Validation gate**:
```bash
node -e "const cp=require('child_process'); const out=cp.execFileSync('node',['pforge-mcp/sarif-to-plan.mjs','pforge-mcp/tests/fixtures/sarif/multi-mixed.sarif.json'],{encoding:'utf8'}); if(!/^###?\s+Slice/m.test(out)){console.error('no Slice headers in output');process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.20

### Slice 8 — Plan round-trip test
**Files in scope**: `pforge-mcp/tests/sarif-to-plan-roundtrip.test.mjs`
**Goal**: Generate a plan from each fixture, run through `parsePlan`, assert no errors and slice count matches finding count.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/sarif-to-plan-roundtrip.test.mjs
```
**Estimated cost**: $0.20

### Slice 9 — Full test sweep + lint
**Files in scope**: (none — verification only)
**Goal**: Run full pforge-mcp vitest suite, ensure no regressions.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run
```
**Estimated cost**: $0.10

### Slice 10 — Chapter Sections 3 + 4, VERSION bump, CHANGELOG
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Goal**: Replace the Section 3 + 4 "Coming next" callouts with full content (worked examples, screenshots if available). Bump VERSION 2.85.0 → 2.86.0. CHANGELOG entry.
**Validation gate**:
```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8'); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const v=fs.readFileSync('VERSION','utf8').trim(); const checks={section3:/pforge run-plan --worker copilot-coding-agent/.test(html), section4:/pforge plan-from-sarif/.test(html), version:v==='2.86.0', changelog:/Copilot Coding Agent dispatch/i.test(cl)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.40

---

## Branch Strategy

- Branch name: `feat/github-coding-agent-dispatch`
- Base: `master`
- Merge strategy: Squash merge after all 10 slices pass and Step 5 Review is clean

## Rollback Plan

- All slices are additive. Rollback via `git revert <merge-commit>`.
- New worker is opt-in (`--worker copilot-coding-agent` must be explicitly passed); existing workers unaffected.
- New CLI subcommand is purely additive.
- New SARIF fixtures live in `tests/fixtures/sarif/` (no `.git/` problems).
- Trajectory schema change is backward compatible (`github` block optional).
- VERSION + CHANGELOG roll back trivially.
- No data migrations, no breaking CLI changes — safe at any point.

---

## Open Decisions (resolve during Step 2 hardening)

1. Issue body template (canonical vs per-stack)
2. PR detection (linked-issue search vs branch pattern, fallback order)
3. SARIF stdin support
4. Trajectory schema CHANGELOG note placement
5. Slice 10 split into 10a (docs) / 10b (release) — Hardener calls

---

## Notes for the Hardener (Step 2)

- This Phase is the **Phase B** of the GITHUB arc. Phase C (chapter content dogfooded by real Copilot Coding Agent dispatch against the live repo) is intentionally deferred and requires user approval per dispatch run.
- All `gh` shell-outs in production code MUST escape user-provided strings (slice titles especially). Step 5 Review should grep for `execSync.*\\\$\{` patterns in the new module.
- The mock-gh helper pattern is reusable for future GitHub-API tests — consider extracting to `tests/helpers/mock-gh.mjs` if Slice 1 hasn't already.
- Existing test count: 450. Phase B adds ~25–35 tests. Final count target: 475–485.
- All gates use direct `node ...` / `npx ...` / `pwsh ...` invocations (NOT wrapped in `bash -c`). The orchestrator's auto-routing handles cross-platform dispatch. See `plan-gate-command-rules.md` for the trap.
- Total estimated cost is $3.00–$6.00 across 10 slices. Re-run `forge_estimate_quorum` if a flagship model is selected.
