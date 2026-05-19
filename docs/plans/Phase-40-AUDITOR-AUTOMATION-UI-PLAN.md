---
phase: 40
name: AUDITOR-AUTOMATION-UI
status: HARDENED
lockHash: b9cf736fc215c03036ac1c7e528c019550f1983d7821ae621f65905e88e91596
---

# Phase AUDITOR-AUTOMATION-UI — Dashboard surfaces for observer, watcher cross-run, and auditor

> **Status**: **HARDENED — awaiting Execution Hold lift**. Cleared for `pforge run-plan` once Execution Hold checklist is satisfied. Step-2 harden completed 2026-05-19. Parent phase Phase-39 shipped on 2026-05-19 (commit 9945c3bd).
> **Parent phase**: [docs/plans/Phase-39-AUDITOR-AUTOMATION-PLAN.md](Phase-39-AUDITOR-AUTOMATION-PLAN.md). The parent ships the *capability* (config blocks, observer process, cross-run watcher mode, auditor auto-invoke). This phase ships the *discoverability* (settings UI to configure them, observability cards to see them work).
> **Tracks**: `pforge-mcp/ui/index.html` + `pforge-mcp/ui/app.js` (new settings tab, three new dashboard cards), `pforge-mcp/server.mjs` (any new `/api/*` endpoints needed for the cards), `pforge-mcp/tests/dashboard-*.test.mjs` (mapping invariants + behavior), docs sweep with new screenshots.
> **Estimated cost**: low-to-medium. All mechanical UI work on an established pattern (Phase-30 settings decomposition). Zero new backend capabilities, zero new MCP tools. The only `/api/*` additions are read endpoints to feed the cards.
> **Pipeline**: Specify ✅ → Harden ⏳ (HELD until parent ships) → Execute → S7 unit QA → S8 testbed E2E + browser → S9 docs → S10 retro.
> **Recommended starting cluster**: **Cluster A — Settings tab** (S0 → S1 → S2) because settings UI is the highest-leverage discoverability gain; cards are progressive enhancement.
> **Session budget**: 10 slices. Recommended break points: **commit + new session after S2** (settings tab complete; cards are independent work) and **after S7** (unit QA green; fresh session for browser-based E2E which has different failure modes).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] Parent phase [Phase-39-AUDITOR-AUTOMATION-PLAN.md](Phase-39-AUDITOR-AUTOMATION-PLAN.md) has shipped (S11 retro complete; CHANGELOG entry promoted; tag pushed)
- [ ] `.forge.json` schema actually contains `hooks.postRun.invokeAuditor` and `forgeMaster.observer` + `forgeMaster.auditor` blocks (verify by reading `templates/.forge.json`)
- [ ] `forge_master_observe` tool actually appears in `forge_capabilities` output
- [ ] `forge_watch({ mode: "cross-run" })` returns valid output against this repo's `.forge/runs/` directory
- [ ] At least one auditor report exists at `.forge/health/latest.md` (so the auditor report card has something to render against in tests)
- [ ] No competing in-flight plan is modifying `pforge-mcp/ui/index.html`, `pforge-mcp/ui/app.js`, or the dashboard test files
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-40-AUDITOR-AUTOMATION-UI-PLAN.md`.

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

**Tests** (per slice + S7 + S8):
- `pforge-mcp/tests/dashboard-settings-forgemaster.test.mjs` (new — covers S1 + S2: section existence, field-id mapping invariants, write-roundtrip)
- `pforge-mcp/tests/dashboard-observer-narrations-card.test.mjs` (new — S4: render, empty state, live update)
- `pforge-mcp/tests/dashboard-cross-run-card.test.mjs` (new — S5: refresh action, cache load, table render)
- `pforge-mcp/tests/dashboard-auditor-report-card.test.mjs` (new — S6: markdown render, sanitization, archive link)
- Phase-30 decomposition mapping tests in `dashboard-settings.test.mjs` extended to include `tab-settings-forgemaster`

**Testbed scenarios + browser tests** (S8 deliverables, executed against `E:\GitHub\plan-forge-testbed` running a live dashboard server; uses existing `forge_testbed_run` framework + `run_playwright_code` for real-browser interactions):
- `docs/plans/testbed-scenarios/dashboard-settings-roundtrip.json` — launch dashboard against testbed; open settings tab in real browser; toggle `cfg-observer-enabled`; save; assert testbed's `.forge.json` has `forgeMaster.observer.enabled: true` AND no other field mutated (atomic write)
- `docs/plans/testbed-scenarios/dashboard-settings-concurrent-save.json` — two browser contexts open settings simultaneously; both save different values; assert final `.forge.json` reflects last-write-wins atomically, no partial JSON, no corrupted file
- `docs/plans/testbed-scenarios/dashboard-xss-injection.json` — write a malicious `.forge/health/latest.md` to testbed containing `<script>window.__pwned=true</script>`, `<img src=x onerror=alert(1)>`, `<iframe src=javascript:alert(1)>`, and a markdown-link with `javascript:` URL; load auditor-report card in real browser; assert `window.__pwned` is undefined; assert no script, iframe, or `javascript:` URL exists in rendered DOM; assert other safe markdown elements (headings, lists, code blocks) still render
- `docs/plans/testbed-scenarios/dashboard-observer-empty-state.json` — testbed with observer disabled; load page; assert empty-state message visible; click deep-link to settings tab; assert settings tab now active and `cfg-observer-enabled` focused
- `docs/plans/testbed-scenarios/dashboard-narrations-live-update.json` — enable observer on testbed; inject a synthetic `observer:narration` event into the hub; assert card renders new narration within 2 s without page reload
- `docs/plans/testbed-scenarios/dashboard-cross-run-real-data.json` — cross-run card against testbed's real 30+ run history; click Refresh; assert response renders within 2 s; assert at least one anomaly row present (testbed has historical failures); assert cached result loads on page reload without API call (verify via Network panel)
- `docs/plans/testbed-scenarios/dashboard-auditor-no-reports.json` — testbed with `.forge/health/` empty; assert report card renders the explicit empty state ("No reports yet —…"), not a broken card or spinner stuck
- `docs/plans/testbed-scenarios/dashboard-field-validation-server-side.json` — bypass client validation (submit form via `fetch()` from devtools); send `cfg-auditor-every-n-runs: 2`; assert HTTP 400 with structured error; assert testbed's `.forge.json` unchanged

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
- **Do NOT** ship without screenshots in S9. UI changes without screenshots make docs regression-prone.
- **Do NOT** modify the parent phase's plan file or any file the parent phase declared in its own Scope Contract (parent ships first, then this phase touches only UI surfaces).
- **Do NOT** push commits, tags, or branches to the testbed repository at `E:\GitHub\plan-forge-testbed` during S8. Browser scenarios MUST be self-contained: open a fresh page state, make assertions, restore any testbed file mutations in `teardown`.
- **Do NOT** skip the XSS regression scenario or weaken its assertions. Sanitization tests in S6 (JSDOM) are necessary but not sufficient — real-browser execution semantics differ.

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
11. **Testbed E2E + real-browser validation is a release gate, not optional** — unit tests (S7, using vitest + JSDOM) prove HTML/JS shape but cannot prove that the rendered UI is XSS-safe, that concurrent saves don't corrupt `.forge.json`, that empty-state UX flows correctly, or that the cross-run card renders against a realistic 30+ run history. S8 runs 8 testbed scenarios against `E:\GitHub\plan-forge-testbed` using `forge_testbed_run` + Playwright (`run_playwright_code`) for genuine browser interactions. XSS scenario specifically MUST run in a real browser — JSDOM sanitization tests don't catch every payload class.

---

## Slice Decomposition

### Slice 0 — Baseline test harness

Captures today's dashboard state for non-regression:
- Existing nine settings tabs render and route correctly
- Existing dashboard cards intact
- `GET /api/config` shape unchanged for fields not under this phase's scope
- `tab-settings-forgemaster` does NOT exist yet (will after S1)
- New endpoints `/api/watcher/cross-run` and `/api/auditor/latest` return 404 today (will be 200 after S5 + S6)

- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-auditor-automation-ui-baseline.test.mjs', {stdio:'inherit'});"
```

