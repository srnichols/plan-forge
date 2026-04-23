---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session harden from Scott Nichols' approved recommendations)
hardened_at: 2026-04-22
---

# Phase-34 — Forge-Master Reasoning Dial (Low / Medium / High)

> **Target release**: v2.68.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-33 shipped (v2.67.0 tagged; GitHub Copilot provider adapter live; zero-key default via `gpt-4o-mini`; `forge_master_ask` reachable for every Copilot subscriber)
> **Branch strategy**: Direct to `master`. All changes are additive — new tier resolver, new auto-escalation field on existing intent router, new dashboard dial + prefs endpoint, new prefs file. Existing provider selection and advisory contract unchanged.
> **Session budget**: 1 session, 4 slices. Natural session-break after Slice 2 (back-end complete; UI work fresh in Slice 3).

---

## Specification Source

- **Field input 1 — `gpt-4o-mini` is right for 95% of advisory turns, wrong for three workloads**: After shipping v2.67.0, Scott asked whether the default model (`gpt-4o-mini`) is strong enough for Forge-Master's job. Agreed answer: yes for intent classification, tool routing, and status summaries — but multi-hop reasoning ("watch this run, correlate with bug #87, recall prior decision"), principle judgment ("is this a vibe-coding violation?"), and tempering / meta-bug-class ambiguity all benefit from a stronger model. The current only way to switch is to edit `.forge.json#forgeMaster.providers.githubCopilot.model` and restart — hidden, not per-session, leaks model names.
- **Field input 2 — user-facing control must not expose model names**: Scott requested a dashboard dial with three positions (Low default, Medium, High) that does **not** show model names to users. Rationale: models rename every quarter (GPT-4o → GPT-5 → ...; Claude Sonnet 4 → Sonnet 5 → ...); the UI shouldn't churn with them. Tier-to-model mapping belongs in config so a single edit updates every user.
- **Field input 3 — approved recommendations**: (1) default tier `low` = Fast = `gpt-4o-mini`, (2) auto-escalation default `true` for `tempering` / `principle-judgment` / `meta-bug-triage` lanes, (3) defer per-tier rate-limit "turns remaining today" UI to Phase-35 calibration, (4) desktop dashboard only (no mobile responsive), (5) hide the dial when no provider is reachable and show a `"Connect GitHub"` prompt instead.
- **Field input 4 — 429 graceful degradation**: When `high` tier returns 429, auto-fall-back to `medium` for that turn with a toast. Don't fail the turn. If `low` 429s, surface the error — no infinite loop. Logged in turn trace.
- **Architecture anchor**: Principle 10 (Keep Gates Boring) applied to UX — the dial is three positions with plain labels, not a dropdown of model names. Principle 6 (Enterprise Quality Is the Default) — smart defaults ship on; users opt out. Principle 1 (Architecture-First) — tier resolution is its own module (`reasoning-tier.mjs`), not bolted into `reasoning.mjs`.
- **Prior postmortem [#94](https://github.com/srnichols/plan-forge/issues/94)**: Phase-33 Slice 4 gate used `test -f VERSION && grep -q ...`. On Windows cmd, `test` is not a builtin → false-negative gate failure (release actually shipped correctly). Phase-34 gates use **pure grep chains only** — no `test -f`, no nested quoting. This plan inherits that discipline.

---

## Scope Contract

### In scope

- [pforge-master/src/reasoning-tier.mjs](pforge-master/src/reasoning-tier.mjs) — NEW tier resolver module
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) — accept `tier` option, wire 429 fallback, wire auto-escalation application
- [pforge-master/src/config.mjs](pforge-master/src/config.mjs) — `forgeMaster.reasoningTiers` + `forgeMaster.defaultTier` + `forgeMaster.autoEscalate` config keys
- [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) — add `recommendedTierBump` field to lane metadata
- `pforge-master/src/__tests__/reasoning-tier.test.mjs` — NEW tier resolver + 429 fallback tests
- `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` — NEW auto-escalation tests
- [pforge-mcp/server.mjs](pforge-mcp/server.mjs) — new REST endpoints `GET /api/forge-master/prefs`, `PUT /api/forge-master/prefs`
- [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js) — dial UI component
- [pforge-mcp/dashboard/served-app.js](pforge-mcp/dashboard/served-app.js) — dashboard integration
- `pforge-mcp/tests/forge-master-prefs.test.mjs` — NEW REST round-trip tests
- `.forge/forge-master-prefs.json` — NEW prefs file schema (gitignored by existing `.forge/` rule)
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — release metadata at Slice 4
- `docs/COPILOT-VSCODE-GUIDE.md` — one-paragraph "Reasoning Depth" section

