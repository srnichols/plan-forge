---
lane: full
source: human
---

# Phase-30 — Settings Panel Decomposition

> **Target release**: v2.64.0
> **Status**: Draft (seed — needs `pforge analyze` hardening before execution)
> **Depends on**: v2.63.2 shipped (commit `0710256` — Config promoted to top-level Settings group, Forge-Master promoted to top-level group). The four-group nav (Forge / LiveGuard / Forge-Master / Settings) and `switchGroup()` table-driven handling must be in place.
> **Branch strategy**: Direct to `master`. Pure **decomposition + relocation** — no new features, no behavioral changes to config read/write or persistence. Every setting keeps its current `.forge.json` key and `/api/config` round-trip.
> **Session budget**: 1 session, ~6 slices (1 per new sub-tab plus one for the structural frame).
> **Design posture**: **Zero logic change.** The oversized `#tab-config` section (currently ~340 HTML lines with three internal `cfg-subtab` buttons invented before the top-level Settings group existed) is broken into proper Settings sub-tabs that live in `subtabs-settings` alongside the existing General/Notifications/Brain. DOM elements move, their IDs are preserved where possible so existing `app.js` save/load handlers keep working with zero refactor. Where an ID rename is required, the handler reference is updated in the same slice. No new endpoints.

---

## Specification Source

- **Field input**: Owner observation 2026-04-21: "config is too big now." Filed immediately after v2.63.2 shipped the Settings top-level promotion (Option A) — this plan is Option C, the structural decomposition that Option A deliberately deferred.
- **Diagnostic anchor — why the current single Settings page is wrong**: The Settings surface currently packs 8 unrelated configuration groups into one 340-line `<section>`: Project identity (preset, version, agents), Model routing (default + image), Execution tuning (parallelism, retries, quorum — hidden behind a `<details>` accordion), API keys, Update source, OpenBrain memory, Bridge notifications, Crucible pipeline config. Accordion disclosure is compensating for missing tab structure. Scroll distance from the Save button at top to the Crucible config at bottom currently exceeds one viewport height at 1080p. A Settings app with 8 independent concern groups is a textbook case for sub-tab organization.
- **Diagnostic anchor — why this is Phase-30 not a hotfix**: The split touches DOM IDs that `app.js` save/load handlers read from by ID. A careless rename breaks Save silently. This earns a proper plan with per-slice structural-test gates (each slice asserts the Settings sub-tab exists + the moved element IDs resolve + the round-trip save/load test still passes) rather than an ad-hoc commit.
- **Architecture anchor**: All work is contained to `pforge-mcp/dashboard/index.html` (DOM restructure) and `pforge-mcp/dashboard/app.js` (subtab click handler + any ID references that need re-pointing). Test additions in `pforge-mcp/tests/server.test.mjs` (structural) and optionally `pforge-mcp/tests/dashboard-settings.test.mjs` if handler behavior needs its own suite. No server-side routes change. No `.forge.json` schema change. No config persistence change.
- **Explicit non-goal**: This plan does **not** add new settings, does **not** change what each setting means, and does **not** modify Save/Load semantics. Decomposition only.

---

## Feature Specification

### Problem Statement

After v2.63.2 promoted Config to a top-level Settings group, the Settings surface is still a single massive form with three ad-hoc `cfg-subtab` buttons (General / Notifications / Brain) that predate the top-level group promotion. The "General" sub-tab alone spans ~200 lines of DOM and houses 7 logically independent configuration groups: project identity, model routing, execution tuning (itself hidden in a `<details>` accordion), API keys, update source, memory, and Bridge notifications. Below the closing tag of the whole subtab container, a separate Crucible-config panel sits orphaned inside `#tab-config` without being part of any subtab. The `<details>` accordion is an obvious tell — it exists because the UI ran out of vertical budget and had to hide complexity. The owner cannot find a setting without scrolling or hunting through accordions. This plan replaces the single overloaded `#cfg-general` panel plus the orphaned Crucible panel with a proper sub-tab bar under the Settings top-level group.

### User Scenarios

1. **Owner tunes quorum before a costly run** — Owner clicks **Settings → Execution**. The Execution sub-tab opens directly to parallelism / retries / history limit / quorum settings / worker availability. No accordion click, no scrolling past project identity. Owner edits the quorum threshold, clicks Save, and returns to the Forge group to launch the plan. Total clicks from dashboard home to "saved": 3.
2. **Owner rotates an API key** — Owner clicks **Settings → API Keys**. The API Keys sub-tab shows the per-provider key list and provider-status badges. Key-only concerns — no project identity, no model routing, no memory state — on screen. Owner pastes a new `XAI_API_KEY`, clicks Save. Done.
3. **New user discovers Bridge** — New user clicks **Settings**, sees 8 sub-tabs in the Settings sub-row, and notices "Notifications" as a peer of General/Models/Execution. Clicks in. Full Bridge adapter grid and routes editor are the whole surface — not buried inside a `<details>` inside General. The Notifications sub-tab already exists in v2.63.2; this plan promotes it to a Settings peer alongside the new decomposed tabs.
4. **Crucible config is findable** — Owner looks for the Crucible config they vaguely remember editing a month ago. **Settings → Crucible**. Not hidden at the bottom of a scrolling list below three other concern groups.