### Cluster A — Settings tab for Forge-Master roles

### Slice 1 — `tab-settings-forgemaster` section + observer fields
- New `<section id="tab-settings-forgemaster">` with six observer `cfg-*` fields
- Tab routing entry in `app.js`
- Read from `/api/config` `forgeMaster.observer.*`; write via `POST /api/config`
- Phase-30 mapping test extended: new tab listed in `SETTINGS_SECTIONS`; new field IDs mapped
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-settings-forgemaster.test.mjs -t observer', {stdio:'inherit'});"
```

### Slice 2 — Auditor fields in `tab-settings-forgemaster`
- Add three auditor `cfg-*` fields (modelTier, onFailure, everyNRuns) to same section
- Field validation: `everyNRuns` rejects 1–4; `null`/blank = off
- Save round-trip: write → reload page → fields show same values
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-settings-forgemaster.test.mjs -t auditor', {stdio:'inherit'});"
```

### Cluster B — Observability cards

### Slice 3 — `/api/watcher/cross-run` read endpoint
- Wraps `runWatch({ mode: "cross-run", window: "14d" })`
- Reads/writes `.forge/cross-run-cache.json` (1 h TTL, atomic write)
- Returns `{ ok, anomalies, recommendations, snapshot, cachedAt }`
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/api-watcher-cross-run.test.mjs', {stdio:'inherit'});"
```

### Slice 4 — Observer narrations card
- New card in `index.html` after existing live session card
- Subscribes to existing dashboard WebSocket; listens for `observer:narration` events (the parent phase's S7 already emits these — this slice is strictly a subscriber, no parent-file edits)
- Initial render: query Brain via `GET /api/brain/recall?source=observer&limit=20`
- Empty state UI + deep-link to settings tab
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-observer-narrations-card.test.mjs', {stdio:'inherit'});"
```

