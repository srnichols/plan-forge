---
phase: 59
name: CRUCIBLE-MODES
status: HARDENED
lockHash: 4b9f2b13bd53142be0a68016866c9e731323bb2349fa2a23f34c16dcf3c23e92
hardenedAt: 2026-05-21
hardenedFromHead: 26a5b3b3678e19b8fb8cb8d2f383c5cf4bb9454c
---

# Phase 59 — CRUCIBLE-MODES — Multi-mode Crucible intake substrate; make auto-output runnable for the bug-batch workflow

> **Status**: **HARDENED — cleared for execution 2026-05-21.** Step-2 hardening completed: line ranges sharpened against current files (see Notes for the Hardener), lockHash computed and locked, Execution Hold preconditions verified (planning/main HEAD `26a5b3b`, master HEAD `4ffb6c7`, clean tree, no concurrent crucible work in last 14 days).
> **Source**: Coordinated remediation for closed-but-still-broken issues #118 / #135 / #137 (and their reopened twins #140 / #142 / #145 / #146 / #147). Escalated by downstream Rummag consumer (RMG-0035..0052 bug-drain batch) on 2026-05-20 — per-bug pipeline still bottoms out at `forge_crucible_finalize` requiring full hand-edit. v2.82.1's symptomatic fixes addressed *field presence* (refusal contract, `forbidden-actions` question, file-overwrite guard) but did not address *interview depth* (no root-cause question for bug lane, no slice decomposition) or *renderer→parser format alignment* (synthesized slices use `**Files**:` body but emit no `[scope: paths]` header, `## Anti-patterns & Forbidden Actions` heading doesn't match `parseScopeContract`'s expected `### Forbidden` under `## Scope Contract`).
> **Tracks**: `pforge-mcp/crucible-interview.mjs`, `pforge-mcp/crucible-draft.mjs`, `pforge-mcp/crucible-server.mjs`, `pforge-mcp/crucible-infer.mjs` (existing, refactored), `pforge-mcp/crucible/` (NEW directory — mode interface + core), `pforge-mcp/crucible/modes/` (NEW directory — 4 mode files), `pforge-mcp/tests/crucible-*.test.mjs` (existing + new contract tests + new baseline snapshot fixture), `pforge-mcp/orchestrator/plan-parser.mjs` (read-only reference — renderer must align with its expectations), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md` (NEW).
> **Estimated cost**: medium. No LLM-cost surfaces. Mostly mechanical refactor (S1, S2) plus one new mode (S4) and one parser-alignment slice (S5). RMG-0035 is the concrete regression validation target for S4.
> **Pipeline**: Specify ✅ (escalation write-up serves as Step 0) → Harden ⏳ → Execute → S7 retro. **No separate QA/E2E slice** — the baseline fixture from S0 plus per-slice contract tests are the gate. A slice fails its gate if the baseline rendering changes for an unrelated lane (no-regression rule) or if a new contract assertion fails.
> **Recommended starting slice**: **S0** (baseline snapshot fixtures for all three existing lanes must land first — every later slice gate compares against them).
> **Session budget**: 8 slices (S0–S7). Recommend 2 sessions. Highest-risk slices: S2 (3-lane migration, behavior preservation is byte-sensitive), S4 (new mode + multi-slice synthesizer, new operator-visible behavior).
> **Issue closure**: This phase, when shipped, closes #140, #142, #145, #146, #147 as duplicates of the root cause this phase addresses. Issues #118, #135, #137 remain closed (their symptomatic fixes stand) but referenced in S7 retro as the trigger.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **No competing in-flight plan touches `pforge-mcp/crucible-*.mjs`** — verify with `git log --since=7.days planning/main -- pforge-mcp/crucible-*.mjs` returns the expected last touch.
- [ ] **`master` is clean** at harden time (record HEAD SHA in the hardener notes).
- [ ] **`planning/main` is clean** at harden time (record HEAD SHA in the hardener notes).
- [ ] **`lockHash`** (added in Step-2 harden) matches plan body at run time.
- [ ] **Baseline snapshot fixture for all three existing lanes (tweak / feature / full) generated in S0 matches the current `renderDraft()` output byte-for-byte** — this is the no-regression contract for S1–S3.
- [ ] **Hardener has verified renderer↔parser alignment** by reading `pforge-mcp/orchestrator/plan-parser.mjs` `parseSlices()` (L559+) and `parseScopeContract()` (L324+), and sharpened S5's scope to the actual heading-shape deltas.
- [ ] **RMG-0035 reproduction fixture is available** (small synthetic smelt mimicking the failure mode) for use as S4's regression target. If unavailable, hardener narrows S4's gate to assert structural properties only.

**To resume**: keep Status as `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-59-CRUCIBLE-MODES-PLAN.md`.

---

## Why this phase exists

The Crucible interview→finalize pipeline is supposed to absorb the planning work the operator does between "I have a bug to fix" and "I have a runnable plan." Today it produces a draft that the operator must rewrite from scratch before `forge_run_plan` can do anything with it. Three GitHub issues track pieces of this — all closed in v2.82.1 — and five duplicate issues have been re-filed since, because the closures addressed symptoms (TBD-laden output, missing `forbidden-actions` question, silent file overwrite) without addressing the shared cause: **the interview design treats the operator as a transcriber, not a collaborator**.

Root cause analysis (verified against source — [crucible-interview.mjs](../../pforge-mcp/crucible-interview.mjs), [crucible-draft.mjs](../../pforge-mcp/crucible-draft.mjs), [crucible-server.mjs](../../pforge-mcp/crucible-server.mjs)):

1. **Field presence ≠ field utility.** v2.82.1 added `CRITICAL_FIELDS` refusal so finalize won't ship `{{TBD: forbidden-actions}}`. But for the bug lane (4 questions: `scope-file`, `validation`, `forbidden-actions`, `rollback`) the operator must complete root-cause investigation manually before they can even answer "which file?". Crucible adds friction without absorbing labor.
2. **One slice, ever.** [synthesizeSliceBlock](../../pforge-mcp/crucible-draft.mjs#L70) emits exactly one slice. The interview has no slice-decomposition question for feature or tweak lanes. Multi-slice plans cannot come from the interview.
3. **Renderer / parser format drift.** Renderer emits `## Anti-patterns & Forbidden Actions`; [parseScopeContract](../../pforge-mcp/orchestrator/plan-parser.mjs#L324) reads `### Forbidden` under `## Scope Contract`. Synthesizer emits `**Files**:` body but no `[scope: paths]` slice-header clause. The orchestrator's enforcement gates miss the data the renderer actually wrote.
4. **Tangled responsibilities.** Question bank, criticality, and rendering are spread across three files keyed by a 3-value lane enum. Adding a lane (or a new intake-source like SARIF or meta-bug) requires edits in three files in lockstep — which is exactly the failure mode that produced #135 (forbidden-actions added to feature without tweak).

The architecture decision is to make Crucible a **multi-mode intake substrate**, with the question bank, criticality set, and renderer body owned per-mode behind a stable core (interview protocol, refusal contract, file-write guard, frontmatter, scope-contract shell). Three existing lanes become three modes; a new `bug-batch` mode for the downstream consumer workflow becomes the fourth. Future intake-sources (`meta-bug`, `sarif-finding`, `triage`) plug in as single-file additions when their callers materialize.

Architectural grounding:
- **SRP/CCP** — each mode is its own closure of change; question changes for `bug-batch` don't risk `feature` regressions
- **OCP** — new intake = add 1 file + register; no edits across 3 files
- **DIP** — `handleFinalize` depends on a mode interface, not a lane enum
- **Stable Dependencies Principle** — core (refusal, file-write, store, interview protocol) is the stable component; modes are volatile
- **ACI** — one `forge_crucible_submit { mode, rawIdea, ... }` discriminator, not a tool-per-intake family

The phase ships the refactor + ONE new mode (validates the interface against a meaningfully-different consumer per **"don't ship an interface against one implementation"** — the existing 3 lanes count as 3 implementations, `bug-batch` is the 4th and the operator-visible win).

---

## Scope Contract

### In Scope

