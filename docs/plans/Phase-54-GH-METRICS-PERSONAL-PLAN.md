---
phase: 54
name: GH-METRICS-PERSONAL
status: HARDENED
lockHash: PENDING
---

# Phase 54 — GH-METRICS-PERSONAL — Make the "GitHub × Plan-Forge" tab useful for personal accounts

> **Status**: **HARDENED — cleared for `pforge run-plan`**. Step-2 harden completed inline 2026-05-19 via prompt session (same auto-approval chain as Phases 39 → 50 in the recent sweep).
> **Source**: User report 2026-05-19 — the "GH Metrics" dashboard tab is hard-wired to the GitHub Copilot Metrics API (`/orgs/{org}/copilot/metrics`), which returns 404 for personal Copilot accounts. Today the tab shows a "Run `pforge github metrics pull --org <org-name>`" empty-state that is actively misleading for non-org users.
> **Tracks**: `pforge-mcp/github-personal.mjs` (NEW), `pforge-mcp/dashboard/github-metrics-tab.mjs` (extended with personal-mode renderers), `pforge-mcp/dashboard/app.js` (mode-aware `loadGithubMetrics`), `pforge-mcp/dashboard/index.html` (existing tab section — copy + container additions only), `pforge-mcp/server.mjs` (one new REST endpoint `GET /api/github-personal`), `pforge-mcp/tests/github-personal*.test.mjs` (NEW), `pforge-mcp/tests/fixtures/github-personal/*.json` (NEW). No change to `pforge-mcp/github-metrics.mjs` — Copilot Metrics API path is preserved verbatim.
> **Estimated cost**: low. Zero LLM-cost surfaces. New surface area is ~3 functions + 1 REST endpoint + 4 dashboard render helpers, all behind mocked `gh` for tests.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute → S4 retro. **No QA/E2E slice** because the test contract (mocked-`gh` fixtures driving each renderer) is the QA — the dashboard tab can be exercised end-to-end via the REST endpoint test.
> **Recommended starting slice**: **S0** (`github-personal.mjs` module + fixtures lands first — every other slice consumes it).
> **Session budget**: 5 slices. Recommend one session — bounded surface, all-mocked dependencies, no DB or network.

---

## Concurrent-Agent Coordination