### Acceptance Criteria

**Sub-tab frame**

- **MUST**: `subtabs-settings` in `index.html` contains exactly 8 sub-tab buttons in this order: `general`, `models`, `execution`, `api-keys`, `updates`, `memory`, `bridge`, `crucible`, `brain`. (The existing `config` data-tab is retired — see below.)
- **MUST**: Each sub-tab button uses `data-tab="settings-<slug>"` (e.g. `data-tab="settings-models"`) and has a `data-testid="settings-<slug>-tab-btn"` for E2E anchoring. Hover color is `hover:text-purple-400` matching the Settings group.
- **MUST**: The original `data-tab="config"` button is **removed**. The `#tab-config` section is split into 9 `<section class="tab-content hidden" id="tab-settings-<slug>">` siblings (one per sub-tab). The internal `cfg-subtab` button row inside `#tab-config` is **deleted** — the top-level Settings sub-row replaces it entirely.
- **MUST**: Default-active sub-tab on Settings group entry is `settings-general`. `switchGroup('settings')` continues to auto-click the first sub-tab in the row.

**Decomposition mapping (every DOM element accounted for)**

Every element currently in `#tab-config` moves to exactly one destination. The mapping is exhaustive — no element left un-relocated, no element duplicated.

| Current location (within `#tab-config`) | Destination section | Notes |
|------------------------------------------|--------------------|-------|
| `#cfg-preset`, `#cfg-version`, `#cfg-agents` | `#tab-settings-general` | Project identity block |
| `#cfg-model-default`, `#cfg-model-image` | `#tab-settings-models` | Model routing block |
| `#cfg-max-parallel`, `#cfg-max-retries`, `#cfg-max-history`, `#cfg-quorum-enabled`, `#cfg-quorum-preset`, `#cfg-quorum-threshold`, `#cfg-quorum-models`, `#cfg-workers` | `#tab-settings-execution` | The `<details>` accordion is **flattened** — contents become a plain section since vertical budget no longer constrains us |
| `#cfg-api-keys`, `#cfg-api-providers` | `#tab-settings-api-keys` | |
| `#cfg-update-source`, `#cfg-update-source-hint` | `#tab-settings-updates` | |
| `#cfg-openbrain`, `#memory-search-panel` (+ `#memory-search-input`, `#memory-search-results`, `#memory-presets`) | `#tab-settings-memory` | |
| `#cfg-bridge-details` contents (the `<details>` is flattened) + entire `#cfg-notifications` current sub-tab contents | `#tab-settings-bridge` | Bridge status + channels + approvals + adapter grid + routes editor + rate-limit inputs all consolidated on one tab. The owner-facing concept is "notifications" — the sub-tab label is "Bridge" to match the code path and `.forge.json` key but the icon/description clarifies it is notification configuration. |
| Orphaned Crucible config (currently below `#cfg-notifications`/`#cfg-brain`, inside `#tab-config`) | `#tab-settings-crucible` | |
| Existing `#cfg-brain` contents (tier counters, top keys, recall misses) | `#tab-settings-brain` | |
| `#cfg-skeleton` loading skeleton | Duplicated into each destination section, or kept as a single skeleton rendered on Settings group entry — slice-author's call, whichever preserves the existing perceived-load behavior |
| `#cfg-status` status line | Duplicated per-section OR one shared status line inside the Settings nav — slice-author's call |
| Save/Reload button row currently at the bottom of `#cfg-general` | One pair of buttons per destination section, each calling the same `saveConfig()` / `loadConfig()` handlers as today — OR a single sticky Save bar at the bottom of the Settings surface. Slice-author's call. Constraint: the `saveConfig()` call signature and `.forge.json` write semantics do not change |

- **MUST**: Every DOM `id` listed in the mapping above resolves via `document.getElementById(...)` after the split. `app.js` `loadConfig()`, `saveConfig()`, `renderNotificationsSubtab()`, `renderBrainSubtab()`, and all Bridge/Memory/Crucible render functions continue to work without being rewritten. Any handler that currently reads `document.getElementById("cfg-preset").value` resolves to the same field post-split.
- **MUST**: If an ID rename is required for structural clarity, (a) the rename is justified in the slice commit message, (b) every JS reference is updated in the same slice, (c) a structural test asserts both old-ID-absent and new-ID-present.

**Persistence + endpoint contract (unchanged)**

- **MUST**: `/api/config` (or whatever existing endpoints are hit) is called with the same request body shape as v2.63.2. A round-trip test (`loadConfig()` → mutate one field → `saveConfig()` → `loadConfig()`) produces the same result before and after this plan. This test is a per-slice gate.
- **MUST**: `.forge.json` schema is **not** modified. A `git diff` of a `.forge.json` written before the split versus after the split (with identical UI inputs) produces zero differences.