- **S0 — Baseline snapshot fixtures for all three existing lanes.** Generate fixture smelts (one each for tweak / feature / full) with deterministic answers and snapshot the output of `renderDraft()` + the public response shape of `handleFinalize()`. Check fixtures into `pforge-mcp/tests/fixtures/crucible-baseline/` and add `pforge-mcp/tests/crucible-modes-no-regression.test.mjs` that loads the baseline and asserts byte-identical output through S1–S3. (Behavior intentionally changes in S2 — the truthful-refusal change means non-critical TBD markers disappear from output; the baseline fixture must be regenerated as part of S2 with a comment in the test naming what changed and why.)
- **S1 — Mode interface + core extraction (no behavior change).** Create:
  - `pforge-mcp/crucible/mode.mjs` (NEW) — exports the `Mode` interface: `{ id, lane, bank, criticalFields, renderBody, frontmatterExtras, modeContextSchema }`. Documented with JSDoc.
  - `pforge-mcp/crucible/core/finalize.mjs` (NEW) — extracts the file-write guard, refusal contract, frontmatter shell, and `CruciblePlanExistsError` / `CrucibleFinalizeRefusedError` / `CrucibleAskMismatchError` from `crucible-server.mjs`. Mode-agnostic.
  - `pforge-mcp/crucible/core/render-shell.mjs` (NEW) — extracts the shared frontmatter render, `## Scope Contract` heading + `### In Scope` / `### Out of Scope` / `### Forbidden` sub-headings, `## Validation Gates`, `## Stop Conditions`, `## Rollback`, `## Change Manifest` from `crucible-draft.mjs`. Mode-agnostic. Modes render only their body sections; this module owns the shell.
  - `pforge-mcp/crucible/core/interview-protocol.mjs` (NEW) — extracts `getNextQuestion(smelt, mode)` and `recordAnswer(smelt, questionId, answer)` from `crucible-interview.mjs`. Mode-agnostic.
  - `pforge-mcp/crucible/registry.mjs` (NEW) — `registerMode(mode)`, `getMode(id)`, `listModes()`. Three lanes plus future modes register here at module load.
  - Top-level `crucible-interview.mjs`, `crucible-draft.mjs`, `crucible-server.mjs` retain their public exports (re-export shims) for zero-breaking-change to existing callers including tests.