### Slice 5 — Cross-run watcher anomalies card
- New card in `index.html` after observer narrations card
- "Refresh" button → `GET /api/watcher/cross-run`
- Renders anomaly table (code, severity, recommendation, occurrence count)
- Auto-loads cached on page load
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-cross-run-card.test.mjs', {stdio:'inherit'});"
```

### Slice 6 — Auditor latest-report card
- New `GET /api/auditor/latest` endpoint: reads `.forge/health/latest.md`, sanitizes markdown server-side (strip HTML/script), returns `{ markdown, timestamp, archive: [{ filename, timestamp }, ...] }`
- New card renders markdown using existing dashboard markdown renderer (already used elsewhere — verify which one and reuse)
- "View history" link opens collapsible list of archived reports
- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/dashboard-auditor-report-card.test.mjs', {stdio:'inherit'});"
```

### Slice 7 — Full QA sweep

Run ALL new test suites together; verify they don't regress each other, existing dashboard tests, or parent phase tests:
- All new tests from S0–S6
- Pre-existing full `pforge-mcp` test suite (including all dashboard-*.test.mjs)
- Parent phase's tests remain green

- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run', {stdio:'inherit'});"
```

### Slice 8 — Testbed E2E + real-browser validation

Exercises the dashboard against the real testbed at `E:\GitHub\plan-forge-testbed`. Launches a dashboard server pointed at the testbed, then runs 8 scenarios via `forge_testbed_run` + Playwright (`run_playwright_code`) for browser interactions. Catches what JSDOM and vitest cannot: real-browser XSS evaluation, concurrent-save race conditions, deep-link focus behavior, real-network performance, cross-run card under realistic data volumes.

For each scenario in §"Testbed scenarios + browser tests" list (under Scope Contract):
1. Create the scenario fixture JSON file (8 fixtures total)
2. Add corresponding test in `pforge-mcp/tests/testbed-dashboard-ui.test.mjs` that calls `forge_testbed_run({ scenarioId })`
3. For browser scenarios, fixture `execute` step invokes Playwright via `run_playwright_code` with the scenario's specific actions + assertions
4. Verify all fixture assertions pass; XSS scenario MUST verify `window.__pwned` undefined AND zero `<script>` / `<iframe>` / `javascript:` in rendered DOM

Also re-runs the existing `forge_testbed_happypath` suite to verify this phase did not regress any pre-existing scenario.

- **Validation Gate**:

```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/testbed-dashboard-ui.test.mjs', {stdio:'inherit'});"
```

### Slice 9 — Docs sweep + screenshots

- Capture screenshots per §"Docs sweep" list using existing `capture-screenshots.mjs` infrastructure
- Update manual pages per §"Docs sweep" list
- Regenerate `forge_capabilities` output and verify dashboard surfaces show up in `dashboard:` capability description
- Update `CHANGELOG.md` `[Unreleased]` with single grouped entry covering all three card additions + settings tab

- **Validation Gate**:

```bash
node -e "const fs=require('fs');const files=['docs/manual/assets/screenshots/dashboard-settings-forgemaster.png','docs/manual/assets/screenshots/dashboard-observer-narrations.png','docs/manual/assets/screenshots/dashboard-cross-run-anomalies.png','docs/manual/assets/screenshots/dashboard-auditor-report.png'];for(const f of files){if(!fs.existsSync(f))throw new Error('missing screenshot: '+f);}console.log('ok all 4 screenshots present');"
```

### Slice 10 — Retro

Append §"What actually shipped" to this plan file:
- Final commit SHAs per slice
- Any deviations from the draft (sliced added/removed/reordered, scope drift)
- Known gotchas surfaced during execution (especially any testbed-only failures caught in S8)
- Carryover for next phase (e.g., per-run drill-down on cross-run anomalies, auditor PR-opening UI, mobile-responsive cards)

- **Validation Gate**:

```bash
node -e "const fs=require('fs');const c=fs.readFileSync('docs/plans/Phase-40-AUDITOR-AUTOMATION-UI-PLAN.md','utf8');if(!/^##\s+What actually shipped/m.test(c))throw new Error('retro section missing');console.log('ok retro present');"
```

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
8. After S8: all 8 testbed scenarios MUST exit `passed`. XSS scenario specifically MUST verify `window.__pwned` is undefined AND assert zero `<script>`, `<iframe>`, or `javascript:` URLs present in the rendered DOM — not just "sanitization function returned cleaned string".
9. After S8: `forge_testbed_findings --severity blocker` and `--severity high` MUST both return zero findings attributable to this phase.
10. After S8: dashboard-settings-concurrent-save scenario MUST NOT produce a partially-written or syntactically-invalid `.forge.json`. Last-write-wins atomicity is mandatory.

### SHOULD

1. New cards SHOULD use the same collapsible-section component existing dashboard cards use (no new card-styling pattern).
2. Settings tab SHOULD reuse existing form-validation styling so error states look consistent.
3. Cross-run anomaly card SHOULD render anomaly severity with the same color coding as the existing per-run anomaly display.
4. New screenshots SHOULD be captured at the same viewport size (1440x900) as existing dashboard screenshots for visual consistency.

---

## Definition of Done

- [ ] All 10 slices' gates green; S7 unit QA green; S8 testbed E2E + browser green; S9 screenshots present
- [ ] Reviewer-Gate sign-off (Session 3): no Scope Contract drift, no Forbidden Action triggered, all MUST criteria met
- [ ] All 8 testbed scenario fixtures committed to `docs/plans/testbed-scenarios/`
- [ ] All four screenshots captured and committed under `docs/manual/assets/screenshots/`
- [ ] `forge_testbed_findings --severity blocker` and `--severity high` both return zero findings for this phase
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
- S8 `dashboard-xss-injection` scenario shows ANY of: `window.__pwned` set, `<script>` in DOM, `<iframe>` in DOM, `javascript:` URL in any href/src — XSS bug; do not ship until fixed AND a regression test added to lock the payload class
- S8 `dashboard-settings-concurrent-save` scenario produces invalid JSON in testbed's `.forge.json` — atomic-write race bug; the existing `POST /api/config` write path needs review, not just this phase's new fields
- S8 modifies the testbed's git tree without complete teardown — testbed isolation breach

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
- S7: `test(dashboard-ui): S7 — full unit QA sweep`
- S8: `test(dashboard-ui): S8 — testbed E2E + real-browser scenarios`
- S9: `docs(dashboard-ui): S9 — screenshots + manual updates`
- S10: `docs(plans): S10 — retro for Phase-AUDITOR-AUTOMATION-UI`

All commits land on `master`. PreCommit chain runs on each.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-18 | Draft created as planned follow-up to [Phase-39-AUDITOR-AUTOMATION-PLAN.md](Phase-39-AUDITOR-AUTOMATION-PLAN.md). Held until parent phase ships. | Copilot session |
| 2026-05-19 | Parent phase Phase-39 shipped at commit 9945c3bd (S12 retro). Step-2 harden cleared to proceed. | Copilot session |
| 2026-05-19 | Step-2 harden: added frontmatter (phase 40, name AUDITOR-AUTOMATION-UI, status HARDENED, lockHash); renamed slice headers (mix of H3 S0/S7-S10 and bold-bullet S1-S6) to uniform Slice 0..Slice 10 H3 headers; rewrote 11 inline-backtick gate markers as fenced bash blocks with portable node -e bodies; S8 testbed-findings cli assertion deferred to in-slice judgment (severity gate cannot run from inside a bash command without orchestrator wiring); S10 retro grep ported to fs.readFileSync regex check | Copilot session (auto-harden) |
| _pending_ | Execution Hold lifted | _pending_ |

---

## Carryover (explicitly out of this phase)

- Per-run drill-down on cross-run anomalies (this phase shows aggregate; per-run views need new card with run-selector — separate phase)
- Auditor PR-opening UI (depends on auditor gaining write capability — that decision still deferred)
- Mobile-responsive layouts for new cards (global dashboard concern; not specific to this phase)
- Real-time narration cost meter (incremental cost over the day — would extend `dashboard-forge-master-cost-meter` but requires observer to emit cost-per-narration events)
- Export auditor report as PDF or share link
- Notification integration: route observer narrations to Slack/Teams/email (existing notification system already extends here)

---

## Appendix A — S9 Docs Sweep Pre-Work

> **Why this exists**: S9 is mechanical, low-creativity work (write text + paste screenshots). This appendix front-loads the discovery so the slice runs cheap (low model, single session). Every target below has been verified against the current repo state at draft time. Parent phase's Appendix A also lists items shared between the two phases — read parent's Appendix A first if shared rows (`docs/capabilities.md`, `CHANGELOG.md`) have already been edited.

### Screenshots to capture (S9 deliverables, manually via dashboard at `localhost:3100/dashboard`)

| # | Path | What it must show | Capture state |
|---|---|---|---|
| 1 | `docs/manual/assets/screenshots/dashboard-settings-forgemaster.png` | The new `tab-settings-forgemaster` panel fully expanded with both observer and auditor field sets visible. `cfg-observer-enabled` toggled ON to show the budget caps; `cfg-observer-modeltier` showing the "Flagship (best quality)" selection so the dropdown's human-friendly labels are visible. | Settings tab active, all fields populated with realistic values (`maxUsdPerDay: 0.50`, `everyNRuns: 10`). |
| 2 | `docs/manual/assets/screenshots/dashboard-observer-narrations.png` | Observer narrations card with **at least 3 real narrations** visible (run testbed for 5 min with observer enabled to generate). Timestamp, batch-event-count badge, and per-narration cost in $ must all be readable. | Main dashboard view, scrolled so card is centered. |
| 3 | `docs/manual/assets/screenshots/dashboard-cross-run-anomalies.png` | Cross-run watcher anomalies card after clicking Refresh against the testbed's 30+ run history. Table must show **≥3 rows** of `cross-run.*` codes with severity + recommendation visible. | Card expanded, Refresh-button "loading" state finished, fresh data rendered. |
| 4 | `docs/manual/assets/screenshots/dashboard-auditor-report.png` | Auditor latest-report card rendered from the testbed's most recent `.forge/health/latest.md`. Must show: timestamp header, "N reports since…" counter, the first ~half-screen of sanitized markdown (headings + lists), and the "View history" archive link. | Card expanded, markdown body visible (do not show only the header). |

**Dimensions**: match existing screenshots in `docs/manual/assets/screenshots/` (1440×900 viewport, no browser chrome — use a clean window or crop in post). Existing examples: `dashboard-cost-tab.png`, `dashboard-settings-general.png`.

### Target inventory (verified at draft time)

| # | File | Insertion anchor | Pattern in file | What to add |
|---|---|---|---|---|
| 1 | `docs/manual/dashboard-settings.html` | After existing `<h3 id="settings-brain">🧠 Brain</h3>` (line 103) | `grep -n "id=\"settings-brain\"" docs/manual/dashboard-settings.html` | Append new `<h3 id="settings-forgemaster">⚒ Forge-Master</h3>` section as the **10th** settings group. Three subsections in the body: (a) "Observer" — list all six `cfg-observer-*` fields with type, default, and effect (matches parent phase's `forgeMaster.observer` config block); (b) "Auditor" — list both `cfg-auditor-*` fields and explain that `everyNRuns` rejects values 1–4 (Resolved Decision: opt-in starts at 5); (c) "Model tier dropdown" — explain the four canonical tokens (`null`/`flagship`/`mid`/`fast`) and that the UI shows human labels while the backend stores the canonical token. Cross-link to `forge-json-reference.html#forgeMaster-observer` and `#forgeMaster-auditor`. Include `<img src="assets/screenshots/dashboard-settings-forgemaster.png" alt="...">` near the top of the section. |
| 2 | `docs/manual/dashboard.html` | Three insertion points: under §"Tab Categories" (line 56) AND a new `<h2>` per card | `grep -n "id=\"tab-overview\"\|id=\"watcher\"\|id=\"audit-loop\"" docs/manual/dashboard.html` (~lines 56, 238, 253) | (a) Update Tab Categories list to mention three new main-view cards (not new tabs). (b) Insert new `<h2 id="observer-narrations">Observer Narrations Card</h2>` after §"Watcher" (~line 238) — describe live-update behavior, empty state with deep-link, per-narration display, that it's driven by the `observer:narration` hub event. Embed `dashboard-observer-narrations.png`. (c) Insert new `<h2 id="cross-run-anomalies">Cross-Run Watcher Anomalies Card</h2>` immediately after — Refresh-button mechanic, 1 h cache via `.forge/cross-run-cache.json`, table columns (code, severity, recommendation). Embed `dashboard-cross-run-anomalies.png`. (d) Insert `<h2 id="auditor-report">Auditor Latest Report Card</h2>` after that — server-side markdown sanitization, "N reports since…" counter, archive link to `.forge/health/`. Embed `dashboard-auditor-report.png`. |
| 3 | `docs/manual/dashboard-forge-master.html` | After existing `<h3 id="studio-classification">Classification Badge</h3>` (line 48) or in a new "See also" footer | `grep -n "studio-classification\|studio-sessions" docs/manual/dashboard-forge-master.html` (~lines 48, 62) | Add a short cross-reference paragraph or admonition: "Live narrations from observer mode (when enabled) surface on the main dashboard view, not in this Studio tab. See [Dashboard — Observer Narrations Card](dashboard.html#observer-narrations)." This avoids confusion between Studio's pull-based ask-mode UI and the new push-based narrations card. |
| 4 | `docs/capabilities.md` | The `Dashboard ... tabs ... cards` enumerations | `grep -n "dashboard\|Dashboard " docs/capabilities.md` (~lines 73, 151, 210) | (a) The `forge_home_snapshot` row's category `dashboard` already exists — leave as-is. (b) In §"Inner Loop" (~line 151), append the new cards to the discovery line: "… or Dashboard → main view (Observer Narrations / Cross-Run Anomalies / Auditor Report cards)…" (c) Note: the **tool count bump** for `forge_master_observe` is owned by the PARENT phase's Appendix A row 2 — DO NOT double-bump here. |
| 5 | `pforge-mcp/capabilities.mjs` | `TOOL_METADATA` for `forge_home_snapshot` (search for `forge_home_snapshot:`) | `grep -n "forge_home_snapshot:" pforge-mcp/capabilities.mjs` | If `forge_home_snapshot` exposes a `dashboardSurfaces` array, append `"observer-narrations"`, `"cross-run-anomalies"`, `"auditor-report"`. If no such field exists, append the three surface names to the `description` text so `forge_capabilities` agent discovery surfaces them. |
| 6 | `docs/COPILOT-VSCODE-GUIDE.md` | Forge-Master workflow section | `grep -n "forge_master_ask\|Forge-Master\|^### " docs/COPILOT-VSCODE-GUIDE.md` | Replace any guidance that says "edit `.forge.json` to enable observer" with "open the dashboard Settings → Forge-Master tab to enable observer with one click; the page validates budgets and `everyNRuns` server-side." Cross-link to `docs/manual/dashboard-settings.html#settings-forgemaster`. |
| 7 | `CHANGELOG.md` | `[Unreleased]` section | `grep -n "## \[Unreleased\]" CHANGELOG.md` | **If parent phase's CHANGELOG entry has already been promoted to a versioned heading**, add a NEW `[Unreleased]` block for this MINOR: `### Added — Forge-Master Dashboard Surfaces`. Bullets: (a) New settings tab `tab-settings-forgemaster` for observer + auditor config. (b) Observer narrations live card on main dashboard view. (c) Cross-run watcher anomalies card with manual refresh + 1 h cache. (d) Auditor latest-report card with sanitized markdown render + archive link. (e) New read endpoints `GET /api/watcher/cross-run` and `GET /api/auditor/latest`. Promotion to a versioned heading happens in this phase's release slice, NOT in S9. |

