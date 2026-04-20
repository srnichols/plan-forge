---
crucibleId: phase-25-inner-loop-a7b3c9e1-2d4f-4851-9e6a-8c3f1d2b4e5a
lane: full
source: human
---

# Phase-25 — Inner-Loop Enhancements (Reflexion / Voyager / Closed-Research)

> **Target release**: v2.57.0
> **Status**: Shipped — released as v2.57.0 on 2026-04-27 (see CHANGELOG).
> **Branch strategy**: `master` direct (small/medium slices, each ≤2h, commit-per-slice)
> **Source**: `docs/research/karpathy-autoresearcher-comparison.md` (April 2026)
> **Session budget**: 11 slices — **plan a session break after Slice 7** (commit, new session, `--resume-from Slice-8`)

---

## Specification Source

- **Research report**: `docs/research/karpathy-autoresearcher-comparison.md`
- **Paradigms referenced**: Karpathy's LLM-OS loop, Sakana AI Scientist, Reflexion, Voyager, STOP, Darwin Gödel Machine
- Full Step-0 specification is reproduced in the chat transcript that produced this plan. Acceptance criteria below are the authoritative execution contract.

---

## Feature Specification: Inner-Loop Enhancements

### Problem Statement
Plan-Forge leads external state-of-the-art on provenance, verifiability, and cost-awareness but lags on three in-loop capabilities: reflection from prior failures is logged but not injected into the next attempt (gap vs Reflexion), the skill library grows only via human authoring (gap vs Voyager), and hardening learnings never flow back to future plans (gap vs Sakana AI Scientist's closed research loop). This phase closes those gaps while preserving the human-in-the-loop safety posture.

### User Scenarios
1. **Retry learns from its own failure** — On attempt 2 of a failed slice, the orchestrator prepends a "previous attempt failed because X" block to the worker prompt.
2. **Successful actions become reusable skills** — After a slice passes all gates, its command sequence + context signature is captured as an auto-skill candidate, retrievable on future slices by domain keyword.
3. **A plan improves the next plan** — A per-run `plan-postmortem.json` becomes required context for the next plan's Step 2 hardening.
4. **Cheap reviewer catches regressions between slices** — An opt-in speed-quorum reviewer scores the slice diff before the next slice releases.
5. **Operator verbalizes intent for the next slice** — A one-paragraph trajectory note is written per slice and retrieved by later slices in the same plan.

---

## Scope Contract

### In-Scope
- Reflexion-style retry prompt injection (L1)
- Per-slice trajectory note write + retrieval (L8)
- Voyager-style auto-skill library (L2) with N-reuse promotion gate
- Reviewer-agent in-loop (L4) — opt-in via `.forge.json`
- Plan postmortem emission + feedback to next Step-2 hardener (L5)
- Adaptive gate synthesis from Tempering minima (L6) — suggest-only by default
- Cross-project memory federation (L7) — explicit-allowlist, read-only
- Capabilities/tool-discovery surface updates (`forge_capabilities`, `tools.json`, `worker-capabilities.json`, `docs/capabilities.md`, `llms.txt`)
- User manual update: new `inner-loop.html` page with a system-wide state-flow Mermaid diagram; `how-it-works.html` cross-reference
- Subtle marketing updates to `README.md` and `docs/index.html` describing the deterministic + reflective agent loop
- CHANGELOG + VERSION bump (v2.57.0)

### Out-of-Scope
- L3 **competitive quorum** (same-slice best-of-N on scratch branches) — deferred to Phase-26
- Auto-promotion of `skills-auto/*` to `.github/skills/*` without the N-reuse gate (stays opt-in)
- Any change to Crucible grammar, atomic-claim format, or manual-import audit contract
- Any mutation of a plan file during its own execution
- Federation fetching from non-allowlisted repos or over the network
- Changes to `ParallelScheduler`, `SequentialScheduler` selection, DAG builder, or Kahn sort

### Forbidden Actions
- `git push --force`, `git reset --hard origin/master`, branch deletion, or any teardown-style operation (Teardown Safety Guard applies)
- Editing `pforge-mcp/crucible*.mjs` (provenance contract is frozen for this phase)
- Editing `pforge-mcp/tempering.mjs` beyond exporting a read-only accessor for gate synthesis
- Adding a new external network dependency for federation (file-system read only)
- Bumping versions of any `pforge-sdk/package.json` or `pforge-mcp/package.json` dependencies
- Running `pforge run-plan` against this plan file on any branch other than `master` without explicit user approval

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1 | Reflexion block format: JSON or Markdown? | ✅ Resolved | Markdown fenced block labelled `## Previous attempt (N-1) summary` — prose is what workers consume well |
| D2 | Trajectory note length cap | ✅ Resolved | 500 words; exceeds truncate with marker `[truncated]` |
| D3 | Auto-skill promotion threshold | ✅ Resolved | N=3 successful reuses; configurable `runtime.autoSkill.promoteThreshold` |
| D4 | Auto-skill storage path | ✅ Resolved | `.forge/skills-auto/<sha256-prefix>.md` (12-char prefix) |
| D5 | Reviewer model default when enabled | ✅ Resolved | `speed` quorum preset (fast, low cost) |
| D6 | Reviewer scoring threshold to block | ✅ Resolved | Advisory-only in v2.57; `blockOnCritical: false` default. Blocking mode enters Phase-26 after calibration data exists |
| D7 | Postmortem retention | ✅ Resolved | Last 10 per plan basename; older aged-out |
| D8 | Gate synthesis modes | ✅ Resolved | `"off" \| "suggest" \| "enforce"`; default `"suggest"` |
| D9 | Federation allowlist format | ✅ Resolved | `brain.federation.repos: string[]` (absolute paths only; refuse relative or URL forms) |
| D10 | Diagram location | ✅ Resolved | New page `docs/manual/inner-loop.html`; `how-it-works.html` gains a cross-link + 2-sentence summary |

All TBDs resolved.

---

## Acceptance Criteria

- **MUST**: `executeSlice()` on retry attempt N≥2 prepends a Markdown block `## Previous attempt (N-1) summary` containing the last failure event's stderr tail (≤2KB), gate name, chosen model, and duration.
- **MUST**: After every slice that passes all gates, a trajectory note is written to `.forge/trajectories/<plan-basename>/slice-<id>.md` (≤500 words prose, written by the slice worker via a templated prompt suffix).
- **MUST**: After every slice that passes all gates, an auto-skill candidate is written to `.forge/skills-auto/<sha256-prefix>.md` with fields: `commands[]`, `contextSignature`, `summary`, `reuseCount: 0`, `createdAt`.
- **MUST**: Auto-skill candidates only promote to `.github/skills/auto-<name>/SKILL.md` after `reuseCount >= runtime.autoSkill.promoteThreshold` (default 3). Promotion requires human confirmation in the terminal output (non-interactive flag: `--auto-promote`).
- **MUST**: On plan completion (success OR stop-condition), `plan-postmortem.json` is written to `.forge/plans/<plan-basename>/postmortem-<timestamp>.json` with fields: `retriesPerSlice`, `gateFlaps`, `driftDelta`, `costDelta`, `topFailureReason`, `totalDurationMs`.
- **MUST**: `step2-harden-plan.prompt.md` gains a "Prior postmortems" section instructing the hardener to read the last 3 `plan-postmortem.json` files (if present) and surface their top failures in the hardener's required context.
- **MUST**: New `runtime.reviewer` config block in `.forge.json`: `{ enabled: false, quorumPreset: "speed", blockOnCritical: false }`.
- **MUST**: When `runtime.reviewer.enabled: true`, the `brain.gate-check` responder invokes the configured quorum preset on the slice diff and writes a review record to `.forge/reviews/<slice-id>.json`.
- **MUST**: New `runtime.gateSynthesis` config block: `{ mode: "suggest" | "off" | "enforce", domains: ["domain","integration","controller"] }`. Default `{ mode: "suggest", domains: [...] }`.
- **MUST**: New `brain.federation` config block: `{ repos: string[] }`; `brain.mjs` reads these paths on `cross.*` scope queries. Non-allowlisted paths rejected with explicit error.
- **MUST**: `forge_capabilities` output gains a top-level `innerLoop` key enumerating: `reflexion`, `trajectory`, `autoSkill`, `reviewer`, `postmortem`, `gateSynthesis`, `federation` — each with `enabled`, `configPath`, and `docs` fields.
- **MUST**: User manual gains `docs/manual/inner-loop.html` containing (a) a Mermaid state-flow diagram of the full inner loop and (b) narrative sections for each subsystem.
- **SHOULD**: `docs/manual/how-it-works.html` gains a "See also: Inner Loop" link and a 2-sentence summary.
- **SHOULD**: `README.md` and `docs/index.html` gain one subtle sentence each acknowledging the "deterministic + reflective agent loop" in the existing "how it works" area — no new top-level section.
- **SHOULD**: `tools.json` and `worker-capabilities.json` surface the new `runtime.*` and `brain.federation` keys for IDE auto-completion.
- **SHOULD**: `docs/capabilities.md` and `llms.txt` updated to list the inner-loop surface.
- **SHOULD**: CHANGELOG gains a v2.57.0 section referencing `docs/research/karpathy-autoresearcher-comparison.md`.
- **MAY**: Individual feature flags so each subsystem can be disabled independently via `.forge.json` (design supports it; implementation present where cheap).

**Traceability** — each MUST maps to at least one slice validation gate (see slice table below).

---

## Execution Slices

> Each slice is 30–120 min, commit-per-slice, gate must pass before proceeding.
> **Session break recommended after Slice 7.**

### Slice 1: Reflexion retry prompt injection [sequential] {#slice-1}

**Goal**: When `executeSlice` retries (attempt ≥ 2), prepend a "Previous attempt summary" Markdown block to the worker prompt.

**Files**:
- `pforge-mcp/orchestrator.mjs` — add `buildReflexionBlock()` near `buildMemoryCaptureBlock`; wire into retry path of `executeSlice()`.
- `pforge-mcp/memory.mjs` — export existing helpers if needed.
- `pforge-mcp/tests/reflexion.test.mjs` — new.

**Depends on**: none

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #1 (reflexion block).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/reflexion.test.mjs"
```

---

### Slice 2: Trajectory note write path [sequential] {#slice-2}

**Goal**: After any successful slice, request a ≤500-word trajectory note from the worker and persist to `.forge/trajectories/<plan>/slice-<id>.md`.

**Files**:
- `pforge-mcp/orchestrator.mjs` — post-slice success handler; trajectory prompt suffix.
- `pforge-mcp/memory.mjs` — `readTrajectory()` + `writeTrajectory()` exported.
- `pforge-mcp/tests/trajectory.test.mjs` — new.

**Depends on**: Slice 1 (shares the post-slice handler region; sequential avoids merge conflict).

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #2 (trajectory write).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/trajectory.test.mjs"
```

---

### Slice 3: Auto-skill library — extract, store, retrieve [sequential] {#slice-3}

**Goal**: On slice success, extract executed commands + context signature → write `.forge/skills-auto/<sha256-prefix>.md`. On future slices, retrieve by domain keyword via the existing 9-pattern matcher in `memory.mjs`. Track `reuseCount`.

**Files**:
- `pforge-mcp/memory.mjs` — add `extractAutoSkill()`, `retrieveAutoSkills()`, `incrementReuse()`.
- `pforge-mcp/orchestrator.mjs` — wire extract on success; wire retrieve into context assembly for the next slice.
- `pforge-mcp/tests/auto-skill.test.mjs` — new.

**Depends on**: Slice 2 (shares the post-slice handler).

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #3 (auto-skill write), MUST #4 (promotion gate).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/auto-skill.test.mjs"
```

---

### Re-anchor Checkpoint (after Slice 3)

Full re-anchor: verify Slices 1–3 together exercise the retry → trajectory → skill extraction chain end-to-end. Run the full vitest suite:

```bash
bash -c "cd pforge-mcp && npx vitest run"
```

---

### Slice 4: Adaptive gate synthesis from Tempering [parallel-safe, group A] {#slice-4}

**Goal**: Read `tempering.mjs` coverage/budget minima; if a slice lacks a gate for a domain-matched Tempering profile, append a *suggested* gate (default `mode: "suggest"`). Surface as stdout advisory.

**Files**:
- `pforge-mcp/tempering.mjs` — add `getMinimaForDomain()` read-only export (no logic change).
- `pforge-mcp/orchestrator.mjs` — new `synthesizeGateSuggestions()` pure function; called during plan lint pre-flight; output printed, not injected.
- `pforge-mcp/tests/gate-synthesis.test.mjs` — new.

**Depends on**: none (independent subsystem).

**Parallel group**: A (with Slices 5, 6).
**Non-overlap proof**: touches `tempering.mjs` exports + a new function in `orchestrator.mjs`; Slices 5 and 6 touch different files.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #9 (gateSynthesis config).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/gate-synthesis.test.mjs"
```

---

### Slice 5: Plan postmortem emission + hardener feedback [parallel-safe, group A] {#slice-5}

**Goal**: On plan completion write `plan-postmortem.json`. Update `step2-harden-plan.prompt.md` to require reading the last 3 postmortems.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `writePlanPostmortem()` at run completion (success and stop-condition paths).
- `.github/prompts/step2-harden-plan.prompt.md` — prepend "Prior postmortems" context section.
- `pforge-mcp/tests/postmortem.test.mjs` — new.

**Depends on**: none.

**Parallel group**: A.
**Non-overlap proof**: orchestrator edits are in the `runPlan` completion block (different region from Slice 4's pre-flight); prompt file is disjoint.

**Context files**:
- `.github/instructions/ai-plan-hardening-runbook.instructions.md`
- `.github/instructions/architecture-principles.instructions.md`

**Traces to**: MUST #5 (postmortem write), MUST #6 (hardener feedback).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/postmortem.test.mjs"
```

---

### Slice 6: Cross-project memory federation (`cross.*` scope) [parallel-safe, group A] {#slice-6}

**Goal**: Extend `brain.mjs` with a federation reader. On `cross.*` keys, query the repo list in `.forge.json → brain.federation.repos[]` (absolute paths only, read-only).

**Files**:
- `pforge-mcp/brain.mjs` — new `federationRead()` function; integrate into `cross.*` routing.
- `pforge-mcp/tests/federation.test.mjs` — new; use a tmpdir fixture repo.
- `.forge.json` example snippet in the test.

**Depends on**: none.

**Parallel group**: A.
**Non-overlap proof**: only touches `brain.mjs` (new function); tests in a new file.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #10 (federation config + allowlist enforcement).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/federation.test.mjs"
```

---

### Parallel Merge Checkpoint (after Slices 4, 5, 6)

- Confirm no merge conflicts between orchestrator edits in Slices 4 and 5.
- Run full vitest suite: `bash -c "cd pforge-mcp && npx vitest run"`.
- Confirm `node pforge-mcp/server.mjs --validate` passes.

---

### Slice 7: Reviewer-agent in-loop (gate-check extension) [sequential] {#slice-7}

**Goal**: Extend the existing `brain.gate-check` responder to optionally invoke a speed-quorum reviewer on the slice diff when `runtime.reviewer.enabled: true`. Advisory-only in v2.57 (`blockOnCritical: false` default).

**Files**:
- `pforge-mcp/orchestrator.mjs` — gate-check responder extension.
- `pforge-mcp/brain.mjs` — reviewer invocation helper.
- `pforge-mcp/tests/reviewer.test.mjs` — new (mock quorum worker).

**Depends on**: Slice 1 (reflexion context available), Slice 3 (auto-skill context).

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #7, MUST #8 (reviewer config + invocation).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/reviewer.test.mjs"
```

---

## 🛑 SESSION BREAK RECOMMENDED HERE

Commit slices 1–7, close session. Open a new session, resume with:
```bash
pforge run-plan --resume-from Slice-8 docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md
```

---

### Slice 8: Capabilities & tool-discovery surface updates [sequential] {#slice-8}

**Goal**: Surface the new `innerLoop` subsystems in `forge_capabilities`, `tools.json`, and `worker-capabilities.json` so IDEs and MCP consumers auto-discover them.

**Files**:
- `pforge-mcp/capabilities.mjs` — add `innerLoop` section.
- `pforge-mcp/tools.json` — add config keys.
- `pforge-mcp/worker-capabilities.json` — add flags.
- `pforge-mcp/tests/capabilities.test.mjs` — extend existing tests.

**Depends on**: Slices 1–7 (surfaces existing features).

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST #11 (forge_capabilities), SHOULD (tools.json, worker-capabilities.json).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/capabilities.test.mjs"
```

---

### Slice 9: User manual — new `inner-loop.html` with state-flow diagram [parallel-safe, group B] {#slice-9}

**Goal**: Create `docs/manual/inner-loop.html` with a Mermaid state-flow diagram covering the full inner loop: plan → slice → retry (reflexion) → trajectory → skill extraction → reviewer → gate-check → next slice → postmortem. Cross-link from `how-it-works.html`.

**Files**:
- `docs/manual/inner-loop.html` — new.
- `docs/manual/how-it-works.html` — add "See also: Inner Loop" cross-link + 2-sentence summary.
- `docs/manual/index.html` — add nav entry.

**Depends on**: Slice 8 (capability surface referenced in docs).

**Parallel group**: B (with Slices 10, 11).
**Non-overlap proof**: only touches `docs/manual/*.html`.

**Context files**: none required (docs-only; follow existing manual style).

**Traces to**: MUST #12, SHOULD (how-it-works cross-link).

**Validation Gate**:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('docs/manual/inner-loop.html','utf8');if(!h.includes('mermaid'))throw new Error('missing mermaid block');if(!h.toLowerCase().includes('reflexion'))throw new Error('missing reflexion narrative');if(!h.toLowerCase().includes('trajectory'))throw new Error('missing trajectory narrative');if(!h.toLowerCase().includes('postmortem'))throw new Error('missing postmortem narrative');const x=fs.readFileSync('docs/manual/how-it-works.html','utf8');if(!x.includes('inner-loop.html'))throw new Error('how-it-works missing cross-link');console.log('ok');"
```

---

### Slice 10: README + docs/index.html subtle marketing updates [parallel-safe, group B] {#slice-10}

**Goal**: One-sentence subtle additions to the existing "how it works" area of `README.md` and `docs/index.html` acknowledging the "deterministic + reflective agent loop." No new top-level sections.

**Files**:
- `README.md`
- `docs/index.html`

**Depends on**: none (can run in parallel with Slice 9).

**Parallel group**: B.
**Non-overlap proof**: disjoint from Slices 9 and 11.

**Context files**: none.

**Traces to**: SHOULD (README, index.html).

**Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['README.md','docs/index.html']){const c=fs.readFileSync(f,'utf8').toLowerCase();if(!c.includes('reflective')&&!c.includes('reflexion')&&!c.includes('inner loop')&&!c.includes('inner-loop'))throw new Error(f+': missing subtle reflective-loop mention');}console.log('ok');"
```

---

### Slice 11: CHANGELOG + VERSION + capabilities.md + llms.txt [parallel-safe, group B] {#slice-11}

**Goal**: CHANGELOG v2.57.0 section, VERSION bump to `2.57.0-dev`, `docs/capabilities.md` update, `llms.txt` update.

**Files**:
- `CHANGELOG.md`
- `VERSION`
- `docs/capabilities.md`
- `llms.txt`

**Depends on**: none (docs-only).

**Parallel group**: B.
**Non-overlap proof**: disjoint from Slices 9 and 10.

**Context files**:
- `.github/instructions/version.instructions.md`

**Traces to**: SHOULD (capabilities.md, llms.txt, CHANGELOG).

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(!v.startsWith('2.57'))throw new Error('VERSION not bumped: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('2.57.0'))throw new Error('CHANGELOG missing 2.57.0 section');if(!c.toLowerCase().includes('inner loop')&&!c.toLowerCase().includes('reflexion'))throw new Error('CHANGELOG missing inner-loop notes');const caps=fs.readFileSync('docs/capabilities.md','utf8').toLowerCase();if(!caps.includes('inner loop')&&!caps.includes('reflexion'))throw new Error('capabilities.md missing inner-loop entry');console.log('ok');"
```

---

### Parallel Merge Checkpoint (after Slices 9, 10, 11)

- Browser-verify `docs/manual/inner-loop.html` renders (manual spot-check OK).
- Run full vitest: `bash -c "cd pforge-mcp && npx vitest run"`.
- Run `node pforge-mcp/server.mjs --validate`.
- `git status` should show only files listed across Slices 1–11.

---

## Re-anchor Checkpoints

- **After Slice 3** — full re-anchor (retry → trajectory → skill chain).
- **After Slice 6** — parallel merge checkpoint + lightweight re-anchor.
- **After Slice 7** — session break.
- **After Slice 11** — full re-anchor + Definition of Done review.

### Lightweight re-anchor (after each slice)
1. Does the slice's validation gate still pass?
2. Did the slice touch any file NOT listed in its `Files` section? (If yes → stop.)
3. Is the scope contract still honored? (No drift into Out-of-Scope or Forbidden items.)
4. Is any new TODO, FIXME, stub, or mock present? (If yes → fix in this slice or Slice 11.)

---

## Definition of Done

- [ ] All 11 slices committed, each with a passing validation gate.
- [ ] Full vitest suite green: `bash -c "cd pforge-mcp && npx vitest run"`.
- [ ] `node pforge-mcp/server.mjs --validate` passes.
- [ ] No TODO, FIXME, stub, or mock introduced outside `tests/`.
- [ ] Completeness sweep (Step 4) run and clean.
- [ ] Reviewer Gate (Step 5) passed with zero 🔴 Critical findings.
- [ ] `forge_capabilities` returns a populated `innerLoop` section.
- [ ] `docs/manual/inner-loop.html` renders a Mermaid state-flow diagram covering all 7 subsystems (reflexion, trajectory, autoSkill, reviewer, postmortem, gateSynthesis, federation).
- [ ] CHANGELOG v2.57.0 entry present and references `docs/research/karpathy-autoresearcher-comparison.md`.
- [ ] VERSION bumped to `2.57.0-dev` at slice 11, `2.57.0` at ship.
- [ ] Phase-26 stub added to CHANGELOG's "Upcoming" section for the deferred L3 competitive-quorum work.

---

## Stop Conditions

- **Build failure** → `node pforge-mcp/server.mjs --validate` exits non-zero on any slice. Fix in-slice or abort.
- **Test failure** → any vitest suite fails. Fix in-slice or abort.
- **Scope violation** → any slice touches a file in Forbidden Actions or outside its declared `Files`. Stop, re-anchor, escalate.
- **Security breach** → any new code path reads files outside the repo root or outside `brain.federation.repos[]` allowlist. Stop, abort slice, revert.
- **Crucible / provenance break** → any edit to `pforge-mcp/crucible*.mjs` or to the `crucibleId` frontmatter of an active plan. Stop, abort.
- **Teardown safety breach** → this plan declares no teardown slices. If one is added mid-execution, Teardown Safety Guard applies automatically.
- **Session budget breach** → if a single slice exceeds 150 minutes or 3 retries, pause and escalate.
- **Cost overshoot** → if total plan cost exceeds 2× the pre-run estimate, pause and escalate.

---

## Session Break Points

| After | Reason | Resume command |
|---|---|---|
| Slice 3 | Core reflexion/trajectory/skill chain complete — natural checkpoint | `--resume-from Slice-4` |
| Slice 7 | **Recommended** session break (11 slices > 8 threshold, context fuel degraded) | `--resume-from Slice-8` |
| Slice 11 | Phase complete → Step 4 Completeness Sweep in a new session | (new session, Step 4 prompt) |

---

## TBD Summary

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1–D10 | All (see Required Decisions table above) | ✅ Resolved | See table |

**All TBDs resolved.**

---

## Plan Quality Self-Check

1. ✅ Every Execution Slice has at least one validation gate with an exact command.
2. ✅ Every `[parallel-safe]` slice avoids touching files shared by other slices in its group (see Non-overlap proofs).
3. ✅ All Required Decisions resolved (no TBD remaining).
4. ✅ Definition of Done includes "Reviewer Gate passed (zero 🔴 Critical)".
5. ✅ Stop Conditions cover: build failure, test failure, scope violation, security breach, provenance break, teardown safety, session budget, cost overshoot.
6. ✅ Each slice lists only the instruction files relevant to its domain (≤3 per slice).
7. ✅ All MUST acceptance criteria are traceable to at least one slice's validation gate (Traces to fields present).
8. ✅ All gate commands obey Gate Portability Rules (no `grep`, no `/dev/stdin`, no `/tmp/`, no pipes to grep, no `//` in `node -e`, no multi-line `node -e`, no `cat`, no pforge CLI).

**Plan hardened ✅ — proceed to Step 3 (Execute Slices) in a new session.**

---

## Links

- Research report: [../research/karpathy-autoresearcher-comparison.md](../research/karpathy-autoresearcher-comparison.md)
- Runbook: [./AI-Plan-Hardening-Runbook.md](./AI-Plan-Hardening-Runbook.md)
- Runbook usage: [./AI-Plan-Hardening-Runbook-Instructions.md](./AI-Plan-Hardening-Runbook-Instructions.md)
- Next-phase stub: Phase-26 Competitive Quorum (L3 from the research report) — to be spec'd separately.
