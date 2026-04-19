---
crucibleId: 6435440a-19bf-421d-ba19-ab57758c5ba2
source: self-hosted
status: draft
phase: TEMPER-04
arc: TEMPER
---

# Phase TEMPER-04: Visual analyzer — quorum-mode vision + diff

> **Status**: 📝 DRAFT (arc-prep, no code yet)
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium-high (LLM cost surface; false-positive risk
> managed via quorum)
> **Target Version**: v2.45.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

UI sweep (TEMPER-03) confirms every page loads. Assertions confirm
every function returns what it should. Neither of them catches:

- A CSS regression that makes the "Buy" button invisible but clickable
- A typo in a headline that passes spell-check because it's a real word
- A layout collapse on narrow viewports that keeps the test green
  (page still loads, assertions still pass)
- A color-contrast regression that automated a11y tools miss because
  it's in an icon overlay
- Accidentally rendered debug overlays, placeholder "Lorem ipsum", or
  mock data in production builds

These are the failures most visible to end users and most invisible to
conventional tests. A human glancing at the screen sees them instantly.
This phase gives tempering that same glance — using vision-capable LLMs,
**in quorum mode by default** for reliability.

## Scope Contract

### In-scope

**Slice 04.1 — Screenshot diff + single-model analyzer**

- `pforge-mcp/tempering/scanners/visual-diff.mjs` — new scanner
- **Pixel-diff baseline**: for each screenshot captured in TEMPER-03,
  compare against the last green baseline stored in
  `.forge/tempering/baselines/<url-hash>.png`
- Diff library: `pixelmatch` + `pngjs` (node-native, no system deps)
- **Thresholds** (configurable, enterprise defaults):
  - `ignorableDiff`: < 0.1% changed pixels
  - `investigateDiff`: 0.1% – 2% — flag for LLM analysis
  - `failureDiff`: > 2% — automatic regression flag
- **LLM analyzer invoked on investigate band**:
  - Single-model mode (Slice 04.1): default `claude-opus-4.7`, user can
    override via `config.visualAnalyzer.models[0]`
  - Prompt: baseline + current + diff image + page URL + expected
    intent from the plan slice
  - Returns JSON: `{ regression: bool, severity: ..., explanation: ... }`
- New hub event `tempering-visual-regression-detected` — used by the
  dashboard for live-alert toasts
- Baselines **opt-in promotion**: user approves a current screenshot as
  new baseline via dashboard (single click) or CLI (`pforge tempering
  approve-baseline <url>`)
- Tests with synthetic image fixtures — ~30 assertions

**Slice 04.2 — Quorum-mode default + visual-diff viewer**

- **Quorum mode** (enterprise default, as specified in arc):
  - 3 vision models (default: claude-opus-4.7, grok-4.20,
    gemini-3-pro-preview — pulled from existing quorum config)
  - Agreement threshold 2-of-3
  - When quorum fails (e.g. 1-1-1 split), falls back to "inconclusive"
    status (not pass, not fail) → human review queued via dashboard
- **Dashboard visual-diff viewer**:
  - Side-by-side baseline / current / diff
  - LLM explanations visible for each model in quorum
  - Buttons: approve-as-new-baseline, open-bug-in-registry (bridges to
    TEMPER-06), ignore-once
- Cost-aware scheduling: visual-analyzer only runs against pages in the
  investigate band, not the full baseline every run
- **L3 capture** on every quorum decision (pass, fail, or inconclusive)
  via `captureMemory()` — tags `tempering`, `visual-regression`,
  `<verdict>`, `quorum:<n-of-m>`; payload: per-model verdict +
  explanation snippet + page URL. **No images** — screenshots stay
  in L2. See arc doc §"L3 semantic memory (OpenBrain) integration".
- Tests — ~25 assertions

### Out of scope

- Video / motion regression (huge cost surface; deferred indefinitely)
- OCR-only baselines (the quorum models already handle text)
- Cross-browser diffs (Chromium is the default; extension opportunity
  for Firefox / WebKit)
- Dark-mode / theme toggle matrix — extension opportunity
- Mobile viewport matrix — extension opportunity (ties into TEMPER-03
  responsive hook)

### Forbidden actions

- Do NOT upload baselines or current screenshots to any external
  service other than the configured LLM provider
- Do NOT store LLM API keys in `.forge/tempering/` — reuses existing
  `.forge/secrets.json` mechanism
- Do NOT auto-promote baselines on a regression — only humans approve
  (this is the single most important guardrail of the phase)
- Do NOT exceed per-run cost cap from `config.visualAnalyzer.maxCostUsd`
  (default $2.00 per run — enterprise reasonable; cap clearly exceeded
  → abort with an `infra` scan result, not a bug)

## Slices

### Slice 04.1 — Pixel diff + single-model analyzer

**Files touched:**
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — new
- `pforge-mcp/tempering/baselines.mjs` — new (baseline storage +
  promotion API)
- `pforge-mcp/server.mjs` — `forge_tempering_approve_baseline` MCP tool
- `pforge-mcp/dashboard/app.js` — live regression toast handler
- `pforge-mcp/tests/tempering-visual-diff.test.mjs` — new, ~30 tests
- `pforge-mcp/tests/fixtures/temper/visual/` — baseline / regression
  pair fixtures
- `package.json` deps — `pixelmatch`, `pngjs`

### Slice 04.2 — Quorum + dashboard viewer

**Files touched:**
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — quorum mode branch
- `pforge-mcp/dashboard/app.js` — visual-diff viewer component
- `pforge-mcp/dashboard/index.html` — viewer DOM
- `pforge-mcp/tests/tempering-visual-quorum.test.mjs` — new, ~25 tests

## Success Criteria

- Fixture regression (intentionally broken CSS on a dashboard page)
  flagged by the scanner, visible in the dashboard viewer, all 3 quorum
  models agree (or correctly handle disagreement via inconclusive)
- Baseline promotion round-trips: approved image becomes new baseline,
  next run sees 0% diff
- Cost cap enforcement: synthetic config with `maxCostUsd: 0.001`
  aborts cleanly with infra status
- Dashboard visual-diff viewer renders baseline / current / diff for a
  fixture case, buttons wired
- All existing tests continue to pass; new tests +55
- CHANGELOG entry under `v2.45.0`

## Dependencies

- **Requires TEMPER-03** (consumes the screenshot baseline it produces)
- Surfaces regressions as candidate bugs → **TEMPER-06** picks them up
- Reuses existing quorum infrastructure from `forge_quorum_analyze` —
  no new LLM routing code
