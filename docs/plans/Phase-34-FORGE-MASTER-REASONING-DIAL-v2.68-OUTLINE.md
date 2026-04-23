---
lane: full
source: human
status: outline
created: 2026-04-22
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-34 — Forge-Master Reasoning Dial (Low / Medium / High)

> **Target release**: v2.68.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: v2.67.0 shipped (Phase-33 — GitHub Copilot adapter, zero-key default via `gpt-4o-mini`)
> **Addresses**: User-facing reasoning depth without exposing model names

## Core Problem

Phase-33 made Forge-Master reachable for every Copilot subscriber by defaulting to `gpt-4o-mini`. That's the right default for ~95% of advisory turns — intent classification, tool routing, status summaries — and it's free under the Copilot subscription. But three workloads benefit from a stronger model:

1. **Multi-hop reasoning** — "watch this run, correlate with bug #87, recall the prior decision about gate timeouts." `gpt-4o-mini` often stops at one hop.
2. **Principle judgment** — "is this a vibe-coding violation?" `gpt-4o-mini` will quote the principle but miss the subtle case.
3. **Tempering and meta-bug classification under ambiguity** — these need stronger reasoning to avoid filing the wrong defect class.

Today, the only way to switch models is to edit `.forge.json#forgeMaster.providers.githubCopilot.model` and restart. That's a power-user knob hidden behind config — not discoverable, not per-session, and it leaks model names that will rename next quarter when OpenAI/Anthropic ship the next generation.

The user-facing fix is a **three-position dial** on the dashboard Forge-Master tab: **Low (default) / Medium / High**. The dial selects a *reasoning tier*, not a model. Tier-to-model mapping lives in config and ships with sensible defaults, so when `gpt-4o` is renamed or `claude-sonnet-5` arrives, one config edit updates every user's dial without a UI release.

This also enables auto-escalation: the intent-router can bump one tier up for a single turn when it classifies the lane as `tempering` or `principle-judgment`, then drop back. Cheap when not needed, sharp when it is.

## Design Constraints

- **No model names in the UI.** Just dial position + a one-line description of what each tier is good at. Tooltip can say "powered by frontier models via your GitHub Copilot subscription." Principle 10 (Keep Gates Boring) applied to UX.
- **Tier-to-model mapping in config**, not hardcoded. `.forge.json#forgeMaster.reasoningTiers: { low, medium, high }` with shipped defaults `{ low: "gpt-4o-mini", medium: "gpt-4o", high: "claude-sonnet-4" }`. Updating defaults = config bump, no code release.
- **Per-user persistence**, not per-repo. Dial position lives in `.forge/forge-master-prefs.json` (gitignored) so different developers on the same project keep their own preference.
- **Graceful degradation on rate limit**. If `high` tier returns 429, auto-fall-back to `medium` for that turn with a small toast: "Deep reasoning busy, using Balanced for this turn." Don't fail the turn.
- **Logged in turn trace** so we can later audit whether users hit the "I should have picked higher" cases — feeds future calibration phases.
- **Backwards compatible** with explicit `--model` overrides from CLI/config. Dial sets the default; explicit overrides win.

## Candidate Slices

### Slice 1 — Tier resolver + config schema + 429 fallback

**Scope**: [pforge-master/src/config.mjs](pforge-master/src/config.mjs), new `pforge-master/src/reasoning-tier.mjs`, [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), tests in `pforge-master/src/__tests__/reasoning-tier.test.mjs` (new).

- Add `forgeMaster.reasoningTiers` to config schema with defaults `{ low: "gpt-4o-mini", medium: "gpt-4o", high: "claude-sonnet-4" }`.
- Add `forgeMaster.defaultTier = "low"` to config schema.
- New `reasoning-tier.mjs` exports `resolveModel(tier, config)` returning the configured model name, falling back to default tier on unknown input.
- `reasoning.mjs` accepts an optional `tier` parameter on `runTurn({ tier, ... })`. If `tier` is provided and no explicit `model` override is set, resolve via `resolveModel()`. Explicit `model` always wins.
- 429 fallback: when the provider returns `{ error: "rate_limited" }`, log the original tier, drop one tier (`high → medium → low`), retry once. If `low` 429s, surface the structured error (don't infinite loop).
- Turn trace logs `requestedTier`, `resolvedModel`, `escalated` (bool), `fallbackFromTier` (nullable).
- Unit tests: tier resolution happy path, unknown tier falls back to default, explicit model override beats tier, 429 fallback chain (high→medium→low→error), trace fields populated correctly.

### Slice 2 — Auto-escalation for high-stakes lanes

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), tests in `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` (new).

- Intent router gains `recommendedTierBump` per lane. Default: `0` (no bump). Lanes that bump: `tempering` (+1), `principle-judgment` (+1), `meta-bug-triage` (+1).
- `runTurn` applies the bump to the requested tier for that single turn only: `low + 1 = medium`, `medium + 1 = high`, `high + 1 = high` (cap).
- Per-turn auto-escalation is logged in the trace as `autoEscalated: true, fromTier: "low", toTier: "medium", reason: "lane=tempering"`.
- User can opt out with `forgeMaster.autoEscalate = false` in config (default `true`).
- Unit tests: escalation table per lane, cap at high, opt-out respected, trace populated, no escalation when explicit `model` is set.

