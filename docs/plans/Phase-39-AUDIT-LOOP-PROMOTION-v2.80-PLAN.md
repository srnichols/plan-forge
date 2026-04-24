---
crucibleId: grandfathered-phase-39-audit-loop-promotion
lane: full
source: human
---

# Phase-39 — Audit Loop Promotion (v2.80.0)

> **Target release**: v2.80.0
> **Status**: Draft — ready for Step-2 hardening
> **Depends on**: v2.79.0 (Phase-38.8) landed on master
> **Branch strategy**: Direct to `master`. Additive — no breaking changes to existing tempering surface.
> **Session budget**: 9 slices in **1 session**. ~135 min, budget ≤ $17.
> **Design posture**: Promote a field-tested pattern (proposal 0001) into a first-class Plan-Forge primitive by **extending** `tempering/` rather than forking it. Two new tools, one new agent, one new scanner, one thin skill wrapper, plus a quorum-style activation surface (default `off`). Zero duplication of existing crawler/classifier/bug-registry code.

---

## Specification Source

- **Proposal**: [0001-recursive-audit-loop.md](../../0001-recursive-audit-loop.md) — Rummag field evidence (88 → 0 findings in 4 rounds, Apr 2026).
- **Public narrative already shipped**: [docs/blog/the-loop-that-never-ends.html](../blog/the-loop-that-never-ends.html) — published case study describing the three-lane triage and `.forge/audits/dev-<ts>.json` convention.
- **Related existing primitives**:
  - [pforge-mcp/tempering/runner.mjs](../../pforge-mcp/tempering/runner.mjs) — single-shot tempering run
  - [pforge-mcp/tempering/bug-classifier.mjs](../../pforge-mcp/tempering/bug-classifier.mjs) — existing classifier (no review gate today)
  - [pforge-mcp/tempering/bug-registry.mjs](../../pforge-mcp/tempering/bug-registry.mjs) — `forge_bug_register` target
  - [pforge-mcp/tempering/scanners/ui-playwright.mjs](../../pforge-mcp/tempering/scanners/ui-playwright.mjs) — BFS crawler we extend
  - [pforge-mcp/crucible-server.mjs](../../pforge-mcp/crucible-server.mjs) — `forge_crucible_submit` target

---

## Feature Specification

### Problem Statement

Plan-Forge's pipeline today turns **stated intent** into shipped code, but has no mechanism for **intent discovery** from the running system. Real products accumulate bugs, feature gaps, and regressions that pass unit tests but fail at the HTTP/HTML edge. Without a discovery lane, the hand-off after `shipper` is "wait for a user to file a ticket."

Proposal 0001 documents a loop that closes this gap (discovery → triage → three lanes → drain-until-converged). It's been validated once in the wild (Rummag) and publicly documented in the blog. This phase promotes it from a hand-rolled per-repo pattern to a core Plan-Forge primitive — without duplicating the 60% of plumbing that already exists in `tempering/`.

### What changes (additive only)

