# Complexity Threshold Recalibration — v2.65

**Author**: gh-copilot-worker  
**Phase**: Phase-31 Calibration — Slice 5  
**Date**: 2026-04-22  

---

## Motivation

`scoreSliceComplexity` returns a 1–10 integer that `loadQuorumConfig` compares against
a configurable `threshold`.  When `quorum: auto`, only slices whose score ≥ threshold
receive multi-model quorum treatment.

The historical default of **6** was chosen without empirical grounding.  This note
establishes the distribution of real scores across six released phases to anchor the
default to observed data.

---

## Methodology

Six plan files were parsed programmatically:

| Plan file | Slices |
|---|---|
| `Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md` | 11 |
| `Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md` | 17 |
| `Phase-27-COST-SERVICE-v2.60-PLAN.md` | 7 |
| `Phase-28-FORGE-MASTER-MVP-v2.61-PLAN.md` | 9 |
| `Phase-29-FORGE-MASTER-STUDIO-v2.63-PLAN.md` | 12 |
| `Phase-30-SETTINGS-SPLIT-v2.64-PLAN.md` | 7 |
| **Total** | **63** |

Each slice was parsed for its `scope` file list (mapped to `scopeWeight`),
`depends` entries (`dependencyWeight`), `validationGate` text (`gateWeight`,
`securityWeight`, `databaseWeight`), and task count (`taskWeight`).
`historicalWeight` resolved to 0 (no `.forge/runs/index.jsonl` present in test
environment).  The formula is unchanged; only the default threshold is updated.

---

## Score Distribution

| Score | Count | Cumulative % |
|---|---|---|
| 1 | 7 | 11.1% |
| 3 | 31 | 60.3% |
| 4 | 22 | 95.2% |
| 5 | 2 | 98.4% |
| 6 | 1 | 100.0% |

**Scores 2, 7–10 were not observed.**

Summary statistics:

| Metric | Value |
|---|---|
| Min | 1 |
| Max | 6 |
| Mean | 3.24 |
| Median | 3 |
| **60th percentile** | **3** |

---

## Threshold Coverage Analysis

| Threshold | Slices selected | % of total |
|---|---|---|
| ≥ 2 | 56 | 88.9% |
| **≥ 3** | **56** | **88.9%** |
| ≥ 4 | 25 | 39.7% |
| ≥ 5 | 3 | 4.8% |
| ≥ 6 | 1 | 1.6% |

At the prior default of **6**, only 1 of 63 real slices (1.6%) would receive quorum
treatment under `auto` mode — making the feature effectively inert on real plans.

The existing `QUORUM_PRESETS.power.threshold = 5` was an improvement but still
catches only 4.8% of slices.

The `cost-service.mjs` `buildQuorumConfigForMode("auto")` hardcodes `threshold: 5`
(set in Phase-27.1 Slice 3) and is independent of `loadQuorumConfig`.

---

## Recommendation

**Set `loadQuorumConfig` default threshold to 3.**

Rationale:

- The 60th-percentile score is **3**.  A threshold of 3 means quorum fires for the
  upper ~40% of slices by complexity — a reasonable operating point for `auto` mode.
- Score ≥ 3 corresponds to slices with 3+ scope files, or multi-dependency chains,
  or moderate gate complexity — i.e., slices worth multi-model review.
- Scores 1–2 are simple documentation/version-bump slices with ≤ 2 scope files and
  no security keywords.  Excluding them from quorum is correct.
- The stop condition ("threshold=3 selects zero slices") does not apply: 56 of 63
  slices (88.9%) have score ≥ 3.

The `QUORUM_PRESETS.power.threshold` (5) and `QUORUM_PRESETS.speed.threshold` (7)
remain unchanged — those are explicit preset overrides and have independent semantics.

---

## Files Modified

- `pforge-mcp/orchestrator.mjs` — `loadQuorumConfig` defaults block: `threshold: 6` → `threshold: 3`
- `pforge-mcp/tests/orchestrator-complexity.test.mjs` — new; asserts new default, distribution properties, threshold coverage
