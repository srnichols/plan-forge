---
lane: full
source: human
status: outline
created: 2026-04-22
author: Claude Opus 4.7 (in-session seed following Scott Nichols' philosophy)
---

# Phase-32 — Forge-Master Advisory Mode

> **Target release**: v2.66.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: v2.65.1 shipped (Phase-31.1 completion).
> **Addresses**: Three observed defects in Forge-Master Studio:
>   1. Prompt-chip click does not populate the composer (broken inline-onclick HTML injection)
>   2. Domain glossary rejects legitimate Plan Forge vocabulary like "Slice" → offtopic
>   3. No principles-grounded advisory lane — Forge-Master cannot serve as CTO-in-a-box for either Scott or other AI agents

## Core Problem

Forge-Master Studio today is **literal and brittle**:

- The dashboard gallery emits `onclick="forgeMasterPickPrompt(${JSON.stringify(p.id)})"` inside a double-quoted HTML attribute, producing broken HTML. The click fires but the composer never receives the template.
- The intent router's `KEYWORD_RULES` in [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs) only recognises "slice" when followed by `passed|failed|done|complete`. Ordinary questions like "what's the status of slice 4" fall through to the router-model, which has no Plan Forge vocabulary and lands on `offtopic`.
- The system prompt at [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md) embeds hardcoded Plan Forge commitments (Anti-Lovable, Crucible-Funneling, No Hand-Math) but has no loader for the user's own principles — `PROJECT-PRINCIPLES.md`, the principles block in `copilot-instructions.md`, or a new `.forge.json#forgeMaster.philosophy` key. Without principles, Forge-Master cannot answer "should we...?" or "what's the right path?" questions grounded in Scott's philosophy.
- The `forge_master_ask` MCP tool advertises itself as a multi-step reasoning helper but doesn't advertise the **CTO-in-a-box advisory contract** for agent-to-agent consultation.

The fix is one coherent phase, not three separate hotfixes. All three defects share a root: Forge-Master is wired as a narrow operational bot, not a principled advisor.

## Candidate Slices

### Slice 1 — Event-delegated prompt gallery

**Scope**: [pforge-mcp/dashboard/forge-master.js](pforge-mcp/dashboard/forge-master.js), [pforge-mcp/dashboard/index.html](pforge-mcp/dashboard/index.html) (if needed), vitest suite at `pforge-mcp/tests/forge-master-gallery.test.mjs` (new).

- Remove inline `onclick="forgeMasterPickPrompt(...)"` HTML injection entirely. Render each prompt as `<button data-prompt-id="...">` with no inline handler.
- Attach a single delegated `click` listener on `#fm-gallery-list` that resolves the target via `event.target.closest('[data-prompt-id]')` and invokes `forgeMasterPickPrompt` with the attribute value.
- Add DOM-based vitest that seeds the catalog, dispatches a `MouseEvent`, and asserts `#fm-composer.value` equals the prompt template and that `#fm-composer` has focus.
- Remove the "Phase-30.1 — window.forgeMaster* assignments moved to the top" workaround hack at the top of `forge-master.js` — it exists only because inline handlers were fragile. With event delegation, the module-scope globals no longer need hoisting.

**Why architecture-first**: this kills the "wire globals before init throws" hack. One concern per layer — rendering does not wire behaviour. Behaviour is attached once at init time.

### Slice 2 — Expand the Plan Forge glossary

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md) (redirect text), test coverage at `pforge-mcp/tests/forge-master.test.mjs`.

Add keyword rules for Plan Forge domain terms the router currently misses:

| Term family | Keywords | Lane |
|---|---|---|
| Slices (bare) | `slice`, `slices`, `current slice`, `slice \d+` | operational |
| Hardening | `harden`, `hardened`, `hardening`, `harden the plan` | operational |
| Gates | `validation gate`, `gate`, `gates`, `gate passed`, `gate failed` | operational (or troubleshoot if failed) |
| Execution | `run`, `ran`, `running`, `execution`, `executed`, `resume`, `resume-from` | operational |
| Tempering | `tempering`, `baseline`, `drift`, `advisory`, `enforcement`, `suppressed` | operational |
| Quorum | `quorum`, `quorum mode`, `reflexion`, `retry`, `attempt`, `escalation` | operational |
| Meta-bugs | `meta-bug`, `self-repair`, `plan-defect`, `orchestrator-defect`, `prompt-defect` | troubleshoot |
| Crucible | `smelt`, `smelts`, `interview`, `preview`, `finalize` | build |
| Phase refs | `phase-\d+`, `phase \d+`, `phase \d+\.\d+` | operational |

Rewrite `OFFTOPIC_REDIRECT` to list the accepted topic lanes with 2 example questions each, so users (including Scott) who accidentally land offtopic see the domain shape rather than a flat rejection.

**Why architecture-first**: the glossary is data. Every new term ships with a matching unit test. The redirect becomes a teaching moment, not a wall.

### Slice 3 — Advisory lane + principles loader