**Test coverage**

- **MUST**: `pforge-mcp/tests/server.test.mjs` dashboard block gains assertions for each new `data-tab="settings-<slug>"` and each new `id="tab-settings-<slug>"`. The legacy `data-tab="config"` button and `id="tab-config"` must no longer match. The existing `SETTINGS_TABS` constant is expanded from `["config"]` to the 9-element list.
- **MUST**: Total `data-tab` count in the HTML (currently 25 after v2.63.2) updates to `25 - 1 + 9 = 33`. The existing test `"total tab count is 25 ..."` is updated to 33 with a comment explaining the change.
- **MUST**: The `tabLoadHooks` coverage test (`HOOKED_TABS = ALL_TABS.filter(t => t !== "actions")`) continues to pass — each new `settings-<slug>` tab has an entry in `tabLoadHooks` even if the entry is a no-op or a call to the existing `renderXSubtab()` function.
- **SHOULD**: A new test file `pforge-mcp/tests/dashboard-settings.test.mjs` asserts the decomposition-mapping table end-to-end: for each row in the mapping, the element ID resolves inside the expected destination section after parsing the HTML with a DOM library. This codifies the mapping as a machine-checkable invariant.

**Visual + UX**

- **MUST**: The flattened `<details>` accordions (Execution's "Advanced Settings", Bridge's `#cfg-bridge-details`) retain their headings as `<h3>` section titles on the new sub-tabs. No information is lost — only the disclosure widget goes away.
- **MUST**: Icons on the 9 sub-tab buttons are distinct (SVG selection is slice-author's call but must pass a visual distinctiveness review). Reuse the existing gear icon only for `settings-general`.
- **SHOULD**: A one-paragraph "What lives here?" header on each Settings sub-tab explaining the section's scope. This is the one concession to new content in an otherwise pure-decomposition plan.

**Completeness sweep**

- **MUST**: After all 9 sections are populated, the legacy `<section id="tab-config">` tag and every internal `cfg-subtab` button are **removed** from `index.html`. No dead DOM. The sweep-step must grep for `id="tab-config"`, `data-tab="config"`, and `class="cfg-subtab` and report zero hits.
- **MUST**: `app.js` references to `cfg-subtab` selectors (the old internal click handler) are removed. A grep for `cfg-subtab` in `pforge-mcp/dashboard/` must return zero hits.
- **MUST**: Recapture the dashboard screenshot set used in `docs/COPILOT-VSCODE-GUIDE.md` and `docs/manual/` if any currently show the legacy single-page Settings surface.

---

## Out-of-Scope

- New settings, new fields, new providers, new endpoints.
- Any change to the Forge, LiveGuard, or Forge-Master groups.
- Any change to `subtabs-forge` content, ordering, or counts.
- Any change to the Crucible smelting pipeline (only its **config UI** relocates).
- Mobile/responsive work. Dashboard is loopback-only desktop.
- Search/filter across Settings sub-tabs (future — tracked separately).

---

## Slice Plan (to be hardened)

| # | Title | Primary files | Validation gate |
|---|-------|---------------|-----------------|
| 1 | Sub-tab frame in `subtabs-settings` | index.html, app.js, server.test.mjs | 9 new `data-tab` buttons exist; old `data-tab="config"` removed; switchGroup auto-activates `settings-general` |
| 2 | General + Models sections | index.html, app.js | `#cfg-preset`, `#cfg-version`, `#cfg-agents`, `#cfg-model-default`, `#cfg-model-image` resolve inside their destination sections; save/load round-trip test passes |
| 3 | Execution + API Keys + Updates sections | index.html, app.js | `<details>` accordion flattened; all listed IDs resolve; round-trip passes |
| 4 | Memory + Brain sections | index.html, app.js | OpenBrain status still renders; memory search still functions; brain tier counters still populate |
| 5 | Bridge (consolidated) + Crucible sections | index.html, app.js | Bridge channels list renders; notifications save round-trip passes; Crucible config save round-trip passes |
| 6 | Completeness sweep + legacy DOM removal | index.html, app.js, tests | Zero grep hits for `tab-config` / `cfg-subtab`; `dashboard-settings.test.mjs` passes; full vitest suite passes |

---

## Forbidden Actions

- Renaming `.forge.json` keys.
- Changing `/api/config` or `/api/notifications` or `/api/brain` request/response shapes.
- Deleting any setting that currently exists.
- Adding new settings.
- Moving a setting to a destination other than the one in the decomposition-mapping table.
- Editing files outside `pforge-mcp/dashboard/**` and `pforge-mcp/tests/**` except to update documentation screenshots.

---

## Rollback Plan

Single-commit revert. The decomposition is contained to three files (index.html, app.js, tests). `git revert <merge-sha>` restores the prior Settings surface. `.forge.json` is unchanged so no data migration is required in either direction.
