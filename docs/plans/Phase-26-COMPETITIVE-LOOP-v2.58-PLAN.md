---
crucibleId: phase-26-competitive-loop-b8c4d0f2-3e5a-4962-af7b-9d4e2c3f5b6c
lane: full
source: human
---

# Phase-26 — Competitive Loop + Promotion + Continuous-Learning Inner Loop

> **Target release**: v2.58.0
> **Status**: Shipped — released as v2.58.0 on 2026-04-20 (see CHANGELOG).
> **Depends on**: Phase-25 (v2.57.0) — Reflexion, trajectories, auto-skill capture, postmortems, reviewer advisory, gate synthesis, federation must be in place
> **Branch strategy**: Feature branch `feat/phase-26-competitive` for C1 slices (Slices 1–5); merge to `master` after parallel merge checkpoint. Non-C1 slices (6–17) commit directly to `master`.
> **Source**: `docs/research/karpathy-autoresearcher-comparison.md` (April 2026), Phase-25 deferrals list
> **Session budget**: 17 slices across **3 sessions** — breaks after Slice 5 and Slice 11
> **Design posture**: **All new behaviors are opt-in for existing users** (defaults preserve v2.57 behavior). **New installs get "best-defaults preset"** written by `setup.ps1`/`setup.sh`/Dashboard welcome that enables non-destructive features (reviewer advisory, auto-skill capture, cost alerting). **Blocking modes stay off everywhere** until data-driven calibration eligibility is met.

---

## Specification Source

- **Research report**: `docs/research/karpathy-autoresearcher-comparison.md` §5 (L3), §7
- **Phase-25 deferrals**: L3 competitive quorum, reviewer blocking mode, auto-skill promotion UX
- **Additions this phase**: gate-synthesis enforce promotion, incident→fix-proposal→auto-retry loop, cost-anomaly model swap, trajectory federation
- **Paradigms referenced**: Darwin Gödel Machine (competitive selection), AI Scientist v2 (reviewer blocking), STOP (scaffolding evolution via auto-skill promotion)

---

## Feature Specification: Competitive Loop + Continuous-Learning

### Problem Statement
Phase-25 established the inner-loop primitives (reflexion, trajectories, auto-skill capture, postmortems, reviewer advisory). Phase-26 closes three remaining gaps vs external state-of-the-art: (a) no competitive parallelism on the same slice (DGM gap) — winning output is selected arbitrarily when quorum models produce divergent work; (b) reflexion/reviewer/gate-synthesis infrastructure exists but data accumulates without promoting suggestions to enforced behavior (closed-loop gap); (c) incidents and fix-proposals are recorded but never acted upon (self-healing gap). This phase turns the loop from "measures and records" into "measures, records, and acts within bounded safety."

### User Scenarios
1. **Same-slice best-of-N wins on verified gates** — A slice tagged `[competitive]` spawns 3 worktrees under `.forge/worktrees/<slice>/variant-{1,2,3}/`. Each variant runs independently; only the one that passes all validation gates and has the lowest cost-to-diff ratio fast-forwards to the parent branch. Losers' traces are preserved for postmortem.
2. **Reviewer auto-promotes to blocking** — After 50 advisory reviews accumulate in `.forge/reviews/`, the Dashboard surfaces a one-click "Enable blocking reviewer" toggle. Until then, the toggle is disabled with a progress bar showing `N/50`.
3. **Auto-skill promotion via Dashboard card** — An auto-skill candidate hits `reuseCount >= 3`. The Dashboard "Skills" tab shows a card: **[Accept] [Reject] [Defer 7d]**. On Accept, the skill is copied to `.github/skills/auto-<slug>/SKILL.md` with an auto-generated manifest.
4. **Gate suggestion promotes to enforce** — A Tempering-derived gate suggestion has been manually accepted 5 times across different plans. The 6th plan auto-injects it (and logs the auto-injection in the postmortem) without prompting.
5. **Incident auto-patches in dry-run mode** — A flaky-test incident triggers a fix-proposal. By default (`runtime.autoFix.mode: "dry-run"`) the patch is written to `.forge/proposed-fixes/<id>.patch` but not applied. Dashboard shows "1 proposed fix ready for review." Opting into `"apply"` mode auto-applies the patch on the next retry and re-runs the gate.
6. **Cost anomaly swaps the model mid-plan** — Slice 4's first attempt costs $2.80 when the plan's median is $0.60. The cost-anomaly detector marks the next retry as "cheaper-model preferred." The escalation chain picks `claude-haiku-4` instead of `claude-sonnet-4.5` for the retry.
7. **Federated trajectories inform the hardener** — A sibling repo in `brain.federation.repos[]` has a similar feature's trajectories under `.forge/trajectories/`. Phase-26's Step-2 hardener reads them (read-only) and cites "sibling repo `acme/payments-svc` Phase-12 Slice 4 found X pitfall" in the required-context block.