**Scope**: [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs), new file [pforge-master/src/principles.mjs](pforge-master/src/principles.mjs), [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), [pforge-master/src/system-prompt.md](pforge-master/src/system-prompt.md), `.forge.json` schema validation.

Three separable concerns, three separable modules:

1. **New `advisory` lane** in `intent-router.mjs`. Keyword rules: "should I", "should we", "what's the right approach", "architecture advice", "help me decide", "best path", "ship vs refactor", "do it right", "no shortcuts", "CTO", "architect this", "philosophy says", "your principles say", "what would you do", "recommend". Lane tools stay read-only: `forge_search`, `forge_timeline`, `brain_recall`, `forge_capabilities`, `forge_hotspot`, `forge_drift_report`.

2. **New `principles.mjs` loader**. Reads, in order:
   - `docs/plans/PROJECT-PRINCIPLES.md` (if present)
   - The principles block of `.github/copilot-instructions.md` (section between `## Architecture Principles` and the next `##` heading)
   - `.forge.json#forgeMaster.philosophy` (new config key — free-form string; the user's own voice)
   - Concatenates with headers; caches per-cwd; exports `loadPrinciples({ cwd })` returning `{ block: string, sources: string[] }`.
   - If no source exists, returns the universal architecture-first baseline (the same 5-question framework from [architecture-principles.instructions.md](.github/instructions/architecture-principles.instructions.md)).

3. **System prompt integration**. Add a new `{principles_block}` placeholder to [system-prompt.md](pforge-master/src/system-prompt.md) above `{context_block}`. The loader in `reasoning.mjs` populates it. Principles are **non-negotiable** — they never truncate under token pressure. If the total system prompt exceeds budget, `{context_block}` is trimmed first, `{principles_block}` last.

**Why architecture-first**: three separable concerns, three separable modules. Each testable in isolation. Principles loading is pure I/O + string concat. Lane addition is one keyword rule table entry. System prompt assembly is a template function. No module knows about the others' internals.

### Slice 4 — CTO-in-a-box advisory contract for agents

**Scope**: [pforge-mcp/capabilities.mjs](pforge-mcp/capabilities.mjs) (`forge_master_ask` entry), [pforge-mcp/tools.json](pforge-mcp/tools.json), integration test at `pforge-mcp/tests/forge-master.advisory.test.mjs` (new).

- Extend the `agentGuidance` string in the `forge_master_ask` TOOL_METADATA entry to advertise the advisory contract: **"Other agents can call `forge_master_ask` as a CTO-in-a-box advisor. Forge-Master reads the project's `PROJECT-PRINCIPLES.md` and the user's declared philosophy, then answers 'should I...?' / 'what's the right path?' / 'architecture-first or ship?' questions grounded in those commitments. Use it when you need a principles-grounded recommendation, not a code answer. Advisory calls are read-only and cost low-medium tokens."**
- Add `"advisory"` to the `intent` array in the tool metadata.
- Add matching entry in `tools.json` (if the shape differs).
- Integration test: mock provider, message "Should I refactor this controller or ship the feature?", assert (a) classification lane = `advisory`, (b) the system prompt sent to the mock provider contains the principles block verbatim, (c) the reply is produced.

**Why architecture-first**: this is a contract change. Contracts get schema tests. Agent discoverability is not a side-effect — it's the deliverable.

### Slice 5 — Ship v2.66.0

**Scope**: `CHANGELOG.md`, `ROADMAP.md`, `VERSION`, `pforge-mcp/package.json`, `docs/index.html`, `README.md`, git tag, GitHub release.

Dogfood the v2.65.1 rebuilt `pforge version-bump --strict` to ship v2.66.0. If `version-bump --strict` doesn't produce `Updated 5/5 targets, 0 failures`, the phase is not done — that's the field test of Phase-31.1.

---

## The Philosophy Block (embedded as `{principles_block}`)

Consolidated from Scott's written positions in the A/B test post, the guardrails-lessons post, and the 80/20 wall post. This is the default advisory prompt — users can override via `.forge.json#forgeMaster.philosophy`.

> **Architecture-First, Always.** Unless under explicit pressure from a real client deadline, do it right the first time. No shortcuts. Guardrails don't slow you down — rework slows you down. The first pass should be the right pass.
>
> **Vibe Coding Is a Trap.** Prompting with intent and hoping for the best works for prototypes and falls apart for anything maintainable. Structure isn't overhead; it's how you avoid the 80/20 wall. A 99/100 app and a 44/100 app can ship in the same 7 minutes — the difference is whether the agent had constraints.
>
> **Define What Shouldn't Be Built.** The most powerful guardrail isn't "do this," it's "don't do that." Every recommendation should include explicit Forbidden Actions, not just aspirations. Scope drift is prevented by the boundary, not the wish.
>
> **The Builder Must Never Review Its Own Work.** Fresh sessions for review. Fresh eyes for audit. Sunk-cost bias is structural, not personal — it lives in the token sequence. If you wrote it, you cannot see its blind spots.
>
> **Slice Boundaries Are Non-Negotiable.** Every substantial change decomposes into 3-7 slices with build + test gates. Failures are caught when they're small. Green-to-green progression means a safe rollback point always exists.
>
> **Enterprise Quality Is the Default, Not an Upgrade.** Every deliverable ships with tests, proper error handling, input validation, and architectural compliance from the first commit. "Add tests later" is how codebases rot. There is no opt-in to quality.
>
> **Evidence Over Assumption.** When asked whether something is done, don't say "it seems right." Paste the test output. Show the commit. Prove coverage didn't drop. Gates produce evidence; assertions produce bugs.
>
> **When in Doubt, Say the Architectural Answer.** If asked "should I take the shortcut?" — the answer is no, unless the user has explicitly invoked client pressure. If asked "is this good enough?" — the answer is the quality bar, not the expediency bar. The advisor's job is to tell the truth about the path, not to be agreeable.
>
> **Work Triage Order — Hotfix, Operational, Strategic.** Rank work in this order, always. Invert only with an explicit, stated reason.
>
> 1. **Hotfixes / patches** — production is bleeding. Real users, real pain, right now. Security incidents live here too. Everything else waits. Ship the minimum surgical fix, then come back and do it architecturally right in the next cycle.
> 2. **Operational** — the system is running but something is off. Flaky tests, slow queries, noisy logs, drift creeping in, toil accumulating. Operational debt compounds faster than feature debt — pay it down before it becomes a hotfix tomorrow.
> 3. **Strategic** — net-new features, architecture moves, platform bets. This is where the leverage is, but only *after* the first two are quiet. A strategic move on top of a smouldering operational fire is a vibe-coding move in a suit.
>
> **The inversion trap**: when strategic work feels more exciting than operational work, agents (human or AI) start reaching up the stack. Don't. The excitement gap is a signal that operational hygiene is being neglected, not that strategy is more valuable. When unsure which tier a task belongs to: ask "what breaks if I don't do this today?" Production → hotfix. Toil → operational. Nothing visible → strategic.

---

## Required Decisions (to resolve at hardening)

1. **Slice 1 test strategy** — jsdom vitest, or real browser via playwright? Recommended: jsdom (lighter, faster, already in the vitest config's ambient environment).
2. **`principles.mjs` caching** — per-cwd in-memory (simple) or filesystem mtime check (robust)? Recommended: per-cwd in-memory with mtime check on first miss per session.
3. **Override semantics for `.forge.json#forgeMaster.philosophy`** — does the user-declared philosophy **replace** or **append to** the file-based principles? Recommended: **replace** if non-empty string, **append** if starts with `"+ "` marker. Predictable and documentable.
4. **Advisory lane default tool allowlist** — read-only only? (Recommended yes; no advisory call should be able to mutate state, even under heavy reasoning.)
5. **Fallback principles** — when no `PROJECT-PRINCIPLES.md`, no copilot-instructions block, no `.forge.json` override, Forge-Master should still give principled advice. Recommended: fall back to the universal architecture-first baseline (the 5-question framework) verbatim from `architecture-principles.instructions.md`.

---

## Forbidden Actions

- ❌ No changes to `build`, `operational`, or `troubleshoot` lane tool lists (those are stable)
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — advisory only for now
- ❌ No "principles-violation detector" — separate phase if desired (Phase-33+)
- ❌ No new write tool in the advisory lane — advisory is inherently read-only
- ❌ No changes to `step0-specify-feature.prompt.md` through `step5-review-gate.prompt.md` — the pipeline is orthogonal to Forge-Master
- ❌ No Crucible interview integration with advisory lane — Crucible is for "what to build", advisory is for "how to decide"
- ❌ No modification of `.forge.json` schema for users automatically — the new `forgeMaster.philosophy` key is opt-in

---

## Success Signals

- User can ask "should I refactor this controller or ship it?" in the Forge-Master Studio and get a principled answer that cites the philosophy block and the architecture-first commitment.
- Prompt chips in the gallery populate the composer on click (happy-path click works reliably in jsdom test and the live dashboard).
- Questions using Plan Forge domain vocabulary like "status of slice 4", "harden Phase-33", "did tempering fire on this slice" no longer fall through to offtopic.
- Another AI agent, reading `forge_capabilities`, discovers `forge_master_ask` as an advisory surface for CTO-style consultation and starts using it in multi-agent quorum flows.

---

## Anti-Pattern Guards

- **Don't** let principles-loading become a `.forge.json` migration — keep it backward-compatible. Missing keys fall back gracefully.
- **Don't** inject principles into every system prompt across Plan Forge — this phase is scoped to Forge-Master only. Pipeline prompts have their own principles surface via instruction files.
- **Don't** widen the advisory lane to cover operational questions — "what's my cost?" is operational, not advisory. Overlap is fine (ambiguous classifications); absorption is not.
- **Don't** rewrite `forge-master.js` as a TypeScript module or refactor its state shape — Slice 1 is a surgical fix to the gallery rendering, not a rewrite.
