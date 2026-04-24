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
> **Session budget**: 7 slices in **1 session**. ~90 min, budget ≤ $12.
> **Design posture**: Promote a field-tested pattern (proposal 0001) into a first-class Plan-Forge primitive by **extending** `tempering/` rather than forking it. Two new tools, one new agent, one new scanner, one thin skill wrapper. Zero duplication of existing crawler/classifier/bug-registry code.

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

### Explicitly out of scope

- **No new `forge_audit_*` tool namespace.** Proposal suggested five. Folded into `forge_tempering_drain` + `forge_triage_route`.
- **No changes to `forge_bug_register` or `forge_crucible_submit`.** Triage calls them as-is.
- **No SPA/Playwright mode for content-audit scanner.** Reference scanner uses `node:fetch`; SPA support is a future phase.
- **No auto-merge of classifier PRs.** Review agent flags, human approves.
- **No breaking changes to `runTemperingRun` signature.** Drain wraps it, does not modify it.

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
- **MUST NOT**: Introduce a `forge_audit_*` tool namespace. Introduce a `.forge/audit/` directory distinct from `.forge/audits/`. Modify `forge_bug_register`, `forge_crucible_submit`, or `runTemperingRun`'s exported signature.

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

### Slice 7 — Docs + CHANGELOG + blog cross-link
- `CHANGELOG.md` — v2.80.0 section listing all additions.
- `docs/blog/the-loop-that-never-ends.html` — footer paragraph linking to `forge_tempering_drain` docs.
- `docs/capabilities.md` — new row in the tools table.
- Full vitest suite passes.
- **Gate**: `grep -q '2.80.0' CHANGELOG.md` AND `grep -q 'forge_tempering_drain' docs/blog/the-loop-that-never-ends.html` AND `npm test` exit 0.

---

## Scope Contract

**In scope (files that may be created or edited):**
- `pforge-mcp/tempering/scanners/content-audit.mjs` (new)
- `pforge-mcp/tempering/drain.mjs` (new)
- `pforge-mcp/tempering/triage.mjs` (new)
- `pforge-mcp/server.mjs` (additive — new tool handlers only)
- `pforge-mcp/tools.json` (additive — two new entries)
- `pforge-mcp/tests/tempering-drain.test.mjs` (new)
- `pforge-mcp/tests/tempering-triage.test.mjs` (new)
- `pforge-mcp/tests/content-audit-scanner.test.mjs` (new)
- `pforge-mcp/tests/mcp-audit-tools.test.mjs` (new)
- `pforge-mcp/tests/audit-artifact-shape.test.mjs` (new)
- `pforge-mcp/tests/tempering-runner-signature.test.mjs` (new)
- `pforge-mcp/tests/blog-crosslink.test.mjs` (new)
- `.github/agents/audit-classifier-reviewer.agent.md` (new)
- `presets/shared/skills/audit-loop/SKILL.md` (new)
- `CHANGELOG.md`
- `docs/capabilities.md`
- `docs/blog/the-loop-that-never-ends.html` (footer cross-link only)
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

---

## References

- [Proposal 0001](../../0001-recursive-audit-loop.md)
- [Blog: The Loop That Never Ends](../blog/the-loop-that-never-ends.html)
- [CHANGELOG v2.79.0 — Phase-38.8](../../CHANGELOG.md)