> ⚠️ **Another agent is active on `planning/main` in a different part of the tree as of 2026-05-19**.
>
> Touched files in this phase (so the other agent can carve around them):
>
> - **NEW files** (zero conflict risk): `pforge-mcp/github-personal.mjs`, `pforge-mcp/tests/github-personal.test.mjs`, `pforge-mcp/tests/github-personal-rest.test.mjs`, `pforge-mcp/tests/fixtures/github-personal/*.json`, `docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md`, `pforge-mcp/dashboard/github-personal-tab.mjs`
> - **EXTENDED files** (bounded edits only):
>   - `pforge-mcp/server.mjs` — adds ONE new endpoint `app.get("/api/github-personal", ...)` adjacent to the existing `app.get("/api/github-metrics", ...)` at approximately line 7618. ~40 line addition, single contiguous block.
>   - `pforge-mcp/dashboard/app.js` — modifies ONE function (`loadGithubMetrics`, ~40 LOC at approximately line 7117). Replaces body; no other section touched.
>   - `pforge-mcp/dashboard/index.html` — modifies the `<section id="tab-github-metrics">` block (~20 lines at approximately line 1912). Adds `<div id="gm-personal-account-card">`, `<div id="gm-personal-repo-card">`, `<div id="gm-personal-ai-card">` containers; existing `<div id="gm-readiness">`, `<div id="gm-adoption-panel">`, `<div id="gm-orchestration-panel">`, `<div id="gm-per-team-panel">` are PRESERVED (org-mode hides them via `.hidden`).
>   - `docs/plans/DEPLOYMENT-ROADMAP.md` — appends one Active row + moves it to Completed at S4. Single 3-line table touch.
>   - `CHANGELOG.md` — appends one `[Unreleased] → Added` entry. Single 2-line touch.
>
> If the other agent's plan touches any of the **EXTENDED files**, coordinate via the orchestrator's auto-rebase or pause this plan at the slice boundary. If the other agent's plan touches any of the **NEW files** path, that is a planning conflict and must be resolved before either phase ships.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] `master` is clean (the publishable branch must not carry in-flight changes)
- [ ] `planning/main` is clean of conflicting edits to: `pforge-mcp/server.mjs` (lines ~7615-7660), `pforge-mcp/dashboard/app.js` (lines ~7117-7160), `pforge-mcp/dashboard/index.html` (lines ~1912-1935), `pforge-mcp/dashboard/github-metrics-tab.mjs`
- [ ] `lockHash` (set by Step-2 harden) matches plan body at run time
- [ ] No competing in-flight plan is restructuring the `pforge-mcp/dashboard/` directory or the GitHub-related modules

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` (currently already cleared) and run `pforge run-plan docs/plans/Phase-54-GH-METRICS-PERSONAL-PLAN.md`.

---

## Why this phase exists

The current "GH Metrics" tab assumes every Plan Forge user runs a GitHub Enterprise Cloud org with Copilot Business / Enterprise and is the org admin. That is **not the bulk of personal-developer users**.

Three concrete user-facing problems today:

1. The empty-state suggests `pforge github metrics pull --org <org-name>` — for a Copilot Individual user, that command will 404 with no metrics. The hint is actively misleading.
2. The tab has no fallback content. A personal-account user sees "No metrics data available" on every load and concludes the feature is broken.
3. There is no equivalent **AI-assisted-PR signal** for personal accounts even though one exists empirically: commits made via Copilot chat / agent-mode carry the `Co-Authored-By: GitHub Copilot <copilot@github.com>` trailer; commits made via the Copilot coding agent are authored by `copilot-swe-agent[bot]`. Both are visible to `gh api repos/{owner}/{repo}/commits` for any account type.

This phase adds a **Personal Mode** that auto-engages when the user has no org slug (or the Copilot Metrics API returns 404 / 403 for the org they entered). Org Mode (the existing rendering path) is preserved verbatim — zero risk of regression for org-admin users.

---

## Scope Contract

### In Scope

**S0 — `pforge-mcp/github-personal.mjs` module + test fixtures**:
- New module file: `pforge-mcp/github-personal.mjs` exporting:
  - `fetchUserProfile({ ghCmd?, env? })` → `{ login, name, plan, publicRepos, followers, createdAt }` or throws `PersonalAuthError` on 401 / no `gh` auth
  - `fetchRepoSummary({ owner, repo, ghCmd?, env? })` → `{ owner, repo, defaultBranch, stargazers, forks, openIssues, openPulls, watchers, pushedAt, sizeKb, language }` or throws `PersonalNotFoundError` on 404
  - `scanCopilotCoauthors({ owner, repo, perPage?, ghCmd?, env? })` → `{ totalScanned, withCopilotSignal, percentage, signals: { coauthorTrailer, swrAgentAuthor, otherBotAuthor } }` — paginates up to `perPage` commits (default 100), tallies how many carry `Co-Authored-By: GitHub Copilot` in the commit message OR are authored by `copilot-swe-agent[bot]` / `github-copilot[bot]`
  - Error classes: `PersonalError`, `PersonalAuthError`, `PersonalNotFoundError`, `PersonalRateLimitError` (mirrors `github-metrics.mjs` shape so server-side error handling is uniform)
- All three functions invoke `gh api` via `spawnSync` using the EXACT pattern from `github-metrics.mjs` (Windows `cmd.exe` wrapping for DEP0190 safety — see `pullMetrics`'s `isWin` branch at `pforge-mcp/github-metrics.mjs:84-92`)
- New test fixtures (JSON files captured from real `gh api` calls and redacted of email + token + photo URLs):
  - `pforge-mcp/tests/fixtures/github-personal/user-profile.json`
  - `pforge-mcp/tests/fixtures/github-personal/repo-summary.json`
  - `pforge-mcp/tests/fixtures/github-personal/commits-with-copilot.json` (≥3 commits, ≥1 with `Co-Authored-By: GitHub Copilot`, ≥1 authored by `copilot-swe-agent[bot]`)
  - `pforge-mcp/tests/fixtures/github-personal/commits-no-copilot.json` (≥3 commits, all human-authored)
  - `pforge-mcp/tests/fixtures/github-personal/repo-not-found.json` (404 body shape)
- New test file: `pforge-mcp/tests/github-personal.test.mjs` using the existing `tests/helpers/mock-gh.mjs` helper (same harness `github-metrics.test.mjs` uses)
  - 8 tests minimum: profile happy-path, profile 401, repo happy-path, repo 404, scan returns correct percentage on mixed commits, scan returns 0% on no-copilot commits, scan handles empty repo, scan respects `perPage` cap

**S1 — `GET /api/github-personal` REST endpoint**:
- Add ONE new endpoint to `pforge-mcp/server.mjs` immediately after the existing `app.get("/api/github-metrics", ...)` handler:
  - Query params: `owner` (optional — defaults to parsing from `git remote get-url origin` of `PROJECT_DIR`), `repo` (optional — same default), `perPage` (optional, default 100, capped at 200)
  - Body shape: `{ ok: true, user: {...} | null, repo: {...} | null, copilotSignal: {...} | null, errors: { user?: string, repo?: string, copilotSignal?: string }, _meta: { ghAuthDetected, defaultsFrom: 'origin' | 'query' } }`
  - Each of `user`/`repo`/`copilotSignal` is independently fetched; one failing does NOT zero out the others (best-effort) — failures go into `errors.<key>` as a string
  - On total `gh` absence: returns 200 with all-null fields and a single `errors.user: 'gh CLI not installed or not authenticated'`
  - NEVER 500 on missing data — empty result is always 200 with structured nulls
- New test file: `pforge-mcp/tests/github-personal-rest.test.mjs` covering: full happy-path, missing `gh` auth (returns 200 + errors), bad owner/repo (returns 200 + nulls + errors), defaulting from git remote, perPage capping at 200

**S2 — Personal-mode renderers in dashboard tab module**:
- New file: `pforge-mcp/dashboard/github-personal-tab.mjs` exporting:
  - `renderAccountCard(user)` → HTML for the login + plan + repo count + follower count card
  - `renderRepoActivityCard(repo)` → HTML for stars / forks / open-issues / open-PRs / last-push card
  - `renderAiAssistCard(copilotSignal)` → HTML for the "Copilot-assisted commits: X% (Y of Z scanned)" card with sparkline-friendly breakdown
  - `renderPersonalEmptyState({ reason })` → HTML for "Sign in with `gh auth login` to populate this view" (when `gh` is missing) or "No commits in the last 100 to scan" (when repo is empty)
- Mirror the existing `pforge-mcp/dashboard/github-metrics-tab.mjs` export-to-window pattern (`window.githubPersonalRenderAccountCard = renderAccountCard` etc.) so the non-module `app.js` can consume them
- New test file: `pforge-mcp/tests/github-personal-tab.test.mjs` exercising all four renderers (happy-path + null/empty input fall-through to empty-state). Uses the same `JSDOM`-free string-assertion pattern as `tests/github-metrics-dashboard.test.mjs`

**S3 — Mode-aware tab wiring (`app.js` + `index.html`)**:
- `pforge-mcp/dashboard/index.html` — extend the `<section id="tab-github-metrics">` block (existing at line ~1912) to add three new container divs AFTER the existing `<div id="gm-per-team-panel">`:
  ```html
  <div id="gm-personal-account-card" class="mb-4 hidden"></div>
  <div id="gm-personal-repo-card" class="mb-4 hidden"></div>
  <div id="gm-personal-ai-card" class="mb-4 hidden"></div>
  ```
  Existing org-mode containers (`gm-readiness`, `gm-adoption-panel`, `gm-orchestration-panel`, `gm-per-team-panel`) are PRESERVED. Also add ONE new `<script src="github-personal-tab.mjs" type="module"></script>` immediately after the existing `<script src="github-metrics-tab.mjs" type="module"></script>` line (~2329)
- Update the subtitle paragraph (`<p class="text-xs text-gray-500">...`) to be neutral: "Copilot adoption (org mode) or your account & repo activity (personal mode)."
- `pforge-mcp/dashboard/app.js` — modify `loadGithubMetrics` (existing at line ~7117) to auto-detect mode:
  1. If `org` is provided: try the existing `/api/github-metrics` endpoint. If response's `metrics.length > 0`, render Org Mode (existing path, unchanged). Else fall through to Personal Mode.
  2. If `org` is empty OR Org Mode produced no metrics: fetch `/api/github-personal`. Render personal cards into their containers; toggle `.hidden` on the four org-mode containers and remove `.hidden` from the three personal containers.
  3. On Personal Mode active: also update the populate-command empty state copy via `window.githubPersonalRenderPersonalEmptyState` IF all of `user`, `repo`, `copilotSignal` are null
- The function MUST NOT break Org Mode for org-admin users — the diff is additive (personal branch runs when org branch yields no data)

**S4 — Retro + roadmap + CHANGELOG**:
- `docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md` — what landed vs cut, screenshot of personal-mode dashboard (manual capture, attached as base64 in retro), dogfood result on srnichols/plan-forge repo (the AI-assist scan against this repo's own commit history is the canonical proof), recommendation for follow-on phases (e.g. trend sparkline for personal-mode like org-mode has, repo selector for users with multiple active repos)
- `docs/plans/DEPLOYMENT-ROADMAP.md` — add Phase 54 to Active phases (one row) at the bottom of the Active table; at S4 move it to the Completed Phases table with `2026-05-19` ship date
- `CHANGELOG.md` — entry under `[Unreleased] → ### Added`: `Personal Mode for the GitHub × Plan-Forge dashboard tab — auto-engages when no org is configured or the Copilot Metrics API returns 404. Surfaces gh user profile, current-repo activity, and a Copilot-assisted-commit % derived from the Co-Authored-By trailer / copilot-swe-agent[bot] author. Org Mode is preserved verbatim.`