### Acceptance Criteria
- **MUST**: New `CompetitiveScheduler` class selected when any slice has the `[competitive]` tag. Spawns N worktrees at `.forge/worktrees/<plan-basename>/<slice-id>/variant-<n>/`, runs each through the standard slice execution path in parallel up to `runtime.competitive.maxVariants` (default 3, configurable 2–5).
- **MUST**: Winner selection rule: (a) ALL gates pass, then (b) lowest cost-to-diff ratio (cost_usd / diff_lines), (c) tiebreak on shortest diff, (d) tiebreak on earliest completion timestamp. Rule is deterministic and logged.
- **MUST**: Losers' worktrees are archived to `.forge/worktrees-archive/<plan>/<slice>/variant-<n>/` with full trace, then aged out after 7 days (configurable `runtime.competitive.archiveDays`).
- **MUST**: Winner fast-forwards to the parent branch via `git worktree add` + cherry-pick pattern; no scratch branches on `refs/heads/`.
- **MUST**: Teardown Safety Guard exempts paths matching `.forge/worktrees/**` and `.forge/worktrees-archive/**` from branch-loss detection.
- **MUST**: `.gitignore` entries added for `.forge/worktrees/` and `.forge/worktrees-archive/`.
- **MUST**: Reviewer calibration counter derived at read-time from `glob('.forge/reviews/*.json')`; never stored as a mutable scalar. Eligibility threshold: `runtime.reviewer.calibrationThreshold` (default 50).
- **MUST**: When reviewer eligible, Dashboard surfaces "Enable blocking reviewer" toggle. Toggle writes `runtime.reviewer.blockOnCritical: true` to `.forge.json`. Until eligible, the toggle is disabled with progress `N/50`.
- **MUST**: Auto-skill promotion UI — Dashboard "Skills" tab (new) lists candidates with `reuseCount >= runtime.autoSkill.promoteThreshold`. Each card has **Accept** (copies to `.github/skills/auto-<slug>/SKILL.md`), **Reject** (moves to `.forge/skills-auto/rejected/`), **Defer 7d** (bumps timestamp). No interactive terminal prompts.
- **MUST**: CLI `--auto-promote` flag exists for CI use; applies Accept to all eligible candidates non-interactively.
- **MUST**: Gate suggestion tracking — every accepted gate suggestion increments a counter in `.forge/gate-suggestions.jsonl`. A suggestion with `acceptCount >= 5` is auto-injected on subsequent plans (logged in postmortem as `gateSynthesis.autoInjected`). Requires `runtime.gateSynthesis.mode: "enforce"` opt-in to take effect; in `"suggest"` mode the counter still accrues.
- **MUST**: Incident → fix-proposal → auto-retry loop. When an incident has an associated `fix-proposals.jsonl` entry and `runtime.autoFix.enabled: true`, the next retry of the same failing slice:
  - In `"dry-run"` mode (default): writes patch to `.forge/proposed-fixes/<id>.patch`, does NOT apply, logs advisory, proceeds with normal retry.
  - In `"apply"` mode: applies the patch before spawning the retry worker, re-runs the gate, rolls back on failure.
  - Hard cap: **one auto-fix attempt per incident, ever**. Tracked in the incident record (`autoFixAttempted: true`).
- **MUST**: Cost-anomaly detector — on slice completion, if `attempt.cost_usd > 2 × median(plan.sliceCosts)`, the next retry's escalation chain is re-ranked to prefer models with lower average cost. Scoped per-plan (not global). Logged in postmortem.
- **MUST**: Trajectory federation — when `brain.federation.repos[]` populated, `cross.*` queries include each sibling repo's `.forge/trajectories/` (read-only). Results are merged, source-tagged per-repo, and rate-limited to 100 trajectory files per query.
- **MUST**: Dashboard gets a new "Inner Loop" tab with sub-sections: Reviewer calibration, Skills pending, Gate suggestions, Proposed fixes, Cost anomalies, Federation status. Each sub-section has a toggle where applicable and a live-save pattern matching today's Source-preference panel.
- **MUST**: `setup.ps1` and `setup.sh` write a "best-defaults preset" to `.forge.json` for new installs: `runtime.reviewer.enabled: true, blockOnCritical: false; runtime.autoSkill.enabled: true; runtime.gateSynthesis.mode: "suggest"; runtime.autoFix.enabled: true, mode: "dry-run"; runtime.competitive.maxVariants: 3`. Existing installs (detected via existing `.forge.json`) get no changes.
- **MUST**: `forge_capabilities` adds `competitive`, `autoFix`, `costAnomaly` subsystems to the `innerLoop` section from Phase-25.
- **MUST**: User manual gains `docs/manual/competitive-loop.html` with a Mermaid diagram showing the worktree-spawn → parallel-execute → winner-select → archive-losers flow.
- **SHOULD**: `docs/manual/inner-loop.html` (from Phase-25) gains a "Phase-26 additions" section and cross-link to competitive-loop.html.
- **SHOULD**: `README.md` and `docs/index.html` get one subtle sentence update acknowledging "competitive execution with verified winners" — no new top-level section.
- **SHOULD**: CHANGELOG v2.58.0 section references `docs/research/karpathy-autoresearcher-comparison.md` and the Phase-25 deferrals list.
- **MAY**: Dashboard "Skills" tab may surface a skill-usage heatmap (reuseCount over time).

---

## Scope Contract

### In-Scope
- **C1** — CompetitiveScheduler, worktree manager, winner selection, loser archival, Teardown-Safety-Guard exemption
- **C2** — Reviewer calibration counter + Dashboard toggle + `blockOnCritical` activation path
- **C3** — Dashboard "Skills" tab with Accept/Reject/Defer; CLI `--auto-promote` for CI
- **C4** — Gate-suggestion accept-counter + per-suggestion auto-inject at threshold
- **C5** — Incident → fix-proposal auto-retry with `dry-run` default + `apply` opt-in, hard cap of 1 attempt per incident
- **C6** — Cost-anomaly per-plan escalation-chain re-ranking
- **C7** — Trajectory federation via `cross.*` scope
- Dashboard "Inner Loop" tab consolidating all Phase-25 and Phase-26 controls
- Best-defaults preset writer in `setup.ps1` / `setup.sh` + a Dashboard welcome card offering the preset on first visit post-upgrade
- Capabilities surface updates (`forge_capabilities`, `tools.json`, `worker-capabilities.json`)
- User manual: new `competitive-loop.html` + updates to `inner-loop.html`
- CHANGELOG + VERSION bump to v2.58.0

