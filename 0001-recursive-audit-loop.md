# Proposal 0001: Recursive Audit Loop

> **Status**: Draft — field-tested once (Rummag, Apr 2026), proposing promotion to a core Plan-Forge primitive
> **Owner**: Rummag team
> **Source repo**: [github.com/srnichols/Rummag](https://github.com/srnichols/Rummag) (local: `E:\GitHub\Rummag`)
> **Field evidence**: 88 real findings → 0 in one session across 4 rounds (commits [`49bd5da`](https://github.com/srnichols/Rummag/commit/49bd5da) → [`8b1ba85`](https://github.com/srnichols/Rummag/commit/8b1ba85) → [`7e41ae4`](https://github.com/srnichols/Rummag/commit/7e41ae4) → [`e9f7e66`](https://github.com/srnichols/Rummag/commit/e9f7e66))

---

## The Problem Plan-Forge Doesn't Solve Today

Plan-Forge today is excellent at **turning a stated intent into shipped code**:

```
Intent → Specifier → Crucible → Plan Hardener → Executor → Reviewer → Shipper
```

But it has a blind spot: **intent discovery**. It assumes the user knows what to build or fix. In practice, most of what a product needs is:

- Real bugs in deployed behavior that nobody has reported yet
- Feature gaps implied by broken user journeys
- Regressions that unit tests don't catch because they pass at the layer boundary but fail at the edge

None of those arrive via a user typing a prompt. They live in the running system.

---

## The Pattern (Field-Tested)

```
┌─ DISCOVERY ─────────┐        ┌─ CRUCIBLE ──────┐       ┌─ HARDEN ────────┐
│ Content audit       │──────▶ │ forge_crucible_ │─────▶ │ Phase-NN plan   │
│ + route crawl       │  finds │   submit (agent)│       │ + Scope Contract│
│ + placeholder regex │        └─────────────────┘       └──────┬──────────┘
└─────────────────────┘                                          │
        ▲                                                        ▼
┌───────┴──────────┐        ┌─ TEMPERING ────┐         ┌─ EXECUTE ──────┐
│ Bug registry     │◀───────│ forge_tempering│◀────────│ slice-by-slice │
│ (auto-smelt loop)│  fails │   _run         │  green  │ + test gates   │
└──────────────────┘        └────────────────┘         └────────────────┘
```

**Three lanes for every audit finding:**

| Lane | Destination | Example |
|------|-------------|---------|
| Real bug | `forge_bug_register` → auto-smelt fix | `/campaigns/:id` returns 500 instead of 400 on bad UUID |
| Feature gap | `forge_crucible_submit` → spec hardening | "Shipping label regen" page missing from ops flow |
| Methodology-only | Audit-tool refinement, not product change | 24 false-positive `missing-h1` on client-hydrated pages |

The third lane is the one Plan-Forge currently has no notion of — and it's the one that makes the loop *converge* instead of generating noise.

---

## Loop Mechanics

### Round structure

Each round is one pass through:

1. **Crawl** — enumerate routes (static + dynamic with seed values)
2. **Fetch** — HTTP-probe each route, capture HTML + status
3. **Classify** — assign a failure class per finding (via priority-ordered decision function)
4. **Triage** — separate real/suspect/info buckets using seed-mismatch rules
5. **Route** — real bugs → bug registry; feature gaps → Crucible; false-positives → audit-tool PR

### Termination condition

```
realFindingCount == 0 AND patternCount == 0
```

When the top pattern is empty, the loop has either fixed everything or taught itself not to flag the thing.

### Self-correction modes (all three observed in field test)

| Mode | What happens | Rummag example |
|------|--------------|----------------|
| A. Product fix | Bug registered, tempering verifies fix | B1: campaign 500→400 |
| B. Classifier addition | New failure class recognizes a legitimate pattern | `client-shell` class for `'use client'` hydration markers |
| C. Classifier reorder | Existing classes re-prioritized to avoid misfire | `client-shell` moved before `missing-h1` check |

Modes B and C are the novel contribution. Without them, audit tooling generates infinite false positives and teams stop trusting it. **The audit tool is itself in scope for the loop.**

---

## Why This Should Be a Core Plan-Forge Primitive

### 1. It's how real products find real bugs

Unit tests, type checks, and linters pass at the layer boundary. Audits probe the edge (HTTP, rendered HTML, deployed binary). Every field-tested bug in the Rummag session was invisible to the existing test suite but obvious to a 3-second HTTP probe.

### 2. It closes the loop between `shipper` and `specifier`

Today the hand-off after `shipper` is "wait for the user to file the next ticket." The audit loop turns the deployed system itself into the next ticket source, with automatic triage into Plan-Forge's existing lanes.

### 3. Classifier-as-code matches Plan-Forge's philosophy

Plan-Forge already treats plans, guardrails, and tempering thresholds as versioned artifacts. The audit classifier is the same kind of artifact — it encodes what "broken" means for this codebase. Committing classifier updates alongside product fixes is the pattern.

### 4. It's measurable

Every round produces a number: real findings count. The drain curve (88→75→31→4→0) is a compact, auditable session artifact. Teams can see loop convergence or divergence at a glance.

---

## Proposed Plan-Forge Surface

### New skill: `/audit-loop`

```
SKILL.md outline:
  1. discover: routes + seeds (pluggable source per stack)
  2. probe: http+html inspection (pluggable fetcher)
  3. classify: priority-ordered decision fn (per-repo classifier file)
  4. triage: route finding to bug | spec | classifier-update
  5. drain: iterate until realFindingCount == 0 AND patternCount == 0
```

### New agent: `Audit Classifier Reviewer`

A read-only reviewer that PR-checks classifier changes the same way `Bicep Reviewer` checks infra:
- Is the new class priority-correct relative to existing ones?
- Is the seed-mismatch rule narrow enough to not mask real bugs?
- Is there a test fixture proving the reclassification?

### New tool contracts

```
forge_audit_discover (routes, seeds) → route set
forge_audit_probe (route set) → findings
forge_audit_classify (findings, classifier) → labeled findings
forge_audit_triage (labeled findings, triage rules) → { bugs, specs, noise }
forge_audit_drain (project) → run loop until converged
```

Each reuses existing primitives:
- `bugs` → `forge_bug_register`
- `specs` → `forge_crucible_submit`
- `noise` → classifier PR (human-reviewed or agent-proposed)

### Pluggability (what varies per stack)

| Component | Rummag impl | Generalizable |
|-----------|-------------|---------------|
| Route discovery | Next.js filesystem + API reflection | Per-framework adapter |
| Fetcher | Node `fetch` + HTML parse | Add Playwright mode for SPAs |
| Classifier | JS module with priority-ordered fns | Yes, ship a default set |
| Seed-mismatch rules | `LEGIT_SEEDS` regex array | Yes, same pattern |

---

## Guardrails Against Misuse

The loop is powerful but easy to abuse. Ship these guardrails:

1. **Classifier changes require a commit** — never ad-hoc in a session. Makes drift visible.
2. **Classifier PRs must include a before/after count** — so a "reclassification" that silently hides 50 real bugs gets caught.
3. **Loop has a max-rounds cap** — if 5 rounds don't converge, escalate to human. Prevents infinite tuning.
4. **Real-finding deltas stored per-round** — the drain curve is the audit trail.
5. **Classifier cannot be modified in the same commit as the product fix it would mask** — enforced by the review agent.

---

## Field Evidence Summary (Rummag, Apr 2026)

| Round | Real | Patterns | Commit | Mode |
|-------|------|----------|--------|------|
| baseline | 88 | — | — | — |
| 1 | 75 | 24 | (B1 fix) | A — product |
| 2 | 31 | 10 | `49bd5da` | B — add `client-shell` |
| 3 | 4 | 3 | `8b1ba85` | C — reorder classifier |
| 4 | 0 | 0 | `7e41ae4` | A + B — fix 2 h1s + seed rule |

One feature-gap that surfaced via the audit (shipping-label regen, Phase-25) went through Crucible and closed as `closed-no-changes` after interview — which is itself a win: the audit's job isn't to always produce fixes, it's to surface questions worth answering.

---

## Ask

Decide whether to:

1. **Accept**: promote the loop to a Plan-Forge core skill + agent + tool set
2. **Prototype**: port the Rummag `scripts/audit/*.mjs` into `pforge-mcp/audit/` as a reference implementation, iterate on one more project, then decide
3. **Defer**: keep it as a per-repo pattern (documented here) without tool-level support

Recommendation: **option 2**. The pattern works, but the generalizable shape (route discovery adapter, classifier DSL, drain-until-converged contract) wants one more field test before it's a promise.

---

## References

- **Source repo**: [github.com/srnichols/Rummag](https://github.com/srnichols/Rummag) — branch `master`
- Rummag scripts: [`scripts/audit/discover-routes.mjs`](https://github.com/srnichols/Rummag/blob/master/scripts/audit/discover-routes.mjs), [`fetch-real-seeds.mjs`](https://github.com/srnichols/Rummag/blob/master/scripts/audit/fetch-real-seeds.mjs), [`audit-content.mjs`](https://github.com/srnichols/Rummag/blob/master/scripts/audit/audit-content.mjs), [`triage-findings.mjs`](https://github.com/srnichols/Rummag/blob/master/scripts/audit/triage-findings.mjs)
- OpenBrain memory: thoughts `4de5fd70`, `90f943f2`, `3d739a4b`, `878f44c6`, `a3e86486`
- Session commits: [`49bd5da`](https://github.com/srnichols/Rummag/commit/49bd5da), [`8b1ba85`](https://github.com/srnichols/Rummag/commit/8b1ba85), [`7e41ae4`](https://github.com/srnichols/Rummag/commit/7e41ae4), [`e9f7e66`](https://github.com/srnichols/Rummag/commit/e9f7e66)