### Out of Scope

- **Any change to `pforge-mcp/github-metrics.mjs`** (the Copilot Metrics API path) — Org Mode rendering is preserved verbatim
- **Any change to the `pforge github metrics pull` CLI command** — personal mode is dashboard-only
- **Any new `forge_*` MCP tool** — personal mode reads through the existing REST surface; no new tool registrations
- **A trend sparkline for personal mode** — first release renders point-in-time cards only. Sparklines require local persistence (a JSONL store like `.forge/github-personal/<owner>__<repo>.jsonl`) which is a separate phase
- **A repo selector UI** — first release always uses the repo derived from `git remote get-url origin` of the Plan-Forge workspace. Users with multiple active repos can switch by `cd`ing or passing `?owner=X&repo=Y` to the REST endpoint directly
- **Caching of the REST endpoint** — first release hits `gh api` on every refresh. If the per-request cost becomes a problem in retro, add cache in a follow-on phase
- **Modifying `inspectGithubStack` or the readiness widget** — those keep working unchanged
- **Touching `pforge-sdk/`, `extensions/`, `pforge-master/` source** (universal carveouts)
- **Modifying `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire)

### Forbidden Actions

- **Do NOT modify `pforge-mcp/github-metrics.mjs`.** Org Mode must produce byte-identical output post-phase. The new module is `github-personal.mjs`, not an extension of `github-metrics.mjs`.
- **Do NOT modify the `/api/github-metrics` REST endpoint.** Personal mode reads through a NEW endpoint `/api/github-personal`. The existing endpoint's request/response shape is frozen.
- **Do NOT modify the existing `loadGithubMetrics` org-mode rendering path inside `app.js`.** Personal mode is additive — the function gains an `if (orgModeProducedNoData) { renderPersonal(); }` branch but the org-mode branch lines (`adoptionEl.innerHTML = ...`, `orchEl.innerHTML = ...`, `teamEl.innerHTML = ...`) are preserved unchanged.
- **Do NOT add a new MCP tool.** This phase is REST + dashboard only. Adding a `forge_*` tool requires registry updates in `capabilities.mjs` + `server.mjs` + tests, all of which are out of scope for this surface.
- **Do NOT add a new dependency (production or dev).** All HTTP calls go through the user's existing `gh` CLI auth — same pattern as `github-metrics.mjs`. No new npm packages introduced.
- **Do NOT change the existing tab name or button label.** The tab stays `data-tab="github-metrics"` and the button label stays "GH Metrics" — a personal/org subtitle change is the only copy edit. URLs and existing test-ids are preserved.
- **Do NOT bundle slices.** S0, S1, S2, S3, S4 each = one commit.
- **Do NOT leak the user's `gh` token or email.** Test fixtures must be redacted before commit (`forge_secret_scan` runs in S0's gate). The REST endpoint MUST NOT echo the raw `gh` stderr if it contains an Authorization header dump (sanitise the error message to category only: 'auth', 'not-found', 'rate-limit', 'unknown').
- **Do NOT delete or restructure the existing `pforge-mcp/dashboard/github-metrics-tab.mjs`.** Personal-mode renderers live in a SEPARATE new file `github-personal-tab.mjs` to minimise merge-conflict surface with the concurrent agent.

---

## Resolved Decisions

All decisions locked at draft time; Step-2 hardener verified against the codebase.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | New module file vs extending `github-metrics.mjs` | ✅ Resolved | New file `github-personal.mjs`. Org-mode API and personal-mode REST surface are independent — coupling them couples their failure modes and inflates the conflict surface with the concurrent agent. |
| 2 | New REST endpoint vs query-param on existing | ✅ Resolved | New endpoint `/api/github-personal`. The existing `/api/github-metrics` contract is frozen; mode-switching via query param would invalidate consumer caches and tests. |
| 3 | New dashboard tab file vs extending `github-metrics-tab.mjs` | ✅ Resolved | New file `github-personal-tab.mjs`. Same reasoning as #1 — independent renderers, independent test surface, smaller merge-conflict surface. |
| 4 | New dashboard tab button vs reusing "GH Metrics" | ✅ Resolved | Reuse the existing tab button. Two buttons for one conceptual surface ("GitHub metrics") confuses users; auto-mode-detection is the better UX. |
| 5 | Auto-detect mode vs explicit mode toggle | ✅ Resolved | Auto-detect with org-input as the trigger: empty input OR 404/403 from Org API → Personal Mode. Explicit toggle adds a control with no value — the org input box IS the toggle. |
| 6 | AI-assist heuristic for personal accounts | ✅ Resolved | Scan last 100 commits for `Co-Authored-By: GitHub Copilot <copilot@github.com>` trailer OR author login matching `copilot-swe-agent[bot]` / `github-copilot[bot]`. Empirically validated (Plan-Forge's own commit history surfaces 0 because this project uses interactive Copilot in IDE, not the coding-agent app — perfect dogfood signal). |
| 7 | Repo source for personal-mode | ✅ Resolved | Parse from `git remote get-url origin` of `PROJECT_DIR`. Users with multiple active repos use `cd` to switch. Repo-selector UI is out of scope. |
| 8 | Caching policy for `/api/github-personal` | ✅ Resolved | No cache — hit `gh api` every refresh. Latency is acceptable (<2s for the three calls). Cache lands in a follow-on phase if retro shows it's needed. |
| 9 | Error handling: 500 vs 200-with-errors | ✅ Resolved | Always 200 with `errors.{user,repo,copilotSignal}` strings on partial failure. Frontend renders an empty card per failed call rather than a global error banner. |
| 10 | `gh` absence handling | ✅ Resolved | Single error `errors.user: 'gh CLI not installed or not authenticated'` returned in the 200 body. Frontend renders the personal empty-state pointing at `gh auth login`. |
| 11 | Fixture redaction policy | ✅ Resolved | All four fixtures are derived from real `gh api` output and committed with: emails replaced by `redacted@example.com`, avatar URLs replaced with `https://example.com/avatar`, all `node_id`, `gravatar_id`, `etag`-style headers stripped. `forge_secret_scan` runs in S0 gate. |
| 12 | Tab subtitle copy | ✅ Resolved | "Copilot adoption (org mode) or your account & repo activity (personal mode)." — neutral wording that covers both modes without mode-switching on the static HTML. |
| 13 | Test framework | ✅ Resolved | Vitest, same as all existing `pforge-mcp/tests/*.test.mjs`. No new dev dependency. |
| 14 | Coordination with concurrent agent | ✅ Resolved | Touched-file list at top of plan (§ Concurrent-Agent Coordination). Re-anchor checkpoints include `git diff --stat` checks to catch incidental drift. Pull before push at each slice (orchestrator default). |
| 15 | Sparkline / trend support | ✅ Resolved | Out of scope this phase. Renderers are point-in-time only. Sparkline requires JSONL persistence + a `pull` CLI command — a separate phase. |

