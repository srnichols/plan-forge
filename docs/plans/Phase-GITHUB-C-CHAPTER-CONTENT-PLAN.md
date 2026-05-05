# Phase GITHUB-C: GitHub-Stack Chapter — Sections 5, 7, 8 + Dogfood Trajectory

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Documentation (chapter content) + capture artifacts (dispatch trajectory link)
> **Estimated cost**: $1.00–$2.50 (6 slices, mostly prose with worked examples)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship
> **Depends on**: Phase GITHUB-A (chapter scaffold), Phase GITHUB-B (Coding Agent dispatch capability), Phase GITHUB-D (Metrics API ingestion) — all must merge before this Phase runs.
> **⚠ Special note**: This Phase has an OPTIONAL "live dogfood" addendum that dispatches a real Plan-Forge slice to Copilot Coding Agent against the live `srnichols/plan-forge` repo. That step **requires explicit user approval** at execution time and is gated behind a separate command, NOT executed automatically by `pforge run-plan`.

---

## Feature Specification

### Problem Statement

After Phases A, B, and D land, the GitHub-stack chapter (`docs/manual/plan-forge-on-the-github-stack.html`) has Sections 1, 2, 3, 4, and 6 fleshed out. Three sections remain stubbed:

- **Section 5 — Copilot Spaces sync.** A description of how to push the active plan + instruction files + Plan-Forge tool catalog into a designated Copilot Space. The implementation is a separate phase (GITHUB-E or later) but the documentation should describe the pattern today using the existing Spaces UI + manual-copy flow.
- **Section 7 — BYOK and the multi-model picker.** How Plan-Forge's `--model` flag and quorum modes compose with Copilot's multi-model picker. When BYOK matters, when the picker is enough.
- **Section 8 — Other agent platforms.** An honest read on Plan-Forge's depth-of-integration with Claude Code, Cursor, and Codex. What works today, what doesn't.

This phase fills those three sections and adds a closing **Section 9 — "Built with Plan-Forge"** dogfood callout that links to a captured Plan-Forge run trajectory showing the chapter being written by Plan-Forge itself (slice-by-slice, dispatched via Copilot Coding Agent against the live repo). The dogfood capture is the reason this chapter is the strongest possible OSS-honest demo.

The work is **strictly documentation-only** for the chapter prose. The dogfood capture is a one-shot Plan-Forge run that produces commit history + a trajectory artifact; it is GATED at the orchestrator level and never auto-runs.

### User Scenarios

**Scenario 1: Reader finishes Section 4 and clicks through to Section 5**
1. User reads the GHAS-driven remediation flow in Section 4.
2. They scroll into Section 5 and learn how to mirror their plan + instructions into a Copilot Space.
3. The section honestly notes: "Today this is a manual copy. A `pforge sync-spaces` command is on the roadmap (Phase GITHUB-E)."
4. Outcome: reader gets a working pattern even though the automated command isn't shipped yet.

**Scenario 2: Reader is on Cursor, not Copilot**
1. They reach Section 8 ("Other agent platforms") and find a clear, honest read on Cursor's depth of Plan-Forge integration.
2. The section lists what works (slice execution, instruction-file context loading, MCP server consumption) and what doesn't (no native Coding-Agent equivalent — Cursor agents must run interactively).
3. Outcome: Cursor user feels seen, not sold-around. They keep reading.

**Scenario 3: Reader sees the "Built with Plan-Forge" callout at chapter end**
1. They follow the link to a captured Plan-Forge trajectory in the dashboard (or a static export).
2. They see: "This chapter was written by Plan-Forge dispatching to Copilot Coding Agent against this same repo. Run started <date>, completed <date>, total cost $X.XX. View slices."
3. Outcome: the chapter's claim ("Plan-Forge is the deepest harness on the GitHub stack") is backed by a verifiable artifact, not just prose.

**Scenario 4: Maintainer runs the dogfood capture (gated)**
1. Maintainer runs: `pforge run-plan docs/plans/Phase-GITHUB-C-CHAPTER-CONTENT-PLAN.md --worker copilot-coding-agent --confirm-live-dispatch`
2. Plan-Forge confirms: "This will create N issues against srnichols/plan-forge and assign to @copilot. Continue? [y/N]"
3. On confirm, dispatch proceeds; trajectory captured.
4. Without `--confirm-live-dispatch`, the orchestrator falls back to the standard claude-sonnet-4.6 worker for documentation slices (no GitHub side effects).
5. Outcome: dogfood is opt-in per run, not opt-in per phase.

### Acceptance Criteria

#### Section content (Slices 1–4)

