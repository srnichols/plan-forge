# Hotfix v2.90.9 — Capabilities Doc Sync (GHCP work)

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Documentation only
> **Estimated cost**: $0.10–$0.30 (4 slices, prose + small tests)
> **VERSION target**: 2.90.8 → 2.90.9 (patch)
> **Depends on**: Phase GITHUB-A, GITHUB-B, GITHUB-C, GITHUB-D, Phase 33 (all shipped)

---

## Feature Specification

### Problem Statement

Five recent phases shipped meaningful GitHub Copilot integration work into the codebase, but the public-facing capabilities surfaces (`docs/capabilities.md`, `docs/capabilities.html`) were never updated to reflect them. A Forge-Master audit (recorded in `.forge/fm-experiment-stream.txt`, 2026-05-05) confirmed the gap independently. The risk is asymmetric: an external evaluator (e.g. Cohesity) reading the public capabilities surface will see an outdated picture of what Plan-Forge actually does, while sales/proposal materials (e.g. `Cohesity_PlanForge_AI_SDLC_Briefing.html`) already reference the newer capabilities.

Concretely, the following capabilities are present in code/tools.json but **not documented** in `capabilities.md` or `capabilities.html`:

| Capability | Phase | Where it lives in code | Public docs status |
|---|---|---|---|
| `forge_github_status` MCP tool (`pforge github status` CLI alias) | GITHUB-A | `pforge-mcp/github-introspect.mjs`, `tools.json:47` | Missing from `.md` and `.html` |
| `pforge github doctor` CLI command | GITHUB-A | `pforge.ps1` / `pforge.sh` `github` subcommand | Missing |
| `--worker copilot-coding-agent` dispatch flag | GITHUB-B | `pforge-mcp/orchestrator.mjs` (worker dispatch) | Missing |
| `pforge plan-from-sarif` CLI command | GITHUB-B | `pforge-mcp/sarif-to-plan.mjs` | Missing |
| Dashboard `github-metrics` tab | GITHUB-D | `pforge-mcp/dashboard/` (tab definitions) | Tab count in `capabilities.md` is stale (still says ~33 tabs, actual is 34) |
| Copilot Metrics API ingestion | GITHUB-D | `pforge-mcp/github-metrics.mjs` | Missing |
| Forge-Master zero-key default via GitHub Models | Phase 33 | `pforge-mcp/forge-master-routes.mjs` + provider adapter | Missing — particularly important because it removes the API-key barrier for new adopters |
| Provider table updated for GitHub Copilot adapter | Phase 33 | `pforge-mcp/server.mjs` | Provider table mentions `gh auth login` but not the zero-key Forge-Master default |

This hotfix is **strictly documentation-only** with one small regression test to keep the surfaces from drifting again. No code or feature changes.

### User Scenarios

**Scenario 1: External evaluator reads `capabilities.md`**
1. Reader opens `https://github.com/srnichols/plan-forge/blob/master/docs/capabilities.md`.
2. Reader finds a new "GitHub Copilot Integration" subsection listing all four CLI commands, the `--worker copilot-coding-agent` flag, the dashboard `github-metrics` tab, and the zero-key Forge-Master default.
3. Reader can map every claim in the public-facing Cohesity briefing back to a documented capability without having to read source code.

**Scenario 2: Internal contributor checks tool count**
1. Contributor opens `capabilities.html` looking for the dashboard tab count.
2. The number reflects the actual count (34 tabs after Phase GITHUB-D), not the pre-D count.

**Scenario 3: First-time adopter looking for "do I need an API key?"**
1. Adopter searches `capabilities.md` for "GitHub Models" or "zero-key".
2. Finds an explicit statement: "Forge-Master defaults to GitHub Models — no separate API key required if you have GitHub Copilot."

### Acceptance Criteria