---

## Required Decisions

All decisions for this phase are resolved in §"Resolved Decisions" above (15 items, locked at draft time). No open TBDs blocking execution.

---

## Slice Decomposition

> All slices are tagged **[sequential]** — each consumes the artefact landed by the previous slice. No parallel group exists; the dependency chain (module → REST → renderers → wiring → retro) is strict.

### Slice 0 — `github-personal.mjs` module + test fixtures

- **Depends On**: nothing (foundation slice)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/github-metrics.mjs` (read-only — the Windows-safe `spawnSync` pattern at lines 84-92 is the template), `pforge-mcp/tests/github-metrics.test.mjs` (read-only — the `createMockGh` test harness pattern), `pforge-mcp/tests/helpers/mock-gh.mjs` (read-only — the actual mock helper), `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`
- **Traces to**: Resolved Decisions #1, #6, #11, #13
- Create `pforge-mcp/github-personal.mjs` with the three `export function` shapes specified in §"Scope Contract → S0" plus the four error classes (mirror `github-metrics.mjs` error class shape)
- Create five fixture files under `pforge-mcp/tests/fixtures/github-personal/` (paths in §"Scope Contract → S0"); fixtures must be redacted per Resolved Decision #11
- Create `pforge-mcp/tests/github-personal.test.mjs` with the 8 minimum tests listed in §"Scope Contract → S0"
- Each test MUST use `createMockGh` (no real `gh` invocation) — the test suite must pass on a machine without `gh` installed
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const required=['pforge-mcp/github-personal.mjs','pforge-mcp/tests/github-personal.test.mjs','pforge-mcp/tests/fixtures/github-personal/user-profile.json','pforge-mcp/tests/fixtures/github-personal/repo-summary.json','pforge-mcp/tests/fixtures/github-personal/commits-with-copilot.json','pforge-mcp/tests/fixtures/github-personal/commits-no-copilot.json','pforge-mcp/tests/fixtures/github-personal/repo-not-found.json'];for(const p of required){if(!fs.existsSync(p))throw new Error('missing: '+p);}const m=fs.readFileSync('pforge-mcp/github-personal.mjs','utf8');for(const sym of ['fetchUserProfile','fetchRepoSummary','scanCopilotCoauthors','PersonalError','PersonalAuthError','PersonalNotFoundError','PersonalRateLimitError']){if(!new RegExp('export\\\\s+(function|class)\\\\s+'+sym+'\\\\b').test(m))throw new Error('missing export: '+sym);}console.log('ok S0 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/github-personal.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 1 — `GET /api/github-personal` REST endpoint

- **Depends On**: S0 (the endpoint imports `fetchUserProfile`, `fetchRepoSummary`, `scanCopilotCoauthors` from S0)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (read-only — surveying the existing `/api/github-metrics` handler at lines ~7614-7649 for the template), `pforge-mcp/github-personal.mjs` (the S0-shipped module), `pforge-mcp/tests/github-metrics-dashboard.test.mjs` (read-only — the REST-test harness shape), `.github/instructions/security.instructions.md`
- **Traces to**: Resolved Decisions #2, #7, #8, #9, #10
- In `pforge-mcp/server.mjs`, add the import line for `github-personal.mjs` near the existing `loadMetrics`/`getCostReport` imports
- Add the new `app.get("/api/github-personal", ...)` handler immediately after the existing `app.get("/api/github-metrics", ...)` handler. The handler:
  1. Parses `owner`/`repo` from query string OR from `git remote get-url origin` of `PROJECT_DIR` via `execSync` (use the existing `spawnSync`-from-node pattern; do NOT shell out)
  2. Wraps each of the three module calls in `try/catch`; on catch, populates `errors.<key>` with a sanitised error message (category only — never the raw stderr)
  3. Always returns 200 with the body shape defined in §"Scope Contract → S1"
  4. Returns `_meta.defaultsFrom: 'origin'` when owner/repo came from git; `'query'` when they came from query string
- Create `pforge-mcp/tests/github-personal-rest.test.mjs` with the 5 test scenarios listed in §"Scope Contract → S1"; reuse the `beforeAll/afterAll` server-harness pattern from `tests/github-metrics-dashboard.test.mjs`
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('pforge-mcp/server.mjs','utf8');if(!s.includes(\"app.get('/api/github-personal'\")&&!s.includes('app.get(\"/api/github-personal\"'))throw new Error('endpoint not registered');if(!s.includes(\"from './github-personal.mjs'\")&&!s.includes('from \"./github-personal.mjs\"'))throw new Error('github-personal.mjs not imported');if(!fs.existsSync('pforge-mcp/tests/github-personal-rest.test.mjs'))throw new Error('REST test file missing');console.log('ok S1 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/github-personal.test.mjs tests/github-personal-rest.test.mjs tests/github-metrics.test.mjs tests/github-metrics-dashboard.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 2 — Personal-mode renderers in dashboard tab module

- **Depends On**: S1 (REST endpoint contract must be locked — renderers consume its body shape)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/dashboard/github-metrics-tab.mjs` (read-only — the export-and-window-attach pattern), `pforge-mcp/tests/github-metrics-dashboard.test.mjs` (read-only — the string-assertion renderer test pattern)
- **Traces to**: Resolved Decisions #3
- Create `pforge-mcp/dashboard/github-personal-tab.mjs` exporting the four renderers listed in §"Scope Contract → S2"
- Mirror the existing `if (typeof window !== "undefined") { window.githubPersonalRenderAccountCard = renderAccountCard; ... }` pattern at the bottom of the file
- Each renderer MUST: (a) accept a single argument that may be `null`/`undefined` without throwing, (b) return an HTML string (never raw DOM), (c) escape user-provided text via the same `escapeHtml` pattern used in `github-metrics-tab.mjs`
- Create `pforge-mcp/tests/github-personal-tab.test.mjs` covering all four renderers — happy-path renders the expected fields, null/empty input renders the empty-state, escape works on `<script>` payload in `user.login` and `repo.repo`
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/dashboard/github-personal-tab.mjs'))throw new Error('renderer module missing');const m=fs.readFileSync('pforge-mcp/dashboard/github-personal-tab.mjs','utf8');for(const sym of ['renderAccountCard','renderRepoActivityCard','renderAiAssistCard','renderPersonalEmptyState']){if(!m.includes('export function '+sym))throw new Error('missing export: '+sym);}if(!m.includes('window.githubPersonalRenderAccountCard'))throw new Error('window attach missing');if(!fs.existsSync('pforge-mcp/tests/github-personal-tab.test.mjs'))throw new Error('renderer test file missing');console.log('ok S2 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/github-personal-tab.test.mjs tests/github-personal.test.mjs tests/github-personal-rest.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 3 — Mode-aware tab wiring (`app.js` + `index.html`)

