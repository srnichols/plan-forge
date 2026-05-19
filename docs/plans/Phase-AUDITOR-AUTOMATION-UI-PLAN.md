# Phase AUDITOR-AUTOMATION-UI — Dashboard surfaces for observer, watcher cross-run, and auditor

> **Status**: **DRAFT — gated on Phase-AUDITOR-AUTOMATION shipping first**. Do NOT execute (or even Step-2 harden) until the parent phase ships. Many fields and capabilities this plan surfaces don't exist yet.
> **Parent phase**: [docs/plans/Phase-AUDITOR-AUTOMATION-PLAN.md](Phase-AUDITOR-AUTOMATION-PLAN.md). The parent ships the *capability* (config blocks, observer process, cross-run watcher mode, auditor auto-invoke). This phase ships the *discoverability* (settings UI to configure them, observability cards to see them work).
> **Tracks**: `pforge-mcp/ui/index.html` + `pforge-mcp/ui/app.js` (new settings tab, three new dashboard cards), `pforge-mcp/server.mjs` (any new `/api/*` endpoints needed for the cards), `pforge-mcp/tests/dashboard-*.test.mjs` (mapping invariants + behavior), docs sweep with new screenshots.
> **Estimated cost**: low-to-medium. All mechanical UI work on an established pattern (Phase-30 settings decomposition). Zero new backend capabilities, zero new MCP tools. The only `/api/*` additions are read endpoints to feed the cards.
> **Pipeline**: Specify ✅ → Harden ⏳ (HELD until parent ships) → Execute → S7 QA → S8 docs → S9 retro.
> **Recommended starting cluster**: **Cluster A — Settings tab** (S0 → S1 → S2) because settings UI is the highest-leverage discoverability gain; cards are progressive enhancement.
> **Session budget**: 9 slices. Recommended break point: **commit + new session after S2** (settings tab complete; cards are independent work).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] Parent phase [Phase-AUDITOR-AUTOMATION-PLAN.md](Phase-AUDITOR-AUTOMATION-PLAN.md) has shipped (S11 retro complete; CHANGELOG entry promoted; tag pushed)
- [ ] `.forge.json` schema actually contains `hooks.postRun.invokeAuditor` and `forgeMaster.observer` + `forgeMaster.auditor` blocks (verify by reading `templates/.forge.json`)
- [ ] `forge_master_observe` tool actually appears in `forge_capabilities` output
- [ ] `forge_watch({ mode: "cross-run" })` returns valid output against this repo's `.forge/runs/` directory
- [ ] At least one auditor report exists at `.forge/health/latest.md` (so the auditor report card has something to render against in tests)
- [ ] No competing in-flight plan is modifying `pforge-mcp/ui/index.html`, `pforge-mcp/ui/app.js`, or the dashboard test files
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-AUDITOR-AUTOMATION-UI-PLAN.md`.

---

## Why this phase exists

The parent phase ships three capabilities (auditor auto-invoke, cross-run watcher, Forge-Master observer mode) but exposes them only through `.forge.json` config and CLI. Three discoverability gaps follow:

| Gap | Today after parent ships | What this phase adds |
|---|---|---|
| **Configuration** | Users must hand-edit `.forge.json` to enable observer or auditor auto-invoke. No UI knob. | `tab-settings-forgemaster` with `cfg-observer-*` + `cfg-auditor-*` form fields wired to existing `GET/POST /api/config` |
| **Live narrations** | Observer narrations land in Brain (`brain_capture`) and the CLI `--status` view. No dashboard surface. | Observer narrations card: live feed of last N narrations with timestamp + cost |
| **Retrospective insight** | Cross-run anomalies and the auditor's latest report live only in `.forge/health/latest.md` and on disk. | Cross-run anomalies card + auditor latest-report card on the dashboard |

Each card and field is read-from-existing-source — no new backend capabilities, no new MCP tools. This phase is **pure UI surfacing**.

---

## Scope Contract

### In Scope

**Cluster A — Settings tab for Forge-Master roles**:
- `pforge-mcp/ui/index.html` — new `<section id="tab-settings-forgemaster">` registered alongside existing nine settings tabs
- Observer field set (within new tab):
  - `cfg-observer-enabled` (checkbox)
  - `cfg-observer-modeltier` (select: `inherit | flagship | mid | fast`)
  - `cfg-observer-budget-usd` (number input, min 0)
  - `cfg-observer-budget-narrations` (number input, min 0)
  - `cfg-observer-batch-window-ms` (number input, default 60000)
  - `cfg-observer-brain-capture` (checkbox)
- Auditor field set (within new tab):
  - `cfg-auditor-modeltier` (select, same options as observer)
  - `cfg-auditor-on-failure` (checkbox)
  - `cfg-auditor-every-n-runs` (number input, blank = off)
- `pforge-mcp/ui/app.js` — register new tab in `tabLoadHooks`; read fields from `GET /api/config`, write via existing `POST /api/config` atomic merge pattern
- Field-level validation: budget caps reject negative; `everyNRuns` rejects values 1–4 (per parent phase's "reasonable opt-in values are 5–25" Resolved Decision)

**Cluster B — Observability cards**:
- **Observer narrations card** (new section on dashboard main view):
  - Renders last 20 narrations (server-rendered from Brain query: `brain_recall` filter on observer-source thoughts)
  - Live updates via existing dashboard WebSocket — new event type `observer:narration`
  - Per-narration display: timestamp, batch event count, narration text (markdown), cost in $
  - Empty state: clear "Observer disabled — enable in Settings" message linking to new settings tab
  - Backend: extend `pforge-master/src/observer-loop.mjs` (parent phase) to emit `observer:narration` events on hub
- **Cross-run watcher anomalies card**:
  - "Refresh" button invokes `forge_watch({ mode: "cross-run", window: "14d" })`
  - Renders table of anomalies: code, severity, recommendation
  - Caches last result in `.forge/cross-run-cache.json` with 1 h TTL; auto-loads cached on page load
  - Backend: new read endpoint `GET /api/watcher/cross-run` (wraps existing watcher tool)
- **Auditor latest-report card**:
  - Renders `.forge/health/latest.md` as markdown (server-side, sanitized — no user-controlled HTML injection)
  - Shows report timestamp + counter "N reports since YYYY-MM-DD"
  - "View history" link opens `.forge/health/` archive listing
  - Backend: new read endpoint `GET /api/auditor/latest` (returns `{ markdown, timestamp, archive: [...] }`)

**Tests** (per slice + S7):
- `pforge-mcp/tests/dashboard-settings-forgemaster.test.mjs` (new — covers S1 + S2: section existence, field-id mapping invariants, write-roundtrip)
- `pforge-mcp/tests/dashboard-observer-narrations-card.test.mjs` (new — S4: render, empty state, live update)
- `pforge-mcp/tests/dashboard-cross-run-card.test.mjs` (new — S5: refresh action, cache load, table render)
- `pforge-mcp/tests/dashboard-auditor-report-card.test.mjs` (new — S6: markdown render, sanitization, archive link)
- Phase-30 decomposition mapping tests in `dashboard-settings.test.mjs` extended to include `tab-settings-forgemaster`

**Docs sweep** (S8):
- New screenshots: `docs/manual/assets/screenshots/dashboard-settings-forgemaster.png`, `dashboard-observer-narrations.png`, `dashboard-cross-run-anomalies.png`, `dashboard-auditor-report.png`
- `docs/manual/dashboard.html` — document new cards
- `docs/manual/dashboard-settings.html` — document new tab + fields
- `docs/manual/dashboard-forge-master.html` — cross-link to observer narrations card
- `docs/capabilities.md` + `pforge-mcp/capabilities.mjs` — note dashboard surfaces now exist for observer/auditor/cross-run
- `docs/COPILOT-VSCODE-GUIDE.md` — point users at dashboard for observer enable instead of `.forge.json` editing
- `CHANGELOG.md` — one entry (MINOR bump per release-checklist: multiple `feat:` commits → MINOR)

### Out of Scope

- **Anything not listed in §"In Scope"**. UI polish only — no new MCP tools, no new capabilities.
- Adding configurable model tiers beyond what the parent phase ships (`flagship | mid | fast`) — UI uses whatever tiers the parent registered
- Live editing of narration prompts or auditor prompts from the dashboard (config-driven, not UI-driven)
- Exporting auditor reports as PDF / shareable links
- Notifying via email/Slack/Teams when observer narrates or auditor reports — that's the existing notification system's concern (not duplicating it here)
- Cross-run anomaly drill-down to per-run detail (this phase shows the summary; per-run views already exist on dashboard)
- Mobile-responsive layouts for the new cards (matches existing dashboard's desktop-first posture; mobile is a global phase concern)
- Auth / permission gating on settings fields (dashboard is already local-only — no auth model exists to extend)
- Renaming or moving existing settings tabs to accommodate the new one
- Touching `pforge-sdk/`, `extensions/`, `presets/`, `pforge-mcp/cost-service.mjs` (universal tripwire)

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected — universal tripwire)
- **Do NOT** render auditor report markdown client-side without server-side sanitization. The `.forge/health/latest.md` file is generated by an LLM and MUST be treated as untrusted text — strip HTML, escape script tags, allow only safe markdown elements.
- **Do NOT** add a `POST /api/auditor/*` endpoint or any write endpoint for auditor/observer state from the dashboard. Cards are read-only; writes happen via the settings tab through the existing `POST /api/config` path.
- **Do NOT** flip `observer.enabled` default to `true` via UI initialization. The UI MUST respect the config-shipped default (`false`). UI displays current state; user click is what flips it.
- **Do NOT** ship a settings field that bypasses the parent phase's budget-cap requirements (e.g., a "no limit" checkbox). UI MUST enforce the same finite-positive constraint the backend enforces; reject submission with a clear error otherwise.
- **Do NOT** add a new top-level dashboard tab. New observability cards live within the existing main dashboard view. Settings live within the existing settings tab framework.
- **Do NOT** change the existing settings tab ordering. Append `tab-settings-forgemaster` at the end (it's new and opt-in).
- **Do NOT** introduce a new frontend framework or build step. Existing dashboard is plain HTML + vanilla JS — keep it that way.
- **Do NOT** bundle slices into one commit. Each slice = one commit. S0 / S7 / S8 / S9 also each = one commit.
- **Do NOT** ship without screenshots in S8. UI changes without screenshots make docs regression-prone.
- **Do NOT** modify the parent phase's plan file or any file the parent phase declared in its own Scope Contract (parent ships first, then this phase touches only UI surfaces).

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **UI-only phase** — no new MCP tools, no new CLI verbs, no new backend capabilities. All work is dashboard rendering + two thin read endpoints for the cards.
2. **Settings tab is named `tab-settings-forgemaster`** — matches existing tab naming convention (`tab-settings-{general,models,...}`). Single tab covers both observer and auditor sub-sections to avoid tab proliferation.
3. **Cards live on main dashboard view, not in a new top-level tab** — three cards add to the existing dashboard's information density; new top-level tab would hide them. Cards are collapsible (existing pattern) so users who don't care can fold them away.
4. **Auditor report markdown is sanitized server-side** — the report is LLM-generated and treated as untrusted. Sanitization at `GET /api/auditor/latest` strips HTML before sending to client. Client renders pre-sanitized markdown only.
5. **Cross-run watcher card uses a refresh button, not a live subscription** — cross-run aggregation is a 14-day scan; polling every second would be wasteful. Manual refresh + 1 h cache is the right cost/freshness balance.
6. **Observer narrations card uses the existing dashboard WebSocket** — same connection live session card already uses. New event type `observer:narration` is additive; no new socket dependency.
7. **Settings writes go through existing `POST /api/config`** — atomic read-merge-write pattern already exists for `brain.federation.enabled` (server.mjs:7367+). New fields land in the same pipeline; no new endpoint.
8. **Field validation is client + server** — client gives instant feedback; server enforces the actual constraints. Both reject negative budgets, `everyNRuns` in [1–4], non-finite caps.
9. **Empty states are explicit, not silent** — if observer is disabled, narrations card says "Observer disabled — enable in Settings" with a deep-link. If no auditor reports yet, report card says "No reports yet — runs trigger reports when `everyNRuns` is set or auto-invoke fires on failure." Silent empty UI is a Plan Forge anti-pattern (see ACI temper guards).
10. **Model tier dropdown shows human labels** — `Inherit ask mode (default)` / `Flagship (best quality)` / `Mid (balanced)` / `Fast (cheapest)`. Backend stores the canonical token; UI shows the label. Vendor model names never appear in the dropdown (per parent phase's Forbidden Action #14).

---

## Slice Decomposition

### S0 — Baseline test harness

Captures today's dashboard state for non-regression:
- Existing nine settings tabs render and route correctly
- Existing dashboard cards intact
- `GET /api/config` shape unchanged for fields not under this phase's scope
- `tab-settings-forgemaster` does NOT exist yet (will after S1)
- New endpoints `/api/watcher/cross-run` and `/api/auditor/latest` return 404 today (will be 200 after S5 + S6)

**Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-auditor-automation-ui-baseline.test.mjs"` returns 0.

### Cluster A — Settings tab for Forge-Master roles

**S1 — `tab-settings-forgemaster` section + observer fields**
- New `<section id="tab-settings-forgemaster">` with six observer `cfg-*` fields
- Tab routing entry in `app.js`
- Read from `/api/config` `forgeMaster.observer.*`; write via `POST /api/config`
- Phase-30 mapping test extended: new tab listed in `SETTINGS_SECTIONS`; new field IDs mapped
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-settings-forgemaster.test.mjs -t 'observer'"` returns 0

**S2 — Auditor fields in `tab-settings-forgemaster`**
- Add three auditor `cfg-*` fields (modelTier, onFailure, everyNRuns) to same section
- Field validation: `everyNRuns` rejects 1–4; `null`/blank = off
- Save round-trip: write → reload page → fields show same values
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-settings-forgemaster.test.mjs -t 'auditor'"` returns 0

### Cluster B — Observability cards

**S3 — `/api/watcher/cross-run` read endpoint**
- Wraps `runWatch({ mode: "cross-run", window: "14d" })`
- Reads/writes `.forge/cross-run-cache.json` (1 h TTL, atomic write)
- Returns `{ ok, anomalies, recommendations, snapshot, cachedAt }`
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/api-watcher-cross-run.test.mjs"` returns 0

**S4 — Observer narrations card**
- New card in `index.html` after existing live session card
- Subscribes to existing dashboard WebSocket; listens for `observer:narration` events (the parent phase's S7 already emits these — this slice is strictly a subscriber, no parent-file edits)
- Initial render: query Brain via `GET /api/brain/recall?source=observer&limit=20`
- Empty state UI + deep-link to settings tab
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-observer-narrations-card.test.mjs"` returns 0

**S5 — Cross-run watcher anomalies card**
- New card in `index.html` after observer narrations card
- "Refresh" button → `GET /api/watcher/cross-run`
- Renders anomaly table (code, severity, recommendation, occurrence count)
- Auto-loads cached on page load
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-cross-run-card.test.mjs"` returns 0

**S6 — Auditor latest-report card**
- New `GET /api/auditor/latest` endpoint: reads `.forge/health/latest.md`, sanitizes markdown server-side (strip HTML/script), returns `{ markdown, timestamp, archive: [{ filename, timestamp }, ...] }`
- New card renders markdown using existing dashboard markdown renderer (already used elsewhere — verify which one and reuse)
- "View history" link opens collapsible list of archived reports
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-auditor-report-card.test.mjs"` returns 0

### S7 — Full QA sweep

Run ALL new test suites together; verify they don't regress each other, existing dashboard tests, or parent phase tests:
- All new tests from S0–S6
- Pre-existing full `pforge-mcp` test suite (including all dashboard-*.test.mjs)
- Parent phase's tests remain green

**Gate**: `bash -c "cd pforge-mcp && npx vitest run"` returns 0; **zero** failed tests across the workspace.

### S8 — Docs sweep + screenshots

- Capture screenshots per §"Docs sweep" list using existing `capture-screenshots.mjs` infrastructure
- Update manual pages per §"Docs sweep" list
- Regenerate `forge_capabilities` output and verify dashboard surfaces show up in `dashboard:` capability description
- Update `CHANGELOG.md` `[Unreleased]` with single grouped entry covering all three card additions + settings tab

**Gate**: `bash -c "ls docs/manual/assets/screenshots/dashboard-settings-forgemaster.png docs/manual/assets/screenshots/dashboard-observer-narrations.png docs/manual/assets/screenshots/dashboard-cross-run-anomalies.png docs/manual/assets/screenshots/dashboard-auditor-report.png"` returns 0.

### S9 — Retro

Append §"What actually shipped" to this plan file:
- Final commit SHAs per slice
- Any deviations from the draft (sliced added/removed/reordered, scope drift)
- Known gotchas surfaced during execution
- Carryover for next phase (e.g., per-run drill-down on cross-run anomalies, auditor PR-opening UI, mobile-responsive cards)

**Gate**: `bash -c "grep -q '## What actually shipped' docs/plans/Phase-AUDITOR-AUTOMATION-UI-PLAN.md"` returns 0.

---

## Acceptance Criteria (DRAFT — to be sharpened by Step-2)

### MUST

1. After Cluster A: opening `localhost:3100/dashboard` and clicking the "Forge-Master" settings tab MUST display all nine `cfg-*` fields (six observer + three auditor) with current values from `.forge.json`.
2. After Cluster A: changing `cfg-observer-enabled` to checked and saving MUST update `.forge.json` `forgeMaster.observer.enabled: true` atomically (no partial write on concurrent save).
3. After Cluster A: submitting `cfg-auditor-every-n-runs: 2` MUST surface a client-side validation error AND a server-side 400 if client validation is bypassed.
4. After Cluster B: with `observer.enabled: false`, the observer narrations card MUST render the empty state with deep-link to the settings tab — not an empty box, not a spinner.
5. After Cluster B: clicking "Refresh" on the cross-run anomalies card MUST invoke `forge_watch({ mode: "cross-run" })` server-side and render the response within 2 s for `.forge/runs/` directories with ≤ 50 runs.
6. After Cluster B: the auditor latest-report card MUST sanitize any `<script>` or raw HTML tags in `.forge/health/latest.md` before rendering — verified by feeding a fixture report with injected `<script>alert(1)</script>` and asserting no script tag in rendered DOM.
7. Across the whole phase: every test from S0 through S7 MUST pass. Pre-existing dashboard suites MUST NOT regress. Parent phase's tests MUST NOT regress.

### SHOULD

1. New cards SHOULD use the same collapsible-section component existing dashboard cards use (no new card-styling pattern).
2. Settings tab SHOULD reuse existing form-validation styling so error states look consistent.
3. Cross-run anomaly card SHOULD render anomaly severity with the same color coding as the existing per-run anomaly display.
4. New screenshots SHOULD be captured at the same viewport size (1440x900) as existing dashboard screenshots for visual consistency.

---

## Definition of Done

- [ ] All 9 slices' gates green; S7 full QA green; S8 screenshots present
- [ ] Reviewer-Gate sign-off (Session 3): no Scope Contract drift, no Forbidden Action triggered, all MUST criteria met
- [ ] All four screenshots captured and committed under `docs/manual/assets/screenshots/`
- [ ] `forge_capabilities` output mentions dashboard surfaces for observer/auditor/cross-run
- [ ] `CHANGELOG.md` entry promoted from `[Unreleased]` → `[<next-MINOR>] — YYYY-MM-DD — Forge-Master Dashboard Surfaces` per the release checklist

---

## Stop Conditions

Halt execution and request human review if any of these fire:

- Markdown sanitization test in S6 fails to strip any HTML payload — security issue; do not paper over with allowlist tweaks until reviewed
- Settings tab save corrupts `.forge.json` on concurrent writes (race in atomic write pattern) — must be fixed before any settings field ships
- Observer narrations card displays narrations that are NOT in Brain (means event fired but capture failed — bug in parent phase, escalate to parent's authors)
- Cross-run watcher endpoint times out >5 s consistently for ≤50-run repos — performance regression vs. parent phase's SHOULD criterion #2
- Any new `cfg-*` field accidentally collides with an existing field ID (Phase-30 mapping test catches this — do not rename around it)

---

## Commit Convention

- Each slice = one commit
- S0: `test(dashboard-ui): S0 — baseline test harness for AUDITOR-AUTOMATION-UI`
- S1: `feat(dashboard): settings tab for Forge-Master observer fields`
- S2: `feat(dashboard): settings tab for Forge-Master auditor fields`
- S3: `feat(api): /api/watcher/cross-run read endpoint`
- S4: `feat(dashboard): observer narrations card`
- S5: `feat(dashboard): cross-run watcher anomalies card`
- S6: `feat(dashboard): auditor latest-report card with sanitized markdown render`
- S7: `test(dashboard-ui): S7 — full QA sweep`
- S8: `docs(dashboard-ui): S8 — screenshots + manual updates`
- S9: `docs(plans): S9 — retro for Phase-AUDITOR-AUTOMATION-UI`

All commits land on `master`. PreCommit chain runs on each.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-18 | Draft created as planned follow-up to [Phase-AUDITOR-AUTOMATION-PLAN.md](Phase-AUDITOR-AUTOMATION-PLAN.md). Held until parent phase ships. | Copilot session |
| _pending_ | Parent phase shipped — verify dependencies before lifting Execution Hold | _pending_ |
| _pending_ | Step-2 harden: lockHash, tightened acceptance criteria, screenshot capture script confirmed | _pending_ |
| _pending_ | Execution Hold lifted | _pending_ |

---

## Carryover (explicitly out of this phase)

- Per-run drill-down on cross-run anomalies (this phase shows aggregate; per-run views need new card with run-selector — separate phase)
- Auditor PR-opening UI (depends on auditor gaining write capability — that decision still deferred)
- Mobile-responsive layouts for new cards (global dashboard concern; not specific to this phase)
- Real-time narration cost meter (incremental cost over the day — would extend `dashboard-forge-master-cost-meter` but requires observer to emit cost-per-narration events)
- Export auditor report as PDF or share link
- Notification integration: route observer narrations to Slack/Teams/email (existing notification system already extends here)
