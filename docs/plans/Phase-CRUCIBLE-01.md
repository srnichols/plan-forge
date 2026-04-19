# Phase CRUCIBLE-01: Raw Ideas → Hardened Specs — Interactive Smelter

> **Status**: 🟡 DRAFT — to be hardened by Plan Hardener
> **Estimated Effort**: 6 execution slices
> **Risk Level**: Medium (new subsystem, crosses MCP tools + dashboard + CLI, but fully additive)
> **Target Version**: v2.37.0

---

## Overview

Close the "typed a raw prompt and hit go" escape hatch. Add a **Crucible** subsystem that turns every idea, bug, or feature request into a hardened Step-0 spec before any code is written.

Humans interact via a new dashboard tab. Agents call the same functionality through MCP tools. Both paths produce the same artifact: a `docs/plans/Phase-NN.md` ready for Plan Hardener.

Motto: **raw iron (idea) → smelted ingot (spec) → forged blade (code)**.

---

## Design Commitments (non-negotiable)

These were debated and settled in the design memo. Changing them requires a new phase doc, not an in-slice pivot:

1. **Phase naming is decimal-only, semver-style**. `Phase-01`, `Phase-01.1`, `Phase-01.1.1`. No letters. No mixed styles. Granular phase = refinement of parent, never peer.
2. **Three lanes**, user-selectable (agent suggests default):
   - **Tweak**: 2–3 questions → inline slice in active phase
   - **Feature**: 5–6 questions → new slice in existing phase
   - **Full phase**: complete Step-0 interview → new `Phase-NN.md`