- [ ] **MUST**: `docs/capabilities.md` has a new subsection titled `## GitHub Copilot Integration` (or equivalent — final heading text decided in Step 2 hardening) covering all eight bullet items above.
- [ ] **MUST**: `docs/capabilities.html` has the equivalent rendered section in the same place in the page.
- [ ] **MUST**: The dashboard tab count referenced in `capabilities.md` and `capabilities.html` reads `34` (or whatever `scripts/_probe-dashboard-tabs.cjs` returns at run time — see regression test below).
- [ ] **MUST**: `forge_github_status` MCP tool appears in the MCP tools table in `capabilities.md`.
- [ ] **MUST**: `--worker copilot-coding-agent` is listed in the execution-modes table in `capabilities.md` (alongside the existing Full Auto / Assisted / Cloud Agent / Quorum entries).
- [ ] **MUST**: `pforge github status`, `pforge github doctor`, and `pforge plan-from-sarif` appear in the CLI commands listing in `capabilities.md`.
- [ ] **MUST**: A new short row in the provider table notes "Forge-Master uses GitHub Models by default — no separate API key required."
- [ ] **MUST**: A new entry `[2.90.9] — YYYY-MM-DD — capabilities-doc sync for GHCP work` exists in `CHANGELOG.md` with subsections `Added (docs only)`, `Why this matters`.
- [ ] **MUST**: `VERSION` bumped to 2.90.9.
- [ ] **MUST**: A regression test `pforge-mcp/tests/capabilities-doc-sync.test.mjs` asserts:
  - The phrase `forge_github_status` appears in `docs/capabilities.md`.
  - The phrase `--worker copilot-coding-agent` appears in `docs/capabilities.md`.
  - The phrase `pforge plan-from-sarif` appears in `docs/capabilities.md`.
  - The phrase `github-metrics` appears in both `docs/capabilities.md` and `docs/capabilities.html`.
  - The dashboard tab count integer in `capabilities.md` matches the count returned by `scripts/_probe-dashboard-tabs.cjs` (or a constant exported by `pforge-mcp/dashboard/tabs.mjs`).
- [ ] **SHOULD**: New section cross-links to the GitHub-stack manual chapter (`docs/manual/plan-forge-on-the-github-stack.html`).
- [ ] **SHOULD**: The `tools.json` description for `forge_github_status` (already shipped) is unchanged — this hotfix does NOT modify tools.json.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| `_probe-dashboard-tabs.cjs` doesn't exist on the worker's branch | Test falls back to a hard-coded constant; emits a `console.warn`. |
| The HTML and MD diverge in tab count after this hotfix (e.g. another phase ships another tab) | Regression test catches the divergence on the next run. |
| Worker invents a new "GitHub" subsection heading style not used elsewhere in `capabilities.md` | Step 2 hardening pre-specifies the exact heading text and level. |
| GitHub Models endpoint URL drifts | Out of scope for this hotfix — the doc just states "GitHub Models" generically. |

### Out of Scope

- Updating `pforge-mcp/tools.json` (already correct).
- Updating `tools.json` descriptions of any other tool.
- Updating the dashboard manual chapter (`docs/manual/dashboard.html`) — that's a separate concern.
- Rewriting the GitHub-stack manual chapter (already shipped in Phase GITHUB-A and C).
- Adding new screenshots.
- Cohesity briefing changes (separate doc, separate process).

---

## Scope Contract

### Inputs
- [docs/capabilities.md](../../docs/capabilities.md) — current state, missing GHCP subsection
- [docs/capabilities.html](../../docs/capabilities.html) — current state, same gap
- [pforge-mcp/tools.json](../../pforge-mcp/tools.json) — source of truth for `forge_github_status` shape (read-only input)
- [docs/manual/plan-forge-on-the-github-stack.html](../../docs/manual/plan-forge-on-the-github-stack.html) — for cross-link target
- [scripts/_probe-dashboard-tabs.cjs](../../scripts/_probe-dashboard-tabs.cjs) — for live tab count

### Outputs
- **Modified**: `docs/capabilities.md` — new GHCP subsection + tab-count update + provider table row
- **Modified**: `docs/capabilities.html` — equivalent rendered section
- **Modified**: `CHANGELOG.md` — new `[2.90.9]` entry
- **Modified**: `VERSION` — `2.90.8` → `2.90.9`
- **New**: `pforge-mcp/tests/capabilities-doc-sync.test.mjs` — regression guard

