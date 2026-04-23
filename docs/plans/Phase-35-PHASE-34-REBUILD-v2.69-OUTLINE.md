---
lane: full
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-35 — Phase-34 Hollow Slice Rebuild (Meta-Bug #96)

> **Target release**: v2.69.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: v2.68.1 shipped
> **Addresses**: Meta-bug [#96](https://github.com/srnichols/plan-forge/issues/96) — Phase-34 Slices 2 & 3 shipped hollow

## Core Problem

Phase-34 bundled three slices: (1) tier resolver + config schema + 429 fallback, (2) auto-escalation for high-stakes lanes, (3) dashboard dial UI + per-user prefs persistence. Slice 1 landed. Slices 2 and 3 shipped with test files committed but no implementation, because the grep-only gates matched placeholder identifiers without ever running `vitest`.

Running the test suites on master today:

- `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` — **10 failures**. Tests import `LANE_DESCRIPTORS` and `LANES.TEMPERING` from `intent-router.mjs`; neither symbol exists.
- `pforge-mcp/tests/forge-master-prefs.test.mjs` — **5 failures**. Tests hit `GET /api/forge-master/prefs` and `PUT /api/forge-master/prefs`; neither route is registered.

The v2.68.0 release notes promise features that do not exist in the shipped binary. This is a trust defect, not a feature gap.

## Design Constraints

- **Truthful release.** Rebuild the missing code until both test files pass unmodified. No skipping, no `.skip`, no deletion.
- **No drift from the original Phase-34 contract.** Lanes to add: `tempering`, `principle-judgment`, `meta-bug-triage` (each with `recommendedTierBump: 1`). `autoEscalate` default `true`. Prefs endpoints GET/PUT under `/api/forge-master/prefs` backed by `.forge/forge-master-prefs.json` (gitignored). Dial UI: Fast/Balanced/Deep, no model names, tooltip language unchanged.
- **Gates must run the tests.** Every slice gate invokes `npx vitest run <file>` and greps for `Tests  N passed`. Structural grep on source is allowed **only as a secondary check**, never as the sole gate. This rule is the core fix for meta-bug #96.
- **No regressions in Phase-34 Slice 1.** Existing tier-resolution tests must still pass. Re-run the Slice 1 vitest suite in each gate.
- **Close the meta-bug on ship.** Final slice commit message includes `Closes #96` + a changelog entry noting the phantom-completion root cause.

## Candidate Slices

### Slice 1 — Intent-router additions (`LANE_DESCRIPTORS`, new lanes, `recommendedTierBump`)

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), existing [pforge-master/src/__tests__/intent-auto-escalation.test.mjs](pforge-master/src/__tests__/intent-auto-escalation.test.mjs).

- Extend `LANES` with `TEMPERING`, `PRINCIPLE_JUDGMENT`, `META_BUG_TRIAGE`.
- Export `LANE_DESCRIPTORS` — map from lane → `{ recommendedTierBump: number, description: string }`. Default bump `0`; `tempering` / `principle-judgment` / `meta-bug-triage` get bump `1`. Opt-out respected via config flag.
- Keyword patterns for each new lane (see `scoreKeywords`). Minimum set:
  - `tempering` — `\b(tempering|coverage|smelt|temper)\b`
  - `principle-judgment` — `\b(principle|vibe.coding|over.engineer|separation of concerns|4th layer)\b`
  - `meta-bug-triage` — `\b(meta.bug|plan.defect|orchestrator.defect|prompt.defect|hollow.slice|phantom)\b`
- **Gate**: `npx vitest run pforge-master/src/__tests__/intent-auto-escalation.test.mjs` must report `Tests  10 passed`. No source grep.

### Slice 2 — Auto-escalation in `runTurn`

**Scope**: [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), existing auto-escalation tests.

- When `classification.lane` has `recommendedTierBump > 0` and no explicit `input.model` override, bump the requested tier for this turn only: `low→medium→high`, capped at `high`.
- Log to turn trace: `autoEscalated: true, fromTier, toTier, reason: "lane=<lane>"`.
- Respect `config.forgeMaster.autoEscalate = false` (skip bump).
- **Gate**: `npx vitest run pforge-master/src/__tests__/intent-auto-escalation.test.mjs` full 10 tests green, **plus** Slice 1 tier-resolution tests still green (re-run to catch regressions).

### Slice 3 — Prefs REST endpoints + file persistence

**Scope**: [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs), new `pforge-master/src/prefs.mjs`, existing [pforge-mcp/tests/forge-master-prefs.test.mjs](pforge-mcp/tests/forge-master-prefs.test.mjs), `.gitignore`.

- New `prefs.mjs` module exporting `readPrefs({ cwd })` and `writePrefs({ cwd, prefs })` — backing store `.forge/forge-master-prefs.json`. Default `{ tier: "low", autoEscalate: true }` when file absent.
- `GET /api/forge-master/prefs` → returns current prefs (defaults if missing).
- `PUT /api/forge-master/prefs` → body `{ tier?, autoEscalate? }`. Validates `tier ∈ {"low","medium","high"}` else 400. Writes file atomically. Returns persisted object.
- `forge_master_ask` tool in `pforge-mcp/server.mjs` reads `prefs.tier` on each invocation and threads it into `runTurn({ tier })`.
- Add `.forge/forge-master-prefs.json` to `.gitignore` if not present.
- **Gate**: `npx vitest run pforge-mcp/tests/forge-master-prefs.test.mjs` reports `Tests  5 passed`.

### Slice 4 — Dashboard dial UI + release v2.69.0

**Scope**: [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js), [pforge-mcp/dashboard/served-app.js](pforge-mcp/dashboard/served-app.js), [CHANGELOG.md](CHANGELOG.md), [VERSION](VERSION), `package.json` files.

- Segmented control (Fast / Balanced / Deep) on Forge-Master tab. On change: `PUT /api/forge-master/prefs`. On load: `GET /api/forge-master/prefs` to restore last choice.
- Toast on dial change, auto-escalation, and 429 fallback — copy matches Phase-34 original contract.
- No model names in DOM or CSS class names.
- Bump VERSION to 2.69.0 across `VERSION`, `pforge-mcp/package.json`, `pforge-master/package.json`, `package.json`, root `package.json` lockfiles.
- CHANGELOG entry: `[2.69.0] — Phase-34 completion rebuild. Closes #96. Root cause: phantom completion — grep-only gates shipped hollow. Fix: all gates now invoke vitest.`
- Commit message: `Closes #96`.
- **Gate**: `grep -q "2.69.0" VERSION` AND `grep -q "Closes #96" CHANGELOG.md` AND `grep -q "Fast\\|Balanced\\|Deep" pforge-mcp/dashboard/forge-master.js` AND NOT grep for model names (`gpt-4\\|claude\\|gemini`) in `pforge-mcp/dashboard/forge-master.js`.

## Required Decisions

1. Keyword coverage minimums for new lanes (see Slice 1). Step2 may tune.
2. Whether Slice 4 also deletes the deprecated Phase-34 PLAN file marker — leave it in place (historical).
3. Should #96 close automatically via commit or explicit `gh issue close`? — commit footer is simpler.

## Forbidden Actions

- **No deleting or skipping tests** in `intent-auto-escalation.test.mjs` or `forge-master-prefs.test.mjs`.
- **No structural-only gates.** Every gate that references a test file must execute that test file via vitest.
- **No model names in dashboard UI strings.**
- **No editing** `docs/plans/Phase-34-FORGE-MASTER-REASONING-DIAL-v2.68-PLAN.md` — it's the historical record of what was promised.