| # | Surface | Addition | Why |
|---|---|---|---|
| 1 | `pforge-mcp/tempering/scanners/content-audit.mjs` (new) | HTTP-probe + HTML-inspection scanner. Routes from existing BFS crawler + optional seed file. Emits findings keyed by failure class. | Blog's Rummag-style content audit, ported once as a reference scanner. |
| 2 | `pforge-mcp/tempering/drain.mjs` (new) | `runTemperingDrain({ project, maxRounds = 5, convergenceRule })` wraps `runTemperingRun` in a round loop. Writes per-round deltas to `.forge/tempering/drain-history.jsonl`. Terminates on `realFindingCount === 0 && patternCount === 0` or `maxRounds`. | Drain-until-converged is the novel contract. Max-rounds prevents infinite tuning. |
| 3 | `pforge-mcp/tempering/triage.mjs` (new) | `routeFinding(finding, classifier)` → `{ lane: "bug" \| "spec" \| "classifier", payload }`. "classifier" lane emits a PR proposal artifact instead of registering a bug. | Three-lane triage with the noise lane. This is the piece that makes the loop converge. |
| 4 | `pforge-mcp/server.mjs` | Two new MCP tools: `forge_tempering_drain` (wraps #2) and `forge_triage_route` (wraps #3). Added to `tools.json`. | Public MCP surface matching blog narrative. |
| 5 | `.github/agents/audit-classifier-reviewer.agent.md` (new) | Read-only reviewer agent. Enforces: before/after counts on classifier PRs, no same-commit masking of product fixes. | Guardrail 5 from proposal. Mirrors existing reviewer-gate pattern. |
| 6 | `presets/shared/skills/audit-loop/SKILL.md` (new) | ~40-line wrapper: call `forge_tempering_drain` → iterate findings → `forge_triage_route` each → summarize drain curve. | Thin skill, not a new subsystem. |
| 7 | `.forge/audits/` convention | Per-run audit artifact written as `.forge/audits/dev-<ts>.json`. Blog-compatible shape. Drain history cross-references via `auditRunId`. | Honors the on-disk contract already documented publicly. |
| 8 | `.forge.json#audit` + CLI `pforge audit-loop` + dashboard toggle | Quorum-style activation surface: `mode: "off" \| "auto" \| "always"` (default `off`). Threshold evaluator fires auto-mode only when change-surface signals trip. Emits `drain-auto-estimate` event before dispatch. | Matches `--quorum=auto` pattern. Zero surprise cost; explicit opt-in graduation path. |

### Explicitly out of scope

- **No new `forge_audit_*` tool namespace.** Proposal suggested five. Folded into `forge_tempering_drain` + `forge_triage_route`.
- **No changes to `forge_bug_register` or `forge_crucible_submit`.** Triage calls them as-is.
- **No SPA/Playwright mode for content-audit scanner.** Reference scanner uses `node:fetch`; SPA support is a future phase.
- **No auto-merge of classifier PRs.** Review agent flags, human approves.
- **No breaking changes to `runTemperingRun` signature.** Drain wraps it, does not modify it.
- **No default-on activation.** `audit.mode` MUST default to `"off"`. `"auto"` and `"always"` are explicit opt-ins set by the project owner.
- **No scheduled/cron execution in v2.80.** Scheduled runs are a future phase; v2.80 ships only manual + auto-on-plan-completion paths.

### User Scenarios

1. **Ops audit, loop runs to convergence.** User runs `pforge audit-loop` (or the MCP tool). Round 1 surfaces 88 findings. Triage routes 75 to bug registry, 10 to Crucible (feature gaps), 3 to classifier proposals. Round 2 reads bug-fix commits, re-probes, surfaces 31. Continues until round 4 returns `realFindingCount === 0` → drain stops, summary artifact written.

2. **Loop diverges, max-rounds cap fires.** After 5 rounds a classifier change introduced noise instead of reducing it. Drain terminates with `terminated: "max-rounds"`. Summary flags the non-converging classifier PR for human review. No infinite loop.

3. **Classifier PR gets reviewed.** Agent sees a classifier change that would reclassify 50 findings from `missing-h1` to `client-shell`. Review agent requires a before/after count in the PR body. If the product fix for any of those 50 is in the same commit, review agent blocks with a specific message.

4. **Existing tempering consumers unaffected.** `forge_tempering_run`, `maybeRunPostSliceTempering`, and all existing scanners continue to work with unchanged signatures. New drain is purely additive.

5. **Blog stays accurate.** `.forge/audits/dev-<ts>.json` shape matches the blog's described artifact. New blog footer links to the MCP tool docs.

### Acceptance Criteria

- **MUST**: `pforge-mcp/tempering/scanners/content-audit.mjs` exports a default scanner module matching the existing scanner interface (`{ name, run(ctx) }`). `name === "content-audit"`. When registered in a tempering run, it emits findings into the existing `findings[]` array with fields `{ class, route, severity, evidence, seed? }`.
- **MUST**: `pforge-mcp/tempering/drain.mjs` exports `runTemperingDrain({ project, maxRounds = 5, scanners, convergenceRule, spawnWorker }) → { rounds: [...], terminated: "converged" | "max-rounds" | "aborted", summary }`. Each round writes one line to `.forge/tempering/drain-history.jsonl` with shape `{ runId, round, realFindings, patterns, ts, deltas }`. Default `convergenceRule` is `(r) => r.realFindings === 0 && r.patterns === 0`. **Test**: `pforge-mcp/tests/tempering-drain.test.mjs` — convergence, max-rounds, and delta-write cases.
- **MUST**: `pforge-mcp/tempering/triage.mjs` exports `routeFinding(finding, classifier) → { lane, payload, confidence }`. Lanes are exactly `"bug"`, `"spec"`, `"classifier"`. Unknown classifier output returns `{ lane: "bug", confidence: "low" }` (fail safe — never drop a finding). **Test**: `pforge-mcp/tests/tempering-triage.test.mjs` — one case per lane plus fail-safe fallback.
- **MUST**: Two new MCP tools in `pforge-mcp/tools.json` and `server.mjs`: `forge_tempering_drain` and `forge_triage_route`. Both documented with `USE FOR` / `DO NOT USE FOR` / `recovery` fields matching existing tool style. **Test**: `pforge-mcp/tests/mcp-audit-tools.test.mjs` — contract test asserts both tools are registered, schemas parse, and handlers dispatch.
- **MUST**: `forge_tempering_drain` writes `.forge/audits/dev-<ts>.json` at loop end. Shape is a superset of the blog's documented shape (fields: `ts`, `rounds`, `findingsByLane`, `terminated`, `summary`). **Test**: `pforge-mcp/tests/audit-artifact-shape.test.mjs` — reads a fixture artifact and asserts the documented keys exist.
- **MUST**: `.github/agents/audit-classifier-reviewer.agent.md` exists with front-matter `{ role: "reviewer", readonly: true }`. Contains two enforceable rules: "classifier PRs must include before/after counts" and "classifier cannot be modified in the same commit as a product fix for a finding that classifier would reclassify." Rules formulated as checks a reviewer agent can evaluate against a diff.
- **MUST**: `presets/shared/skills/audit-loop/SKILL.md` exists, ≤ 80 lines, invokes only `forge_tempering_drain` and `forge_triage_route` (no net-new orchestration logic). Lists `DO NOT USE FOR` cases that overlap existing tempering skill.
- **MUST**: Existing test suite (baseline: 3285 tests at v2.79) remains green. Added tests: drain convergence (2 tests), drain max-rounds (1), triage three-lane (3), content-audit scanner fixture (2), MCP tool contract (2). Total ≥ 10 new tests.
- **MUST**: `tempering/runner.mjs` signature unchanged. `runTemperingRun` is called by drain, not modified. **Test**: `pforge-mcp/tests/tempering-runner-signature.test.mjs` — asserts exported signature matches v2.79 baseline snapshot.
- **MUST**: Blog footer updated to link to `forge_tempering_drain` tool doc once shipped (docs-only task in the final slice). **Test**: `pforge-mcp/tests/blog-crosslink.test.mjs` — reads `docs/blog/the-loop-that-never-ends.html` and asserts it contains the string `forge_tempering_drain`.
- **MUST**: `.forge.json` schema extended with an `audit` object: `{ mode: "off" | "auto" | "always", maxRounds: number, autoThresholds: { routeFilesChanged, uiComponentsChanged, daysSinceLastDrain, onInvestigateVerdict }, environments: { dev, staging }, forbidProduction: true }`. **Default `mode` is exactly `"off"`.** Loader added to `pforge-mcp/config.mjs` (or the existing config loader). **Test**: `pforge-mcp/tests/audit-config-loader.test.mjs` — asserts default is `"off"`, schema validation rejects unknown modes, and `forbidProduction` cannot be set to `false` in the schema.
- **MUST**: CLI `pforge audit-loop` command exists with flags `--auto`, `--max=N`, `--dry-run`, `--env=dev|staging`. Manual one-shot `pforge audit-loop` ignores `audit.mode` and always runs. `--auto` respects `audit.mode` and exits early (exit code 0, message "no drain signals tripped") if no threshold trips. **Test**: `pforge-mcp/tests/cli-audit-loop.test.mjs` — covers manual run, `--auto` with no signals (early exit), `--auto` with signals tripped (drain dispatched), `--dry-run` (no triage routing), and `--env=staging` plumbing.
- **MUST**: Auto-activation evaluator in `pforge-mcp/tempering/auto-activate.mjs` exports `shouldAutoDrain({ planContext, config, lastDrainTs, lastVerdict }) → { fire: boolean, signals: string[] }`. Emits a `drain-auto-estimate` event (via existing hub) before dispatch so callers can cancel. **Test**: `pforge-mcp/tests/audit-auto-activate.test.mjs` — one case per threshold (route-files, UI-components, days-since, investigate-verdict), plus a no-signals-tripped case and a `mode: "off"` short-circuit case.
- **MUST**: `pforge run-plan` checks `audit.mode` after plan completion. On `"auto"`, calls the evaluator; on `"always"`, dispatches unconditionally; on `"off"`, does nothing. NEVER runs per-slice — only once at plan end. **Test**: `pforge-mcp/tests/run-plan-audit-hook.test.mjs` — three cases (off/auto/always) plus per-slice negative assertion.
- **MUST**: Integration & E2E validation (Slice 8) covers a live MCP handshake for both new tools, an end-to-end drain against a fixture project with three known-bad routes, a CLI E2E for `pforge audit-loop` (dry-run and live), auto-activation threshold E2Es, and a full no-regression sweep of the prior test baseline. **Test**: `pforge-mcp/tests/e2e-audit-loop.test.mjs` and `pforge-mcp/tests/e2e-audit-loop-cli.test.mjs` — together contain ≥ 5 `test(` entries and must pass.
- **MUST**: Documentation sweep (Slice 9) updates every auto-discovering surface: `README.md`, `CHANGELOG.md`, `VERSION`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/CLI-GUIDE.md`, `docs/COPILOT-VSCODE-GUIDE.md`, `docs/manual/` tempering chapter, `docs/index.html`, `docs/docs.html`, `docs/faq.html`, `llms.txt`, `docs/llms.txt`, and `pforge-mcp/capabilities.mjs`. Each MUST contain the string `forge_tempering_drain` or `audit-loop` as appropriate. **Test**: Slice 9 validation gate greps all required files; CI lint verifies no broken cross-links to the new tool/CLI names.
- **MUST NOT**: Introduce a `forge_audit_*` tool namespace. Introduce a `.forge/audit/` directory distinct from `.forge/audits/`. Modify `forge_bug_register`, `forge_crucible_submit`, or `runTemperingRun`'s exported signature. Ship with `audit.mode` default anything other than `"off"`. Wire auto-drain into per-slice post-tempering — only plan-completion.

---

## Slices

### Slice 1 — `content-audit` scanner (reference impl)
- Port the shape of Rummag's `scripts/audit/*.mjs` into `pforge-mcp/tempering/scanners/content-audit.mjs`.
- Scanner interface: `{ name, run({ routes, seeds, fetcher }) }`.
- Findings emitted in the shared `findings[]` contract (`class`, `route`, `severity`, `evidence`, `seed?`).
- Routes sourced from existing BFS crawler output when available; falls back to `.forge/audits/routes.json` if user-provided.
- **Gate**: `grep -q 'name: *"content-audit"' pforge-mcp/tempering/scanners/content-audit.mjs` AND fixture test passes.

### Slice 2 — `runTemperingDrain` loop driver
- New file `pforge-mcp/tempering/drain.mjs`.
- Wraps `runTemperingRun` in a round loop. Default `maxRounds = 5`.
- Writes per-round deltas to `.forge/tempering/drain-history.jsonl` atomically.
- Convergence rule injectable; default is `realFindings === 0 && patterns === 0`.
- **Gate**: `grep -q 'export function runTemperingDrain' pforge-mcp/tempering/drain.mjs` AND 3 drain tests pass.

### Slice 3 — `routeFinding` three-lane triage
- New file `pforge-mcp/tempering/triage.mjs`.
- Pure function: takes a finding + classifier, returns `{ lane, payload, confidence }`.
- Fail-safe: unknown outputs route to `bug` with `confidence: "low"` (never drop findings).
- **Gate**: `grep -q 'export function routeFinding' pforge-mcp/tempering/triage.mjs` AND 3 triage tests pass (one per lane).

### Slice 4 — MCP tools `forge_tempering_drain` + `forge_triage_route`
- Add two entries to `pforge-mcp/tools.json` with full `USE FOR` / `DO NOT USE FOR` / `recovery`.
- Wire handlers in `pforge-mcp/server.mjs` that delegate to Slice 2 and Slice 3.
- Audit artifact written to `.forge/audits/dev-<ts>.json` at drain end.
- **Gate**: `grep -q 'forge_tempering_drain' pforge-mcp/tools.json` AND `grep -q 'forge_triage_route' pforge-mcp/tools.json` AND contract test passes for both tools.

### Slice 5 — Audit Classifier Reviewer agent
- New file `.github/agents/audit-classifier-reviewer.agent.md`.
- Front-matter: `{ role: "reviewer", readonly: true, triggers: ["path:pforge-mcp/tempering/bug-classifier.mjs"] }`.
- Rules codified as agent checks: before/after count required, no same-commit masking.
- **Gate**: `grep -q 'role: *reviewer' .github/agents/audit-classifier-reviewer.agent.md` AND `grep -q 'before/after' .github/agents/audit-classifier-reviewer.agent.md`.

### Slice 6 — `/audit-loop` skill wrapper
- New file `presets/shared/skills/audit-loop/SKILL.md`.
- Thin: invokes `forge_tempering_drain` then per-finding `forge_triage_route`. Prints drain curve.
- `DO NOT USE FOR` enumerated against the existing tempering skill to prevent misfire.
- **Gate**: file exists, ≤ 80 lines (`(Get-Content ... | Measure-Object -Line).Lines -le 80`), contains both tool names.

### Slice 7 — Activation surface (`off` / `auto` / `always`)
- Extend `.forge.json` schema with the `audit` object. Default `mode: "off"`.
- New `pforge-mcp/tempering/auto-activate.mjs` with `shouldAutoDrain(...)` threshold evaluator.
- New CLI command `pforge audit-loop` with `--auto`, `--max=N`, `--dry-run`, `--env=` flags.
- Dashboard toggle (`off / auto / always`) + "Start drain loop" button + live drain curve chart. Wired to the same SSE hub as existing tempering panels.
- `pforge run-plan` end-of-plan hook calls the evaluator and dispatches on `auto`/`always`.
- **Gate**: `grep -q '"mode": *"off"' pforge-mcp/config/*.mjs` (or wherever the default lives) AND `grep -q 'shouldAutoDrain' pforge-mcp/tempering/auto-activate.mjs` AND `grep -q 'audit-loop' pforge/*.mjs` (or CLI entry) AND the 4 activation-surface tests pass.

### Slice 8 — Integration & E2E validation
All unit tests from Slices 1–7 must be green before this slice runs. This slice proves the whole loop works end-to-end before any docs ship.
- **Live MCP handshake**: boot `pforge-mcp/server.mjs` against a temp project fixture, call `forge_tempering_drain` and `forge_triage_route` over the MCP transport, assert responses match schemas in `tools.json`.
- **End-to-end drain**: seed a fixture project (`pforge-mcp/tests/fixtures/audit-loop-e2e/`) with 3 known-bad routes + 1 classifier-noise pattern. Run `forge_tempering_drain` and assert: ran ≥2 rounds, converged or hit max-rounds cleanly, wrote `.forge/audits/dev-<ts>.json` with valid shape, wrote per-round deltas to `drain-history.jsonl`, triage routed findings to all three lanes.
- **CLI E2E**: spawn `pforge audit-loop --dry-run --env=dev` against the fixture; assert exit 0 and no triage side effects. Then spawn without `--dry-run` and assert triage artifacts created.
- **Auto-activation E2E**: synthetic `planContext` trips each threshold independently; assert `shouldAutoDrain` fires for each and that `drain-auto-estimate` event is emitted on the hub before dispatch.
- **Safety rails**: assert `forbidProduction: true` cannot be overridden at runtime; assert `audit.mode` defaults to `"off"` on a fresh `.forge.json` with no `audit` key.
- **No-regression sweep**: full existing test suite (baseline 3285 tests at v2.79) passes. New total ≥ 3295 + the ~14 new tests from Slices 1–7 + the new E2E tests.
- **Gate**: `npm test` exit 0 AND `pforge-mcp/tests/e2e-audit-loop.test.mjs` exists AND `pforge-mcp/tests/e2e-audit-loop-cli.test.mjs` exists AND both pass AND `grep -c 'test(' pforge-mcp/tests/e2e-audit-loop.test.mjs` ≥ 5.

### Slice 9 — Documentation sweep
All auto-discovering docs, capability manifests, and user-facing surfaces updated so the new features are findable without reading the plan.
- **`README.md`** — add one-paragraph "Audit Loop" section under the feature list with a CLI example.
- **`CHANGELOG.md`** — v2.80.0 section listing all additions (scanner, drain, triage, two MCP tools, reviewer agent, skill, activation surface, E2E suite).
- **`VERSION`** — bump to `2.80.0`.
- **`docs/capabilities.md`** — new rows for `forge_tempering_drain`, `forge_triage_route`, and the `pforge audit-loop` CLI.
- **`docs/capabilities.html`** — mirror the `.md` additions in the HTML capability index (used by the website).
- **`docs/CLI-GUIDE.md`** — full `audit-loop` subcommand section (flags, examples, when-to-use).
- **`docs/COPILOT-VSCODE-GUIDE.md`** — append note about the `/audit-loop` skill and `forge_tempering_drain` tool being callable from chat.
- **`docs/EXTENSIONS.md`** — note classifier-as-code and the classifier-reviewer agent if extension authors need to plug in.
- **`docs/UNIFIED-SYSTEM-ARCHITECTURE.md`** — add audit drain loop to the system diagram section (one paragraph + one line in the ASCII/Mermaid diagram if present).
- **`docs/manual/`** — add or extend the tempering chapter with an "Audit Loop" subsection.
- **`docs/index.html`** — small feature-card or bullet under "What's new" linking to the blog + capabilities page.
- **`docs/docs.html`** — add audit loop to the table of contents / sidebar.
- **`docs/faq.html`** — one Q&A: "Does Plan-Forge audit my deployed app automatically?" → "No — audit.mode defaults to `off`."
- **`docs/blog/the-loop-that-never-ends.html`** — footer paragraph linking to `forge_tempering_drain` docs and noting default-off activation (already in Slice 7 criteria, but verified here).
- **`llms.txt`** and **`docs/llms.txt`** — add line items for the two new MCP tools and the `pforge audit-loop` command so LLM discovery indexes pick them up.
- **`pforge-mcp/capabilities.mjs`** — ensure the new tools are exported in the capabilities manifest (auto-discovery for `forge_capabilities` tool). Add schema entries if needed.
- **`action.yml`** / **`plugin.json`** — surface the new CLI command if these manifests enumerate subcommands.
- **`AGENT-SETUP.md`** and **`CUSTOMIZATION.md`** — brief mention of the classifier-reviewer agent and audit-loop skill where setup instructions list available agents/skills.
- **Gate**: `grep -q '2.80.0' CHANGELOG.md` AND `grep -q '2.80.0' VERSION` AND `grep -q 'forge_tempering_drain' docs/capabilities.md` AND `grep -q 'forge_tempering_drain' docs/capabilities.html` AND `grep -q 'audit-loop' docs/CLI-GUIDE.md` AND `grep -q 'audit-loop' README.md` AND `grep -q 'forge_tempering_drain' llms.txt` AND `grep -q 'forge_tempering_drain' pforge-mcp/capabilities.mjs` AND `grep -q 'forge_tempering_drain' docs/blog/the-loop-that-never-ends.html` AND `npm test` exit 0.

---

## Scope Contract

**In scope (files that may be created or edited):**
- `pforge-mcp/tempering/scanners/content-audit.mjs` (new)
- `pforge-mcp/tempering/drain.mjs` (new)
- `pforge-mcp/tempering/triage.mjs` (new)
- `pforge-mcp/server.mjs` (additive — new tool handlers only)
- `pforge-mcp/tools.json` (additive — two new entries)
- `pforge-mcp/tempering/auto-activate.mjs` (new)
- `pforge-mcp/tests/tempering-drain.test.mjs` (new)
- `pforge-mcp/tests/tempering-triage.test.mjs` (new)
- `pforge-mcp/tests/content-audit-scanner.test.mjs` (new)
- `pforge-mcp/tests/mcp-audit-tools.test.mjs` (new)
- `pforge-mcp/tests/audit-artifact-shape.test.mjs` (new)
- `pforge-mcp/tests/tempering-runner-signature.test.mjs` (new)
- `pforge-mcp/tests/blog-crosslink.test.mjs` (new)
- `pforge-mcp/tests/audit-config-loader.test.mjs` (new)
- `pforge-mcp/tests/cli-audit-loop.test.mjs` (new)
- `pforge-mcp/tests/audit-auto-activate.test.mjs` (new)
- `pforge-mcp/tests/run-plan-audit-hook.test.mjs` (new)
- `pforge-mcp/tests/e2e-audit-loop.test.mjs` (new — Slice 8)
- `pforge-mcp/tests/e2e-audit-loop-cli.test.mjs` (new — Slice 8)
- `pforge-mcp/tests/fixtures/audit-loop-e2e/` (new — fixture project for Slice 8)
- `pforge-mcp/capabilities.mjs` (additive — register new tools)
- `pforge-mcp/dashboard/` (additive panel only — no edits to existing tiles)
- CLI entry file (`pforge.mjs` or `pforge-mcp/cli.mjs`) — additive subcommand only
- `.forge.json` schema / config loader — additive `audit` object only
- `README.md`
- `AGENT-SETUP.md`
- `CUSTOMIZATION.md`
- `llms.txt`
- `docs/llms.txt`
- `docs/capabilities.md`
- `docs/capabilities.html`
- `docs/CLI-GUIDE.md`
- `docs/COPILOT-VSCODE-GUIDE.md`
- `docs/EXTENSIONS.md`
- `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`
- `docs/manual/**` (tempering chapter only)
- `docs/index.html` (small additive block only)
- `docs/docs.html` (sidebar/TOC addition only)
- `docs/faq.html` (one Q&A addition only)
- `docs/blog/the-loop-that-never-ends.html` (footer cross-link only)
- `action.yml` (only if it enumerates CLI subcommands)
- `plugin.json` (only if it enumerates CLI subcommands)
- `.github/agents/audit-classifier-reviewer.agent.md` (new)
- `presets/shared/skills/audit-loop/SKILL.md` (new)
- `CHANGELOG.md`
- `VERSION`

**Forbidden actions:**
- Editing `pforge-mcp/tempering/runner.mjs` signature or exported API
- Editing `pforge-mcp/tempering/bug-registry.mjs`, `bug-classifier.mjs`, or `scheduling.mjs`
- Editing `pforge-mcp/crucible-server.mjs` or any `crucible-*.mjs`
- Introducing `forge_audit_*` tool namespace
- Introducing `.forge/audit/` (singular) directory — `.forge/audits/` only
- Modifying any scanner in `pforge-mcp/tempering/scanners/*` other than adding `content-audit.mjs`
- Auto-merging classifier PRs
- Rewriting the blog post content beyond the footer cross-link

---

## Open Questions for Step-2 Hardener

1. Should `runTemperingDrain` accept a custom `spawnWorker` for post-slice orchestrator use, or stay out of that code path for v2.80?
2. Does the content-audit scanner need a dev-server detection guard like `ui-playwright` has (won't crawl prod)?
3. Should the `classifier` lane PR proposal be a GitHub issue, a local file, or both?
4. For the CLI flag: `pforge audit-loop --auto` (respects config) vs `pforge audit-loop` alone (manual one-shot) — confirm naming so users don't confuse the two.
5. Should the dashboard toggle persist to `.forge.json` or only to a session-scoped cache? (Parity with existing tempering toggles says `.forge.json`.)

---

## References

- [Proposal 0001](../../0001-recursive-audit-loop.md)
- [Blog: The Loop That Never Ends](../blog/the-loop-that-never-ends.html)
- [CHANGELOG v2.79.0 — Phase-38.8](../../CHANGELOG.md)