3. **Recommended defaults source = memory**. Defaults come from `buildPlanBootContext()` (L3 + L2) + Project Principles. No defaults = no question (leave blank, don't fabricate).
4. **Governance docs (PROJECT-PRINCIPLES.md, profiles) are NOT edited in Crucible**. Read-only view with "Open in VS Code" link. Crucible is for idea→spec only.
5. **Recursion guardrails**: agent self-submits capped at depth 1 by default (configurable ≤ 3), tagged `source=agent`, require human approval unless `--auto-approve-crucible` is set.
6. **Bypass enforcement**: plans without a `crucibleId:` frontmatter field or explicit `--manual-import` flag are rejected by `forge_run_plan`. Backward-compat: existing plans grandfathered via a one-time migration.

---

## Prerequisites

- [ ] v2.36.1 shipped (allowlist hints in place)
- [ ] `buildPlanBootContext()` functional (v2.36.0 GX.2) — required for defaults
- [ ] Hub events infrastructure (v2.36.0 G1.1–G1.4) — required for dashboard live updates
- [ ] 784/784 tests green on master

## Acceptance Criteria

- **MUST**: Dashboard has a Crucible tab in slot 2 (after Overview), with 3 panels: in-progress smelts, active interview, live draft preview
- **MUST**: 6 new MCP tools: `forge_crucible_submit`, `forge_crucible_ask`, `forge_crucible_preview`, `forge_crucible_finalize`, `forge_crucible_list`, `forge_crucible_abandon`
- **MUST**: Smelts persist to `.forge/crucible/<id>.json` (resumable across sessions)
- **MUST**: Three lanes functional: Tweak (2–3 Q), Feature (5–6 Q), Full phase (Step-0 interview)
- **MUST**: Recommended defaults pre-populated from `buildPlanBootContext()`; user can override
- **MUST**: Phase naming validator enforces decimal-only semver rule (`Phase-01`, `Phase-01.1`, `Phase-01.1.1`)
- **MUST**: Atomic phase-number claim via file lock on `.forge/crucible/phase-claims.json`
- **MUST**: `forge_run_plan` rejects plans without `crucibleId:` frontmatter unless `--manual-import` set
- **MUST**: One-time migration grandfathers existing plans with `crucibleId: grandfathered-<uuid>`
- **MUST**: Recursion guardrails: self-referral depth cap (default 1), agent-submitted smelts require approval unless `--auto-approve-crucible`
- **MUST**: New Crucible config section in dashboard Config tab: lane defaults, recursion depth, auto-approve toggle, default-source weights
- **MUST**: 3 new hub events: `crucible-smelt-started`, `crucible-smelt-updated`, `crucible-smelt-finalized`
- **MUST**: Hand-off to Plan Hardener on finalize (invokes Step 2 prompt automatically)
- **SHOULD**: Governance tab shows PROJECT-PRINCIPLES.md + profiles read-only with "Open in VS Code" button
- **SHOULD**: Stale-defaults warning if a smelt is resumed > 24h after last edit and Principles file mtime changed
- **MUST**: 95%+ test coverage on new code (new files only; existing untouched)
- **MUST**: All existing 784 tests still pass

---

## Execution Slices

### Slice 1 — CRUCIBLE-01.1 — Persistence + Phase Naming

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run tests/crucible.test.mjs`

**Tasks**:
1. Create `pforge-mcp/crucible.mjs` with:
   - `parsePhaseName(s)` — validates decimal-semver (`Phase-01`, `Phase-01.1`, `Phase-01.1.1`). Rejects letters/mixed.
   - `comparePhaseNames(a, b)` — sorts deterministically (`01 < 01.1 < 01.2 < 02`)
   - `nextPhaseNumber(existing, parent?)` — returns next available at depth
   - `claimPhaseNumber(projectDir, name)` — file-lock via `.forge/crucible/phase-claims.json` (atomic write, rename-on-write pattern)
   - `releaseClaim(projectDir, id)` — release on abandon
2. Create `pforge-mcp/crucible-store.mjs`:
   - `createSmelt({lane, rawIdea, source, projectDir})` — writes `.forge/crucible/<id>.json`
   - `loadSmelt(id, projectDir)` — reads back, null if missing
   - `updateSmelt(id, patch, projectDir)` — merge + atomic rewrite
   - `listSmelts(projectDir, {status?})` — lists in-progress/finalized
   - `abandonSmelt(id, projectDir)` — marks abandoned, releases phase claim
   - Record schema: `{id, lane, rawIdea, answers[], draftMarkdown, phaseName, createdAt, updatedAt, status, source, parentSmeltId?}`
3. Write `pforge-mcp/tests/crucible.test.mjs` — 20+ tests covering:
   - Phase name validator accepts valid formats, rejects `1D`, `1.C.2`, `2.1A`, mixed
   - Sort order is stable and correct for 20 random cases
   - Atomic claim: two concurrent `claimPhaseNumber` calls — exactly one succeeds
   - Smelt CRUD lifecycle + abandon releases claim

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run tests/crucible.test.mjs   # all pass
grep -rn "TODO\|FIXME" pforge-mcp/crucible.mjs pforge-mcp/crucible-store.mjs   # 0 hits
```

**Stop Condition**: If atomic-claim test flakes → STOP and redesign (must be provably race-safe).

**Files**:
- NEW `pforge-mcp/crucible.mjs`
- NEW `pforge-mcp/crucible-store.mjs`
- NEW `pforge-mcp/tests/crucible.test.mjs`

---

### Slice 2 — CRUCIBLE-01.2 — MCP Tools + Hub Events

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run tests/crucible-server.test.mjs`

**Tasks**:
1. Add 6 tool definitions to `pforge-mcp/server.mjs` (alphabetical in `ListToolsRequestSchema` response):
   - `forge_crucible_submit(rawIdea, lane?, source?)` → `{id, recommendedLane, firstQuestion}`
   - `forge_crucible_ask(id, answer?)` → `{nextQuestion?, done?, draftPreview}` (stateful — serves next question or finalizes)
   - `forge_crucible_preview(id)` → `{markdown, phaseName, unresolvedFields[]}`
   - `forge_crucible_finalize(id)` → `{phaseName, planPath, hardenerInvoked}`
   - `forge_crucible_list({status?})` → `{smelts[]}`
   - `forge_crucible_abandon(id)` → `{abandoned: true}`
2. Register in `pforge-mcp/tools.json` + `pforge-mcp/capabilities.mjs` tool list (bumps count 37 → 43)
3. Add 3 hub events to `pforge-mcp/hub.mjs` event type enum + `EVENTS.md` schema docs:
   - `crucible-smelt-started` `{id, lane, source}`
   - `crucible-smelt-updated` `{id, questionIndex, totalQuestions}`
   - `crucible-smelt-finalized` `{id, phaseName, planPath}`
4. Each tool emits the appropriate hub event on state change
5. Add recommended-lane inference: keyword heuristics (`typo|rename|bump|config` → tweak, `add|implement|support` → feature, `new phase|major|redesign` → full)
6. Write `tests/crucible-server.test.mjs` — 15+ tests:
   - Each tool round-trips via dispatcher
   - Hub events fire with correct payloads
   - Tool count assertion updated (37 → 43)
   - Invalid smelt id → structured error
   - `forge_crucible_ask` with no answer returns first question; with answer advances

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run   # all 784 + new pass
grep -c "forge_crucible" pforge-mcp/tools.json pforge-mcp/server.mjs   # both >= 6
```

**Stop Condition**: If existing tool tests break (tool-count assertions in other tests) → update those assertions in same slice, do NOT split.

**Files**:
- MODIFIED `pforge-mcp/server.mjs`
- MODIFIED `pforge-mcp/tools.json`
- MODIFIED `pforge-mcp/capabilities.mjs`
- MODIFIED `pforge-mcp/hub.mjs`
- MODIFIED `pforge-mcp/EVENTS.md`
- MODIFIED `pforge-mcp/tests/server.test.mjs` (tool count)
- NEW `pforge-mcp/tests/crucible-server.test.mjs`

---

### Slice 3 — CRUCIBLE-01.3 — Interview Engine + Recommended Defaults

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run tests/crucible-interview.test.mjs`

**Tasks**:
1. Create `pforge-mcp/crucible-interview.mjs`:
   - Three question banks: `TWEAK_QUESTIONS` (3), `FEATURE_QUESTIONS` (6), `FULL_QUESTIONS` (12 — mirrors Step-0 prompt)
   - `getNextQuestion(smelt)` → `{id, prompt, recommendedDefault?, required}` or `null` if done
   - `recordAnswer(smelt, questionId, answer)` — updates smelt.answers
   - `buildRecommendedDefault(questionId, context)` — sources from:
     - `buildPlanBootContext()` (L3 memory) — primary
     - `PROJECT-PRINCIPLES.md` parse — secondary
     - Existing plan conventions (scan `docs/plans/Phase-*.md`) — tertiary
     - If none of the above yields a value, return `null` (do NOT fabricate)
2. Create `pforge-mcp/crucible-draft.mjs`:
   - `renderDraft(smelt)` — assembles phase-doc markdown from lane + answers
   - Template includes 6 mandatory blocks (slices, gates, stop conditions, rollback, anti-patterns, change manifest)
   - Unresolved fields marked `{{TBD: question-id}}` so preview can list them
3. Write `tests/crucible-interview.test.mjs` — 25+ tests:
   - Each lane serves correct question count
   - `recordAnswer` advances state
   - Recommended defaults pulled from memory when available
   - Recommended defaults = null when memory empty (no fabrication)
   - Draft renders all 6 mandatory blocks
   - Unresolved fields surfaced correctly

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run tests/crucible-interview.test.mjs
grep -c "{{TBD:" pforge-mcp/crucible-draft.mjs   # template uses placeholders
grep -rn "// fabricate\|// guess" pforge-mcp/crucible-*.mjs   # 0 hits
```

**Stop Condition**: If `buildRecommendedDefault` ever returns fabricated content when memory is empty → STOP and fix.

**Files**:
- NEW `pforge-mcp/crucible-interview.mjs`
- NEW `pforge-mcp/crucible-draft.mjs`
- NEW `pforge-mcp/tests/crucible-interview.test.mjs`

---

### Slice 4 — CRUCIBLE-01.4 — Bypass Enforcement + Grandfather Migration

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run tests/crucible-enforce.test.mjs`

**Tasks**:
1. Modify `pforge-mcp/orchestrator.mjs` `runPlan()`:
   - Parse plan frontmatter. Require `crucibleId:` field OR `--manual-import` CLI flag.
   - Error message (structured) if neither present: `"Plan missing crucibleId — run it through Crucible first, or pass --manual-import to bypass (logged)."`
   - Log all `--manual-import` uses to `.forge/crucible/manual-imports.jsonl` for audit
2. Add frontmatter parser (simple YAML-ish, 3 lines between `---`) — don't pull in full YAML dep
3. Create `pforge-mcp/crucible-migrate.mjs`:
   - `grandfatherExistingPlans(projectDir)` — scans `docs/plans/Phase-*.md`, adds `crucibleId: grandfathered-<uuid>` frontmatter to any lacking it
   - Idempotent (skip if `crucibleId:` already present)
   - Called automatically on first `forge_crucible_list` invocation per project
4. Add CLI flag `--manual-import` to `pforge.ps1` + `pforge.sh` `run-plan` command
5. Write `tests/crucible-enforce.test.mjs` — 12+ tests:
   - Plan with `crucibleId:` → accepted
   - Plan without, no flag → rejected with structured error
   - Plan without, `--manual-import` → accepted + logged to manual-imports.jsonl
   - Grandfather migration is idempotent
   - Grandfather migration adds `grandfathered-*` uuid, not a real smelt id

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run tests/crucible-enforce.test.mjs
# Grandfather migration smoke test on Plan Forge's own docs/plans/
node -e "import('./pforge-mcp/crucible-migrate.mjs').then(m => m.grandfatherExistingPlans(process.cwd()))"
grep -L "crucibleId:" docs/plans/Phase-*.md   # must be empty (all have field)
```

**Stop Condition**: If migration corrupts any plan file (diff shows anything beyond frontmatter added) → STOP, revert, fix.

**Files**:
- MODIFIED `pforge-mcp/orchestrator.mjs`
- MODIFIED `pforge.ps1`
- MODIFIED `pforge.sh`
- NEW `pforge-mcp/crucible-migrate.mjs`
- NEW `pforge-mcp/tests/crucible-enforce.test.mjs`
- MODIFIED `docs/plans/Phase-CRUCIBLE-01.md` (this file gets `crucibleId:` on finalize — self-hosting check)

---

### Slice 5 — CRUCIBLE-01.5 — Dashboard Crucible Tab

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run tests/server.test.mjs` (tab count assertion)

**Tasks**:
1. Modify `pforge-mcp/dashboard/index.html`:
   - Insert Crucible tab in position 2 (after Overview, before Plan): `<button data-tab="crucible">🔥 Crucible</button>`
   - Add `<section id="tab-crucible">` with 3-column grid layout:
     - Left (25%): smelt list (in-progress + recent finalized), "+ New Smelt" button
     - Center (45%): active interview — question text, recommended default (pre-filled), answer textarea, Prev/Next buttons, lane indicator
     - Right (30%): live draft preview (rendered markdown, unresolved fields highlighted)
2. Modify `pforge-mcp/dashboard/app.js`:
   - Add `TAB_LOADERS.crucible` entry
   - `loadCrucible()` — fetch `GET /api/crucible/list`, render smelt list
   - `startNewSmelt()` — modal for raw-idea input + lane picker (with AI recommendation), POSTs to `/api/crucible/submit`
   - `answerQuestion(smeltId, answer)` — POSTs to `/api/crucible/ask`, re-renders
   - `finalizeSmelt(smeltId)` — calls `/api/crucible/finalize`, shows toast + hands off to Plan Hardener
   - Subscribe to hub events `crucible-smelt-started/updated/finalized` for live updates
3. Add REST endpoints to `pforge-mcp/server.mjs`:
   - `POST /api/crucible/submit` `{rawIdea, lane?}` → `{id, firstQuestion}`
   - `POST /api/crucible/ask` `{id, answer}` → `{nextQuestion?, done?, draftPreview}`
   - `GET /api/crucible/list` → `{smelts[]}`
   - `GET /api/crucible/preview?id=…` → `{markdown, phaseName, unresolvedFields}`
   - `POST /api/crucible/finalize` `{id}` → `{phaseName, planPath}`
   - `POST /api/crucible/abandon` `{id}` → `{abandoned: true}`
4. Update `server.test.mjs`:
   - `CORE_TABS` array gains `"crucible"` at index 1
   - Tab count assertions 16 → 17 total, 11 → 12 core
5. Add 8+ dashboard tests (`tests/crucible-dashboard.test.mjs`):
   - All 6 REST endpoints return expected shapes
   - 401/400 behavior on bad inputs

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run   # all green
grep -c "tab-crucible" pforge-mcp/dashboard/index.html   # >= 1
grep -c "TAB_LOADERS.crucible\|loadCrucible" pforge-mcp/dashboard/app.js   # >= 2
```

**Stop Condition**: Tab count assertion drift beyond +1 suggests accidental duplicate tab — STOP, audit.

**Files**:
- MODIFIED `pforge-mcp/dashboard/index.html`
- MODIFIED `pforge-mcp/dashboard/app.js`
- MODIFIED `pforge-mcp/server.mjs`
- MODIFIED `pforge-mcp/tests/server.test.mjs`
- NEW `pforge-mcp/tests/crucible-dashboard.test.mjs`

---

### Slice 6 — CRUCIBLE-01.6 — Config Page + Governance View + Hardener Handoff + Docs

**Build command**: `npm --prefix pforge-mcp test -- --run`
**Test command**: `npm --prefix pforge-mcp test -- --run`

**Tasks**:
1. Add Crucible config section to Config tab (`pforge-mcp/dashboard/index.html` + `app.js`):
   - Default lane (Tweak/Feature/Full)
   - Self-referral depth cap (0–3, default 1)
   - Auto-approve agent-submitted smelts (bool, default false)
   - Default-source weights (L3 memory / Principles / existing plans — 3 sliders summing to 100)
   - Stale-defaults warning threshold in hours (default 24)
   - Persists to `.forge/crucible/config.json`
2. Add Governance tab (read-only, slot 3, after Crucible):
   - Renders `PROJECT-PRINCIPLES.md` + profile files as HTML
   - "Open in VS Code" button per file → `vscode://file/<absolute-path>`
   - Shows last-modified timestamp
   - No edit affordance — intentional
3. Implement Hardener handoff in `forge_crucible_finalize`:
   - Writes `docs/plans/Phase-<name>.md`
   - Invokes `step2-harden-plan.prompt.md` logic (or emits `crucible-handoff-to-hardener` event the dashboard listens to and shows a "Hardener ready" action)
4. Implement stale-defaults warning:
   - On smelt resume, check if `PROJECT-PRINCIPLES.md` mtime > smelt.updatedAt
   - If threshold exceeded, show warning banner in UI + include in `forge_crucible_ask` response as `warnings: [...]`
5. Manual chapter: add **Chapter 6.6 — Crucible** to `docs/manual/`:
   - NEW `docs/manual/crucible.html` (following existing chapter template)
   - Update `docs/manual/assets/manual.js` CHAPTERS array
   - Covers: philosophy, three lanes, recursion guardrails, bypass enforcement, config, troubleshooting
6. Update `CHANGELOG.md` with v2.37.0 entry listing all 6 slices
7. Bump `VERSION` → `2.37.0`, `pforge-mcp/package.json` → `2.37.0`
8. Add `crucibleId:` frontmatter to `docs/plans/Phase-CRUCIBLE-01.md` itself (self-hosting moment)

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- --run                     # full suite green
grep -c "Crucible" docs/manual/assets/manual.js           # >= 1 (chapter registered)
grep -c "crucibleId:" docs/plans/Phase-CRUCIBLE-01.md     # >= 1 (self-hosted)
cat VERSION                                               # 2.37.0
```

**Stop Condition**: If Governance tab exposes any edit path (even accidentally) → STOP, remove. Governance must be read-only.

**Files**:
- MODIFIED `pforge-mcp/dashboard/index.html` (Config section + Governance tab)
- MODIFIED `pforge-mcp/dashboard/app.js`
- MODIFIED `pforge-mcp/server.mjs` (config endpoints + governance file-read endpoint)
- NEW `docs/manual/crucible.html`
- MODIFIED `docs/manual/assets/manual.js`
- MODIFIED `CHANGELOG.md`
- MODIFIED `VERSION`
- MODIFIED `pforge-mcp/package.json`
- MODIFIED `docs/plans/Phase-CRUCIBLE-01.md` (add `crucibleId:` frontmatter)

---

## Rollback Plan

1. **Code**: Revert merge commit (all 6 slices squash-merged into a single PR #35 — `git revert -m 1 <merge-sha>`)
2. **Data**: `.forge/crucible/` directory is fully additive — delete to reset. No existing data migrated destructively.
3. **Plans**: Grandfather migration only *adds* frontmatter — run `git checkout docs/plans/Phase-*.md` to revert those additions if needed.
4. **Config**: `.forge/crucible/config.json` is isolated; delete to reset to defaults.
5. **Bypass enforcement**: Setting `--manual-import` on all future runs restores pre-Crucible behavior without code changes.

---

## Anti-Pattern Checks

```bash
# Run after each slice
grep -rn "TODO\|FIXME\|HACK" pforge-mcp/crucible*.mjs   # must be 0 by slice 6
grep -rn "// TODO\|// guess\|// fabricate" pforge-mcp/crucible*.mjs   # must be 0
grep -rn "as any\|@ts-ignore" pforge-mcp/dashboard/app.js   # must be 0
grep -rn "contentEditable\|<textarea.*principles" pforge-mcp/dashboard/index.html   # must be 0 (Governance is read-only)
grep -c "crucibleId:" docs/plans/Phase-*.md | grep ":0$"   # must be empty (every plan has field)
```

---

## Change Manifest (file-level)

### New files (11)
- `pforge-mcp/crucible.mjs`
- `pforge-mcp/crucible-store.mjs`
- `pforge-mcp/crucible-interview.mjs`
- `pforge-mcp/crucible-draft.mjs`
- `pforge-mcp/crucible-migrate.mjs`
- `pforge-mcp/tests/crucible.test.mjs`
- `pforge-mcp/tests/crucible-server.test.mjs`
- `pforge-mcp/tests/crucible-interview.test.mjs`
- `pforge-mcp/tests/crucible-enforce.test.mjs`
- `pforge-mcp/tests/crucible-dashboard.test.mjs`
- `docs/manual/crucible.html`

### Modified files (10)
- `pforge-mcp/server.mjs` (6 new tools + 6 REST endpoints + Governance endpoint)
- `pforge-mcp/orchestrator.mjs` (bypass enforcement in `runPlan`)
- `pforge-mcp/tools.json` (6 new tool defs)
- `pforge-mcp/capabilities.mjs` (tool count, new category)
- `pforge-mcp/hub.mjs` (3 new event types)
- `pforge-mcp/EVENTS.md` (3 new schemas)
- `pforge-mcp/dashboard/index.html` (Crucible tab, Governance tab, Config section)
- `pforge-mcp/dashboard/app.js` (loaders + event subscriptions)
- `pforge-mcp/tests/server.test.mjs` (tab count 16→17, tool count 37→43)
- `docs/manual/assets/manual.js` (chapter 6.6 registered)
- `CHANGELOG.md`, `VERSION`, `pforge-mcp/package.json` (v2.37.0)

### Plans touched (grandfather migration, slice 4)
- All existing `docs/plans/Phase-*.md` files gain `crucibleId: grandfathered-<uuid>` frontmatter (idempotent, reversible)

---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice | ✅ |
| 3 | Stop conditions | ✅ |
| 4 | Rollback plan (5 tiers) | ✅ |
| 5 | Anti-pattern grep commands | ✅ |
| 6 | File-level change manifest | ✅ |

---

## Scope Contract (for Plan Hardener)

**IN SCOPE**:
- New Crucible subsystem (MCP tools, persistence, interview engine, dashboard tab)
- Bypass enforcement in `forge_run_plan`
- Grandfather migration for existing plans
- Read-only Governance tab
- Crucible config section
- Manual chapter 6.6
- Version bump to v2.37.0

**OUT OF SCOPE** (defer to later phases):
- Crucible edit pages for PROJECT-PRINCIPLES.md / profiles (explicit governance boundary — read-only forever, or until a separate phase argues otherwise)
- Monaco editor embedding in dashboard (long docs go to VS Code via `vscode://` protocol)
- Multi-project Crucible coordination (each project has its own `.forge/crucible/`)
- Agent-to-agent Crucible handoff across repositories (single-repo only in v1)
- AI-powered "rewrite my draft for me" button (first version: defaults + user-authored answers only, no post-hoc rewrite)

**FORBIDDEN ACTIONS** (enforced by PreToolUse hook during execution):
- Editing any file under `docs/plans/examples/` (reference only)
- Modifying `.forge/` outside `.forge/crucible/`
- Adding edit affordances to the Governance tab
- Fabricating recommended defaults when memory yields nothing