### Out of scope

- Any change to existing provider adapters (`github-copilot-tools.mjs`, `anthropic-tools.mjs`, `openai-tools.mjs`, `xai-tools.mjs`)
- Any change to the 10-principle `UNIVERSAL_BASELINE` in `principles.mjs` or the advisory lane system-prompt text
- Any change to `forge_master_ask` MCP tool schema in `tools.json` or `capabilities.mjs`
- Any change to existing intent-router lane classification rules (only the lane metadata gets a new field)
- Per-tool model selection (e.g., Deep for `forge_drift_report`, Fast for everything else) — too clever for v2.68.0
- Custom user-defined tiers beyond the three shipped — adds config complexity for no clear win
- Provider switching from the dial (e.g., "use Anthropic for Deep, OpenAI for Fast") — belongs in a future provider-preference UI phase
- Cost meter on the dial (estimated $/turn) — belongs in Phase-35 calibration
- Per-tier rate-limit budget tracking ("X turns remaining today on Deep") — belongs in Phase-35
- Streaming token display in the UI — separate UX phase
- Mobile-responsive dashboard CSS — desktop only for v2.68.0
- Any live HTTP calls in unit tests (all tests use fixtures or stubs)
- Any change to `pforge.ps1` or `pforge.sh` orchestrator logic

### Forbidden actions