- **Depends On**: S2 (renderers must be loadable; `index.html` `<script>` line wires the new module)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/dashboard/app.js` (the existing `loadGithubMetrics` function at ~line 7117), `pforge-mcp/dashboard/index.html` (the existing `<section id="tab-github-metrics">` block at ~line 1912), `pforge-mcp/dashboard/github-metrics-tab.mjs` (read-only — for the org-mode render-helper names), `pforge-mcp/dashboard/github-personal-tab.mjs` (S2-shipped)
- **Traces to**: Resolved Decisions #4, #5, #12, #14
- In `pforge-mcp/dashboard/index.html`:
  - Update the subtitle paragraph inside `<section id="tab-github-metrics">` per Resolved Decision #12
  - Add the three new container divs (`gm-personal-account-card`, `gm-personal-repo-card`, `gm-personal-ai-card`) immediately after `<div id="gm-per-team-panel">`
  - Add `<script src="github-personal-tab.mjs" type="module"></script>` immediately after the existing `<script src="github-metrics-tab.mjs" type="module"></script>` line
- In `pforge-mcp/dashboard/app.js`, modify `loadGithubMetrics` per §"Scope Contract → S3" — the function gains a Personal-Mode fallback branch that fetches `/api/github-personal`, calls the four `window.githubPersonalRender*` helpers, and toggles `.hidden` on org-mode vs personal-mode container divs
- The org-mode code path (the four `xxxEl.innerHTML = window.githubMetricsRender...` lines) MUST be preserved unchanged
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('pforge-mcp/dashboard/index.html','utf8');for(const id of ['gm-personal-account-card','gm-personal-repo-card','gm-personal-ai-card']){if(!h.includes('id=\"'+id+'\"'))throw new Error('container missing: '+id);}if(!/github-personal-tab\\.mjs/.test(h))throw new Error('script tag missing');if(!/personal mode/i.test(h))throw new Error('subtitle not updated');const a=fs.readFileSync('pforge-mcp/dashboard/app.js','utf8');if(!/\\/api\\/github-personal/.test(a))throw new Error('app.js does not call /api/github-personal');if(!/githubPersonalRenderAccountCard/.test(a))throw new Error('app.js does not call account renderer');if(!/githubMetricsRenderAdoptionPanel/.test(a))throw new Error('org-mode renderer call deleted from app.js');console.log('ok S3 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/github-personal-tab.test.mjs tests/github-personal-rest.test.mjs tests/github-personal.test.mjs tests/github-metrics-dashboard.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 4 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0-S3 all green
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` (existing retro shape), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`
- **Traces to**: Resolved Decision #14
- Create `docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md` with sections: surface summary (per-file LOC delta), dogfood result (output of `/api/github-personal` against `srnichols/plan-forge` itself — captured verbatim), friction log (what surprised us in the dual-mode auto-detect), Resolved Decisions audit (did any decision flip during execution?), follow-on phase recommendations (sparkline + cache + repo selector)
- In `docs/plans/DEPLOYMENT-ROADMAP.md`: add `| 54 — GH-METRICS-PERSONAL | Personal-account fallback for the GitHub × Plan-Forge dashboard tab — auto-detects when no org metrics are available and renders user profile + repo activity + Copilot-coauthor commit % | 2026-05-19 | [Phase-54-GH-METRICS-PERSONAL-PLAN.md](./Phase-54-GH-METRICS-PERSONAL-PLAN.md) |` to the Completed Phases table
- Append the `CHANGELOG.md` `[Unreleased] → ### Added` entry per §"Scope Contract → S4"
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md'))throw new Error('retro missing');const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!rm.includes('GH-METRICS-PERSONAL')&&!rm.includes('Phase-54-GH-METRICS-PERSONAL-PLAN.md'))throw new Error('Phase 54 not in roadmap');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!cl.includes('Personal Mode')&&!cl.includes('github-personal')&&!cl.includes('Phase 54'))throw new Error('CHANGELOG entry missing');console.log('ok S4');"
```

---

## Acceptance Criteria

- **MUST**: `pforge-mcp/github-personal.mjs` exists and exports `fetchUserProfile`, `fetchRepoSummary`, `scanCopilotCoauthors`, `PersonalError`, `PersonalAuthError`, `PersonalNotFoundError`, `PersonalRateLimitError` (S0).
- **MUST**: All five fixture files under `pforge-mcp/tests/fixtures/github-personal/` are present and are free of real email addresses, tokens, and avatar URLs (S0).
- **MUST**: `pforge-mcp/tests/github-personal.test.mjs` runs green via `npx vitest run tests/github-personal.test.mjs` with ≥8 passing tests, using `createMockGh` only — no real `gh` invocation (S0).
- **MUST**: `GET /api/github-personal` REST endpoint is registered in `pforge-mcp/server.mjs` and returns the body shape `{ ok, user, repo, copilotSignal, errors, _meta }` defined in §"Scope Contract → S1" (S1).
- **MUST**: The endpoint NEVER returns 500 on missing data — partial failures populate `errors.<key>` strings inside a 200 response (S1).
- **MUST**: `pforge-mcp/tests/github-personal-rest.test.mjs` runs green covering happy-path + missing-gh + bad-repo + default-from-origin + perPage-cap (S1).
- **MUST**: `pforge-mcp/dashboard/github-personal-tab.mjs` exists and exports `renderAccountCard`, `renderRepoActivityCard`, `renderAiAssistCard`, `renderPersonalEmptyState`, all attached to `window` for non-module-script consumption (S2).
- **MUST**: `pforge-mcp/tests/github-personal-tab.test.mjs` runs green, including XSS escape coverage on `user.login` and `repo.repo` (S2).
- **MUST**: `pforge-mcp/dashboard/index.html` includes the three new container divs (`gm-personal-account-card`, `gm-personal-repo-card`, `gm-personal-ai-card`), the new `<script>` tag for `github-personal-tab.mjs`, and the updated subtitle text mentioning "personal mode" (S3).
- **MUST**: `pforge-mcp/dashboard/app.js` `loadGithubMetrics` function fetches `/api/github-personal` when org-mode yields no data AND still calls all org-mode renderers (`githubMetricsRenderAdoptionPanel` etc.) when org-mode data is present (S3).
- **MUST**: Org Mode rendering is byte-identical post-phase for a user who provides a valid org slug with active Copilot Metrics — verified by `tests/github-metrics-dashboard.test.mjs` passing unchanged (S3).
- **MUST**: `docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md` exists and includes a verbatim dogfood capture against the `srnichols/plan-forge` repo (S4).
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` lists Phase 54 in the Completed Phases table with ship date `2026-05-19` (S4).
- **MUST**: `CHANGELOG.md` `[Unreleased] → ### Added` block contains an entry naming Personal Mode for the GitHub × Plan-Forge dashboard tab (S4).
- **MUST**: No production-code change in `pforge-mcp/github-metrics.mjs`, `pforge-mcp/dashboard/github-metrics-tab.mjs`, or the `/api/github-metrics` endpoint handler (Forbidden Actions enforcement).
- **MUST**: No new npm dependency added in either workspace's `package.json`.
- **MUST**: `forge_secret_scan` produces zero new findings on the five new fixture files (S0 retro check).
- **SHOULD**: The `scanCopilotCoauthors` function detects at least one Copilot signal when run against a real Copilot-enabled public repo (manual dogfood in S4 retro).
- **SHOULD**: The full `pforge-mcp` test suite (`bash -c "cd pforge-mcp && npx vitest run"`) passes at end of S3 with no new flakes.
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before promoting Phase 54 to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + concurrent-agent touched-file list at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed with the next slice.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm `git diff --stat HEAD~1` touches ONLY: `pforge-mcp/github-personal.mjs`, `pforge-mcp/tests/github-personal.test.mjs`, and five new files under `pforge-mcp/tests/fixtures/github-personal/`. Confirm no existing file was modified. Re-read §"Forbidden Actions". |
| **S1** | Confirm `git diff --stat HEAD~1` touches ONLY: `pforge-mcp/server.mjs` (single contiguous block added) and `pforge-mcp/tests/github-personal-rest.test.mjs` (new). Confirm the existing `/api/github-metrics` handler is byte-identical to its pre-S1 state. Re-read §"Concurrent-Agent Coordination". |
| **S2** | Confirm `git diff --stat HEAD~1` touches ONLY: `pforge-mcp/dashboard/github-personal-tab.mjs` (new) and `pforge-mcp/tests/github-personal-tab.test.mjs` (new). Confirm `pforge-mcp/dashboard/github-metrics-tab.mjs` is byte-identical to its pre-S2 state. |
| **S3** | Confirm `git diff --stat HEAD~1` touches ONLY: `pforge-mcp/dashboard/index.html` (section-bounded changes) and `pforge-mcp/dashboard/app.js` (single function modified). Run full `pforge-mcp` vitest suite (`bash -c "cd pforge-mcp && npx vitest run"`) — all tests pass, including pre-existing `tests/github-metrics-dashboard.test.mjs`. |
| **S4** | Confirm DEPLOYMENT-ROADMAP entry includes correct ship date `2026-05-19`. Confirm retro file's dogfood capture section is non-empty. Confirm `forge_secret_scan` produces zero findings on the changed surface. |