### Out-of-Scope
- Multi-repo plan orchestration (one plan spanning multiple repos)
- Autonomous plan authorship — plans remain human-owned
- Self-modifying orchestrator source code — Crucible contract stands
- Full skill marketplace UI — "Skills" tab gets Accept/Reject/Defer only
- Web-UI editing of worktree contents — only start/stop/cleanup controls
- Retroactive auto-fix on historical incidents — only incidents from the current run
- Cost-anomaly model swap across plans (global) — per-plan scope only
- Federation over the network — file-system allowlist only
- Changes to Phase-25 defaults for existing users (reviewer stays advisory-only, auto-skill stays suggest-only, etc.)

### Forbidden Actions
- `git push --force`, `git reset --hard origin/master`, deletion of protected branches, operations against `refs/heads/master` from any slice other than the merge checkpoint
- Editing `pforge-mcp/crucible*.mjs` (provenance contract frozen)
- Any change to Phase-25 behavior contracts (reflexion block format, trajectory path, auto-skill schema, postmortem schema) without explicit plan directive
- Auto-applying a fix-proposal when `runtime.autoFix.mode != "apply"` — dry-run MUST always write-only
- Auto-promoting an auto-skill without Dashboard Accept or CLI `--auto-promote`
- Writing to sibling repos in `brain.federation.repos[]` — read-only enforced at the fs layer, not just the app layer
- Retaining worktree archives longer than `runtime.competitive.archiveDays` (default 7)
- Running `pforge run-plan` against this plan file on any branch other than `feat/phase-26-competitive` (Slices 1–5) or `master` (Slices 6–16) without explicit user approval
- Deleting `.forge/worktrees/` or `.forge/worktrees-archive/` outside the worktree manager's cleanup path

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1 | Competitive parallelism: scratch branches vs worktrees | ✅ Resolved | **Worktrees under `.forge/worktrees/`** — true filesystem isolation, no `refs/heads/` pollution, easy `.gitignore`, pattern-based Teardown Safety Guard exemption |
| D2 | Winner selection metric | ✅ Resolved | Gate-pass first, then cost-to-diff ratio, tiebreak on diff length, tiebreak on earliest completion |
| D3 | Max variants per competitive slice | ✅ Resolved | Default 3; configurable 2–5 via `runtime.competitive.maxVariants` |
| D4 | Loser archive retention | ✅ Resolved | 7 days default; configurable `runtime.competitive.archiveDays` |
| D5 | Reviewer calibration threshold | ✅ Resolved | 50 advisory reviews; derived at read-time from `.forge/reviews/` glob (never a stored scalar) |
| D6 | Reviewer blocking default after eligible | ✅ Resolved | Stays opt-in even after eligible — Dashboard toggle required. No auto-flip. |
| D7 | Auto-skill promotion UX location | ✅ Resolved | Dashboard "Skills" tab cards with Accept/Reject/Defer; CLI `--auto-promote` for CI only |
| D8 | Gate-suggestion enforce threshold | ✅ Resolved | 5 manual accepts per suggestion (tracked per-suggestion in `.forge/gate-suggestions.jsonl`); auto-inject on 6th plan if `runtime.gateSynthesis.mode: "enforce"` |
| D9 | Auto-fix default mode | ✅ Resolved | `"dry-run"` — writes patch, never applies. `"apply"` is explicit opt-in. |
| D10 | Auto-fix retry cap | ✅ Resolved | **One attempt per incident, ever.** Tracked in incident record. |
| D11 | Cost-anomaly threshold | ✅ Resolved | `cost_usd > 2 × median(plan.sliceCosts)` — per-plan, not global |
| D12 | Cost-anomaly action | ✅ Resolved | Re-rank per-plan escalation chain to prefer cheaper models for next retry only; original chain restored for next plan |
| D13 | Federation trajectory rate limit | ✅ Resolved | 100 trajectory files per query, sorted by mtime desc |
| D14 | Dashboard Inner Loop tab location | ✅ Resolved | New top-level tab between "Config" and "Memory"; sub-sections are collapsible panels |
| D15 | Best-defaults preset scope | ✅ Resolved | Applied ONLY when `.forge.json` does not exist; existing installs untouched |
| D16 | Welcome-card trigger on existing installs | ✅ Resolved | Dashboard shows a "New inner-loop features available" dismissible card on first visit after v2.58 upgrade (tracked via `.forge/dashboard-state.json`); card explains each feature and offers one-click opt-in |
| D17 | Feature branch strategy for C1 | ✅ Resolved | `feat/phase-26-competitive` for Slices 1–5; merge to master at Slice 5 checkpoint; Slices 6–16 direct to master |

All TBDs resolved.

---

## Execution Slices

### Session 1 — Competitive core (C1)

#### Slice 1: Worktree manager [sequential] {#slice-1}

**Goal**: Implement `.forge/worktrees/` lifecycle — create, list, archive, cleanup. Pure filesystem + `git worktree` wrapper; no scheduler integration yet.

**Files**:
- `pforge-mcp/worktree-manager.mjs` — new module: `createWorktree()`, `archiveWorktree()`, `cleanupAgedArchives()`.
- `pforge-mcp/tests/worktree-manager.test.mjs` — new.
- `.gitignore` — add `.forge/worktrees/`, `.forge/worktrees-archive/`.

**Depends on**: none

**Branch**: `feat/phase-26-competitive`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (worktree spawn, archive, cleanup, `.gitignore`).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/worktree-manager.test.mjs"
```

---

#### Slice 2: CompetitiveScheduler [sequential] {#slice-2}

**Goal**: New `CompetitiveScheduler` class. When a slice has tag `[competitive]`, spawn N worktrees via the manager, run each through the same slice executor in parallel up to `runtime.competitive.maxVariants`.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `CompetitiveScheduler` class near `ParallelScheduler`; scheduler selection gains a third branch for `[competitive]`-tagged slices.
- `pforge-mcp/tests/competitive-scheduler.test.mjs` — new.

**Depends on**: Slice 1

**Branch**: `feat/phase-26-competitive`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (CompetitiveScheduler selection, N variant spawn).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/competitive-scheduler.test.mjs"
```

