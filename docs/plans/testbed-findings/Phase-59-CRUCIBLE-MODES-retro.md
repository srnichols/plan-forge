# Phase 59 — CRUCIBLE-MODES — Retro

> **Phase**: 59  
> **Name**: CRUCIBLE-MODES  
> **Status**: ✅ Complete (2026-05-21)  
> **Goal**: Multi-mode Crucible intake substrate: mode interface + registry, per-mode criticalFields, truthful refusal, `bug-batch` lane, renderer/parser alignment, legacy-flag deprecation gate.

---

## Shape-of-Output Comparison (Before vs After)

### Scope Contract heading hierarchy

**Before Phase 59 (pre-S5):**

```markdown
## Scope Contract

**In scope**:

- pforge-mcp/pagination.mjs

## [other sections…]

## Anti-patterns & Forbidden Actions

- no schema changes
- no edits outside scope-file
```

**After Phase 59 (post-S5):**

```markdown
## Scope Contract

### In Scope

- pforge-mcp/pagination.mjs

### Forbidden

- no schema changes
- no edits outside scope-file

## [other sections…]
```

**Parser benefit**: `parseScopeContract` in `orchestrator/plan-parser.mjs` expects `### In Scope`, `### Out of Scope`, `### Forbidden` under `## Scope Contract`. Pre-Phase-59 output used bold-text pseudo-headings (`**In scope**:`) and a separate top-level heading (`## Anti-patterns`), which the parser could not consume. Post-S5, a rendered plan can be parsed without any post-processing.

### Synthesized slice header

**Before Phase 59 (pre-S5):**

```markdown
### Slice 1 — Add export-to-CSV capability to cost report

Build command: npm run build
Test command:  npm test

**Files**:
- pforge-mcp/cost-service.mjs
- pforge-mcp/server.mjs

**Acceptance Criteria**:
- [ ] cd pforge-mcp && npx vitest run tests/cost-csv.test.mjs
```

**After Phase 59 (post-S5):**

```markdown
### Slice 1 — Add export-to-CSV capability to cost repor [scope: pforge-mcp/cost-service.mjs, pforge-mcp/server.mjs]

Build command: npm run build
Test command:  npm test

**Files**:
- pforge-mcp/cost-service.mjs
- pforge-mcp/server.mjs
```

**Parser benefit**: `parseSlices` extracts `[scope: <paths>]` from the slice header directly into `slice.scope[]`. Pre-Phase-59, scope information was buried in the `**Files**:` body and required a separate `handleFilesHeading` parse pass. The `**Acceptance Criteria**:` block was redundant with `## Validation Gates` and has been removed; `## Validation Gates` is now the single source.

### `bug-batch` mode output (RMG-0035 fixture)

Pre-Phase-59, a bug of the RMG-0035 class would be tracked as a `tweak` or `feature` smelt with no structured root-cause section and no multi-slice synthesizer. The operator would hand-write the entire document body.

**Post-Phase-59 `bug-batch` output (condensed fixture excerpt):**

```markdown
## Root Cause Hypothesis

**Symptom observed**: plan-parser.mjs throws TypeError: Cannot read properties of null when scope-files answer is empty string

**Expected behavior**: parseScopeContract returns empty scope array instead of crashing

**Suspected component**: pforge-mcp/orchestrator/plan-parser.mjs handleFilesHeading (L525)

## Scope Contract

### In Scope

- pforge-mcp/orchestrator/plan-parser.mjs
- pforge-mcp/tests/plan-parser.test.mjs

### Forbidden

- do not alter the public parseScopeContract API signature
- do not change unrelated plan-parser functions

## Slices

### Slice 1 — Guard empty scope-files [scope: pforge-mcp/orchestrator/plan-parser.mjs]

Build command: npm run build
Test command:  npm run test:parser

**Files**:
- pforge-mcp/orchestrator/plan-parser.mjs

### Slice 2 — Add regression test [scope: pforge-mcp/tests/plan-parser.test.mjs]

Build command: npm run build
Test command:  npm run test:parser

**Files**:
- pforge-mcp/tests/plan-parser.test.mjs
```

**Is operator burden actually lower for RMG-0035-class bugs? YES.**

