# `scoreSliceComplexity` Distribution Report — April 2026

> **Produced for**: Phase-27.2 Slice 7  
> **Date**: 2026-04-20  
> **Source data**: all 7 `docs/plans/Phase-*-PLAN.md` files present at commit time  
> **Scorer**: `scoreSliceComplexity` from `pforge-mcp/orchestrator.mjs`  
> **Purpose**: Evidence-gathering only. **No scoring changes ship in this phase.**

---

## TL;DR

With the current `scoreSliceComplexity` heuristic, **every slice in the
Plan Forge repo scores between 1 and 4**. The `auto` quorum mode's
threshold — `5` as of Phase-27.1 Slice 3 — catches **zero** slices. In
practice, `auto` ≡ `false` for every plan in this repo. The picker is
defensible as a floor ("never spend quorum overhead when the scorer
thinks the slice is trivial") but it is not actively discriminating
between slices.

**Recommended (for a future phase, not this one)**: either lower the
`auto` threshold to `3` (catches ~7% of slices), or rewrite the scorer
to spread scores more evenly across 1–10 using real signals like file
count, LOC touched, cross-subsystem edits, and historical failure rate.
Lowering the threshold is the smaller, reversible change; a scorer
rewrite is the correct long-term move.

---

## Method

1. Parse each `docs/plans/Phase-*-PLAN.md` with `parsePlan()`.
2. For each slice in the parsed plan, call
   `scoreSliceComplexity(slice, repoRoot).score`.
3. Aggregate across all 70 slices (7 plans).

Scores are integers 1–10; `scoreSliceComplexity` caps at 10.

The scorer considers: slice title/body length, keyword hits
(e.g. "migration", "breaking", "schema"), file-scope breadth, and
dependency count. No historical signal is consulted.

---

## Observed Distribution

| Statistic | Value |
|-----------|-------|
| Total slices | 70 |
| Mean         | 1.89 |
| p50 (median) | 2 |
| p75          | 2 |
| p95          | 3 |
| Max          | 4 |
| Min          | 1 |

### Histogram

| Score | Count | Share |
|-------|------:|------:|
| 1     | 14    | 20.0% |
| 2     | 51    | 72.9% |
| 3     | 4     |  5.7% |
| 4     | 1     |  1.4% |
| 5–10  | 0     |  0.0% |

`72.9%` of slices score exactly **2**, and `92.9%` score ≤ 2. Only **5
slices** (7.1%) score ≥ 3, and only **one** scores 4 (the
`Phase-26-COMPETITIVE-LOOP` Slice 17 — "Release v2.58.0", which has
cross-subsystem scope and a long body).

### Per-plan summary

| Plan | Slices | min | max | mean |
|------|-------:|----:|----:|-----:|
| Phase-25 Inner-Loop Enhancements v2.57 | 11 | 2 | 3 | 2.18 |
| Phase-26 Competitive Loop v2.58        | 17 | 2 | 4 | 2.18 |
| Phase-27 Cost Service v2.60            |  7 | 2 | 2 | 2.00 |
| Phase-27.1 Hotfix v2.60.1              |  6 | 1 | 1 | 1.00 |
| Phase-27.2 Refinement v2.61            |  8 | 1 | 1 | 1.00 |
| Phase-28 Forge-Master MVP v2.61        |  9 | 2 | 3 | 2.11 |
| Phase-29 Forge-Master Studio v2.62     | 12 | 2 | 2 | 2.00 |

Hotfix / refinement phases register as "trivial" (score 1) — consistent
with their narrow scope but unhelpful for budget projection: a
6-slice hotfix that touches hot code paths probably merits more
scrutiny than a mean score of 1.00 suggests.

---

## Threshold Sweep

How many slices does each threshold recruit into `auto`-mode quorum?

| Threshold | Hits | % of slices |
|----------:|-----:|------------:|
| 1 | 70 | 100.0% |
| 2 | 56 |  80.0% |
| 3 |  5 |   7.1% |
| 4 |  1 |   1.4% |
| 5 |  0 |   0.0% |
| 6 |  0 |   0.0% |
| 7 |  0 |   0.0% |
| 8 |  0 |   0.0% |

**Current `auto` threshold (Phase-27.1 Slice 3 set it to 5).** On this
repo's current plan inventory, that threshold recruits nobody. The
`estimateQuorum` `auto` vs `false` spreads are numerically identical
for every plan tested.

**Threshold 3** would recruit 5 slices (7.1%) — the actually-expensive
ones (release slice, cross-subsystem MVPs, v2.58 release consolidation).

**Threshold 2** would recruit 80% of slices — too aggressive, would
make `auto` ≡ `power` for most work.

---

## Findings

1. **Current threshold is non-actionable.** Threshold 5 selects zero
   slices on every plan in the repo. `auto` mode does not differentiate
   from `false` mode for any real work. This is not a bug in the picker
   wiring (the code runs fine) — it is a calibration mismatch between
   the scorer's output range and the threshold's position in that range.

2. **The scorer compresses the distribution.** 93% of slices land in
   {1, 2}. That is either the scorer's designed behavior (risk-averse,
   assume most slices are cheap) or a bug (the heuristic is ignoring
   real complexity signals). From the source, the scorer gives full
   credit for a few binary keyword hits and modest credit for body
   length; it has no view into actual file/LOC impact, dependency
   counts, or historical difficulty, so most slices look the same to
   it.