---

## Definition of Done

- [ ] All 5 execution slices (S0-S4) committed individually with conventional-commit messages
- [ ] All slice validation gates green
- [ ] All Re-anchor Checkpoints passed
- [ ] `pforge-mcp/github-personal.mjs` exists with the three exported `fetch*`/`scan*` functions
- [ ] `GET /api/github-personal` returns 200 with structured-null fields when `gh` is absent
- [ ] Personal-mode renderers exist in `pforge-mcp/dashboard/github-personal-tab.mjs`
- [ ] Mode-aware wiring in `pforge-mcp/dashboard/app.js` and three new container divs in `index.html`
- [ ] Full `pforge-mcp` vitest suite passes (`bash -c "cd pforge-mcp && npx vitest run"`)
- [ ] Full `pforge-master` vitest suite passes (no cross-impact expected, but verified)
- [ ] `forge_secret_scan` shows zero new findings on the changed surface
- [ ] `docs/plans/testbed-findings/Phase-54-GH-METRICS-PERSONAL-retro.md` written and committed
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` Completed Phases table updated with Phase 54 row
- [ ] `CHANGELOG.md` `[Unreleased] → Added` entry added
- [ ] Reviewer Gate passed (zero 🔴 Critical findings)
- [ ] `lockHash` in plan frontmatter matches at run time
- [ ] No new dependency added in either workspace's `package.json`
- [ ] No file outside the §"Concurrent-Agent Coordination" allowlist was modified by this phase

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Test failure in `tests/github-metrics-dashboard.test.mjs` or `tests/github-metrics.test.mjs`** | Org Mode regression — the existing Copilot Metrics path was inadvertently modified. Per Forbidden Actions, those files must be byte-identical. | Roll back the offending slice; verify `git diff HEAD~1 -- pforge-mcp/github-metrics.mjs pforge-mcp/dashboard/github-metrics-tab.mjs` is empty. |
| **A non-allowlisted file was modified by a slice** | Scope-contract violation; concurrent-agent collision risk. | Roll back the offending slice; verify against §"Concurrent-Agent Coordination" touched-file list. |
| **Build / lint failure introduced by the slice** | New file has a syntax error or violates an existing lint rule. | Fix in the same commit OR roll back. Do not advance with a broken build. |
| **`forge_secret_scan` flags a token / email / avatar URL in a fixture** | Fixture redaction failed — committing real secrets is a Project Principle forbidden pattern. | Roll back the fixture; redact per §"Resolved Decisions → #11"; re-commit. |
| **The `/api/github-personal` endpoint returns 500** | Per Resolved Decision #9 the endpoint must always return 200 with structured nulls. A 500 indicates a missing try/catch on a module call. | Roll back S1; wrap each module call in independent try/catch as specified. |
| **A test requires real `gh` invocation to pass** | Tests must use `createMockGh` — a CI-without-gh failure indicates a missing mock. | Roll back the offending test commit; switch to `createMockGh`. |
| **The concurrent agent's plan touches `server.mjs` near line 7615 between S0 and S2** | Merge-conflict surface in the same contiguous block. | Pause this plan at slice boundary; resolve the concurrent agent's commit first; pull/rebase; resume. |
| **Security check fails** (e.g. `forge_secret_scan` surfaces a token in any new file) | Genuine breach risk. | Halt, redact, re-do extraction with secrets routed through env. |
| **The `Personal Mode` populate path leaks `gh` stderr to the user** | Per Forbidden Actions, raw stderr (which may include Authorization headers) MUST NOT be echoed. Only sanitised category strings. | Roll back S1; replace raw error message with category-only sanitisation. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| **S0 fixture parse failure** | The fixture JSON is malformed. Re-derive from `gh api` output, redact, re-commit. |
| **S0 mock-gh test failure** | The `createMockGh` harness API may have evolved; consult `pforge-mcp/tests/helpers/mock-gh.mjs` and align fixture shape. |
| **S1 endpoint registration grep fail** | The registration line is correct but uses single-quoted `'/api/github-personal'` while the gate regex expects either quote style. Inspect the regex `app\.get\(['"]\/api\/github-personal['"]/` in the validation gate and ensure code matches one of the two quote forms. |
| **S2 renderer test XSS escape fail** | The renderer is using raw template-string interpolation; switch to the `escapeHtml` helper pattern from `github-metrics-tab.mjs`. |
| **S3 org-mode regression** | `app.js` was over-edited — the org-mode `xxxEl.innerHTML = ...` lines were modified. Re-read the function, restore the org-mode lines verbatim, add personal-mode as an `if (!metrics.length) { ... }` fallback branch only. |
| **S4 roadmap gate fail** | The gate uses `.includes('GH-METRICS-PERSONAL')` — failure indicates the row was added in the wrong table or with a wrong identifier. Use the exact roadmap format from §"Scope Contract → S4". |

---

## Open Risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| 1 | Concurrent agent commits to `server.mjs` between S0 and S2 | Medium | Slice boundaries are commit boundaries; orchestrator pulls before push; conflict-resolve at the slice (not within a slice). |
| 2 | Personal-mode auto-detect is too eager — flips a user with a slow Copilot Metrics API response into personal mode incorrectly | Low | Auto-detect triggers ONLY when `metrics.length === 0`, NOT on slow response. Slow response stays in org mode. |
| 3 | `gh api repos/{o}/{r}/commits` rate-limit on a hot-reloaded dashboard | Low | Frontend's `loadGithubMetrics` is gated on user-clicked Refresh button, not auto-poll. Rate-limit error returned as `PersonalRateLimitError` and rendered as a card-level message. |
| 4 | XSS in user-rendered fields (login, repo name, plan name) | Medium | All renderers use the same `escapeHtml` pattern as `github-metrics-tab.mjs`. S2 test suite includes an XSS-payload regression test. |
| 5 | Repo derivation from `git remote get-url origin` breaks on detached worktrees or non-GitHub remotes | Medium | The endpoint returns `errors.repo` with the parse failure reason; frontend renders the repo card empty-state pointing at the `?owner=&repo=` query param escape hatch. |
| 6 | Plan-Forge's own commit history yields 0% Copilot-coauthor (because Plan-Forge uses interactive Copilot in IDE, not the coding-agent) and looks like a bug | Low | Retro explicitly captures this as the expected dogfood signal — 0% is correct for this project. Add an inline note to the AI-Assist card explaining the signal only fires for chat/agent-mode commits. |

---

## Out-of-Band Documentation

- The `pforge` CLI does NOT gain a personal-mode command in this phase. If a retro recommendation surfaces a need for `pforge github personal pull --repo owner/name`, that lands in a follow-on phase along with JSONL persistence and sparklines.
- The MCP tool surface is UNCHANGED. The existing `forge_github_metrics` tool continues to read from the org-metrics JSONL store; personal mode is dashboard-and-REST-only by design (Resolved Decision #1, follow-on space).
- The `inspectGithubStack` readiness widget continues to work as today — it's adjacent to but independent of this phase's surface.