| Section | Pre-Phase-59 (hand-written) | Post-Phase-59 (generated) |
|---------|----------------------------|--------------------------|
| Root Cause Hypothesis | 0 (not structured) → ✍️ hand-write | ✅ synthesized from 3 answers |
| Scope Contract headings | ✍️ hand-write `**In scope**:` | ✅ generated `### In Scope` + `### Forbidden` |
| Synthesized slices | ✍️ hand-write each `### Slice N` block | ✅ generated from `slice-breakdown` answer (pipe-delimited) |
| `[scope: <paths>]` clause | ✍️ never existed | ✅ generated for each slice header |
| Validation gates | ✍️ hand-write | ✅ copied from `validation-gates` answer |
| Change manifest | ✍️ hand-write | ✅ synthesized from `scope-files` answer |

**Sections an operator must still write**: `slice-breakdown` answer in the correct pipe-delimited format. All other sections are fully synthesized from the 8-question interview.

**Remaining operator burden (approx.)**: 8 interview answers (3–5 words each for most) vs. a 30–60 line document written by hand. The `slice-breakdown` format (`<name> | <files> | <test-cmd>`) is the steepest learning curve; the error message on malformed input (`INVALID_SLICE_BREAKDOWN`) provides clear guidance.

---

## Per-Slice Notes

### S0 — Baseline snapshot fixtures + no-regression gate
- Captured `tweak`, `feature`, `full` baseline smelts + rendered fixtures.
- Added `crucible-modes-no-regression.test.mjs` as byte-identical regression gate.
- Pre-S2 baselines contained `{{TBD:}}` markers for unanswered fields.

### S1 — Mode interface + core extraction (zero behavior change)
- Created `pforge-mcp/crucible/` with `mode.mjs` (interface shape), `registry.mjs` (singleton map), `core/finalize.mjs` (thin re-export shim at this stage).
- Zero behavior change; all public exports preserved. No-regression test still passed byte-identical.

### S2 — Migrate 3 lanes to mode files; per-mode criticalFields; truthful refusal
- Created `tweak.mjs`, `feature.mjs`, `full.mjs` under `crucible/modes/`.
- Deleted global `CRITICAL_FIELDS` from `crucible-server.mjs`; per-mode `criticalFields` is now the single source.
- Post-S2 baselines regenerated: **zero `{{TBD:}}` markers** (truthful refusal — unanswered non-critical fields are omitted, not falsely filled).

### S3 — Frontmatter completeness + `linked-bugs` question + `bugId` pass-through
- Extracted `buildFrontmatter`, `handleFinalize`, error classes, `CRITICAL_FIELDS` into `crucible/core/finalize.mjs`.
- `handleSubmit` now accepts `bugId`; stored on smelt and surfaced in frontmatter as `bugId` + `linkedBugs`.
- Every mode's `questionBank()` extended with non-critical `linked-bugs` question.
- `phaseId` always emitted in finalized plan frontmatter.

### S4 — `bug-batch` mode + RMG-0035 regression target
- Created `crucible/modes/bug-batch.mjs`: 8-question bank, 4 critical fields (`scope-files`, `validation-gates`, `forbidden-actions`, `slice-breakdown`).
- `renderBody` emits `## Root Cause Hypothesis` + N synthesized slices from `slice-breakdown` answer.
- `parseSliceBreakdown`: pipe-delimited parser; throws `INVALID_SLICE_BREAKDOWN` on malformed lines.
- `crucible-draft.mjs` extended to delegate to `mode.renderBody` when present (S4 extensibility hook).
- 14 tests green; fixture added (`bug-batch-smelt.json`, `bug-batch-rendered.md`).

### S5 — Renderer↔parser alignment
- `appendScopeContract`: `**In scope**:` → `### In Scope`, `**Out of scope**:` → `### Out of Scope`, `## Anti-patterns & Forbidden Actions` → `### Forbidden` under `## Scope Contract`.
- `synthesizeSliceBlock`: added `[scope: <files>]` clause to slice header; dropped `**Acceptance Criteria**:` block.
- `MANDATORY_BLOCKS` updated: `## Anti-patterns & Forbidden Actions` removed; `### Forbidden` added (still 7 items).
- `parseScopeContract` exported from `plan-parser.mjs` (previously private).
- 4 baselines regenerated; `crucible-parser-alignment.test.mjs` added (20 tests).

