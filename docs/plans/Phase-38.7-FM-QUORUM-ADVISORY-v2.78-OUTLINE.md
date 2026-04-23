---
crucibleId: 8f92ee55-ff4e-4d50-859c-05d19ed3a81e
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.7 — Forge-Master Quorum Advisory Mode

> **Target release**: v2.78.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-37 shipped (v2.71.0). Independent of other 38.x phases.

## Core Problem

For high-stakes advisory questions ("should I add this 4th abstraction layer?", "is this refactor over-engineering?", "which auth library should we adopt?") a single model's reply is a single opinion. The Plan Forge orchestrator already supports multi-model quorum (Power, Speed picker — see `forge_estimate_quorum`). Forge-Master should mirror this pattern: when the **advisory lane** fires AND auto-escalation hits the **high tier** (per Phase-35 logic), optionally fan out to 2–3 models and surface dissent — without picking a winner.

User-visible result: *"2 of 3 models say refactor; 1 says ship as-is. Diverging on: complexity vs delivery speed."*

## Design Constraints

- **Advisory lane only.** Quorum mode never engages on operational/troubleshoot/build lanes. (Phase-32 guardrail — those lanes are frozen.)
- **Opt-in, not default.** New pref `forgeMaster.quorumAdvisory: "off" | "auto" | "always"`. Default `"off"`. `"auto"` engages only when classification confidence ≥ medium AND lane is advisory AND escalated tier is high.
- **No auto-pick.** Forge-Master surfaces the N replies + a dissent summary; the human picks. There is no "majority vote" output.
- **Cost-bounded.** Quorum mode is expensive — surface estimated cost in the SSE stream BEFORE dispatching. User can cancel client-side. Hard cap: 3 models per quorum.
- **Reuse existing model routing.** Models pulled from `forge_estimate_quorum`'s "power" preset (sonnet, gpt-5.x, grok-4.20). No new model adapters.
- **No tool-list mutations.** Quorum is a reply-generation strategy, not a tool. Lane allowlists unchanged.

## Candidate Slices

### Slice 1 — Quorum dispatcher

**Scope**: New `pforge-master/src/quorum-dispatcher.mjs` — `dispatchQuorum({prompt, models, deps}) → {replies: [{model, text, durationMs, costUSD}], dissent: {topic, axis}}`. Parallel dispatch with hard timeout. New `pforge-master/src/__tests__/quorum-dispatcher.test.mjs`.

- **Gate**: vitest verifies parallel dispatch, partial-result handling (1 model fails → return 2), timeout, dissent extraction.

### Slice 2 — Pref endpoint + auto-engage logic

**Scope**: `pforge-master/src/http-routes.mjs` extends `loadPrefs/savePrefs` with `quorumAdvisory`. `runTurn` engages quorum when `pref === "always"` OR (`pref === "auto"` AND lane === advisory AND fromTier === high AND confidence >= "medium"). Cost estimate emitted via `quorum-estimate` SSE event before dispatch.

- **Gate**: SSE test asserts `quorum-estimate` arrives before any reply chunk in auto-engage scenario.

### Slice 3 — Dashboard quorum picker + reply UI

**Scope**: Dashboard adds "Quorum: off / auto / always" segmented control wired to prefs. Reply panel renders multi-model output as side-by-side cards with dissent summary at top.

- **Gate**: dashboard test renders 3-card layout from fixture quorum reply.

### Slice 4 — Probe harness + release v2.78.0

**Scope**: New probe `adv-quorum-trigger` validates quorum engages when expected. CHANGELOG, ROADMAP, version bump.

- **Gate**: probe run shows `quorum-estimate` SSE event for the new probe.

## Out of Scope

- ❌ Auto-picking a winner / majority vote.
- ❌ Quorum on operational/troubleshoot/build lanes (Phase-32 guardrail).
- ❌ New tool adapters or model providers.
- ❌ Quorum for slice execution (orchestrator already has its own).