- Do NOT expose model names (`gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4`, `claude-opus-4`) as string literals in any file under `pforge-mcp/dashboard/` that contributes to rendered user-facing UI text. Tooltips and labels use tier names only (`Fast`, `Balanced`, `Deep`).
- Do NOT add mobile-responsive CSS or media queries targeting viewport widths below 900 px in this phase.
- Do NOT change the existing provider-selection order (`githubCopilot` → `anthropic` → `openai` → `xai`) shipped in Phase-33.
- Do NOT use nested pwsh-in-bash gates, escaped-quote gate patterns, or `test -f <FILE>` in any validation gate (meta-bug [#94](https://github.com/srnichols/plan-forge/issues/94)). All gates are plain `npx vitest run <path>` or plain `grep -q` against a file. Principle 10.
- Do NOT make live HTTP calls in any test file. Stub `fetch` or inject provider mocks.
- Do NOT commit a real prefs file with a user's specific tier choice. `.forge/forge-master-prefs.json` stays gitignored; any example files live under `docs/` or as inline JSON in comments.
- Do NOT break backward compatibility: `runTurn({ model: "..." })` with an explicit model name MUST continue to bypass the tier resolver (explicit override wins).

---

## Acceptance Criteria

### Criteria for Slice 1 (tier resolver + 429 fallback)

- **MUST**: `pforge-master/src/reasoning-tier.mjs` exists and exports a function `resolveModel(tier, config)` that returns the string model name mapped to the tier.
- **MUST**: `resolveModel` returns the `config.forgeMaster.reasoningTiers.<tier>` value when `tier` is one of `"low"`, `"medium"`, `"high"`, else falls back to `resolveModel(config.forgeMaster.defaultTier || "low", config)`.
- **MUST**: `pforge-master/src/config.mjs` defines defaults `forgeMaster.reasoningTiers = { low: "gpt-4o-mini", medium: "gpt-4o", high: "claude-sonnet-4" }` and `forgeMaster.defaultTier = "low"` and `forgeMaster.autoEscalate = true`.
- **MUST**: `pforge-master/src/reasoning.mjs` `runTurn` accepts an optional `tier` parameter. When `tier` is provided and no explicit `model` option is set, the chosen model is `resolveModel(tier, config)`. When an explicit `model` is set, it wins and the tier is ignored.
- **MUST**: When the provider returns `{ error: "rate_limited" }` and the current turn is at tier `"high"`, `runTurn` retries once at tier `"medium"`. When at `"medium"`, retries once at `"low"`. When at `"low"`, surfaces the structured error without retry.
- **MUST**: The turn trace emitted by `runTurn` (the existing `emitToolTelemetry` payload or equivalent) includes fields `requestedTier` (string), `resolvedModel` (string), `fallbackFromTier` (string or null), and `escalated` (bool).
- **MUST**: `pforge-master/src/__tests__/reasoning-tier.test.mjs` contains at least 7 tests covering: (a) tier `"low"` resolves to `"gpt-4o-mini"` with defaults, (b) tier `"medium"` resolves to `"gpt-4o"`, (c) tier `"high"` resolves to `"claude-sonnet-4"`, (d) unknown tier falls back to default, (e) explicit `model` option beats tier, (f) 429 at `"high"` retries at `"medium"` with `fallbackFromTier: "high"` in trace, (g) 429 at `"low"` surfaces structured error without infinite loop.

### Criteria for Slice 2 (auto-escalation)

- **MUST**: `pforge-master/src/intent-router.mjs` adds a `recommendedTierBump` integer field to each lane descriptor. Default `0`. Lanes `"tempering"`, `"principle-judgment"`, and `"meta-bug-triage"` set it to `1`.
- **MUST**: `runTurn` applies the bump once per turn: `low + 1 → medium`, `medium + 1 → high`, `high + 1 → high` (capped). The bump applies only when `config.forgeMaster.autoEscalate !== false` AND no explicit `model` option is set.
- **MUST**: When auto-escalation happens, the turn trace includes `autoEscalated: true`, `fromTier: <original>`, `toTier: <bumped>`, `reason: "lane=<lane name>"`. Otherwise `autoEscalated: false`.
- **MUST**: Setting `config.forgeMaster.autoEscalate = false` disables bumping regardless of lane.
- **MUST**: `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` contains at least 6 tests covering: (a) `advisory` lane does NOT bump (`recommendedTierBump` 0), (b) `tempering` lane bumps from `low` to `medium`, (c) `principle-judgment` lane bumps from `medium` to `high`, (d) `tempering` lane at `high` stays at `high` (capped), (e) explicit `model` option disables bumping, (f) `autoEscalate: false` config disables bumping.

### Criteria for Slice 3 (dashboard dial + prefs)

- **MUST**: `pforge-mcp/server.mjs` exposes `GET /api/forge-master/prefs` returning `{ tier: "low"|"medium"|"high", autoEscalate: boolean }`. When the file does not exist, returns defaults `{ tier: "low", autoEscalate: true }` with HTTP 200.
- **MUST**: `pforge-mcp/server.mjs` exposes `PUT /api/forge-master/prefs` accepting a JSON body matching the same schema. Writes the body verbatim to `.forge/forge-master-prefs.json`. Returns HTTP 200 on success, HTTP 400 with `{ error: "invalid tier" }` when `tier` is not one of the three allowed values.
- **MUST**: `forge_master_ask` in `pforge-mcp/server.mjs` reads `.forge/forge-master-prefs.json` on each invocation (or uses a cached read with ≤ 5 s TTL) and threads `tier` into the `runTurn` call.
- **MUST**: `pforge-mcp/dashboard/forge-master.js` renders a three-position segmented control with labels `"Fast"`, `"Balanced"`, `"Deep"`. No model names appear anywhere in the rendered DOM or in the JS string literals that contribute to rendered DOM.
- **MUST**: The segmented control tooltip text reads `"Powered by frontier models via your GitHub Copilot subscription. Higher tiers may hit rate limits sooner."`
- **MUST**: When the user clicks a dial position, the dashboard calls `PUT /api/forge-master/prefs` with the new value and displays a toast `"Reasoning depth set to <Label>."` where `<Label>` is `Fast`, `Balanced`, or `Deep`.
- **MUST**: When no provider is available (detected via existing provider-status check), the dial is hidden and a `"Connect GitHub"` prompt is shown linking to the secrets UI row for `GITHUB_TOKEN`.
- **MUST**: `pforge-mcp/tests/forge-master-prefs.test.mjs` contains at least 5 tests covering: (a) `GET` returns defaults when file absent, (b) `PUT` persists and subsequent `GET` reads it back, (c) `PUT` with invalid tier returns 400, (d) `PUT` creates the `.forge/` directory if missing, (e) `PUT` with missing `autoEscalate` defaults to `true`.

### Criteria for Slice 4 (release v2.68.0)

- **MUST**: `VERSION` contains `2.68.0` (dogfoods Phase-31.1 strict version-bump).
- **MUST**: `CHANGELOG.md` has a `[2.68.0] — 2026-04-22` section promoted from `[Unreleased]`, including the phrase `"reasoning dial"` or `"Fast / Balanced / Deep"` in the headline or first bullet.
- **MUST**: `CHANGELOG.md` `[2.68.0]` section notes `"no API key required for any tier when GitHub Copilot subscription is active"` or equivalent zero-key reassurance.
- **MUST**: `ROADMAP.md` reflects v2.68.0 as shipped and Phase-34 as complete.
- **MUST**: `docs/COPILOT-VSCODE-GUIDE.md` contains a section whose heading contains the word `"Reasoning"` with at least three bullet points describing what each of the three tiers is good at.
- **MUST**: Git tag `v2.68.0` exists on the Slice 4 release commit (push deferred to manual step per operational-safety policy if the worker cannot push tags).

### Quality bar

- **SHOULD**: `reasoning-tier.mjs` code coverage ≥ 80% by line from the unit tests (informational — do not gate on it).
- **SHOULD**: Dial state change round-trips through `PUT /api/forge-master/prefs` in under 100 ms on a localhost dashboard session.
- **SHOULD**: `pforge.ps1 version-bump 2.68.0 --strict` exits 0 with `Updated 5/5`.
- **SHOULD**: Release commit message uses format `chore(release): v2.68.0 — Forge-Master reasoning dial`.

---

## Execution Slices

### Slice 1 — Tier resolver + 429 fallback

**Complexity**: 3 (new file, config keys, reasoning.mjs changes, 7 unit tests).

**Files to create**:
- `pforge-master/src/reasoning-tier.mjs`
- `pforge-master/src/__tests__/reasoning-tier.test.mjs`

**Files to extend**:
- `pforge-master/src/config.mjs`
- `pforge-master/src/reasoning.mjs`

**Steps**:
1. Read `config.mjs`. Add `reasoningTiers`, `defaultTier`, `autoEscalate` defaults under `forgeMaster`.
2. Create `reasoning-tier.mjs` exporting `resolveModel(tier, config)` and a constant `VALID_TIERS = ["low", "medium", "high"]`.
3. Read `reasoning.mjs`. Locate `runTurn`. Accept `tier` as an option. Before calling the provider, resolve the final model using `resolveModel` when no explicit `model` option was passed.
4. Wrap the provider call in a fallback loop: on `{ error: "rate_limited" }` at `"high"`, set `fallbackFromTier = "high"`, re-resolve at `"medium"`, retry once. Same chain for `"medium"` → `"low"`. At `"low"`, surface the structured error.
5. Extend the telemetry payload with `requestedTier`, `resolvedModel`, `fallbackFromTier`, `escalated` (set by Slice 2; defaults to `false` here).
6. Write 7 unit tests in `reasoning-tier.test.mjs`. Stub the provider's `callProvider` to inject `{ error: "rate_limited" }` or a success response.

**Validation gate**:
```bash
cd pforge-master && npx vitest run src/__tests__/reasoning-tier.test.mjs --reporter=default
```
Expected: `Tests  7 passed (7)` (or more).

**Commit**: `feat(forge-master): Slice 1 — reasoning tier resolver + 429 fallback`

---

### Slice 2 — Auto-escalation for high-stakes lanes

**Complexity**: 3 (intent-router metadata, runTurn bump logic, 6 unit tests).

**Files to extend**:
- `pforge-master/src/intent-router.mjs`
- `pforge-master/src/reasoning.mjs`

**Files to create**:
- `pforge-master/src/__tests__/intent-auto-escalation.test.mjs`

**Steps**:
1. Read `intent-router.mjs`. Locate the lane descriptor array or object. Add `recommendedTierBump: 0` to every lane. Set `recommendedTierBump: 1` on `tempering`, `principle-judgment`, and `meta-bug-triage`. If `meta-bug-triage` does not exist as a lane today, add it or map it via keyword to the closest existing lane — check the shipped `intent-router.mjs` first.
2. In `reasoning.mjs` `runTurn`, after intent classification and before model resolution, compute `effectiveTier`:
   - If explicit `model` option provided → no bump, `effectiveTier = requestedTier`.
   - Else if `config.forgeMaster.autoEscalate === false` → no bump.
   - Else `effectiveTier = min(requestedTier + recommendedTierBump, "high")` (integer tier math on the VALID_TIERS index).
3. Set trace fields `autoEscalated`, `fromTier`, `toTier`, `reason` accordingly.
4. Write 6 unit tests in `intent-auto-escalation.test.mjs`.

**Validation gate**:
```bash
cd pforge-master && npx vitest run src/__tests__/intent-auto-escalation.test.mjs --reporter=default
```
Expected: `Tests  6 passed (6)` (or more).

**Commit**: `feat(forge-master): Slice 2 — auto-escalation for high-stakes lanes`

---

### Slice 3 — Dashboard dial + prefs REST + persistence

**Complexity**: 4 (REST endpoints, dial UI component, prefs-aware forge_master_ask, 5 REST tests, provider-availability branching).

**Files to extend**:
- `pforge-mcp/server.mjs` (new REST endpoints + forge_master_ask prefs read)
- `pforge-mcp/dashboard/forge-master.js` (dial UI + toast on change)
- `pforge-mcp/dashboard/served-app.js` (integration point — wire the dial into the Forge-Master tab)

**Files to create**:
- `pforge-mcp/tests/forge-master-prefs.test.mjs`

**Steps**:
1. Locate the existing REST-router section of `pforge-mcp/server.mjs`. Register `GET /api/forge-master/prefs` and `PUT /api/forge-master/prefs` handlers.
   - `GET`: read `.forge/forge-master-prefs.json`. If absent, respond with defaults `{ tier: "low", autoEscalate: true }`. Always 200.
   - `PUT`: parse body as JSON. Validate `tier` is in `["low", "medium", "high"]`; reject with 400 `{ error: "invalid tier" }` otherwise. Default `autoEscalate: true` if missing. `mkdirSync(".forge", { recursive: true })` before write. `writeFileSync` with 2-space JSON. Respond 200.
2. Update `forge_master_ask` tool handler in `pforge-mcp/server.mjs` to read the prefs file on each invocation (or with a ≤ 5 s cached read) and pass `tier` and `autoEscalate` into the `runTurn` call.
3. In `pforge-mcp/dashboard/forge-master.js`, add the dial:
   - Three-button segmented control with labels `Fast`, `Balanced`, `Deep`.
   - Initial state loaded from `GET /api/forge-master/prefs`.
   - Click → `PUT /api/forge-master/prefs` → toast `"Reasoning depth set to <Label>."`
   - Tooltip on the group: exact string from criterion 21.
   - Hidden when provider-status endpoint reports no provider available; show `"Connect GitHub"` link to the secrets UI instead.
4. Wire the dial into `served-app.js` at the Forge-Master tab top section (search for the existing Forge-Master tab scaffold; insert above the prompt gallery).
5. Write 5 REST tests in `forge-master-prefs.test.mjs` using the existing test harness pattern for REST endpoints in `pforge-mcp/tests/`.

**Validation gate**:
```bash
cd pforge-mcp && npx vitest run tests/forge-master-prefs.test.mjs --reporter=default
```
Expected: `Tests  5 passed (5)` (or more).

**Commit**: `feat(forge-master): Slice 3 — dashboard reasoning dial + per-user prefs`

---

### Slice 4 — Release v2.68.0

**Complexity**: 2 (docs + version-bump dogfood + tag; NO `test -f` in gates per meta-bug #94).

**Files to modify**:
- `VERSION`
- `CHANGELOG.md`
- `ROADMAP.md`
- `docs/COPILOT-VSCODE-GUIDE.md`

**Steps**:
1. Run `.\pforge.ps1 version-bump 2.68.0 --dry-run` and review the diff. Confirm 5 files targeted.
2. Run `.\pforge.ps1 version-bump 2.68.0 --strict`. Require `Updated 5/5`.
3. Promote `[Unreleased]` in CHANGELOG to `[2.68.0] — 2026-04-22`. Headline: `"**Forge-Master gains a reasoning dial: Fast / Balanced / Deep, no API key required for any tier.**"` followed by bullets for Slice 1–3 deliverables.
4. Update `ROADMAP.md`: mark Phase-34 shipped; bump current version.
5. Add or update the `"Reasoning Depth"` section in `docs/COPILOT-VSCODE-GUIDE.md` with three bullets (one per tier) describing what each is good at; mention auto-escalation and the opt-out config key.
6. Commit as `chore(release): v2.68.0 — Forge-Master reasoning dial`.
7. Tag: `git tag v2.68.0 && git push origin v2.68.0`.

**Validation gate**:
```bash
grep -q '^2.68.0' VERSION && grep -q '\[2.68.0\]' CHANGELOG.md && grep -q 'reasoning dial\|Fast / Balanced / Deep\|Fast.*Balanced.*Deep' CHANGELOG.md && grep -q 'Reasoning' docs/COPILOT-VSCODE-GUIDE.md
```
Expected: exit 0.

**Commit**: `chore(release): v2.68.0 — Forge-Master reasoning dial`

---

## Execution Order

1 → 2 → 3 → 4. No parallelism. Slice 2 depends on Slice 1's tier resolver; Slice 3 depends on Slice 1+2's runTurn wiring; Slice 4 depends on everything.

## Risks and Mitigations

- **Risk**: Intent router lane names don't include `meta-bug-triage` yet. *Mitigation*: Slice 2 step 1 explicitly says to check shipped lanes first and add the bump to the closest existing lane (e.g., `tempering`) if the new lane doesn't exist. Don't invent new classification rules.
- **Risk**: Prefs file read on every turn adds I/O cost. *Mitigation*: the criterion allows ≤ 5 s cached read. Small JSON file; cost negligible. If observed slow, convert to in-memory with mtime-based invalidation (defer to calibration phase).
- **Risk**: Dashboard JS bundle may contain model names via embedded config dump. *Mitigation*: Forbidden Actions explicitly bans model-name string literals in `dashboard/` files that render UI; reviewer grep-checks the bundle before release.
- **Risk**: 429 fallback loop infinite if provider is stuck. *Mitigation*: fallback chain is bounded to 2 retries max (`high → medium → low`), then surfaces structured error. Explicitly tested in Slice 1 criterion 7g.
- **Risk**: User disables auto-escalation and then complains Deep isn't sharp enough. *Mitigation*: toast on auto-escalation in Slice 3 makes the feature visible. Release notes explain the opt-out.
- **Risk**: `test -f` sneaks into gates again (meta-bug #94 recurrence). *Mitigation*: Forbidden Actions explicitly bans it. Slice 4 gate uses pure grep chains. Reviewer spot-checks gate bash blocks in the plan before launch.

## Session Break Points

- After Slice 2: all back-end tier resolution + auto-escalation complete; UI and release can happen in a fresh session with full context for dashboard work.
- After Slice 3: feature complete; release can defer.

## Agent-handoff Status Template

On completion of each slice, emit (per `status-reporting.instructions.md`):

```
## Phase-34 — Slice N — <title>
Status: passed | failed
Duration: <mm:ss>
Gate: <one-line gate output>
Files changed: <count>
Next: Slice N+1 | complete
```