### S6 — Legacy `tbdPlaceholders` flag + operator doc
- `crucible-config.mjs`: `legacy.tbdPlaceholders` knob (default `false`); `isLegacyTbdEnabled()` helper.
- `crucible/core/render-shell.mjs`: graduated from thin re-export to owning legacy flag consultation; one-time `console.warn` per process.
- `docs/crucible-modes.md`: operator guide covering all 4 modes, `bug-batch` usage, `slice-breakdown` format, renderer/parser alignment summary, deprecation schedule.
- Closed #140, #142, #145, #146, #147.

### S7 — Retro + roadmap + CHANGELOG (this slice)
- This document.
- Phase 59 promoted to Completed in DEPLOYMENT-ROADMAP.md.
- CHANGELOG `[Unreleased] → Changed` entry added.

---

## Deferred Items (Follow-On Phase Candidates)

The following were scoped out of Phase 59 and are candidates for a follow-on phase:

1. **`meta-bug` mode** — structured capture of Plan Forge self-repair findings from `forge_meta_bug_file`. Would replace the current ad-hoc `bug-batch` workaround for framework defects.

2. **`sarif-finding` mode** — structured intake for SARIF-format security/lint findings. Described in Resolved Decision #16 (deferred).

3. **`triage` mode** — lightweight triage mode for classifying and routing incoming issues without a full interview. Described in Resolved Decision #7 (deferred).

4. **`forge_bug_register` → `bug-batch` auto-open** — when `forge_bug_register` creates a bug entry, automatically open a `bug-batch` smelt seeded with the bug's metadata. Not wired in Phase 59; would require changes to `forge_bug_register`'s output contract.

5. **`linked-bugs` in the interview engine** — `getNextQuestion` in `crucible-interview.mjs` still uses the static question banks, not the mode's `questionBank()`. The `linked-bugs` question is in every mode's `questionBank()` but is not currently served by the interview engine. Wiring this would require the engine to delegate to `getMode(lane).questionBank()`.

6. **RMG-0035 live reproduction** — the Phase 59 plan included a "Execution Hold" for live RMG-0035 reproduction. The synthetic fixture (`bug-batch-smelt.json`) was used instead. A live reproduction would validate that the `slice-breakdown` format maps to the actual files touched in the real fix.

---

## Test Coverage Summary

| Test file | Tests | Scope |
|-----------|-------|-------|
| `crucible-mode-interface.test.mjs` | 34 | MODE_INTERFACE_KEYS, MANDATORY_BLOCKS, renderDraft, registry |
| `crucible-modes-no-regression.test.mjs` | 8 | Byte-identical baseline regression for all 4 modes |
| `crucible-frontmatter.test.mjs` | 5 | `buildFrontmatter` pure unit + `handleFinalize` integration |
| `crucible-modes/bug-batch.test.mjs` | 14 | bug-batch contract, parseSliceBreakdown, renderBody, refusal |
| `crucible-parser-alignment.test.mjs` | 20 | `parseSlices` + `parseScopeContract` through rendered output |
| `crucible-legacy-flag.test.mjs` | 7 | `isLegacyTbdEnabled`, render-shell warn, finalize invariant |
| **Total (Phase-59 additions)** | **88** | |

---

## Lessons Learned

1. **Pre-apply pattern accelerates execution** — all S0–S6 source changes were pre-applied before the execution session began. The session's work was running validation gates, verifying contract alignment, and committing. This is the ideal flow for a well-hardened plan.

2. **Parser-first design reveals heading inconsistencies early** — the S5 alignment work uncovered that `**In scope**:` (bold text) and `## Anti-patterns` were invisible to the parser. Writing the parser-alignment test before the renderer changes would have surfaced these gaps in S0/S1 rather than S5.

3. **`parseSliceBreakdown` pipe format is learnable but steep** — operator feedback on the `<name> | <files> | <test-cmd>` format should be collected. A failure message with an example line would reduce friction.