- **S2 — Migrate 3 existing lanes to mode files; per-mode `criticalFields`; truthful refusal.** Create:
  - `pforge-mcp/crucible/modes/tweak.mjs` (NEW) — owns `TWEAK_QUESTIONS`, its `criticalFields` set (today's `scope-file`, `validation`, `forbidden-actions`), and the tweak-specific render body (root-cause stub only if `bug-batch` is not the mode used).
  - `pforge-mcp/crucible/modes/feature.mjs` (NEW) — owns `FEATURE_QUESTIONS`, its `criticalFields` set, and the feature-specific render body.
  - `pforge-mcp/crucible/modes/full.mjs` (NEW) — owns `FULL_QUESTIONS`, its `criticalFields` set, and the full-lane sections (Problem & Success Metric, Stack Boundary, Data Model, API Surface, Security Posture).
  - The global `CRITICAL_FIELDS` set in `crucible-server.mjs` is deleted; `handleFinalize` reads `mode.criticalFields` instead.
  - **Truthful refusal**: `renderDraft` no longer emits `{{TBD: <id>}}` markers for non-critical fields. Missing optional answers cause the corresponding section to be omitted from output. Missing required (critical) answers cause `CrucibleFinalizeRefusedError` with `criticalGaps`. This is the one intentional behavior change in this slice; the baseline fixture from S0 is regenerated and the diff is reviewed in the slice commit message.
  - `inferLane()` is preserved (lane inference still useful for default mode selection); `submit` defaults `mode` from inferred lane when no explicit `mode` passed.
- **S3 — Frontmatter completeness + `linked-bugs` question.** Modify:
  - `handleFinalize` in `crucible-server.mjs` to emit additional frontmatter keys: `linkedBugs` (array, sourced from `mode.frontmatterExtras` / submit-time `bugId` / new `linked-bugs` answer), `phaseId` (alias for `phaseName`, kept for downstream consumers who key off this name — Scott's playbook is the concrete consumer), `bugId` (string, present only if `submit` carried one). All optional; never blocks finalize.
  - All three modes' `bank` get a `linked-bugs` question via mode-extras (NOT a critical field — operator can skip). When a smelt was opened via `submit { bugId: "RMG-0042" }`, the question's `recommendedDefault` is the bug-id; operator can append related bugs or accept.
  - `submit` carries `bugId` through to the smelt store (existing schema field `linkedBugs` if present, otherwise added).
- **S4 — `bug-batch` mode (RMG-0035 regression target).** Create:
  - `pforge-mcp/crucible/modes/bug-batch.mjs` (NEW) — opt-in mode chosen by `submit { mode: "bug-batch", bugId, rawIdea }`. Question bank (~8 questions):
    1. `symptom-observed` — "What does the user see when this bug fires? (exact error message, screenshot description, or behavior)"
    2. `expected-behavior` — "What should happen instead?"
    3. `suspected-component` — "Which subsystem or file area is the most likely culprit? (best guess; will be refined)"
    4. `scope-files` — "Once narrowed, list the file(s) the fix will touch."
    5. `slice-breakdown` — "Describe each slice as `<name> | <files> | <test-command-or-acceptance>` on its own line. Use 1 slice for trivial fixes, up to 4 for fix + regression-test + docs + retro."
    6. `validation-gates` — "Which build/test commands gate completion of each slice?"
    7. `forbidden-actions` — "What MUST this fix not do? (e.g., 'no schema changes', 'no edits outside scope-files')"
    8. `rollback` — "How do we roll back if the fix breaks something?"
  - `renderBody` emits a new `## Root Cause Hypothesis` section sourced from questions 1–3, and a multi-slice block parsed from `slice-breakdown` answer (one synthesized `### Slice N — <name>` per line).
  - `criticalFields`: `scope-files`, `validation-gates`, `forbidden-actions`, `slice-breakdown`.
  - `frontmatterExtras`: emits `linkedBugs: [bugId]` when submit carried one.
  - Synthesized slice headers include the `[scope: <paths>]` clause (renderer↔parser alignment — covered fully in S5; this mode is the first to emit it).
  - Add `pforge-mcp/tests/crucible-modes/bug-batch.test.mjs`:
    - Contract test: bank length, critical fields, frontmatter extras shape.
    - End-to-end test against RMG-0035 fixture (or synthetic equivalent if RMG-0035 not available at run time — fall back per Execution Hold note).
    - Regression test: smelt with empty `slice-breakdown` refuses with `criticalGaps`.
- **S5 — Renderer↔parser alignment.** Modify renderer to emit shapes the existing orchestrator parsers actually read:
  - Synthesized slice headers (in `synthesizeSliceBlock` and bug-batch's multi-slice synthesizer) emit `### Slice N — <name> [scope: <comma-paths>]` — the `[scope: paths]` clause is what `parseSlices()` in `plan-parser.mjs` already parses (verified by hardener against L559+).
  - Forbidden-actions content renders under `## Scope Contract` → `### Forbidden` (matches `parseScopeContract` at `plan-parser.mjs:324`) **instead of** the current top-level `## Anti-patterns & Forbidden Actions` heading. The old heading is dropped (single source of truth).
  - In-scope / out-of-scope content already renders under `## Scope Contract` → `### In Scope` / `### Out of Scope` per existing renderer; verify no regression.
  - Drop the `**Acceptance Criteria**` block from inside synthesized slices — `## Validation Gates` (top-level, mode-agnostic shell) is the single source. Eliminates the double-render Scott called out.
- **S6 — Deprecation gate + duplicate-issue closure + audit-log entry.**
  - Add `crucible.legacy.tbdPlaceholders: false` config knob to `.forge.json` schema (default off). When `true`, `renderDraft` emits `{{TBD: <id>}}` for non-critical fields the legacy way. Documented as scheduled-for-removal in the major after next.
  - Add a one-time `console.warn` (audit log entry, gated to once per process) when the legacy flag is set true.
  - In S6's commit message AND in the retro (S7): `Closes #140, #142, #145, #146, #147`. Do not re-open #118/#135/#137 — their symptomatic fixes are still correct, just insufficient on their own.
- **S7 — Retro + roadmap update + CHANGELOG.** Write the Phase 59 retro with: shape-of-output comparison (before/after for each lane), the rendered output of the `bug-batch` mode against RMG-0035, deferred items (no `meta-bug` / `sarif-finding` / `triage` modes — those land when their callers move), and an explicit honest answer to "is the bug-batch operator burden actually lower?" backed by a sample new run vs the manually-edited Phase-43-ish historical run. Move Phase 59 to Completed in DEPLOYMENT-ROADMAP. Append CHANGELOG `[Unreleased] → Changed` entry.

### Out of Scope

- **Additional intake modes** (`meta-bug`, `sarif-finding`, `triage`). They land when `forge_meta_bug_file`, `sarif-to-plan.mjs`, or `forge_classifier_issue` are wired in — separate phases each. This phase ships the substrate plus one demo mode; do NOT speculatively add the others (defeats the "interface against one implementation" check).
- **Changes to `crucible-import.mjs`, `crucible-config.mjs`, `crucible-migrate.mjs`, `crucible-enforce.mjs`, `crucible-store.mjs`.** These modules are stable and orthogonal to mode design. The smelt schema is preserved unchanged in S3 (only adds an optional `linkedBugs` array if not already present).
- **Changes to the dashboard's Crucible tab.** Mode selection in the dashboard UI is a separate phase; CLI/MCP callers can drive `mode` directly.
- **Changes to `forge_crucible_*` tool surfaces beyond adding the `mode` parameter to `submit`.** Tool count is preserved; ACI payload shapes preserved.
- **Changes to OpenBrain integration.** Smelt persistence remains L2 (files) only; OpenBrain replay is unaffected.
- **Changes to the Hardener handoff event.** `crucible-handoff-to-hardener` fires identically for all modes.
- **Removal of `inferLane()`** — lane inference still chooses the default mode when no explicit `mode` is passed. Backwards-compatible.
- **Bug-batch mode auto-invocation from `forge_bug_register`.** Auto-opening a smelt when a bug is registered is an obvious future win (the four-real-consumers argument in the design discussion lists it), but it's a separate caller-side change. This phase makes it possible; a follow-on plan wires it.
- **Any change to `pforge-mcp/orchestrator/plan-parser.mjs`.** S5 aligns the renderer to the parser, not the reverse. Parser is stable Phase 53 contract.
- **Any change to `pforge-master/`, `pforge-sdk/`, `extensions/`, `templates/`, `presets/`.**
- **Any new runtime dependency.** Mode interface is plain JSDoc + frozen objects; no DI framework, no plugin registry beyond a Map.
- **Any change to `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire).

### Forbidden Actions

- **Do NOT change any public export name or signature** of `crucible-interview.mjs`, `crucible-draft.mjs`, `crucible-server.mjs`. Top-level shims preserve the existing API for test files and external callers.
- **Do NOT change the `forge_crucible_*` MCP tool count or response shapes** beyond adding `mode` to `submit` inputSchema. The submit-time enum extends from `["tweak","feature","full"]` to `["tweak","feature","full","bug-batch"]` — additive, backwards-compatible.
- **Do NOT delete any existing `crucible-*.mjs` file.** Migrations move code; shims remain.
- **Do NOT bundle slices.** S0–S7 each = one commit.
- **Do NOT regenerate the baseline snapshot fixture mid-phase.** S0 produces it; S1 reads it unchanged; S2 regenerates it once (with diff justification in commit message); S3+ read the post-S2 baseline. Re-regeneration is a deliberate plan amendment, not a quiet edit.
- **Do NOT change the smelt JSON-on-disk schema** beyond optional fields. Existing `.forge/crucible/<id>.json` files must continue to load and finalize without migration.
- **Do NOT introduce a new dependency** (`dependencies` or `devDependencies`).
- **Do NOT modify any file outside the slice's declared Scope.**
- **Do NOT use `--no-verify` to bypass commit hooks.**
- **Do NOT modify `pforge-mcp/orchestrator/plan-parser.mjs`.** The renderer must align to the parser. If a parser change appears necessary, halt and re-scope.
- **Do NOT re-open issues #118, #135, #137.** Their narrow fixes are correct. Their broader cause is what this phase addresses.
- **Do NOT delete or close the duplicate issues (#140, #142, #145, #146, #147) before S6 lands.** They are tracking signal; close in the S6 commit body and the merge.
- **Do NOT touch `master` directly.** All work lands on `planning/main`. The shipper slice (out of scope) handles the master sync.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen wording and line ranges but should not re-litigate them.

1. **Path B (multi-mode substrate), not Path A (intake-form leaks fix).** Bug-batch workflow is a real second consumer; mode interface earns its keep against three existing lanes + one new mode = four implementations on day one.
2. **Refactor first, new mode second.** S1 (mode interface) and S2 (migrate 3 lanes) ship before S4 (new bug-batch mode). Validates the interface against real implementations before adding new capability.
3. **Single tool, mode discriminator.** No `forge_crucible_submit_bug_batch` tool variant — keep `forge_crucible_submit { mode, ... }`. ACI temper guard.
4. **Per-mode `criticalFields`, no global set.** Every required question in the mode's bank is critical. Optional fields simply omit their section; no `{{TBD:}}` markers ever ship.
5. **Truthful refusal as the single failure rule.** `CrucibleFinalizeRefusedError` is the only finalize failure (plus the existing `CruciblePlanExistsError` for the file-write guard). No "soft" TBD output mode by default.
6. **Backwards compatibility via legacy flag.** `crucible.legacy.tbdPlaceholders: true` in `.forge.json` restores the old behavior for one major-release-and-a-bit. Default off from day one; documented for removal.
7. **Mode interface is a JSDoc shape, not a class hierarchy.** Plain frozen objects with the required keys. No subclassing, no abstract base. Modes register at module load via `registerMode(modeObject)`.
8. **Renderer/parser alignment direction: renderer follows parser.** Parser is stable Phase 53 contract; renderer changes in S5 to match `parseScopeContract` and `parseSlices` heading expectations.
9. **Slice-header `[scope: paths]` clause is the canonical scope mechanism.** `**Files**:` body bullets remain as a redundant operator-readable form, but the parser-readable scope is the header clause.
10. **Single source of truth for validation gates.** Top-level `## Validation Gates` (mode-agnostic shell) is canonical; `**Acceptance Criteria**` blocks inside synthesized slices are dropped.
11. **`bug-batch` mode is opt-in via `submit { mode: "bug-batch" }`.** `inferLane()` is not extended to auto-route to bug-batch; that would change behavior for existing tweak-lane callers. A follow-on phase can wire `forge_bug_register` to auto-open `bug-batch` smelts.
12. **Mode registry is a plain `Map`, populated at module load.** Three existing modes register in their own files via top-level `registerMode(...)`. Bug-batch registers the same way. No dynamic load, no plugin discovery.
13. **Frontmatter extras are additive only.** `crucibleId`, `lane`, `source` continue unchanged; `linkedBugs`, `phaseId`, `bugId` are added (all optional). Downstream parsers must tolerate unknown fields.
14. **Smelt schema additions are optional.** Existing `.forge/crucible/<id>.json` files load and finalize without migration. `crucible-migrate.mjs` is unchanged.
15. **Issue closure plan: close 5 dups in S6 commit body; leave #118/#135/#137 closed.** Reviewers can re-open if the operator-burden delta isn't real per S7 retro evidence.
16. **Sub-module directory follows the Phase 51–53 pattern.** `pforge-mcp/crucible/` (NEW) is a sub-directory of focused sub-modules; `pforge-mcp/crucible-*.mjs` top-level files become re-export shims.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Multi-mode vs single-tier fix | ✅ Resolved | Multi-mode substrate (RD #1) |
| 2 | Refactor-first vs new-mode-first sequencing | ✅ Resolved | Refactor first (RD #2) |
| 3 | Tool surface multiplication | ✅ Resolved | Single tool, `mode` discriminator (RD #3) |
| 4 | `CRITICAL_FIELDS` shape | ✅ Resolved | Per-mode (RD #4) |
| 5 | TBD-marker contract | ✅ Resolved | Truthful refusal only (RD #5) |
| 6 | Back-compat strategy | ✅ Resolved | Legacy flag, default off (RD #6) |
| 7 | Mode interface shape | ✅ Resolved | JSDoc frozen object (RD #7) |
| 8 | Renderer↔parser drift direction | ✅ Resolved | Renderer follows parser (RD #8) |
| 9 | Slice scope-clause mechanism | ✅ Resolved | `[scope: paths]` header clause (RD #9) |
| 10 | Validation-gate single source | ✅ Resolved | Top-level `## Validation Gates` (RD #10) |
| 11 | `bug-batch` activation | ✅ Resolved | Opt-in via explicit `mode` (RD #11) |
| 12 | Mode registry mechanism | ✅ Resolved | Plain `Map`, module-load registration (RD #12) |
| 13 | Frontmatter shape change | ✅ Resolved | Additive only (RD #13) |
| 14 | Smelt schema migration | ✅ Resolved | No migration; optional fields only (RD #14) |
| 15 | Issue closure plan | ✅ Resolved | Close 5 dups in S6 (RD #15) |
| 16 | Sub-module directory layout | ✅ Resolved | `pforge-mcp/crucible/` subfolder (RD #16) |

All decisions for this phase are resolved above. Hardener may sharpen line ranges; no open TBDs block execution after hardening.

---

## Slice Decomposition

> All slices are tagged **[sequential]** — the baseline fixture from S0 plus the mode interface from S1 are prerequisites for every later slice. No parallel execution group exists.

### Slice 0 — Baseline snapshot fixtures + no-regression test

- **Depends On**: nothing (Execution Hold enforced outside the slice graph).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/crucible-draft.mjs`, `pforge-mcp/crucible-interview.mjs`, `pforge-mcp/crucible-server.mjs`, `pforge-mcp/tests/` (pattern reference for fixture-driven snapshot tests — see `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs`).
- **Traces to**: Resolved Decisions #2, #5, #14.
- **Scope** (files in scope):
  - `pforge-mcp/tests/fixtures/crucible-baseline/tweak-smelt.json` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/feature-smelt.json` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/full-smelt.json` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/tweak-rendered.md` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/feature-rendered.md` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/full-rendered.md` (NEW)
  - `pforge-mcp/tests/crucible-modes-no-regression.test.mjs` (NEW)
- Construct three deterministic fixture smelts (one per lane) with every question answered. Save the smelt JSON to fixtures.
- Render each via `renderDraft(smelt, { cwd: <repo-root> })` and snapshot output to `*-rendered.md` files (LF line endings).
- The no-regression test loads each smelt fixture, calls `renderDraft`, and asserts byte-identical match against the snapshot. Runs as part of `npm test`.
- Note in the test file: "Snapshot intentionally regenerates in Phase-59 S2 (truthful refusal change). Do not regenerate outside a deliberate plan amendment."
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/tests/fixtures/crucible-baseline/tweak-smelt.json','pforge-mcp/tests/fixtures/crucible-baseline/feature-smelt.json','pforge-mcp/tests/fixtures/crucible-baseline/full-smelt.json','pforge-mcp/tests/fixtures/crucible-baseline/tweak-rendered.md','pforge-mcp/tests/fixtures/crucible-baseline/feature-rendered.md','pforge-mcp/tests/fixtures/crucible-baseline/full-rendered.md','pforge-mcp/tests/crucible-modes-no-regression.test.mjs'])if(!fs.existsSync(f))throw new Error('missing fixture/test: '+f);console.log('ok S0 fixtures + test present');"
node -e "const fs=require('fs');for(const lane of ['tweak','feature','full']){const md=fs.readFileSync('pforge-mcp/tests/fixtures/crucible-baseline/'+lane+'-rendered.md','utf8');if(md.length<200)throw new Error(lane+' rendered fixture suspiciously short ('+md.length+' bytes)');}console.log('ok S0 rendered fixtures non-trivial');"
node -e "const fs=require('fs');const t=fs.readFileSync('pforge-mcp/tests/crucible-modes-no-regression.test.mjs','utf8');if(!/Phase-59|S2|truthful refusal/i.test(t))throw new Error('regen note missing from no-regression test');console.log('ok S0 regen note present');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-modes-no-regression.test.mjs"
```

### Slice 1 — Mode interface + core extraction (zero behavior change)

- **Depends On**: S0.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/crucible-server.mjs` (L94–135 for the three error classes; L137–150 for `CRITICAL_FIELDS`; L343–445 for `handleFinalize`), `pforge-mcp/crucible-draft.mjs` (L72–132 for `synthesizeSliceBlock`; L134–268 for `buildDraftContent` + `appendDraftPreamble` / `appendFullLaneSections` / `appendScopeContract` / `appendSliceTemplate` / `appendStandardBlocks` / `appendInterviewLog`; L270–298 for `renderDraft`; L300+ for `extractUnresolvedFields` + `MANDATORY_BLOCKS`), `pforge-mcp/crucible-interview.mjs` (L185–211 for `getQuestionBank`; L213–241 for `getNextQuestion`; L243–267 for `recordAnswer`; L269+ for `buildRecommendedDefault`), `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` (frozen contract reference — verify Crucible refactor doesn't surface new orchestrator exports).
- **Traces to**: Resolved Decisions #7, #12, #16.
- **Scope** (files in scope):
  - `pforge-mcp/crucible/mode.mjs` (NEW)
  - `pforge-mcp/crucible/registry.mjs` (NEW)
  - `pforge-mcp/crucible/core/finalize.mjs` (NEW)
  - `pforge-mcp/crucible/core/render-shell.mjs` (NEW)
  - `pforge-mcp/crucible/core/interview-protocol.mjs` (NEW)
  - `pforge-mcp/crucible-server.mjs` (re-export shim)
  - `pforge-mcp/crucible-draft.mjs` (re-export shim)
  - `pforge-mcp/crucible-interview.mjs` (re-export shim)
  - `pforge-mcp/tests/crucible-mode-interface.test.mjs` (NEW — contract test for the interface)
- `crucible/mode.mjs` exports a JSDoc-documented `Mode` shape: `{ id: string, lane: string, bank: ReadonlyArray<Question>, criticalFields: Set<string>, renderBody: (smelt, ctx) => string, frontmatterExtras: (smelt) => Record<string,string|string[]>, modeContextSchema?: object }`.
- `crucible/registry.mjs` exports `registerMode(mode)`, `getMode(id)`, `listModes()`. Backing store is a `Map<string, Mode>`.
- `crucible/core/finalize.mjs` owns the refusal contract, file-write guard, `CruciblePlanExistsError`, `CrucibleFinalizeRefusedError`. Imports `getMode` from registry. Reads `mode.criticalFields` instead of the deleted global `CRITICAL_FIELDS`.
- `crucible/core/render-shell.mjs` owns frontmatter render, `## Scope Contract` heading + sub-headings, `## Validation Gates`, `## Stop Conditions`, `## Rollback`, `## Change Manifest`. Calls `mode.renderBody(smelt, ctx)` for mode-specific sections.
- `crucible/core/interview-protocol.mjs` owns `getNextQuestion(smelt, mode)` — accepts a mode object explicitly, not via a lane lookup. `recordAnswer(smelt, questionId, answer)` is mode-agnostic.
- Top-level `crucible-server.mjs`, `crucible-draft.mjs`, `crucible-interview.mjs` become re-export shims: `export { handleFinalize, ... } from "./crucible/core/finalize.mjs";` etc. Public exports are byte-identical at this slice (verified by S0 baseline test).
- **No mode files yet.** S2 adds the three lane mode files; this slice only ships the substrate. The existing three-lane logic in the original modules is left in place during S1 and removed in S2 — overlap is intentional for the no-regression test to pass at S1.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/crucible/mode.mjs','pforge-mcp/crucible/registry.mjs','pforge-mcp/crucible/core/finalize.mjs','pforge-mcp/crucible/core/render-shell.mjs','pforge-mcp/crucible/core/interview-protocol.mjs','pforge-mcp/tests/crucible-mode-interface.test.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);console.log('ok S1 substrate present');"
node -e "import('./pforge-mcp/crucible/registry.mjs').then(m=>{if(typeof m.registerMode!=='function'||typeof m.getMode!=='function'||typeof m.listModes!=='function')throw new Error('registry API incomplete');console.log('ok S1 registry API');}).catch(e=>{console.error(e);process.exit(1);});"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-modes-no-regression.test.mjs tests/crucible-mode-interface.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/no-circular-imports.test.mjs"
```

### Slice 2 — Migrate 3 existing lanes to mode files; per-mode `criticalFields`; truthful refusal

- **Depends On**: S1.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/crucible/mode.mjs` (interface), `pforge-mcp/crucible/registry.mjs`, `pforge-mcp/crucible/core/render-shell.mjs`, `pforge-mcp/crucible-interview.mjs` (existing question banks — TWEAK_QUESTIONS, FEATURE_QUESTIONS, FULL_QUESTIONS), `pforge-mcp/crucible-draft.mjs` (existing per-lane render branches — `appendFullLaneSections`, `synthesizeSliceBlock`, `appendSliceTemplate`, `buildDraftContent`).
- **Traces to**: Resolved Decisions #4, #5, #7, #12.
- **Scope** (files in scope):
  - `pforge-mcp/crucible/modes/tweak.mjs` (NEW)
  - `pforge-mcp/crucible/modes/feature.mjs` (NEW)
  - `pforge-mcp/crucible/modes/full.mjs` (NEW)
  - `pforge-mcp/crucible/core/finalize.mjs` (drop CRITICAL_FIELDS reference, switch to `mode.criticalFields`)
  - `pforge-mcp/crucible/core/render-shell.mjs` (replace `{{TBD: <id>}}` fallback with omit-section for non-critical fields)
  - `pforge-mcp/crucible-interview.mjs` (preserve `TWEAK_QUESTIONS` / `FEATURE_QUESTIONS` / `FULL_QUESTIONS` exports as re-exports from the mode files; keep `inferLane`, `getQuestionBank`, `getNextQuestion` public)
  - `pforge-mcp/crucible-draft.mjs` (preserve `renderDraft`, `extractUnresolvedFields`, `MANDATORY_BLOCKS` public exports; delegate to `render-shell.mjs` + `mode.renderBody`)
  - `pforge-mcp/tests/fixtures/crucible-baseline/{tweak,feature,full}-rendered.md` (REGENERATE — explicitly in this slice's commit; diff justification in commit message)
  - `pforge-mcp/tests/crucible-modes-no-regression.test.mjs` (update commit-time comment recording the regen)
- Each mode file declares its bank, criticalFields, renderBody, frontmatterExtras, and calls `registerMode(...)` at module top.
- Mode files are imported by `crucible-server.mjs` shim at module load to trigger registration: `import "./crucible/modes/tweak.mjs"; import "./crucible/modes/feature.mjs"; import "./crucible/modes/full.mjs";`.
- `finalize.mjs` reads `mode.criticalFields`. The global `CRITICAL_FIELDS` `Set` is deleted from `crucible-server.mjs`. Per-mode criticality:
  - **tweak**: `scope-file`, `validation`, `forbidden-actions` (every required question except `rollback`, which is required but operationally optional for finalize)
  - **feature**: `scope-files`, `validation-gates`, `forbidden-actions`
  - **full**: `scope-in`, `scope-out`, `forbidden-actions`, `slice-count`, `rollback-plan` (full lane is the strictest; cannot ship without slice count)
  - Build/test commands remain inferred from `inferRepoCommands(cwd)` — the override question slated for Path A item A3 is deferred to S3 (when `linked-bugs` and other frontmatter additions land).
- **Truthful refusal change**: in `render-shell.mjs` and any `mode.renderBody`, missing optional answer = omit section. Missing required answer = `fallbackField` returns `null`, render skips the section, and `extractUnresolvedFields` is replaced with `gatherMissingCriticalFromMode(smelt, mode)` (computed against `mode.criticalFields`, not by regex-scraping output).
- Regenerate the three baseline fixtures (`tweak-rendered.md`, `feature-rendered.md`, `full-rendered.md`) using the same fixture smelts from S0 against the new render path. Commit the regenerated files with a commit body section: `Baseline regen (Phase-59 S2 — truthful refusal): <diff summary>`.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/crucible/modes/tweak.mjs','pforge-mcp/crucible/modes/feature.mjs','pforge-mcp/crucible/modes/full.mjs'])if(!fs.existsSync(f))throw new Error('missing mode file: '+f);console.log('ok S2 mode files present');"
node -e "import('./pforge-mcp/crucible/registry.mjs').then(async m=>{await import('./pforge-mcp/crucible-server.mjs');const ids=m.listModes().map(x=>x.id).sort();const expected=['feature','full','tweak'];if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('expected modes '+expected.join(',')+' got '+ids.join(','));console.log('ok S2 three lanes registered: '+ids.join(','));}).catch(e=>{console.error(e);process.exit(1);});"
node -e "const fs=require('fs');const s=fs.readFileSync('pforge-mcp/crucible/core/finalize.mjs','utf8');if(/CRITICAL_FIELDS\s*=\s*new Set/.test(s))throw new Error('global CRITICAL_FIELDS still defined in finalize.mjs');if(!/mode\.criticalFields/.test(s))throw new Error('mode.criticalFields not referenced in finalize.mjs');console.log('ok S2 per-mode criticalFields wired');"
node -e "const fs=require('fs');for(const lane of ['tweak','feature','full']){const md=fs.readFileSync('pforge-mcp/tests/fixtures/crucible-baseline/'+lane+'-rendered.md','utf8');if(/\\{\\{TBD:/.test(md))throw new Error(lane+' baseline still contains TBD markers — truthful refusal not applied');}console.log('ok S2 no TBD markers in baseline');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-modes-no-regression.test.mjs tests/crucible-mode-interface.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
```

### Slice 3 — Frontmatter completeness + `linked-bugs` question + build/test override

- **Depends On**: S2.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/crucible/core/finalize.mjs` (handleFinalize frontmatter emit, L370–390 region), `pforge-mcp/crucible-store.mjs` (smelt schema — verify `linkedBugs` field handling), `pforge-mcp/crucible-infer.mjs` (`inferRepoCommands` — for the override question default).
- **Traces to**: Resolved Decisions #13, #14.
- **Scope** (files in scope):
  - `pforge-mcp/crucible/core/finalize.mjs`
  - `pforge-mcp/crucible/modes/tweak.mjs`
  - `pforge-mcp/crucible/modes/feature.mjs`
  - `pforge-mcp/crucible/modes/full.mjs`
  - `pforge-mcp/crucible-server.mjs` (submit handler — pass-through `bugId`)
  - `pforge-mcp/tests/crucible-frontmatter.test.mjs` (NEW)
- `handleFinalize` frontmatter emit changes from:
  ```
  ---
  crucibleId: <id>
  lane: <lane>
  source: <source>
  ---
  ```
  to (only including non-empty keys):
  ```
  ---
  crucibleId: <id>
  lane: <lane>
  source: <source>
  phaseId: <phaseName>
  linkedBugs: [<bug1>, <bug2>]      # if any
  bugId: <bugId>                     # if submit carried one
  ---
  ```
- All three modes' banks get a `linked-bugs` question (optional, NOT in criticalFields). Default value is the smelt's submit-time `bugId` if present (formatted as `[<bugId>]`).
- `submit` handler stores `bugId` on the smelt at creation time. Existing `createSmelt` in `crucible-store.mjs` already accepts arbitrary properties; verify no schema migration required.
- Add `pforge-mcp/tests/crucible-frontmatter.test.mjs`:
  - Smelt without `bugId` and without `linked-bugs` answer → frontmatter omits both keys.
  - Smelt with `bugId: "RMG-0035"` and no `linked-bugs` answer → frontmatter emits `bugId: RMG-0035` and `linkedBugs: [RMG-0035]`.
  - Smelt with `bugId: "RMG-0035"` and `linked-bugs: "RMG-0035, RMG-0041"` → frontmatter emits `bugId: RMG-0035` and `linkedBugs: [RMG-0035, RMG-0041]`.
  - `phaseId` always emitted post-finalize (equals `phaseName`).
- Build/test command override question is added to each mode's bank ONLY when `inferRepoCommands(cwd)` returns `null` for one or both commands — implemented as a per-mode `extendBankForContext(smelt, ctx)` hook on the mode interface. Default implementation returns the static bank.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/tests/crucible-frontmatter.test.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);for(const m of ['tweak','feature','full']){const s=fs.readFileSync('pforge-mcp/crucible/modes/'+m+'.mjs','utf8');if(!/linked-bugs/.test(s))throw new Error(m+' mode missing linked-bugs question');}console.log('ok S3 modes carry linked-bugs question');"
node -e "const fs=require('fs');const s=fs.readFileSync('pforge-mcp/crucible/core/finalize.mjs','utf8');for(const k of ['phaseId','linkedBugs','bugId'])if(!new RegExp(k).test(s))throw new Error('finalize.mjs missing frontmatter key emit: '+k);console.log('ok S3 finalize emits additive frontmatter keys');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-frontmatter.test.mjs tests/crucible-modes-no-regression.test.mjs tests/crucible-mode-interface.test.mjs"
```

### Slice 4 — `bug-batch` mode + RMG-0035 regression target

- **Depends On**: S3.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/crucible/mode.mjs` (interface), `pforge-mcp/crucible/modes/feature.mjs` (pattern reference for a mode file), `pforge-mcp/crucible/core/render-shell.mjs` (mode body wiring), `pforge-mcp/crucible-server.mjs` (submit handler — accepts `mode: "bug-batch"`), the RMG-0035 reproduction (hardener attaches at hardening time or notes that the gate falls back to structural assertions).
- **Traces to**: Resolved Decisions #1, #11, #16.
- **Scope** (files in scope):
  - `pforge-mcp/crucible/modes/bug-batch.mjs` (NEW)
  - `pforge-mcp/crucible-server.mjs` (extend submit `mode` enum to include `bug-batch`)
  - `pforge-mcp/server/tool-definitions.mjs` (extend `forge_crucible_submit` inputSchema mode enum)
  - `pforge-mcp/tests/crucible-modes/bug-batch.test.mjs` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-smelt.json` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-rendered.md` (NEW)
- `bug-batch.mjs` declares the 8-question bank (symptom-observed, expected-behavior, suspected-component, scope-files, slice-breakdown, validation-gates, forbidden-actions, rollback) and registers via `registerMode(...)`.
- `criticalFields`: `scope-files`, `validation-gates`, `forbidden-actions`, `slice-breakdown`.
- `frontmatterExtras(smelt)`: returns `{ linkedBugs: smelt.bugId ? [smelt.bugId] : undefined, bugId: smelt.bugId }`. Empty values cause omission.
- `renderBody(smelt, ctx)` emits in order:
  1. `## Root Cause Hypothesis` — three sub-paragraphs from `symptom-observed`, `expected-behavior`, `suspected-component`.
  2. `## Slices` — N synthesized `### Slice <i> — <name> [scope: <paths>]` blocks parsed from the `slice-breakdown` answer (one slice per non-empty line, format `<name> | <files> | <test-command-or-acceptance>`).
  3. Each synthesized slice's body: `Build command: <inferred>`, `Test command: <from-line>`, `**Files**:` bullet list (in addition to the `[scope: paths]` header — operator-readable redundancy).
- Slice-breakdown parser: splits the answer on `\n`, splits each line on `|`, trims; if a line has fewer than 3 parts the parse fails and finalize refuses with `criticalGaps: ["slice-breakdown"]` and a hint specifying the expected format.
- `bug-batch.test.mjs`:
  - **Contract**: bank length 8, all 8 IDs present, `criticalFields` covers the 4 names above, `frontmatterExtras` emits expected shape for both with/without bugId cases.
  - **Render**: a fixture smelt with all 8 answers + 2-line slice-breakdown produces 2 synthesized slices, each with a `[scope: …]` header clause and a `## Root Cause Hypothesis` section before the slices.
  - **Refuse**: a smelt missing `slice-breakdown` causes finalize to throw `CrucibleFinalizeRefusedError` with `criticalGaps` containing `slice-breakdown`.
  - **RMG-0035 regression** (if reproduction available — see Execution Hold): a smelt seeded with answers approximating RMG-0035 produces a 2-slice plan whose first slice's `[scope: paths]` clause includes the file the bug fix actually touched (per the reproduction).
- Add `bug-batch-smelt.json` + `bug-batch-rendered.md` as the snapshot fixture for this mode. The no-regression test from S0 is extended to include this mode.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/crucible/modes/bug-batch.mjs','pforge-mcp/tests/crucible-modes/bug-batch.test.mjs','pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-smelt.json','pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-rendered.md'])if(!fs.existsSync(f))throw new Error('missing: '+f);console.log('ok S4 bug-batch artifacts present');"
node -e "import('./pforge-mcp/crucible/registry.mjs').then(async m=>{await import('./pforge-mcp/crucible-server.mjs');const bb=m.getMode('bug-batch');if(!bb)throw new Error('bug-batch mode not registered');if(bb.bank.length!==8)throw new Error('bug-batch bank length '+bb.bank.length+' (expected 8)');const crit=Array.from(bb.criticalFields).sort();const expected=['forbidden-actions','scope-files','slice-breakdown','validation-gates'];if(JSON.stringify(crit)!==JSON.stringify(expected))throw new Error('bug-batch criticalFields '+crit.join(',')+' (expected '+expected.join(',')+')');console.log('ok S4 bug-batch contract');}).catch(e=>{console.error(e);process.exit(1);});"
node -e "const fs=require('fs');const md=fs.readFileSync('pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-rendered.md','utf8');if(!/## Root Cause Hypothesis/.test(md))throw new Error('rendered bug-batch missing Root Cause Hypothesis section');const sliceHeaders=(md.match(/^### Slice \\d+ — /gm)||[]);if(sliceHeaders.length<2)throw new Error('rendered bug-batch has '+sliceHeaders.length+' slices; expected >=2 from fixture');if(!/\\[scope:[^\\]]+\\]/.test(md))throw new Error('rendered bug-batch missing [scope: ...] header clause');console.log('ok S4 bug-batch rendered shape: '+sliceHeaders.length+' slices, root-cause section present, scope clause present');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-modes/bug-batch.test.mjs tests/crucible-modes-no-regression.test.mjs tests/crucible-mode-interface.test.mjs tests/crucible-frontmatter.test.mjs"
```

### Slice 5 — Renderer↔parser alignment

- **Depends On**: S4.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator/plan-parser.mjs` (READ-ONLY — `parseSlices` L559+ for `[scope: paths]` header parsing, `parseScopeContract` L321+ for `### Forbidden` under `## Scope Contract`, `handleFilesHeading` L525+ for `**Files**:` body parsing), `pforge-mcp/crucible/core/render-shell.mjs` (target — move Forbidden under Scope Contract), `pforge-mcp/crucible/modes/{tweak,feature,full,bug-batch}.mjs` (synthesized-slice header emit).
- **Traces to**: Resolved Decisions #8, #9, #10.
- **Scope** (files in scope):
  - `pforge-mcp/crucible/core/render-shell.mjs`
  - `pforge-mcp/crucible/modes/tweak.mjs`
  - `pforge-mcp/crucible/modes/feature.mjs`
  - `pforge-mcp/crucible/modes/full.mjs`
  - `pforge-mcp/crucible/modes/bug-batch.mjs`
  - `pforge-mcp/tests/crucible-parser-alignment.test.mjs` (NEW)
  - `pforge-mcp/tests/fixtures/crucible-baseline/{tweak,feature,full,bug-batch}-rendered.md` (REGENERATE — second deliberate baseline regen, justified in commit body)
- Change in `render-shell.mjs`:
  - The top-level `## Anti-patterns & Forbidden Actions` heading is removed. Forbidden-actions content moves under `## Scope Contract` → `### Forbidden` (matches `parseScopeContract`'s expected heading).
  - Verify `## Scope Contract` → `### In Scope` / `### Out of Scope` heading shapes match the parser.
- Change in each mode's body renderer that produces a synthesized slice header:
  - Header format: `### Slice N — <name> [scope: <comma-separated-paths>]`
  - The `[scope: …]` clause derives from the slice's `scope-files` / `slice-breakdown` files list.
  - The `**Acceptance Criteria**:` block inside the slice body is dropped. Top-level `## Validation Gates` (in `render-shell.mjs`) is the single source.
- Add `pforge-mcp/tests/crucible-parser-alignment.test.mjs`:
  - For each mode, render a fixture smelt, pass the output through `parseSlices` from `plan-parser.mjs`, and assert: `slices[0].scope` is non-empty AND matches what the smelt declared.
  - For each mode, render, pass through `parseScopeContract`, and assert: `contract.forbidden` is non-empty when the mode declared forbidden actions.
  - For bug-batch: render with multi-line `slice-breakdown`, parse, assert `slices.length === N` matching the line count.
- Regenerate baseline fixtures (now 4 — tweak, feature, full, bug-batch) under the new shape. Commit body section: `Baseline regen (Phase-59 S5 — renderer↔parser alignment): <diff summary>`.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('pforge-mcp/crucible/core/render-shell.mjs','utf8');if(/## Anti-patterns/.test(s))throw new Error('render-shell still emits ## Anti-patterns heading — should move under Scope Contract');if(!/### Forbidden/.test(s))throw new Error('render-shell missing ### Forbidden subheading under Scope Contract');console.log('ok S5 render-shell forbidden placement');"
node -e "const fs=require('fs');for(const m of ['tweak','feature','full','bug-batch']){const md=fs.readFileSync('pforge-mcp/tests/fixtures/crucible-baseline/'+m+'-rendered.md','utf8');if(/## Anti-patterns/.test(md))throw new Error(m+' baseline still has ## Anti-patterns');if(!/### Forbidden/.test(md))throw new Error(m+' baseline missing ### Forbidden under Scope Contract');}console.log('ok S5 baselines reflect heading move');"
node -e "const fs=require('fs');const md=fs.readFileSync('pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-rendered.md','utf8');const headers=md.match(/^### Slice \\d+ — [^\\n]+\\[scope:[^\\]]+\\]/gm)||[];if(headers.length<2)throw new Error('bug-batch baseline has '+headers.length+' slice headers with [scope:] clause; expected >=2');console.log('ok S5 bug-batch synthesized slices carry [scope:] header clause');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-parser-alignment.test.mjs tests/crucible-modes-no-regression.test.mjs tests/crucible-mode-interface.test.mjs tests/crucible-frontmatter.test.mjs tests/crucible-modes/bug-batch.test.mjs"
```

### Slice 6 — Deprecation gate + duplicate-issue closure prep

- **Depends On**: S5.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/.forge.json` (if it exists in pforge-mcp's own dogfood; otherwise the schema is implicit), `pforge-mcp/crucible-config.mjs` (existing config loader — pattern reference), `pforge-mcp/crucible/core/render-shell.mjs` (where the legacy flag would be consulted).
- **Traces to**: Resolved Decisions #6, #15.
- **Scope** (files in scope):
  - `pforge-mcp/crucible-config.mjs` (extend config loader with `legacy.tbdPlaceholders` knob, default `false`)
  - `pforge-mcp/crucible/core/render-shell.mjs` (consult the legacy flag; when true, restore `{{TBD: <id>}}` markers for non-critical fields)
  - `pforge-mcp/tests/crucible-legacy-flag.test.mjs` (NEW)
  - `docs/crucible-modes.md` (NEW — short operator doc covering: mode discriminator, legacy flag deprecation timeline, when to use bug-batch)
- The legacy flag is consulted **only** for non-critical fields. Critical fields always refuse — no flag opts out of refusal.
- One-time `console.warn` at server startup when `legacy.tbdPlaceholders === true`, plus an audit log entry to `.forge/runs/<id>/audit.jsonl` with event type `crucible.legacy-tbd-enabled`. Idempotent (warns once per process).
- `crucible-legacy-flag.test.mjs`:
  - Default (flag false): renders without `{{TBD:}}` markers (matches post-S2 baseline).
  - Flag true: renders with `{{TBD: <id>}}` markers for non-critical fields (matches pre-S2 baseline pattern).
  - Critical fields still refuse regardless of flag.
- `docs/crucible-modes.md` includes a "Deprecation schedule" section: legacy flag removed in major-after-next.
- S6 commit body MUST include the line `Closes #140, #142, #145, #146, #147` so the GitHub merge auto-closes the duplicate issues. Do not close #118, #135, #137.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['docs/crucible-modes.md','pforge-mcp/tests/crucible-legacy-flag.test.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);const s=fs.readFileSync('pforge-mcp/crucible-config.mjs','utf8');if(!/legacy.*tbdPlaceholders|tbdPlaceholders.*legacy/i.test(s))throw new Error('crucible-config.mjs missing legacy.tbdPlaceholders knob');console.log('ok S6 legacy flag wired');"
node -e "const fs=require('fs');const s=fs.readFileSync('pforge-mcp/crucible/core/render-shell.mjs','utf8');if(!/tbdPlaceholders/.test(s))throw new Error('render-shell does not consult legacy flag');console.log('ok S6 render-shell consults legacy flag');"
node -e "const fs=require('fs');const d=fs.readFileSync('docs/crucible-modes.md','utf8');if(!/Deprecation|deprecation/.test(d))throw new Error('crucible-modes.md missing Deprecation section');if(!/bug-batch/.test(d))throw new Error('crucible-modes.md missing bug-batch coverage');console.log('ok S6 operator doc covers required sections');"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-legacy-flag.test.mjs tests/crucible-modes-no-regression.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
```

### Slice 7 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0–S6 all green.
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md` (retro pattern reference), `docs/plans/cleanup-findings/raw/` (location pattern for baseline fixtures, though S7 doesn't generate one), all four `pforge-mcp/tests/fixtures/crucible-baseline/*-rendered.md` files (before/after evidence for the retro).
- **Traces to**: Resolved Decisions #15.
- **Scope** (files in scope):
  - `docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md` (NEW)
  - `docs/plans/DEPLOYMENT-ROADMAP.md`
  - `CHANGELOG.md`
- Retro must include:
  - Shape-of-output comparison (before vs after) for each lane — quote the heading hierarchy delta and the `[scope:]` clause emergence.
  - The rendered output of the `bug-batch` mode against RMG-0035 (or the synthetic fixture if RMG-0035 wasn't available) with operator-burden commentary: how many sections did the operator have to hand-write before vs after.
  - Honest answer to "is the operator burden actually lower for RMG-0035-class bugs?" — if YES, quote the delta; if NO, document what's still missing and propose the follow-on phase.
  - Per-slice notes (what changed, what didn't).
  - Deferred items: no `meta-bug` / `sarif-finding` / `triage` modes shipped; auto-open of bug-batch from `forge_bug_register` not wired. List as follow-on phase candidates.
- Move Phase 59 from Active to Completed in DEPLOYMENT-ROADMAP.
- Append CHANGELOG `[Unreleased] → Changed` entry: "Phase 59 — Crucible multi-mode substrate; new `bug-batch` mode; renderer/parser alignment; legacy TBD-placeholder behavior gated behind `crucible.legacy.tbdPlaceholders`."
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md','docs/plans/DEPLOYMENT-ROADMAP.md','CHANGELOG.md'])if(!fs.existsSync(f))throw new Error('missing: '+f);const retro=fs.readFileSync('docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md','utf8');for(const heading of ['Shape-of-output','bug-batch','operator burden','Deferred'])if(!new RegExp(heading,'i').test(retro))throw new Error('retro missing section: '+heading);const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!/59 — CRUCIBLE-MODES/.test(rm))throw new Error('Phase 59 not in roadmap Completed table');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!/Phase 59|CRUCIBLE-MODES/i.test(cl))throw new Error('CHANGELOG entry missing');console.log('ok S7');"
bash -c "cd pforge-mcp && npx vitest run"
```

---

## Acceptance Criteria

- **MUST**: Baseline snapshot fixtures for tweak / feature / full lanes exist (S0) and are checked in.
- **MUST**: `pforge-mcp/tests/crucible-modes-no-regression.test.mjs` exists and passes against the baseline (S0).
- **MUST**: `pforge-mcp/crucible/` directory exists with `mode.mjs`, `registry.mjs`, and `core/` subfolder (S1).
- **MUST**: `pforge-mcp/crucible/modes/` directory exists with `tweak.mjs`, `feature.mjs`, `full.mjs` (S2) and `bug-batch.mjs` (S4).
- **MUST**: Global `CRITICAL_FIELDS` `Set` is deleted from `crucible-server.mjs` after S2; per-mode `criticalFields` is the single source (S2).
- **MUST**: Post-S2 baseline fixtures contain zero `{{TBD:}}` markers (truthful refusal applied).
- **MUST**: Top-level `crucible-server.mjs`, `crucible-draft.mjs`, `crucible-interview.mjs` retain public export shape (zero breaking change to external callers).
- **MUST**: `handleFinalize` emits `phaseId`, optional `linkedBugs`, optional `bugId` in frontmatter after S3.
- **MUST**: All three pre-existing modes carry a `linked-bugs` question after S3.
- **MUST**: `bug-batch` mode registered after S4; bank length 8; criticalFields = `{scope-files, validation-gates, forbidden-actions, slice-breakdown}`.
- **MUST**: `bug-batch` mode renders `## Root Cause Hypothesis` section + multi-slice synthesizer (1 slice per slice-breakdown line) after S4.
- **MUST**: All synthesized slice headers (all modes) carry `[scope: <paths>]` clause after S5.
- **MUST**: Forbidden-actions content renders under `## Scope Contract` → `### Forbidden` (parser-aligned) after S5; the top-level `## Anti-patterns & Forbidden Actions` heading is gone.
- **MUST**: Slice-internal `**Acceptance Criteria**:` blocks are gone; `## Validation Gates` (top-level shell) is the single source after S5.
- **MUST**: `crucible-parser-alignment.test.mjs` validates renderer output through `parseSlices` and `parseScopeContract` for all four modes (S5).
- **MUST**: `crucible.legacy.tbdPlaceholders` config knob exists, defaults `false`, gates `{{TBD:}}` marker emission (S6).
- **MUST**: `docs/crucible-modes.md` written; covers mode selection, bug-batch usage, and the legacy-flag deprecation timeline (S6).
- **MUST**: S6 commit body closes #140, #142, #145, #146, #147 (and only those).
- **MUST**: `docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md` written and committed in S7.
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` lists Phase 59 in Completed by end of S7.
- **MUST**: `CHANGELOG.md` `[Unreleased] → Changed` entry added in S7.
- **MUST**: Full `pforge-mcp` test suite passes at end of every slice (no regressions).
- **MUST**: No new dependency added.
- **MUST**: `forge_crucible_*` MCP tool count is preserved; ACI payload shapes preserved.
- **MUST**: `lockHash` in plan frontmatter matches at run time.
- **SHOULD**: RMG-0035 reproduction (if available) renders into a multi-slice bug-batch plan whose first slice scope matches the actual fix location.
- **SHOULD**: Operator-burden delta documented in S7 retro with quantitative before/after (sections hand-written count).
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before Phase 59 is promoted to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + baseline-vs-current rendering at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm baseline fixtures parse, render byte-identical to checked-in `*-rendered.md` files, and the no-regression test passes. |
| **S1** | Re-read §"Forbidden Actions". Confirm only files inside `pforge-mcp/crucible/` and the three top-level shims changed. Public exports of `crucible-server.mjs`, `crucible-draft.mjs`, `crucible-interview.mjs` are byte-identical. No-regression test still passes (zero behavior change). |
| **S2** | Re-read §"Forbidden Actions". Confirm the three mode files exist, register on import, and the regenerated baseline fixtures contain zero `{{TBD:}}` markers. Global `CRITICAL_FIELDS` deleted. Full vitest suite green. |
| **S3** | Re-read §"Forbidden Actions". Confirm frontmatter additions are additive only (no key removal, no rename). Smelt schema not migrated. Existing tests still pass. |
| **S4** | Re-read §"Forbidden Actions". Confirm `bug-batch` mode registered alongside the existing three. Render fixture has multi-slice output + Root Cause Hypothesis section. `forge_crucible_submit` inputSchema mode enum updated. |
| **S5** | Re-read §"Forbidden Actions". Confirm `## Anti-patterns` heading removed; `### Forbidden` under `## Scope Contract` present in all four baselines. `[scope:]` clause present in all synthesized slice headers. Acceptance-Criteria slice-internal blocks gone. `crucible-parser-alignment.test.mjs` green. |
| **S6** | Re-read §"Forbidden Actions". Confirm legacy flag default-off, critical fields still refuse regardless of flag, operator doc covers deprecation timeline. |
| **S7** | Confirm roadmap promotion, retro (with before/after evidence), CHANGELOG entry, and dup-issue closure plan all in place. Full vitest suite green. |

---

## Definition of Done

- [ ] All 8 execution slices (S0–S7) committed individually with conventional-commit messages.
- [ ] All slice validation gates green.
- [ ] All Re-anchor Checkpoints passed.
- [ ] `pforge-mcp/crucible/` subfolder exists with mode interface, registry, and core sub-modules.
- [ ] `pforge-mcp/crucible/modes/` subfolder exists with four mode files (tweak, feature, full, bug-batch).
- [ ] Global `CRITICAL_FIELDS` deleted; per-mode `criticalFields` is the single source.
- [ ] Zero `{{TBD:}}` markers in default-rendered output (legacy flag off).
- [ ] Synthesized slice headers carry `[scope: <paths>]` clause across all modes.
- [ ] Forbidden-actions content under `## Scope Contract` → `### Forbidden` (parser-aligned).
- [ ] `bug-batch` mode operational; produces multi-slice output with Root Cause Hypothesis section.
- [ ] Frontmatter emits `phaseId`, optional `linkedBugs`, optional `bugId`.
- [ ] `crucible.legacy.tbdPlaceholders` config knob exists; default off.
- [ ] `docs/crucible-modes.md` written.
- [ ] Full `pforge-mcp` test suite passes.
- [ ] Top-level `crucible-server.mjs`, `crucible-draft.mjs`, `crucible-interview.mjs` retain public exports.
- [ ] `forge_crucible_*` MCP tool count and ACI shapes preserved.
- [ ] No new dependency added.
- [ ] `docs/plans/testbed-findings/Phase-59-CRUCIBLE-MODES-retro.md` written.
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` lists Phase 59 in Completed.
- [ ] `CHANGELOG.md` `[Unreleased] → Changed` entry added.
- [ ] Issues #140, #142, #145, #146, #147 closed (via S6 commit body or merge close).
- [ ] Reviewer Gate passed (zero 🔴 Critical findings).
- [ ] `lockHash` in plan frontmatter matches at run time.

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Baseline no-regression test fails after S1** | S1 was supposed to be zero behavior change; a regression means re-export wiring or shell extraction is wrong. | Roll back S1; diff the actual vs baseline render; fix the extraction. |
| **Baseline regeneration in S2 changes more than just the TBD-marker removal** | Truthful-refusal change should ONLY drop `{{TBD:}}` lines; any other content delta means render-shell extraction altered semantics. | Roll back S2; identify the unintended semantic change; re-scope. |
| **Public export of `crucible-server.mjs` / `crucible-draft.mjs` / `crucible-interview.mjs` changes** | External callers (including tests, dashboard, REST routes) depend on these exports. Breaking them violates the no-breaking-change contract. | Roll back the slice; preserve the shim. |
| **`forge_crucible_*` MCP tool count or shape changes** beyond the `mode` enum extension in `submit` | ACI/contract violation. | Roll back; route the change through `mode.modeContextSchema` instead. |
| **A new dependency lands** | Lean dependencies principle (Project Principle 7). | Roll back; implement without the dep or file a Required Decision amendment. |
| **`pforge-mcp/orchestrator/plan-parser.mjs` is modified** | This phase aligns renderer to parser, not the reverse. Modifying the parser means the scope was wrong. | Halt; re-read RD #8 and S5 scope; if a parser change is genuinely needed, raise a separate phase plan. |
| **Smelt JSON-on-disk schema becomes incompatible** | Existing `.forge/crucible/<id>.json` files must continue to load. | Roll back the schema-touching change; use additive optional fields only. |
| **`bug-batch` mode shipped without a regression test exercising the multi-slice synthesizer** | The new operator-visible win is exactly the multi-slice synthesizer; shipping it without a test means we can't catch regressions later. | Halt S4; add the test; resume. |
| **Renderer output stops being parseable by `parseSlices` / `parseScopeContract`** in S5 | Alignment is the whole point of S5; if it regresses the alignment, halt. | Roll back S5; pick a different alignment target. |
| **Critical field check stops refusing in S6 when legacy flag is true** | Legacy flag is for non-critical fields only; critical refusal is non-negotiable. | Roll back S6; tighten the flag scope. |
| **#140/#142/#145/#146/#147 closures land before S6** | Issue housekeeping should track the actual fix landing in S6. | Re-open the issues; close them when S6 merges. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| No-regression test fails once after a refactor slice | Retry once after diffing actual vs expected render; check re-export wiring. |
| No-regression test fails twice on the same slice | Halt per Stop Conditions. |
| Mode-interface contract test fails once | Retry once after re-reading the JSDoc interface and verifying mode-file structure. |
| Mode-interface contract test fails twice | Halt; the interface may need amendment via a Required Decision. |
| Snapshot fixture diff is larger than the slice's stated intent | Halt — likely a semantic regression in shell extraction. |
| `bug-batch` regression test (RMG-0035 fixture) fails once | Retry once after inspecting the slice-breakdown parser output. |
| Full vitest suite has a likely unrelated flake | Re-run once. If the same test fails twice, treat as real. |
| Parser-alignment test fails once | Retry once after diffing the renderer output against the parser's expected heading shape. |
| Parser-alignment test fails twice | Halt; re-read `parseSlices` / `parseScopeContract` line-by-line and adjust the renderer. |
| Legacy-flag test fails once | Retry once after verifying the flag plumbing through `crucible-config.mjs`. |

---

## Notes for the Hardener

- **Line ranges already sharpened against current files** (verified 2026-05-21 at HEAD `26a5b3b`):
  - `crucible-server.mjs`: error classes L94–135, `CRITICAL_FIELDS` L137–150, `handleFinalize` L343–445.
  - `crucible-draft.mjs`: `synthesizeSliceBlock` L72, `buildDraftContent` L134, `appendDraftPreamble` L148, `appendFullLaneSections` L161, `appendScopeContract` L193, `appendSliceTemplate` L206, `appendStandardBlocks` L232, `appendInterviewLog` L260, `renderDraft` L270, `extractUnresolvedFields` L300.
  - `crucible-interview.mjs`: `getQuestionBank` L185, `getNextQuestion` L213, `recordAnswer` L243, `buildRecommendedDefault` L269.
  - `orchestrator/plan-parser.mjs`: `parseScopeContract` L321, `handleFilesHeading` L525, `parseSlices` L559.
- **Verify renderer↔parser heading shapes** for S5 by reading `pforge-mcp/orchestrator/plan-parser.mjs` `parseScopeContract` (L321) and `parseSlices` (L559) line-by-line and noting the EXACT regex expectations. If the renderer's current `## Anti-patterns & Forbidden Actions` is already aliased somewhere in the parser, S5's scope may shrink.
- **Confirm `bug-batch` mode bank length is 8 questions** by re-reading the question list in this plan and counting; the validation gate hard-asserts 8.
- **Compute `lockHash`** and replace `TBD` in the frontmatter.
- **Survey RMG-0035 reproduction availability.** If the Rummag consumer can provide a synthetic fixture by the time hardening runs, attach it as `pforge-mcp/tests/fixtures/crucible-baseline/bug-batch-rmg-0035-smelt.json` and add a stricter assertion to the bug-batch test. If not, the gate falls back to structural assertions per the Execution Hold.
- **Verify no in-flight plan touches `pforge-mcp/crucible-*.mjs`** by checking `git log --since=14.days -- pforge-mcp/crucible-*.mjs` — if there is concurrent work, coordinate before hardening.
- **Verify the smelt-store schema** accepts arbitrary properties (specifically `bugId`) by reading `pforge-mcp/crucible-store.mjs`'s `createSmelt` / `updateSmelt` / `loadSmelt`. If schema validation rejects unknown keys, S3 scope expands to include a schema migration — file a Required Decision amendment before proceeding.
- **Preserve the S0–S7 slice ordering**; only line ranges, fixture shapes, and the bug-batch question wording may sharpen.
- **Do NOT bundle slices**. Each slice is a single commit, individually validated.
- **The `meta-bug` / `sarif-finding` / `triage` modes are intentionally deferred** — they land when their callers (`forge_meta_bug_file`, `sarif-to-plan.mjs`, `forge_classifier_issue`) move. A follow-up plan after this phase should wire them as single-file additions.
- **Two baseline regenerations are planned** (S2 and S5). Both are deliberate plan amendments documented in their commit bodies. A third regeneration is a Stop Condition.
- **S6's commit body MUST close exactly five issues** (#140, #142, #145, #146, #147). Do NOT close #118/#135/#137 — their fixes stand; this phase addresses the broader cause.