### Forbidden Actions
- Modifying `pforge-mcp/tools.json`.
- Modifying any source file under `pforge-mcp/` other than the new test file.
- Adding new MCP tools.
- Adding new CLI commands.
- Modifying `docs/manual/*.html` (the manual chapter is already correct).
- Bumping VERSION beyond `2.90.9`.
- Touching the Cohesity briefing or any file under `E:\GitHub\` outside the Plan-Forge repo.

---

## Slice Plan

### Slice 1 — `capabilities.md` GHCP subsection + tab-count update

**Goal**: Add the new "GitHub Copilot Integration" subsection to `docs/capabilities.md` and refresh the dashboard tab count.

**Files modified**:
- `docs/capabilities.md`

**Validation gate**:
```bash
node -e "const md = require('fs').readFileSync('docs/capabilities.md','utf8'); const checks = { hasGhcp: /## GitHub Copilot Integration/i.test(md) || /### GitHub Copilot Integration/i.test(md), hasForgeGithubStatus: md.includes('forge_github_status'), hasWorkerFlag: md.includes('--worker copilot-coding-agent'), hasPlanFromSarif: md.includes('plan-from-sarif'), hasGithubMetrics: md.includes('github-metrics'), hasGitHubModels: /GitHub Models/i.test(md) }; const failed = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k); if (failed.length) { console.error('FAIL:', failed.join(', ')); process.exit(1); } console.log('OK', JSON.stringify(checks));"
```

### Slice 2 — `capabilities.html` equivalent section

**Goal**: Add the equivalent rendered section to `docs/capabilities.html` matching the structure of Slice 1.

**Files modified**:
- `docs/capabilities.html`

**Validation gate**:
```bash
node -e "const html = require('fs').readFileSync('docs/capabilities.html','utf8'); const checks = { hasForgeGithubStatus: html.includes('forge_github_status'), hasWorkerFlag: html.includes('--worker copilot-coding-agent'), hasPlanFromSarif: html.includes('plan-from-sarif'), hasGithubMetrics: html.includes('github-metrics'), hasGitHubModels: /GitHub Models/i.test(html) }; const failed = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k); if (failed.length) { console.error('FAIL:', failed.join(', ')); process.exit(1); } console.log('OK', JSON.stringify(checks));"
```

### Slice 3 — Regression test

**Goal**: Add `pforge-mcp/tests/capabilities-doc-sync.test.mjs` that asserts both surfaces stay in sync.

**Files modified**:
- `pforge-mcp/tests/capabilities-doc-sync.test.mjs` (new)

**Validation gate**:
```bash
cd pforge-mcp && npx vitest run tests/capabilities-doc-sync.test.mjs --reporter=basic 2>&1 | findstr /C:"Test Files" /C:"PASS"
```

### Slice 4 — CHANGELOG + VERSION bump

**Goal**: Add `[2.90.9]` CHANGELOG entry and bump VERSION.

**Files modified**:
- `CHANGELOG.md`
- `VERSION`

**Validation gate**:
```bash
node -e "const v = require('fs').readFileSync('VERSION','utf8').trim(); const cl = require('fs').readFileSync('CHANGELOG.md','utf8'); const checks = { version: v === '2.90.9', changelogEntry: /## \[2\.90\.9\]/.test(cl), mentionsGhcp: /capabilities-doc sync|GHCP|GitHub Copilot Integration/i.test(cl) }; const failed = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k); if (failed.length) { console.error('FAIL:', failed.join(', ')); process.exit(1); } console.log('OK', JSON.stringify(checks));"
```

---

## Branch Strategy

- Direct commits to `master` (consistent with prior 2.90.x hotfix series).
- Each slice = one commit.
- No feature branch, no PR.

---

## Rollback Plan

If any slice fails or produces unintended diffs:

1. `git revert <commit-hash>` for the offending slice.
2. The regression test from Slice 3 will guard against re-introducing the drift on a subsequent run.
3. CHANGELOG/VERSION can be reverted to 2.90.8 if all four slices need to be unwound.

No production impact — documentation-only changes, no code paths affected.

---

## Open Decisions (resolve during Step 2 hardening)

1. **Heading level**: Should the new section be `##` (top-level) or `###` (subsection of an existing block)? Current recommendation: `###` under the existing "Integrations" or "Execution Modes" block, but the hardener should pick based on actual `capabilities.md` structure.
2. **Section ordering in HTML**: Insert before/after which existing `<section>`? Hardener should pick based on the rendered page flow.
3. **Tab count source of truth**: Hard-code `34`, or read from `scripts/_probe-dashboard-tabs.cjs` at test time? Recommendation: read at test time; hard-code in the prose.
4. **Provider table row wording**: Exact phrasing of the "no separate API key required" line. Recommendation: "Forge-Master uses GitHub Models by default — if you have GitHub Copilot, no separate API key is required."

---

## Notes for the Hardener (Step 2)

- This plan was drafted after a Forge-Master audit (`.forge/fm-experiment-stream.txt`, 2026-05-05) confirmed the gap from a second source.
- The Cohesity briefing at `E:/GitHub/Cohesity_PlanForge_AI_SDLC_Briefing.html` already references most of these capabilities — keeping public docs in sync with proposal-grade material is the underlying motivation.
- `pforge-mcp/tools.json` is **already correct** for `forge_github_status` (line 47); the gap is purely in the human-readable surfaces.
- Worker should read the existing structure of `capabilities.md` and `capabilities.html` before deciding heading levels — these files are organised differently than typical READMEs.
- The Phase GITHUB-A manual chapter at `docs/manual/plan-forge-on-the-github-stack.html` is the primary cross-link target.