---

#### Slice 3: Winner selection + fast-forward [sequential] {#slice-3}

**Goal**: Per-variant gate evaluation, deterministic winner rule (gate-pass → cost/diff → diff length → timestamp), cherry-pick winner into parent branch, archive losers.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `selectWinner()` pure function; fast-forward helper.
- `pforge-mcp/worktree-manager.mjs` — `promoteWinner()` method.
- `pforge-mcp/tests/winner-selection.test.mjs` — new; covers tiebreak chain and archival.

**Depends on**: Slice 2

**Branch**: `feat/phase-26-competitive`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (winner rule, loser archive, cherry-pick).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/winner-selection.test.mjs"
```

---

#### Slice 4: Teardown Safety Guard exemption for worktrees [sequential] {#slice-4}

**Goal**: Extend the Teardown Safety Guard to skip path patterns `.forge/worktrees/**` and `.forge/worktrees-archive/**` — these must not trigger branch-loss incidents when the worktree manager cleans them up.

**Files**:
- `pforge-mcp/orchestrator.mjs` — Teardown Safety Guard path-pattern matcher (reuse any existing pattern helper; add new if absent).
- `pforge-mcp/tests/teardown-guard-worktrees.test.mjs` — new.

**Depends on**: Slice 1

**Branch**: `feat/phase-26-competitive`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (Teardown Safety Guard exemption).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/teardown-guard-worktrees.test.mjs"
```

---

#### Slice 5: Competitive end-to-end integration test + merge to master [sequential] {#slice-5}

**Goal**: End-to-end test: fixture plan with one `[competitive]` slice runs three variants, one passes gates, the other two fail differently, winner is cherry-picked, losers archived. Merge `feat/phase-26-competitive` → `master` after gate passes.

**Files**:
- `pforge-mcp/tests/competitive-e2e.test.mjs` — new.
- `pforge-mcp/tests/fixtures/competitive-plan.md` — new fixture.

**Depends on**: Slices 1–4

**Branch**: `feat/phase-26-competitive` → merge to `master` on pass

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (CompetitiveScheduler selection, winner rule, fast-forward, archive).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/competitive-e2e.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
```

---

### Parallel Merge Checkpoint (after Slice 5)

- All C1 vitest files pass.
- `.forge/worktrees/` and `.forge/worktrees-archive/` are gitignored.
- Merge `feat/phase-26-competitive` → `master` via fast-forward (no merge commit).
- `git log --oneline -10` shows all 5 slice commits on master.

---

## 🛑 SESSION BREAK RECOMMENDED HERE

Close session after merge. Open a new session, resume with:
```bash
pforge run-plan --resume-from Slice-6 docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md
```

---

### Session 2 — Promotion surfaces (C2, C3, C4)

#### Slice 6: Reviewer calibration counter + eligibility check [parallel-safe, group A] {#slice-6}

**Goal**: Add `getReviewerCalibration()` function that derives `reviewCount` at read-time from `glob('.forge/reviews/*.json')`. Returns `{ count, threshold, eligible }`. Never stored as a scalar.

**Files**:
- `pforge-mcp/brain.mjs` — new `getReviewerCalibration()` export.
- `pforge-mcp/tests/reviewer-calibration.test.mjs` — new.

**Depends on**: none (Phase-25 reviewer writes `.forge/reviews/` already)

**Branch**: `master`

**Parallel group**: A (with Slice 7, Slice 8).
**Non-overlap proof**: only touches `brain.mjs` (new function); Slices 7 and 8 touch different files.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (reviewer calibration read-time derivation).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/reviewer-calibration.test.mjs"
```

---

#### Slice 7: Gate-suggestion accept counter + auto-inject [parallel-safe, group A] {#slice-7}

**Goal**: When a gate suggestion is accepted (via Dashboard in Slice 13 or CLI), increment its counter in `.forge/gate-suggestions.jsonl`. When `runtime.gateSynthesis.mode: "enforce"` AND a suggestion's `acceptCount >= 5`, auto-inject it into the plan's gate list (logged in postmortem).

**Files**:
- `pforge-mcp/orchestrator.mjs` — extend existing `synthesizeGateSuggestions()` (from Phase-25 Slice 4) with counter read + auto-inject path.
- `pforge-mcp/memory.mjs` — `recordGateAccept()`, `getGateSuggestionCounter()`.
- `pforge-mcp/tests/gate-suggestion-promote.test.mjs` — new.

**Depends on**: none

**Branch**: `master`

**Parallel group**: A.
**Non-overlap proof**: orchestrator edits are in the gate-synthesis block; Slices 6 and 8 touch different files.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (gate suggestion counter + auto-inject).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/gate-suggestion-promote.test.mjs"
```

---

#### Slice 8: Auto-skill promotion — CLI + backend API [parallel-safe, group A] {#slice-8}

**Goal**: CLI `--auto-promote` flag accepts all eligible candidates non-interactively. Backend `/api/skills/pending`, `/api/skills/accept`, `/api/skills/reject`, `/api/skills/defer` endpoints for Dashboard use in Slice 13.

**Files**:
- `pforge-mcp/memory.mjs` — `listPendingAutoSkills()`, `acceptAutoSkill()`, `rejectAutoSkill()`, `deferAutoSkill()`.
- `pforge-mcp/server.mjs` — four new API endpoints.
- `pforge-mcp/cli-schema.json` — add `--auto-promote` flag.
- `pforge.ps1` and `pforge.sh` — wire the flag through to the orchestrator.
- `pforge-mcp/tests/auto-skill-promote.test.mjs` — new.

**Depends on**: none

**Branch**: `master`

**Parallel group**: A.
**Non-overlap proof**: disjoint from Slices 6 and 7 — touches memory.mjs (new functions, not overlapping Slice 7's), server.mjs, CLI schemas.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/api-patterns.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (Accept/Reject/Defer API, `--auto-promote` CLI).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/auto-skill-promote.test.mjs"
```

---

### Parallel Merge Checkpoint (after Slices 6, 7, 8)

- No merge conflicts across the three slices.
- Full vitest suite green.
- `node pforge-mcp/server.mjs --validate` passes.

---

### Session 2 continued — Self-healing & cost intelligence (C5, C6, C7)

#### Slice 9: Incident → fix-proposal auto-retry (dry-run + apply modes) [sequential] {#slice-9}

**Goal**: On slice retry, if the last incident has a matching `fix-proposals.jsonl` entry, write patch to `.forge/proposed-fixes/<id>.patch` (dry-run, default). In `"apply"` mode, apply the patch, re-run the gate, rollback on failure. Hard cap: 1 attempt per incident (tracked via `autoFixAttempted: true` in the incident record).

**Files**:
- `pforge-mcp/orchestrator.mjs` — extend `executeSlice` retry path; new `applyFixProposal()` and `rollbackFixProposal()` helpers.
- `pforge-mcp/tests/auto-fix.test.mjs` — new; covers dry-run path, apply path, rollback path, retry cap.

**Depends on**: none (Phase-25 `fix-proposals.jsonl` is already written by LiveGuard)

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (dry-run default, apply opt-in, 1-attempt cap, rollback).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/auto-fix.test.mjs"
```

---

#### Slice 10: Cost-anomaly detector + per-plan escalation re-ranking [sequential] {#slice-10}

**Goal**: On slice completion, compute `median(plan.sliceCosts)`. If `attempt.cost_usd > 2 × median`, mark next retry's escalation chain as "cheaper-preferred" — re-rank by `avg_cost_usd` ascending. Scoped per-plan; resets at plan start.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `detectCostAnomaly()`, `rerankEscalationChain()`.
- `pforge-mcp/tests/cost-anomaly.test.mjs` — new.

**Depends on**: none (Phase-25 postmortem already captures slice costs)

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (cost anomaly threshold, re-rank, per-plan scope).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/cost-anomaly.test.mjs"
```

---

#### Slice 11: Trajectory federation in `cross.*` [sequential] {#slice-11}

**Goal**: Extend Phase-25 Slice-6 federation reader to include `.forge/trajectories/` from each allowlisted sibling repo. Rate-limit 100 files per query, sorted by mtime desc, source-tagged per-repo.

**Files**:
- `pforge-mcp/brain.mjs` — extend `federationRead()` to include trajectories.
- `pforge-mcp/tests/trajectory-federation.test.mjs` — new.

**Depends on**: none (Phase-25 Slice 6 & Slice 2 in place)

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (trajectory federation with rate limit).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/trajectory-federation.test.mjs"
```

---

## 🛑 SESSION BREAK RECOMMENDED HERE

Close session. Open a new session, resume with:
```bash
pforge run-plan --resume-from Slice-12 docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md
```

---

### Session 3 — Dashboard, capabilities, docs, ship

#### Slice 12: Dashboard backend — `/api/innerloop` endpoints [sequential] {#slice-12}

**Goal**: Backend endpoints to power the new Dashboard "Inner Loop" tab: `/api/innerloop/status` (all subsystem states), `/api/innerloop/reviewer-calibration`, `/api/innerloop/gate-suggestions`, `/api/innerloop/cost-anomalies`, `/api/innerloop/proposed-fixes`, `/api/innerloop/federation`.

**Files**:
- `pforge-mcp/server.mjs` — six new endpoints.
- `pforge-mcp/tests/api-innerloop.test.mjs` — new.

**Depends on**: Slices 6, 7, 8, 9, 10, 11 (surfaces their data)

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/api-patterns.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (Dashboard data sources).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/api-innerloop.test.mjs"
```

---

#### Slice 13: Dashboard UI — "Inner Loop" tab [sequential] {#slice-13}

**Goal**: New top-level "Inner Loop" tab with six collapsible panels: Reviewer calibration (toggle disabled until eligible; progress bar), Skills pending (cards with Accept/Reject/Defer), Gate suggestions (list with accept/reject per-row), Cost anomalies (read-only list), Proposed fixes (read-only list with Apply button respecting `runtime.autoFix.mode`), Federation status (repo list + last sync). Live-save pattern matches existing Source-preference panel.

**Files**:
- `pforge-mcp/dashboard/index.html` — add tab + panels markup.
- `pforge-mcp/dashboard/app.js` — tab wiring, fetch calls, render logic, event handlers.

**Depends on**: Slice 12

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`

**Traces to**: MUST (Dashboard Inner Loop tab with six sub-sections).

**Validation Gate**:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('pforge-mcp/dashboard/index.html','utf8');if(!h.includes('Inner Loop'))throw new Error('tab missing');if(!h.includes('reviewer-calibration'))throw new Error('reviewer panel missing');if(!h.includes('skills-pending'))throw new Error('skills panel missing');if(!h.includes('gate-suggestions'))throw new Error('gate suggestions panel missing');if(!h.includes('cost-anomalies'))throw new Error('cost anomalies panel missing');if(!h.includes('proposed-fixes'))throw new Error('proposed fixes panel missing');if(!h.includes('federation-status'))throw new Error('federation panel missing');const j=fs.readFileSync('pforge-mcp/dashboard/app.js','utf8');if(!j.includes('/api/innerloop/'))throw new Error('app.js missing innerloop fetches');console.log('ok');"
node pforge-mcp/server.mjs --validate
```

---

#### Slice 14: Best-defaults preset writer + welcome card [sequential] {#slice-14}

**Goal**: (a) `setup.ps1` and `setup.sh` write the best-defaults preset to `.forge.json` ONLY when the file does not exist. (b) Dashboard shows a dismissible "New inner-loop features available" welcome card on first visit after v2.58 upgrade (tracked via `.forge/dashboard-state.json`), offering one-click opt-in per feature.

**Files**:
- `setup.ps1` — new `Write-BestDefaultsPreset` function; invoked when `.forge.json` absent.
- `setup.sh` — matching bash function.
- `pforge-mcp/dashboard/index.html` — welcome card markup (hidden by default; shown on first visit post-upgrade).
- `pforge-mcp/dashboard/app.js` — welcome card logic with dismiss/opt-in handlers; reads and writes `.forge/dashboard-state.json` via a new `/api/dashboard-state` endpoint.
- `pforge-mcp/server.mjs` — new `/api/dashboard-state` GET/POST.
- `pforge-mcp/tests/best-defaults-preset.test.mjs` — new; fixtures for fresh install vs upgrade.

**Depends on**: Slice 13

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/deploy.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (best-defaults preset on fresh install, welcome card on upgrade).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/best-defaults-preset.test.mjs"
```

---

#### Slice 15: Capabilities & tool-discovery surface updates [sequential] {#slice-15}

**Goal**: Extend the Phase-25 `innerLoop` section of `forge_capabilities` with `competitive`, `autoFix`, `costAnomaly` subsystems. Update `tools.json`, `worker-capabilities.json`, `docs/capabilities.md`, `llms.txt`.

**Files**:
- `pforge-mcp/capabilities.mjs` — add three subsystems to `innerLoop`.
- `pforge-mcp/tools.json` — new config keys.
- `pforge-mcp/worker-capabilities.json` — new flags.
- `docs/capabilities.md` — new entries.
- `llms.txt` — new entries.
- `pforge-mcp/tests/capabilities.test.mjs` — extend existing tests.

**Depends on**: Slices 1–14

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (`forge_capabilities` additions), SHOULD (capabilities.md, llms.txt).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/capabilities.test.mjs"
```

---

#### Slice 16: Feature-specific docs, CHANGELOG, VERSION [sequential] {#slice-16}

**Goal**: Create `docs/manual/competitive-loop.html` with a Mermaid worktree-spawn → winner flow. Update `docs/manual/inner-loop.html` with Phase-26 additions + cross-link. CHANGELOG v2.58.0 section. VERSION bump to `2.58.0-dev`. **No README / marketing HTML edits in this slice** — those land in Slice 17's system-wide doc sweep.

**Files**:
- `docs/manual/competitive-loop.html` — new.
- `docs/manual/inner-loop.html` — "Phase-26 additions" section + cross-link.
- `docs/manual/index.html` — nav entry for competitive-loop.html.
- `CHANGELOG.md` — v2.58.0 section.
- `VERSION` — `2.58.0-dev`.

**Depends on**: Slice 15

**Branch**: `master`

**Context files**:
- `.github/instructions/version.instructions.md`

**Traces to**: MUST (competitive-loop.html with Mermaid), SHOULD (inner-loop.html update, CHANGELOG, VERSION).

**Validation Gate**:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('docs/manual/competitive-loop.html','utf8');if(!h.includes('mermaid'))throw new Error('missing mermaid');if(!h.toLowerCase().includes('worktree'))throw new Error('missing worktree narrative');if(!h.toLowerCase().includes('winner'))throw new Error('missing winner narrative');const il=fs.readFileSync('docs/manual/inner-loop.html','utf8');if(!il.toLowerCase().includes('phase-26'))throw new Error('inner-loop.html missing Phase-26 section');if(!il.includes('competitive-loop.html'))throw new Error('inner-loop.html missing cross-link');const v=fs.readFileSync('VERSION','utf8').trim();if(!v.startsWith('2.58'))throw new Error('VERSION not bumped: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('2.58.0'))throw new Error('CHANGELOG missing 2.58.0');if(!c.toLowerCase().includes('competitive'))throw new Error('CHANGELOG missing competitive mention');console.log('ok');"
```

---

#### Slice 17: System-wide doc sweep — self-deterministic loop narrative + flow diagrams [sequential] {#slice-17}

**Goal**: Consolidate v2.57 + v2.58 into a single coherent narrative that positions Plan-Forge's full inner loop as an **advanced self-deterministic agent loop**. This is the authoritative, system-wide doc pass — it supersedes per-phase narrative fragments and must leave the manual, auto-discovery surfaces, and marketing pages internally consistent.

Deliverables:

1. **New manual page `docs/manual/self-deterministic-loop.html`** — the master narrative. Contains **two Mermaid diagrams**:
   - **Diagram A — System-wide state flow** (`stateDiagram-v2`): Plan → Preflight → Harden → Execute(slice loop) → Sweep → Review → Ship, with callback arrows from Execute back to Harden (reflexion), from Review back to Execute (advisory/blocking), from Sweep back to Execute (completeness gaps), and terminal states for Stop Conditions.
   - **Diagram B — Inner-loop callback graph** (`flowchart TD`): slice execution → trajectory write → postmortem → {auto-skill capture, gate-suggestion accrual, reviewer advisory, fix-proposal, cost-anomaly, federation read} with feedback arrows showing how each callback feeds the *next* slice's context, the *next* plan's hardener, or the *Dashboard promotion surface*. Every Phase-25 (L1–L8) and Phase-26 (C1–C7) subsystem must appear as a node.

2. **Manual cross-links** — `docs/manual/inner-loop.html`, `docs/manual/competitive-loop.html`, `docs/manual/index.html` all link to `self-deterministic-loop.html` as the canonical overview.

3. **Auto-discovery surface refresh** — re-verify consistency across `docs/capabilities.md`, `llms.txt`, `docs/llms.txt`, `pforge-mcp/tools.json`, `pforge-mcp/worker-capabilities.json`, `pforge-mcp/capabilities.mjs`. Every inner-loop subsystem must be described with the same name and one-line summary across all files. Add a new top-level section to `docs/capabilities.md` titled **"Self-Deterministic Agent Loop"** summarizing the L1–L8 + C1–C7 mesh with a link to the new manual page.

4. **Subtle marketing copy** — one sentence in `README.md`, `docs/index.html`, `docs/docs.html`, `docs/faq.html` acknowledging the self-deterministic loop. Must NOT add new top-level sections, hero banners, or pricing claims. Must NOT use superlatives like "revolutionary" or "world-class". Target tone: factual, understated, developer-respecting.

5. **FAQ entry** — add one entry to `docs/faq.html`: *"What do you mean by 'self-deterministic agent loop'?"* with a 3–4 sentence answer linking to the new manual page.

6. **Glossary entry** — if `docs/manual/glossary.html` exists, add an entry; if not, skip without failing.

**Files**:
- `docs/manual/self-deterministic-loop.html` — new master narrative with two Mermaid diagrams.
- `docs/manual/inner-loop.html` — add cross-link near top.
- `docs/manual/competitive-loop.html` — add cross-link near top.
- `docs/manual/index.html` — nav entry for self-deterministic-loop.html; positioned as the first inner-loop entry.
- `docs/capabilities.md` — new "Self-Deterministic Agent Loop" section.
- `llms.txt` — one-sentence update referencing the loop and pointing to the manual page.
- `docs/llms.txt` — matching update.
- `README.md` — one subtle sentence.
- `docs/index.html` — one subtle sentence (same or consistent with README).
- `docs/docs.html` — one subtle sentence + link to new manual page.
- `docs/faq.html` — new FAQ entry.
- `docs/manual/glossary.html` — conditional entry (skip if file absent).

**Depends on**: Slice 16

**Branch**: `master`

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`

**Traces to**: SHOULD (system-wide narrative, subtle marketing), plus reinforces all MUST items by ensuring discoverability.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/self-deterministic-loop.html';const h=fs.readFileSync(p,'utf8');if(!h.includes('mermaid'))throw new Error(p+': missing mermaid');if(!h.includes('stateDiagram-v2'))throw new Error(p+': missing stateDiagram-v2');if(!h.includes('flowchart'))throw new Error(p+': missing flowchart');const subsystems=['reflexion','trajector','auto-skill','postmortem','gate synth','reviewer','federation','competitive','auto-fix','cost anomal'];const low=h.toLowerCase();for(const s of subsystems){if(!low.includes(s))throw new Error(p+': missing subsystem mention: '+s);}const il=fs.readFileSync('docs/manual/inner-loop.html','utf8');if(!il.includes('self-deterministic-loop.html'))throw new Error('inner-loop.html missing cross-link to master page');const cl=fs.readFileSync('docs/manual/competitive-loop.html','utf8');if(!cl.includes('self-deterministic-loop.html'))throw new Error('competitive-loop.html missing cross-link');const idx=fs.readFileSync('docs/manual/index.html','utf8');if(!idx.includes('self-deterministic-loop.html'))throw new Error('manual index missing nav entry');const cap=fs.readFileSync('docs/capabilities.md','utf8');if(!cap.toLowerCase().includes('self-deterministic agent loop'))throw new Error('capabilities.md missing new section');const llms1=fs.readFileSync('llms.txt','utf8').toLowerCase();if(!llms1.includes('self-deterministic'))throw new Error('llms.txt not updated');const llms2=fs.readFileSync('docs/llms.txt','utf8').toLowerCase();if(!llms2.includes('self-deterministic'))throw new Error('docs/llms.txt not updated');for(const f of ['README.md','docs/index.html','docs/docs.html']){const x=fs.readFileSync(f,'utf8').toLowerCase();if(!x.includes('self-deterministic')&&!x.includes('inner loop'))throw new Error(f+': missing subtle loop mention');}const faq=fs.readFileSync('docs/faq.html','utf8').toLowerCase();if(!faq.includes('self-deterministic'))throw new Error('faq.html missing new entry');const banned=['revolutionary','world-class','world class','unparalleled','game-changer','game changer'];for(const b of banned){if(h.toLowerCase().includes(b))throw new Error(p+': banned superlative: '+b);const r=fs.readFileSync('README.md','utf8').toLowerCase();if(r.includes(b))throw new Error('README.md: banned superlative: '+b);}console.log('ok');"
```

---

### Final Merge Checkpoint (after Slice 17)

- Full vitest suite green: `bash -c "cd pforge-mcp && npx vitest run"`.
- `node pforge-mcp/server.mjs --validate` passes.
- Dashboard Inner Loop tab renders all six panels (manual browser spot-check).
- Welcome card shows on a simulated upgrade; preset writes on a simulated fresh install.
- `forge_capabilities` returns all nine inner-loop subsystems (Phase-25 seven + Phase-26 three).

---

## Re-anchor Checkpoints

- **After Slice 5** — full re-anchor; C1 competitive path exercised end-to-end; merge to master.
- **After Slice 8** — parallel merge checkpoint (Slices 6–8); lightweight re-anchor.
- **After Slice 11** — session break; all backend/logic C1–C7 landed.
- **After Slice 14** — Dashboard + preset complete; lightweight re-anchor.
- **After Slice 16** — lightweight re-anchor; feature-specific docs landed.
- **After Slice 17** — full re-anchor + Definition of Done review.

### Lightweight re-anchor (after each slice)
1. Does the slice's validation gate still pass?
2. Did the slice touch any file NOT listed in its `Files` section?
3. Is the scope contract still honored (no drift into Out-of-Scope or Forbidden Actions)?
4. Is any new TODO, FIXME, stub, or mock present?
5. **Opt-in check**: does any new behavior activate without an explicit `.forge.json` key or Dashboard toggle? If yes → stop, this violates the Phase-26 design posture.

---

## Definition of Done

- [ ] All 17 slices committed, each with a passing validation gate.
- [ ] Feature branch `feat/phase-26-competitive` merged to `master` at Slice 5 checkpoint.
- [ ] Full vitest suite green across all new test files.
- [ ] `node pforge-mcp/server.mjs --validate` passes.
- [ ] No TODO, FIXME, stub, or mock introduced outside `tests/`.
- [ ] Completeness sweep (Step 4) run and clean.
- [ ] Reviewer Gate (Step 5) passed with zero 🔴 Critical findings.
- [ ] **No new behavior activates by default for existing users** — verified by test: given a `.forge.json` carried over from v2.57, all new subsystems are off.
- [ ] **New installs get the best-defaults preset** — verified by test: given no `.forge.json`, post-setup config matches the preset spec.
- [ ] Dashboard "Inner Loop" tab renders with all six panels.
- [ ] Welcome card shows once on upgrade and dismisses correctly.
- [ ] `forge_capabilities` returns nine inner-loop subsystems (seven from Phase-25 + three from Phase-26).
- [ ] `docs/manual/competitive-loop.html` renders a Mermaid worktree-spawn → winner flow.
- [ ] `docs/manual/self-deterministic-loop.html` renders both Mermaid diagrams (state flow + callback graph) with all L1–L8 + C1–C7 subsystems as nodes.
- [ ] Auto-discovery surfaces (`capabilities.md`, `llms.txt`, `docs/llms.txt`, `tools.json`, `worker-capabilities.json`, `capabilities.mjs`) are internally consistent — same subsystem names, same one-line summaries.
- [ ] Marketing copy updates (README.md, docs/index.html, docs/docs.html, docs/faq.html) are **subtle** — no new top-level sections, no banned superlatives.
- [ ] CHANGELOG v2.58.0 entry present and references `docs/research/karpathy-autoresearcher-comparison.md`.
- [ ] VERSION bumped to `2.58.0-dev` at Slice 16; `2.58.0` at ship.

---

## Stop Conditions

- **Build failure** → `node pforge-mcp/server.mjs --validate` exits non-zero. Fix in-slice or abort.
- **Test failure** → any vitest suite fails. Fix in-slice or abort.
- **Scope violation** → any slice touches a file in Forbidden Actions or outside its declared `Files`. Stop, re-anchor, escalate.
- **Opt-in breach** → any new subsystem activates for existing users without `.forge.json` key or Dashboard toggle. Stop, abort slice, revert.
- **Security breach** → any new code path writes to a sibling repo in `brain.federation.repos[]`, auto-applies a fix-proposal in dry-run mode, or skips the Teardown Safety Guard for a non-worktree path. Stop, abort slice, revert.
- **Crucible / provenance break** → any edit to `pforge-mcp/crucible*.mjs` or to active-plan `crucibleId` frontmatter. Stop, abort.
- **Worktree leak** → any path under `.forge/worktrees/` persists beyond `archiveDays` without archival. Stop, investigate cleanup path.
- **Fix-proposal cap breach** → any incident triggers more than one auto-fix attempt. Stop, abort slice, revert; this is a critical safety invariant.
- **Session budget breach** → single slice exceeds 150 minutes or 3 retries. Pause, escalate.
- **Cost overshoot** → total plan cost exceeds 2× pre-run estimate. Pause, escalate.

---

## Session Break Points

| After | Reason | Resume command |
|---|---|---|
| Slice 5 | **Recommended** — C1 competitive core complete + merge; 3-session plan boundary | `--resume-from Slice-6` |
| Slice 8 | Optional mini-break — parallel group A complete | `--resume-from Slice-9` |
| Slice 11 | **Recommended** — all backend/logic C1–C7 landed; next session is UI-heavy | `--resume-from Slice-12` |
| Slice 17 | Phase complete → Step 4 Completeness Sweep in a new session | (new session, Step 4 prompt) |

---

## TBD Summary

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1–D17 | All (see Required Decisions table above) | ✅ Resolved | See table |

**All TBDs resolved.**

---

## Plan Quality Self-Check

1. ✅ Every Execution Slice has at least one validation gate with an exact command.
2. ✅ Every `[parallel-safe]` slice avoids touching files shared by other slices in its group (Non-overlap proofs on Slices 6, 7, 8; Slice 16 is solo in its group).
3. ✅ All Required Decisions resolved (no TBD remaining).
4. ✅ Definition of Done includes "Reviewer Gate passed (zero 🔴 Critical)".
5. ✅ Stop Conditions cover: build failure, test failure, scope violation, opt-in breach (new), security breach, provenance break, worktree leak (new), fix-proposal cap breach (new), session budget, cost overshoot.
6. ✅ Each slice lists only the instruction files relevant to its domain (≤3 per slice).
7. ✅ All MUST acceptance criteria are traceable to at least one slice's validation gate (Traces-to fields present).
8. ✅ All gate commands obey Gate Portability Rules (no `grep`, no `/dev/stdin`, no `/tmp/`, no pipes to grep, no `//` in `node -e`, no multi-line `node -e`, no `cat`, no pforge CLI, no vitest `--grep`).
9. ✅ **Opt-in invariant** encoded in Definition of Done and Stop Conditions (additional PF-specific check for this phase).

**Plan hardened ✅ — proceed to Step 3 (Execute Slices) after Phase-25 ships.**

---

## Links

- Research report: [../research/karpathy-autoresearcher-comparison.md](../research/karpathy-autoresearcher-comparison.md)
- Phase-25 plan: [./Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md](./Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md)
- Runbook: [./AI-Plan-Hardening-Runbook.md](./AI-Plan-Hardening-Runbook.md)
- Follow-on candidates (Phase-27+): multi-repo plan orchestration, skill marketplace UI, autonomous plan authorship guardrails, retroactive auto-fix on historical incidents
