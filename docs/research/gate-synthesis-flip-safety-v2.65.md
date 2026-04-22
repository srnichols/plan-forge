# Gate-Synthesis Flip Safety Analysis — v2.65

**Author**: Copilot Worker (Phase-31 Slice 4)  
**Date**: 2026-04-22  
**Purpose**: Assess risk of promoting `runtime.gateSynthesis.mode` from `"suggest"` to `"enforce"` by sampling recent runs under `.forge/runs/` and counting which slices would have been blocked.

---

## Methodology

Three recent run directories were sampled from `.forge/runs/`. For each run every recorded `slice-N.json` was inspected for:

1. **Title** — run through `classifySliceDomain()` keyword patterns (`domain`, `integration`, `controller`).  
2. **Validation gate** — whether `validationGate` is non-empty.

A slice is considered *would-have-been-blocked* when:
- Its title matches a domain keyword, **and**
- `validationGate` is absent or empty.

---

## Sampled Runs

### Run A — `2026-04-22T09-08-13-205Z_Phase-31-CALIBRATION-v2.65-PLAN`

| Slice | Title | Domain match | Gate present | Would block? |
|-------|-------|-------------|-------------|-------------|
| 1 | Timeout-but-committed dashboard surface | none | — | No |
| 2 | Plan-parser lint in `pforge analyze` | none | — | No |

**Blocked under `--strict-gates`: 0 / 2 slices**

---

### Run B — `2026-04-22T08-54-03-706Z_Phase-31-CALIBRATION-v2.65-PLAN`

| Slice | Title | Domain match | Gate present | Would block? |
|-------|-------|-------------|-------------|-------------|
| 1 | Timeout-but-committed dashboard surface | none | — | No |
| 2 | Plan-parser lint in `pforge analyze` | none | — | No |
| 3 | Reflexion prompt wiring | none | — | No |

**Blocked under `--strict-gates`: 0 / 3 slices**

---

### Run C — `2026-04-22T02-37-25-785Z_Phase-30-SETTINGS-SPLIT-v2.64-PLAN` (slices 4–6)

| Slice | Title | Domain match | Gate present | Would block? |
|-------|-------|-------------|-------------|-------------|
| 4 | Memory + Brain | none | — | No |
| 5 | Bridge (consolidated) + Crucible | none | — | No |
| 6 | Completeness sweep + legacy DOM removal | none | — | No |

**Blocked under `--strict-gates`: 0 / 3 slices**

---

## Aggregate

| Metric | Value |
|--------|-------|
| Total slices sampled | 8 |
| Domain-matched slices | 0 |
| Would have been blocked | 0 |
| Block rate | 0% |

---

## Risk Summary

The sampled Plan Forge plans are infrastructure/orchestrator plans whose slice titles center on dashboard, tooling, and configuration work. None of the recent slice titles trigger the `domain`, `integration`, or `controller` keyword patterns in `GATE_SYNTH_DOMAIN_PATTERNS`. As a result, enabling `--strict-gates` on these plans would have caused **zero pre-flight rejections**.

This is consistent with the design intent: the gate-synthesis classifier targets feature-development plans that add business logic or API endpoints, not infra/tooling plans.

### Risk tiers

| Scenario | Risk level | Rationale |
|----------|-----------|-----------|
| Infrastructure / orchestrator plans | **Low** | Titles rarely match domain keywords |
| Feature plans with controller/service slices | **Medium** | Title matching can flag legitimate "no gate yet" slices |
| Mandatory CI usage (every run) | **High** | Would require all plans to pre-declare gates — disruptive for drafts |

### Recommendation

`--strict-gates` is safe as an **opt-in flag** for mature plans that are known to include domain-matched slices. It should **not** be set as the default mode via `runtime.gateSynthesis.mode = "enforce"` in `.forge.json` without first auditing the active plan library. The `"suggest"` default remains appropriate for general use.

---

## Key files

- `pforge-mcp/orchestrator.mjs` — `loadGateSynthesisConfig`, `synthesizeGateSuggestions`, `runPlan` (`strictGates` option)
- `pforge.ps1` / `pforge.sh` — `--strict-gates` CLI flag passthrough
- `pforge-mcp/tests/orchestrator-gate-synthesis.test.mjs` — enforcement tests