### Auto-discovery + visual verification (executor checklist after edits)

After all rows above are applied + screenshots captured:

```bash
# All four screenshots present and ≥ 50 KB (a blank 1x1 PNG is ~100 bytes — guard against empties)
for f in dashboard-settings-forgemaster dashboard-observer-narrations dashboard-cross-run-anomalies dashboard-auditor-report; do
  ls -l "docs/manual/assets/screenshots/$f.png" || echo "MISSING: $f"
done

# New section IDs landed and are unique
grep -E 'id="settings-forgemaster"|id="observer-narrations"|id="cross-run-anomalies"|id="auditor-report"' docs/manual/dashboard*.html
# Expect exactly one match per ID across all dashboard*.html files

# Settings tab count bumped from 9 to 10
grep -c '<h3 id="settings-' docs/manual/dashboard-settings.html   # expect 10 (was 9)

# Cross-link from Studio tab back to main view exists
grep -q 'observer-narrations' docs/manual/dashboard-forge-master.html
```

All four checks must succeed.

### Pre-flight grep sentinel (run BEFORE starting S9)

If any of these has drifted since this appendix was written, update the row above first:

| Value | Expected at draft time | Re-check command |
|---|---|---|
| Settings tab count in `dashboard-settings.html` | 9 `<h3 id="settings-">` | `grep -c '<h3 id="settings-' docs/manual/dashboard-settings.html` |
| Last existing settings tab heading | `<h3 id="settings-brain">🧠 Brain</h3>` (line 103) | `grep -n "settings-brain" docs/manual/dashboard-settings.html` |
| Dashboard main-view `<h2>` count | ~15 sections (Progress, Runs, Cost, Actions, Replay, Extensions, Traces, Skills, Watcher, Audit-Loop, Timeline, Ports …) | `grep -c '<h2 id=' docs/manual/dashboard.html` |
| Screenshots folder file count | 13 PNGs | `ls docs/manual/assets/screenshots/*.png \| wc -l` (this phase adds 4 → 17) |
| Parent phase's CHANGELOG entry state | Either still in `[Unreleased]` or already promoted to a `[X.Y.Z]` heading | `head -20 CHANGELOG.md` |