- [ ] **MUST**: Section 5 ("Copilot Spaces sync") of the chapter is fleshed out: pattern description, manual-copy steps, links to GitHub Spaces docs, "automation roadmap" callout for Phase GITHUB-E.
- [ ] **MUST**: Section 7 ("BYOK and the multi-model picker") is fleshed out: when to use Plan-Forge's `--model` directly, when to use Copilot's picker, how quorum modes interact, BYOK cost model with worked numbers.
- [ ] **MUST**: Section 8 ("Other agent platforms") is fleshed out with three subsections — Claude Code, Cursor, Codex — each with: depth-of-integration assessment, what works today, what doesn't, a one-paragraph "should you use this with Plan-Forge?" verdict.
- [ ] **MUST**: All three sections end with a "Read next" link to a related chapter (cross-link health).
- [ ] **MUST**: The "Coming next / Planned" callouts for Sections 5, 7, 8 are removed.

#### Dogfood capture (Slice 5)

- [ ] **MUST**: Section 9 ("Built with Plan-Forge") is added at the end of the chapter, AFTER the existing "open an issue" footer.
- [ ] **MUST**: Section 9 contains a placeholder for the dogfood trajectory link plus a static screenshot of the dashboard's run summary for this chapter.
- [ ] **MUST**: The dogfood capture itself is a SEPARATE manual step documented in `docs/plans/PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md`. The runbook lists the exact command, the expected GitHub side-effects (N issues against `srnichols/plan-forge`), the rollback procedure (close issues, delete PRs), and the trajectory-export procedure.
- [ ] **MUST**: The runbook explicitly notes: "DO NOT run this as part of `pforge run-plan` autonomous execution. Run interactively, review each PR, and merge only after independent review."

#### Polish (Slice 6)

- [ ] **MUST**: Chapter line count post-Phase-C: ~600–900 lines (up from current ~280). Sweep for stale "Coming next" / "Planned" callouts.
- [ ] **MUST**: VERSION bump (next minor after Phase D) + CHANGELOG entry under [Unreleased].
- [ ] **MUST**: A test that asserts chapter file contains all 9 section headings (`<h2 id="...">`) — prevents accidental section-deletion regressions.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Phase B or D not yet merged when Phase C runs | Hardener detects unmerged dependencies and refuses to start. Manual step: merge B/D first. |
| Reader on Codex / Cursor follows a Section 3 link expecting it to work | Section 3 explicitly notes "Coding Agent path is Copilot-only; for Codex/Cursor see Section 8". |
| Dogfood capture fails mid-run | Trajectory shows partial state; runbook covers rollback (close opened issues, delete branches). Section 9 placeholder remains until a successful run is captured. |
| Chapter exceeds 1000 lines after Section 8 | Hardener may split Section 8 into a sub-page (Appendix H.1?). Decision deferred to hardening. |
| Dogfood capture succeeds but introduces unwanted commits | Standard git revert applies. The runbook documents the revert path. |

### Out of Scope

- Implementing `pforge sync-spaces` (deferred to Phase GITHUB-E).
- Implementing Cursor / Codex / Claude Code first-class workers beyond what already exists.
- Marketing copy beyond what's needed for technical accuracy.
- The dogfood capture's automation — it's a one-shot manual step by design.
- Translating the chapter to other languages.
- Adding new screenshots beyond the dogfood dashboard summary (Section 9).

### Open Questions

1. **Section 8 ordering — alphabetical or "deepest first"?** Recommend alphabetical (Claude Code, Codex, Cursor) for fairness; depth-of-integration noted in the body, not the order.
2. **Section 5 "manual copy" instructions — link to GitHub's Spaces docs or inline?** Recommend inline summary + link, in case GitHub's docs URL changes.
3. **Section 9 dogfood capture — publish to a public dashboard URL, or screenshot only?** Recommend screenshot for v1 (no auth complications); public dashboard URL is a Phase E enhancement.
4. **Is a "Migration from Spec-Kit to Plan-Forge" subsection in scope?** Recommend NO — Spec-Kit is GitHub's tool and we link to it as an entry point; we don't position Plan-Forge as a replacement.

### Complexity Estimate