### Slice 3 — Dashboard dial UI + per-user prefs persistence

**Scope**: [pforge-mcp/dashboard/served-app.js](pforge-mcp/dashboard/served-app.js), [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js), new `.forge/forge-master-prefs.json` schema, `.gitignore`, [pforge-mcp/server.mjs](pforge-mcp/server.mjs) (new REST endpoints `GET /api/forge-master/prefs`, `PUT /api/forge-master/prefs`), tests in `pforge-mcp/tests/forge-master-prefs.test.mjs` (new).

- New three-position segmented control on the Forge-Master tab, labeled `Fast` / `Balanced` / `Deep`.
  - Fast: "Quick answers, status summaries, tool routing" (default).
  - Balanced: "Multi-hop reasoning, bug triage, plan critique."
  - Deep: "Principle judgment, architectural review, deep tempering analysis."
  - Tooltip: "Powered by frontier models via your GitHub Copilot subscription. Higher tiers may hit rate limits sooner."
- No model names visible. Inspector / `View Source` may still reveal config; that's fine for power users.
- Dial position posts to `PUT /api/forge-master/prefs` which writes `.forge/forge-master-prefs.json` (`{ tier: "low" | "medium" | "high", autoEscalate: bool }`).
- `forge_master_ask` MCP tool reads `.forge/forge-master-prefs.json` on each invocation and threads `tier` into `runTurn`.
- Add `.forge/forge-master-prefs.json` to `.gitignore`.
- Toast notification on dial change: "Reasoning depth set to Balanced." Toast on auto-escalation during a turn: "Deep reasoning kicked in for this answer (lane: tempering)."
- Toast on 429 fallback: "Deep reasoning busy, used Balanced for this turn."
- Tests: REST round-trip (GET defaults, PUT persists, GET reads back), invalid tier rejected with 400, prefs file created if missing on first PUT.

### Slice 4 — Release v2.68.0

**Scope**: `VERSION`, `CHANGELOG.md`, `ROADMAP.md`, `docs/COPILOT-VSCODE-GUIDE.md` (one-paragraph dial section).

- Bump VERSION to `2.68.0`.
- CHANGELOG entry under `## [2.68.0]` summarizing the dial, auto-escalation, fallback behavior. Explicitly note "no API key required for any tier when GitHub Copilot subscription is active."
- ROADMAP marks Phase-34 complete.
- Brief "Reasoning Depth" section in COPILOT-VSCODE-GUIDE.md showing the three tiers, what each is good at, and how to disable auto-escalation.
- Gate uses **plain grep chains only** (no `test -f` — meta-bug #94 lesson). Pure `grep -q` against VERSION + CHANGELOG.

## Required Decisions Before Hardening

1. **Default tier**: confirm `low` (Fast / `gpt-4o-mini`). Recommended: yes — matches Phase-33 zero-key default and free-tier rate limits.
2. **Auto-escalation default**: confirm `true` (lanes that need it bump automatically). Recommended: yes — user can disable, but the smart default is "be helpful when it matters."
3. **Per-tier rate-limit warning thresholds**: should the dashboard show "X turns remaining today on Deep tier"? Recommended: defer to Phase-35 (calibration). Phase-34 just surfaces the toast on 429; the tracking infrastructure is bigger.
4. **Mobile-friendly dial** (dashboard responsive): out of scope for v2.68.0 — desktop dashboard only. Note in plan.
5. **Should anonymous-mode (no GitHub token) show the dial?** Recommended: hide the dial when no provider is reachable; show a "Connect GitHub" prompt instead. Slice 3 should branch on `isAvailable()`.

## Out of Scope

- Per-tool model selection (use Deep for `forge_drift_report` calls but Fast for everything else). Too clever for v2.68.0.
- Custom user-defined tiers (`reasoningTiers.deep-cheap`). Adds config complexity for no clear win.
- Provider switching from the dial (e.g., "use Anthropic for Deep, OpenAI for Fast"). Belongs in a future "provider preference" UI phase.
- Cost meter on the dial (estimated $/turn). Belongs in Phase-35 calibration.
- Streaming token display in the UI. Separate UX phase.

## Validation Strategy

- Unit tests per slice for resolver, escalation, REST endpoints.
- Manual smoke test: open dashboard, flip dial through all three positions, send the same advisory prompt at each, eyeball the trace log to confirm `resolvedModel` differs.
- Manual escalation test: send a tempering-classified prompt with dial on `Fast`, confirm trace shows `autoEscalated: true, toTier: "medium"`.
- 429 fallback test: stub the provider to return 429 once, confirm the loop drops a tier and succeeds.

## Estimated Effort

- 4 slices, complexity 3-3-4-2.
- Total cost estimate: ~$0.05 (similar to Phase-33).
- Runtime estimate: ~40 min autonomous.
- Session break point: after Slice 2 if needed (UI work fresh in Session 2).

## Open Questions for Hardening (step2)

- Confirm exact label copy for each dial position (Fast / Balanced / Deep — alternatives: Quick / Standard / Thorough).
- Confirm prefs file schema exact shape.
- Confirm toast wording.
- Confirm `.forge.json` config key path for tier mapping.
- Forbidden Actions: no `test -f` in gates (meta-bug #94), no live HTTP in unit tests, no model names in dashboard JS strings.
