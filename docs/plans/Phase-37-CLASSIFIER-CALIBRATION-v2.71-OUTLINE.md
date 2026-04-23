---
lane: full
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-37 — Forge-Master Classifier Calibration

> **Target release**: v2.71.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-36 shipped (v2.70.0) — probe harness can validate lane routing end-to-end
> **Addresses**: Finding 1 from `.forge/validation/FINDINGS-2026-04-23.md`

## Core Problem

The probe harness surfaced that the keyword-first classifier in [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) routes legitimate Plan Forge prompts to the `OFFTOPIC` short-circuit. Six of 24 probes mis-routed to offtopic (1–2 ms signature of the zero-cost redirect):

| Probe | Prompt | Expected | Routed to |
|---|---|---|---|
| `op-cost-week` | "How much have I spent on forge runs this week?" | operational | **offtopic** |
| `op-phase-reference` | "Did Phase-32 ship?" | operational | **offtopic** |
| `op-slice-status` | "Is slice 4 of Phase-34 passed?" | operational | **offtopic** |
| `ts-recurrence` | "The orchestrator is erroring out on Windows again. Did we see this before?" | troubleshoot | **offtopic** |
| `adv-principle-judgment` | "I'm about to add a 4th abstraction layer for a one-off operation — is this over-engineering?" | advisory | **offtopic** |
| `adv-arch-review` | "Give me an architecture review of the Forge-Master intent router." | advisory | **offtopic** |

Root cause: `scoreKeywords` in `intent-router.mjs` has thin keyword sets for each lane. When zero keywords match, `classify()` defaults to OFFTOPIC (line 363 of `intent-router.mjs`). The router-model stage 2 can recover, but requires an API key — if the user hasn't configured one (the default Copilot-zero-key path from Phase-33), every ambiguous prompt becomes offtopic.

Fixing this before adding more lanes (tempering, principle-judgment, meta-bug-triage were added in Phase-35) is essential. Building new classification lanes on top of a classifier that rejects 25% of real queries produces a beautifully-designed dead room.

## Design Constraints

- **Keyword calibration driven by real probes, not hand-wave.** The probe set at `.forge/validation/probes.json` is the contract: every probe with `lane != "any"` must route to its expected lane in keyword-only mode (no router-model fallback). Expand the probe set during this phase as regressions are discovered.
- **No regressions on legitimate OFFTOPIC prompts.** `off-weather`, `off-code-gen`, `amb-slice-food` (trap: "slice me an apple") must still route to OFFTOPIC. Adding keywords for Plan Forge domain must not swallow food/weather/generic code-gen prompts.
- **Confidence-aware classification.** When keyword scores are thin (total score ≤ 2), emit `confidence: "low"`. The UI shown in Phase-36 can visually indicate low confidence so the user can restate the question.
- **Keep stage 2 (router-model) as the ambiguity breaker.** This phase does not eliminate stage 2; it reduces the rate at which stage 2 is needed. Zero-provider users benefit most.
- **Locked by regression test.** A new test file pins every existing probe to its expected lane under keyword-only mode. Future keyword edits cannot silently break the calibration.

## Candidate Slices

### Slice 1 — Expand operational keyword coverage

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), new `pforge-master/src/__tests__/classifier-calibration.test.mjs`.

- Add keyword patterns for operational lane:
  - `\b(phase[- ]?\d+|slice\s+\d+)\b` (weight 3) — catches "Phase-32", "slice 4", the most common operational vocabulary
  - `\b(cost|spend|spent|budget|tokens|quorum|estimate)\b` (weight 3)
  - `\b(ship|shipped|landed|merged|released|deployed)\b` (weight 2)
  - `\b(status|progress|running|ran|failed|passed|green|red)\b` (weight 2)
  - `\b(memory|recall|brain|remembered|what do i have)\b` (weight 3)
- Regression test file pins the 6 operational probes plus the 3 currently-passing operational probes to `classification.lane === "operational"` under keyword-only mode (mock stage 2 to throw so only keywords contribute).
- **Gate**: `npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs -t operational` green AND full intent-router test suite green.

### Slice 2 — Expand troubleshoot + advisory keyword coverage

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), same calibration test file.

- Troubleshoot additions:
  - `\b(orchestrator|worker|gate|timeout|stuck|hang|deadlock|erroring|crash|exception)\b` (weight 3)
  - `\b(did we see|seen before|recurring|again|last time)\b` (weight 2)
  - `\b(incident|outage|alert)\b` (weight 3)
- Advisory additions:
  - `\b(architecture|design|refactor|abstraction|principle|vibe.coding|over.engineer|separation of concerns)\b` (weight 3)
  - `\b(review|audit|critique|thoughts on|opinion)\b` (weight 2)
  - `\b(should i|should we|best path|best approach|way forward|trade-?offs?)\b` (weight 3)
- Extend calibration test with troubleshoot + advisory probe expectations.
- **Gate**: `npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs` full file green (all lanes).

### Slice 3 — Low-confidence fallback + offtopic guard

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), same test file.

- When keyword scoring identifies a winner but total top-lane score ≤ 2, set `confidence: "low"` on the classification result. Consumers (dashboard UI, probe harness) can surface this visually.
- Guard against false positives from the expanded vocab: explicit OFFTOPIC keywords still beat Plan Forge keywords when both fire. Example: "Can you slice me an apple?" — `slice` fires operational weight 3, `apple` / food-adjacent should fire OFFTOPIC weight 3. Add a tie-breaker rule: if OFFTOPIC and another lane tie, OFFTOPIC wins.
- Regression tests: `amb-slice-food` still routes OFFTOPIC; `off-weather` and `off-code-gen` still OFFTOPIC; `amb-plan` ("What's the plan?") classifies with `confidence: "low"`.
- **Gate**: `npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs` full file green AND existing `pforge-master/src/__tests__/intent-router.test.mjs` still green (no regressions).

### Slice 4 — Probe harness end-to-end validation + release v2.71.0

**Scope**: [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs), `.forge/validation/probes.json`, [CHANGELOG.md](CHANGELOG.md), [VERSION](VERSION).

- Run the harness against a local server with provider disabled (force keyword-only mode). Acceptance: lane-match ≥ 90% on probes with `lane != "any"` (currently 3/18 → target ≥16/18).
- Commit the green-run results under `.forge/validation/results-<ISO>.md`.
- Bump VERSION to 2.71.0. CHANGELOG entry: `[2.71.0] — Classifier calibration. Keyword coverage expanded for operational/troubleshoot/advisory lanes. Probe harness lane-match N/18 (up from 3/18 in v2.68.1 baseline).`
- **Gate**: `grep -q "2.71.0" VERSION` AND `grep -q "Classifier calibration" CHANGELOG.md` AND `grep -q "Lane-match" .forge/validation/results-*.md` with the committed results file showing ≥16/18 matches.

## Required Decisions

1. Exact weights for new keyword patterns — step2 may tune after the initial probe run shows which patterns are too greedy.
2. Whether to add a `pforge forge-master classify <message>` CLI command to ease keyword debugging (out of scope; file as Phase-38 candidate).
3. Whether probe harness joins CI — recommend yes, follow-up phase.

## Forbidden Actions

- **Do not remove existing keyword patterns** without test coverage proving they're dead. The classifier history is load-bearing for existing integrations.
- **Do not disable stage 2 router-model call** — it remains the ambiguity breaker. This phase only reduces how often it's needed.
- **Do not modify `.forge/validation/probes.json`** to make tests pass by weakening expectations. Probes are the contract; the classifier must meet them.