- **Estimated effort**: Small-medium (6 slices, all docs except Slice 5's runbook authoring)
- **Estimated files**: 3 (chapter expand, new runbook, VERSION/CHANGELOG)
- **Recommended pipeline**: Standard pipeline.

---

## Scope Contract

### Inputs

- Phase A chapter scaffold: [docs/manual/plan-forge-on-the-github-stack.html](../manual/plan-forge-on-the-github-stack.html)
- Phase B Coding Agent dispatch (must be merged for Section 9's claim to be honest)
- Phase D Metrics API ingestion (must be merged for Section 6 to render correctly — Section 6 was completed in Phase D)
- Existing manual chapters for cross-links: `multi-agent.html`, `mcp-server.html`, `extensions.html`, `cli-reference.html`
- GitHub Copilot Spaces documentation (referenced inline)
- Anthropic Claude Code, Cursor, OpenAI Codex docs (referenced for Section 8)

### Outputs

**New files** (~1):
- `docs/plans/PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md` — gated dogfood capture procedure

**Modified files** (~3):
- `docs/manual/plan-forge-on-the-github-stack.html` — Sections 5, 7, 8, 9 fleshed out; Section-3/4/6 callouts removed
- `pforge-mcp/package.json` + `VERSION` — bump
- `CHANGELOG.md` — add entry

### Forbidden Actions

- ❌ Modifying any other manual chapter
- ❌ Modifying any code in `pforge-mcp/`, `pforge.ps1`, `pforge.sh`
- ❌ Auto-running the dogfood capture as part of `pforge run-plan` execution
- ❌ Pushing commits to `srnichols/plan-forge` from inside `pforge run-plan` for this Phase
- ❌ Adding new tool integrations (Spec-Kit beyond the existing reference, IDE extensions, etc.)

---

## Slice Plan

> Memory note `plan-gate-command-rules.md` applies. All gates use single-line `bash -c "..."`.

### Slice 1 — Section 5: Copilot Spaces sync (manual pattern + roadmap)
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Replace Section 5 callout with full content — pattern description, manual-copy steps, GitHub Spaces docs link, Phase GITHUB-E roadmap callout.
**Validation gate**:
```bash
bash -c "grep -q 'Copilot Spaces' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'Phase GITHUB-E' docs/manual/plan-forge-on-the-github-stack.html"
```
**Estimated cost**: $0.20

### Slice 2 — Section 7: BYOK and the multi-model picker
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Replace Section 7 callout. Cover --model flag, quorum modes, picker interaction, BYOK cost model with worked numbers (claude-sonnet-4.6 vs gpt-5.5 vs grok-4 examples).
**Validation gate**:
```bash
bash -c "grep -q 'BYOK' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q '--model' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'quorum' docs/manual/plan-forge-on-the-github-stack.html"
```
**Estimated cost**: $0.25

### Slice 3 — Section 8: Other agent platforms (Claude Code, Cursor, Codex)
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Replace Section 8 callout. Three subsections, alphabetical, each with assessment + verdict.
**Validation gate**:
```bash
bash -c "grep -q 'Claude Code' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'Cursor' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'Codex' docs/manual/plan-forge-on-the-github-stack.html"
```
**Estimated cost**: $0.30

### Slice 4 — Cross-links + verify all "Coming next" callouts removed
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Add "Read next" link at end of each new section. Sweep for any remaining "Coming next" / "Planned" callouts (only Section 9 may have a placeholder if dogfood not yet captured).
**Validation gate**:
```bash
bash -c "grep -c 'Coming next' docs/manual/plan-forge-on-the-github-stack.html | grep -E '^[0-1]$'"
```
**Estimated cost**: $0.15

### Slice 5 — Section 9 + dogfood runbook (gated)
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `docs/plans/PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md`
**Goal**: Add Section 9 callout pointing at the runbook. Author the runbook with command, side-effects, rollback, export procedure, and the explicit "do not auto-run" warning.
**Validation gate**:
```bash
bash -c "grep -q 'Built with Plan-Forge' docs/manual/plan-forge-on-the-github-stack.html"
bash -c "test -f docs/plans/PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md"
bash -c "grep -q 'DO NOT run this as part' docs/plans/PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md"
```
**Estimated cost**: $0.20

### Slice 6 — VERSION bump + CHANGELOG + section-heading regression test
**Files in scope**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `pforge-mcp/tests/manual-chapter-headings.test.mjs`
**Goal**: Bump VERSION (next minor after Phase D), add CHANGELOG entry. Add a test asserting all 9 section headings present.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/manual-chapter-headings.test.mjs"
bash -c "grep -q 'GitHub-stack chapter complete' CHANGELOG.md"
```
**Estimated cost**: $0.15

---

## Branch Strategy

- Branch name: `docs/github-stack-chapter-complete`
- Base: `master` (after Phase B + Phase D merged)
- Merge strategy: Squash merge after all 6 slices pass

## Rollback Plan

- Documentation-only changes. Rollback via `git revert <merge-commit>`.
- The dogfood runbook is referenced from the chapter but not auto-executed; rolling back removes both safely.
- The section-heading test ensures future edits don't accidentally delete sections — it does NOT block rollback.

---

## Open Decisions (resolve during Step 2 hardening)

1. Section 8 sub-section order (alphabetical vs depth-first)
2. Section 5 manual-copy instructions inline vs link
3. Section 9 dogfood capture publication mode (screenshot vs public URL)
4. Section 8 Spec-Kit positioning

---

## Notes for the Hardener (Step 2)

- This Phase MUST run AFTER Phase B and Phase D merge. Hardener should refuse to start if either is unmerged.
- Total estimated cost is $1.00–$2.50 across 6 slices.
- The dogfood capture in Section 9 is a SEPARATE manual step. The runbook makes this explicit. Do not let the Hardener fold dogfood execution into the autonomous Plan-Forge run.
- Final chapter line count target: 600–900 lines. If Slice 8 pushes over 1000, Hardener may sub-divide.