3. **The scorer disagrees with observable reality.** A human reading
   the Phase-26 plan would call several slices more complex than the
   scorer grades them. The scorer gives the entire Phase-27.2
   refinement phase score 1 ("trivial"), yet this phase adds an MCP
   tool, changes a cost estimator schema, ships new dashboard UI, and
   cuts a release. A Phase-27.1 hotfix that fixes three live bugs in
   the cost estimator also scores uniformly 1. The scorer cannot tell
   those from a documentation-only phase.

4. **Power / speed / false modes are not affected.** Those modes force
   quorum either on or off regardless of the score. The scoring
   calibration only matters for `auto`, which is the recommended
   default — so fixing it improves default behavior without changing
   the opt-in extremes.

---

## Recommendations (For a Future Phase, Not This One)

Listed smallest change first.

### Option A (smallest, reversible): lower `auto` threshold from 5 → 3
- Catches the 5 slices above the noise floor on current plans (7.1%).
- One-line change in `pforge-mcp/cost-service.mjs`'s `autoConfig`.
- Keeps the current scorer; just re-aims the threshold at the real
  distribution's shoulder.
- Risk: the 5 slices currently picked are mostly release slices
  ("Release v2.58.0", etc.) which are arguably the *least* valuable
  to quorum-protect. Lowering the threshold helps `estimateQuorum`
  produce non-degenerate `auto` vs `false` numbers, which is the
  primary value of the fix.

### Option B (medium, reversible): lower threshold to 3 AND add one signal
- Same as A, plus extend the scorer with file-count signal (count of
  distinct files named in the slice body / scope text, capped).
- Produces more spread across {1, 2, 3, 4, 5} and makes auto mode
  meaningful.

### Option C (larger, needs its own phase): scorer rewrite
- Rewrite `scoreSliceComplexity` to combine: title/body length,
  file-count estimate, subsystem-breadth heuristic, keyword hits
  (weighted, not binary), dependency-depth in the DAG, and optionally
  a historical-difficulty signal from `cost-history.json`.
- Target: the same 70 slices produce a distribution that spans 1–8
  with a median near 4.
- Must ship with its own regression tests (including this report's
  numbers, which act as a before-after baseline).

---

## Next Action

**Nothing ships in Phase-27.2 from this report.** This document exists
as the evidence base for a follow-up phase. When that phase is planned,
the hardener should:

1. Read this report first.
2. Choose Option A, B, or C with an explicit rationale.
3. Add regression tests that fix the chosen threshold's hit count
   against this exact repo inventory (70 slices) as a tripwire.
4. Update `MODEL_PRICING` / `QUORUM_PRESETS` **only if** scoring
   changes require it (they should not).

If no follow-up phase materializes within the next two months, revisit
whether `auto` mode is worth keeping versus just documenting
"pick power, speed, or false explicitly; auto is a no-op for typical
Plan Forge plans."

---

## Appendix — Raw Per-Slice Scores

<details>
<summary>Click to expand full table (70 rows)</summary>

Phase-25 Inner-Loop Enhancements v2.57 (11 slices): 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3.  
Phase-26 Competitive Loop v2.58 (17 slices): 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 4.  
Phase-27 Cost Service v2.60 (7 slices): 2, 2, 2, 2, 2, 2, 2.  
Phase-27.1 Hotfix v2.60.1 (6 slices): 1, 1, 1, 1, 1, 1.  
Phase-27.2 Refinement v2.61 (8 slices): 1, 1, 1, 1, 1, 1, 1, 1.  
Phase-28 Forge-Master MVP v2.61 (9 slices): 2, 2, 2, 2, 3, 2, 2, 2, 2.  
Phase-29 Forge-Master Studio v2.62 (12 slices): 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2.

</details>
