---
crucibleId: ff4e9ac7-0bb8-4381-a30b-ba5ce77e51c5
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.6 — Forge-Master Pattern Surfacing

> **Target release**: v2.77.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-38.3 shipped (v2.74.0) — uses the knowledge graph + run index.

## Core Problem

The 'tee /tmp/...' Windows gate failure repeated across Phase-35, 36, and 37 plans before being patched. The classic pattern: a recurring failure goes unnoticed because nobody is comparing across runs. Forge-Master sits on the data — `.forge/runs/**/events.log`, `.forge/cost-history.json`, model performance per slice — but never says *"this gate type has failed 7× across 3 plans"* unless the user explicitly asks the right question.

This phase adds a read-only pattern detector that scans run history and surfaces recurring patterns as **advisory** observations. Surfaced through Forge-Master's troubleshoot lane, never injected into the hardener prompt or executor (Phase-32 guardrail).

## Design Constraints

- **Advisory only.** Patterns surface when the user asks a troubleshoot-lane question OR via `pforge patterns list`. They are NEVER injected into `step2-harden-plan.prompt.md` or the slice executor. (Phase-32 guardrail.)
- **No principles-violation detection.** Patterns are about empirical recurrence ("this gate fails 60% of the time"), not normative judgments ("this violates principle X"). Principles judgment is explicitly a separate future phase.
- **Read-only.** Reads `.forge/runs/**`, `.forge/cost-history.json`, `.forge/model-performance.json`, `.forge/bugs/**` via Phase-38.3 graph queries. Writes nothing back.
- **Bounded pattern types.** Initial set: gate-failure-recurrence, model-failure-rate-by-complexity, slice-flap-pattern, cost-anomaly. Extensible via `pforge-mcp/patterns/detectors/<name>.mjs` registry.
- **Threshold-gated.** Pattern only surfaces if N≥3 occurrences AND across ≥2 distinct plans. Single-run flukes don't bubble.
- **No new tool added to operational/troubleshoot/build lanes.** Surface via existing `forge_graph_query` extended to support `type: "patterns"` queries. (Or via a new advisory-lane-only tool `forge_patterns_list` — to be decided in hardening.)

## Candidate Slices

### Slice 1 — Pattern detector framework

**Scope**: New `pforge-mcp/patterns/registry.mjs` + `pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs`. New `pforge-mcp/tests/patterns-registry.test.mjs`.

- Detector contract: `({graph, runs, costs}) → [{patternId, severity, occurrences: [...], summary}]`.
- **Gate**: vitest verifies registry loads detectors AND gate-failure detector finds the synthesized 'tee /tmp/' regression in fixture data.

### Slice 2 — Three more detectors

**Scope**: `model-failure-rate-by-complexity.mjs`, `slice-flap-pattern.mjs`, `cost-anomaly.mjs`. Each with its own test.

- **Gate**: full patterns test suite green.

### Slice 3 — Surface in advisory lane + CLI

**Scope**: `pforge-master/src/intent-router.mjs` — when troubleshoot lane fires AND patterns detector returns ≥1 match, append to reply context as "Recurring pattern observed". CLI: `pforge patterns list [--since <iso>]`.

- **Gate**: SSE test verifies a troubleshoot probe with seeded recurring failure surfaces a pattern in the reply context. CLI exits 0.

### Slice 4 — Dashboard panel + release v2.77.0

**Scope**: Dashboard "Recurring patterns" panel that lists detected patterns by severity. CHANGELOG, ROADMAP, version bump.

- **Gate**: dashboard test renders panel from fixture pattern data.

## Out of Scope

- ❌ Injecting patterns into hardener prompt (Phase-32 guardrail — explicitly forbidden).
- ❌ Injecting patterns into slice executor (same).
- ❌ Principles-violation detection (separate phase, not 38.x).
- ❌ Auto-fix proposals based on patterns (advisory only).
- ❌ Adding tools to operational/troubleshoot/build lanes that mutate state.
