---
crucibleId: 1fe0c84a-b401-4fc2-b8f2-db4454a511d3
source: self-hosted
status: planning
arc: TEMPER
---

# Forge Arc: **Tempering** — automated test-intelligence subsystem

> **Status**: 📝 PLANNING — nothing shipped yet.
> **Estimated Effort**: 6 phases, ~10–14 execution slices total.
> **Risk Level**: High impact, low-to-medium per-slice risk (additive
> subsystem — no existing surfaces are broken).
> **Target Version band**: v2.42.x → v2.47.x.

---

## The metallurgy metaphor, completed

| Stage | Subsystem | Ships since |
|-------|-----------|-------------|
| Extract raw ore, melt | **Crucible** | v2.37+ |
| Shape into form | **Forge** (plan execution) | v0.1+ |
| Harden by controlled heat | **Temper** | *this arc* |
| Inspect in service | **LiveGuard** (drift / incidents / fix) | v2.29+ |

Tempering is the literal missing stage. Crucible smelts ideas into plans.
The Forge executes plans into code. Temper hardens that code — it exercises
it under all the pressures it will face in production (unit, integration,
UI, visual, load, accessibility, mutation) and reports where the metal
is still soft. LiveGuard then monitors the hardened artefact in service.

## Why

Plan Forge currently delegates test quality to humans. We ship LiveGuard
drift detection, incident capture, fix-proposal auto-plans, and Crucible
health signals — but *whether a project has adequate tests at all* is
invisible to the system. Operators have no way to ask "which of my shipped
slices has zero coverage?" or "did my last deploy introduce a visual
regression?" without manually wiring each individual framework.

Tempering closes that gap. It is the **autonomous test orchestrator** that
sits in the Plan Forge loop between the Forge and LiveGuard, producing
test-quality signals at the same grain as every other subsystem (per slice,
per run, per smelt).

## Design principles

1. **Enterprise defaults.** Quorum-mode visual analysis, per-layer coverage
   minima, mutation testing, flakiness detection, full accessibility sweep
   — all *on by default*. Users dial down in `.forge/tempering/config.json`
   if they want; they should not have to dial up to get serious coverage.
2. **One JSON file per thing.** Mirrors Crucible exactly:
   `.forge/tempering/<runId>.json` per scan, `.forge/bugs/<bugId>.json`
   per bug, `.forge/tempering/config.json` shared. This gives dashboards,
   `forge_smith`, fix proposals, and watcher anomalies a single queryable
   contract.
3. **Fix the harness, never the product.** Tempering is allowed to repair
   flakes, missing fixtures, hard-coded paths, and infra drift *in its own
   test files*. It is **forbidden** from editing production code. Real bugs
   it discovers become **Bug Registry entries** that only the Forge (via
   `forge_fix_proposal`) can turn into code-change plans.
4. **GitHub Issues primary, JSONL fallback, extension points everywhere.**
   First-class integration with GitHub Issues for teams that use them;
   `.forge/bugs/*.json` is always the source of truth locally so teams
   without GitHub (GitLab, Azure DevOps, Jira, Linear, on-prem) are not
   locked out. Third-party integrations land as extensions in the same
   catalog mechanism used by `pforge ext`.
5. **Language-agnostic.** Reuses the existing `presets/` architecture.
   Each preset (typescript, dotnet, python, go, java, rust, php, swift,
   azure-iac) provides a tempering adapter describing how to run its
   tests. New stacks land as preset PRs, not core changes.
6. **No speculative abstraction.** Each phase ships a working end-to-end
   slice of value. No "foundation without users." TEMPER-01 is readable
   by dashboards on day 1; TEMPER-06 is the final closed loop.

## The closed loop (target end-state after TEMPER-06)

```
Crucible smelts an idea
      │
      ▼
Forge executes the plan (code lands)
      │
      ▼
Tempering scans the run: coverage? flakes? visuals? a11y? perf?
      │
      ├──── gap found ────► generate + run missing test suite
      │
      ├──── test-infra bug ────► tempering fixes it in-place, re-runs
      │
      └──── real product bug ──► Bug Registry entry
                                    │
                                    ▼
                          forge_fix_proposal source="tempering-bug"
                                    │
                                    ▼
                              Crucible smelt (new)
                                    │
                                    ▼
                              Forge executes fix
                                    │
                                    ▼
                    Tempering re-runs → validates fix → closes bug
                                    │
                                    ▼
                              LiveGuard monitors
```

Every arrow above is **automated**. Humans review, approve, and override —
but are never the reason a bug sits un-tested for three days.

## Phase breakdown

| Phase | Ships | Slices | Version band |
|-------|-------|--------|--------------|
| [TEMPER-01](Phase-TEMPER-01.md) | Foundation: config, storage contract, `forge_tempering_scan` read-only, dashboard tab | 2 | v2.42.x |
| [TEMPER-02](Phase-TEMPER-02.md) | Unit + integration execution harness (language-aware) | 2 | v2.43.x |
| [TEMPER-03](Phase-TEMPER-03.md) | Playwright: link sweep + accessibility + API contract tests | 2 | v2.44.x |
| [TEMPER-04](Phase-TEMPER-04.md) | Visual analyzer (quorum-mode vision, screenshot diffs) | 2 | v2.45.x |
| [TEMPER-05](Phase-TEMPER-05.md) | Load/stress + performance budgets + mutation testing + flakiness detection | 2 | v2.46.x |
| [TEMPER-06](Phase-TEMPER-06.md) | Bug Registry + GitHub Issues sync + fix-proposal integration + closed-loop validator | 2–3 | v2.47.x |

Each phase is **independently shippable** and delivers standalone value. An
early abort at any phase leaves the system in a working state — no phase
depends on a later one to function.

## Cross-cutting contracts (frozen in TEMPER-01, consumed by all later phases)

These are the decisions that, once shipped, cannot be changed cheaply.
They're called out here so every later phase has a stable target.

### `.forge/tempering/config.json` shape

```jsonc
{
  "enabled": true,
  "coverageMinima": {
    "domain": 90,      // business logic / services
    "integration": 80, // repositories, data access
    "controller": 60,  // HTTP / glue
    "overall": 80
  },
  "runtimeBudgets": {
    "unitMaxMs": 120000,
    "integrationMaxMs": 300000,
    "uiMaxMs": 600000
  },
  "scanners": {
    "unit": true,
    "integration": true,
    "ui-playwright": true,
    "ui-visual": true,
    "ui-accessibility": true,
    "load-stress": true,
    "mutation": true,
    "flakiness": true,
    "contract": true,
    "performance-budget": true
  },
  "visualAnalyzer": {
    "mode": "quorum",     // "quorum" | "single" — quorum default (enterprise)
    "models": ["claude-opus-4.7", "grok-4.20", "gemini-3-pro-preview"],
    "agreement": 2        // of 3 must agree on "looks broken"
  },
  "bugRegistry": {
    "integration": "github",  // "github" | "none" (JSONL-only)
    "githubRepo": null,        // auto-detect from git remote when null
    "autoCreateIssues": true,
    "labelPrefix": "tempering",
    "fallback": "jsonl"        // always maintained
  },
  "execution": {
    "trigger": "post-slice",   // "post-slice" | "manual" | "scheduled"
    "parallelism": "cpu-count",
    "regressionFirst": true    // run tests touching changed files first
  },
  "stackOverrides": {}         // preset-specific overrides keyed by stack name
}
```

### `.forge/tempering/<runId>.json` shape

```jsonc
{
  "runId": "temper-2026-04-20T15-30-00Z",
  "startedAt": "...",
  "completedAt": "...",
  "triggeredBy": "post-slice|manual|scheduled",
  "sliceRef": "Phase-TEMPER-01.md#slice-01.1", // when post-slice
  "stack": "typescript",
  "scanners": {
    "unit": { "ran": true, "pass": 412, "fail": 0, "coverage": {...}, "durationMs": 42100 },
    "integration": { ... },
    "ui-playwright": { ... },
    ...
  },
  "coverageVsMinima": { "domain": { "minimum": 90, "actual": 86, "gap": 4 } },
  "bugs": ["bug-001", "bug-002"],
  "infraFixes": [
    { "file": "tests/setup.ts", "change": "Added deterministic seed", "commit": "abc123" }
  ],
  "status": "green|amber|red",
  "verdict": "...human-readable summary..."
}
```

### `.forge/bugs/<bugId>.json` shape

```jsonc
{
  "bugId": "bug-2026-04-20-001",
  "discoveredAt": "...",
  "discoveredBy": "temper-run-2026-04-20T15-30-00Z",
  "scanner": "ui-visual|unit|integration|load-stress|contract|...",
  "severity": "critical|high|medium|low",
  "classification": "real-bug",     // always "real-bug" — test-infra issues are never bugs
  "evidence": {
    "testName": "...",
    "assertionMessage": "...",
    "stackTrace": "...",
    "screenshotBefore": "path",
    "screenshotAfter": "path",
    "visualDiffScore": 0.87
  },
  "affectedFiles": ["src/..."],
  "reproSteps": ["..."],
  "externalRef": {
    "provider": "github",
    "issueNumber": 42,
    "url": "https://github.com/.../issues/42"
  },
  "status": "open|in-fix|fixed|wont-fix|duplicate",
  "linkedFixPlan": "docs/plans/auto/LIVEGUARD-FIX-tempering-bug-bug-001.md",
  "validatedFixed": false,
  "validatedAt": null
}
```

### MCP tool surface (end-state)

| Tool | Added in | Purpose |
|------|----------|---------|
| `forge_tempering_scan` | TEMPER-01 | Read-only: detect gaps, report coverage-vs-minima, list missing scanners |
| `forge_tempering_run` | TEMPER-02 | Execute enabled scanners, write `.forge/tempering/<runId>.json` |
| `forge_tempering_status` | TEMPER-01 | Return latest N scan summaries (dashboard feed) |
| `forge_bug_register` | TEMPER-06 | Create a Bug Registry entry (called internally by scanners) |
| `forge_bug_list` | TEMPER-06 | Query registry with filters |
| `forge_bug_validate_fix` | TEMPER-06 | Re-run targeted scanners against an open bug |
| `forge_fix_proposal` (extended) | TEMPER-06 | New `source="tempering-bug"` + `bugId` arg |

### Dashboard surface (end-state)

- New **Tempering tab** (full dedicated pane) — phase TEMPER-01 ships skeleton
- **Watcher-tab chip row** (same pattern as Crucible row) — TEMPER-01
- **Tempering status row on every slice card** (Progress tab) — TEMPER-02
- **Bug Registry tab** — TEMPER-06
- **Live visual-diff viewer** — TEMPER-04

### Hub events introduced

- `tempering-scan-started` (TEMPER-01)
- `tempering-scan-completed` (TEMPER-01)
- `tempering-run-started` (TEMPER-02)
- `tempering-scanner-completed` (TEMPER-02)
- `tempering-run-completed` (TEMPER-02)
- `tempering-bug-registered` (TEMPER-06)
- `tempering-bug-validated-fixed` (TEMPER-06)
- `tempering-visual-regression-detected` (TEMPER-04)

### L3 semantic memory (OpenBrain) integration

Tempering writes to all three tiers of Plan Forge's memory architecture
(see [`docs/MEMORY-ARCHITECTURE.md`](../MEMORY-ARCHITECTURE.md)):

| Tier | Surface | Writer |
|------|---------|--------|
| **L1** (hub) | `tempering-*` events (above) | every scanner, every MCP tool |
| **L2** (files) | `.forge/tempering/<runId>.json`, `.forge/bugs/<bugId>.json`, `.forge/tempering/config.json`, `.forge/tempering/perf-history.jsonl`, `.forge/tempering/baselines/` | scanners + registry |
| **L3** (semantic) | OpenBrain via `captureMemory()` (falls back to `.forge/openbrain-queue.jsonl` when offline) | see capture table below |

**L3 capture sites** — each goes through the existing `captureMemory()`
helper so OpenBrain outages never block a tempering run:

| Capture site | Phase | Tags | Why L3 |
|--------------|-------|------|--------|
| Scan-completed summary (coverage gaps) | TEMPER-01 | `tempering`, `scan`, `<stack>`, `<status>` | "Has this project — or similar projects — had this coverage shape before?" |
| Run-completed verdict | TEMPER-02 | `tempering`, `run`, `<stack>`, `<verdict>` | Cross-project recall of what scanner mixes produce green/amber/red |
| Visual quorum decision | TEMPER-04 | `tempering`, `visual-regression`, `<verdict>`, `quorum:<n-of-m>` | Quorum disagreement patterns are valuable across projects (false-positive calibration) |
| Flake-confirmed (≥ 3 of N runs) | TEMPER-05 | `tempering`, `flake`, `<scanner>`, `<testName>` | "This test has been flaky in other projects too" |
| Perf regression confirmed (2 consecutive runs) | TEMPER-05 | `tempering`, `perf-regression`, `<endpoint-or-page>` | Cross-project p95 baselines |
| Mutation score below minimum | TEMPER-05 | `tempering`, `mutation-gap`, `<layer>` | Weak-suite patterns by layer |
| Bug-registered (real-bug only) | TEMPER-06 | `tempering-bug`, `<category>`, `<severity>`, `confidence-source:<rule\|llm>` | Cross-project bug pattern recall feeds future classifier confidence |
| Fix-validated (fix → validation pair) | TEMPER-06 | `tempering-fix`, `<bugCategory>`, `<outcome>` | "What fixes have worked for this class of bug before?" |

**Forbidden in L3:**

- Do NOT capture screenshots or binary blobs — L3 stores the verdict
  and metadata; the evidence stays in L2 under `.forge/bugs/<id>.json`
- Do NOT capture GitHub issue tokens, PII, or repo-private URLs in
  tags — `captureMemory()` already scrubs, but scanners must not
  hand-roll payloads that bypass it
- Do NOT capture test-infra-only bugs to L3 — only `real-bug`
  classifications cross the L3 threshold (infra noise would pollute
  cross-project search)

### Watcher anomalies introduced

- `tempering-coverage-below-minimum` (TEMPER-01)
- `tempering-scan-stale` (TEMPER-01) — last scan > 7 days ago
- `tempering-run-failed` (TEMPER-02)
- `tempering-visual-regression` (TEMPER-04)
- `tempering-flake-detected` (TEMPER-05)
- `tempering-bug-unaddressed` (TEMPER-06) — bug open > 14 days with no linked fix plan

### Forbidden actions (apply to every tempering scanner, every phase)

- Do NOT modify production source files (anywhere outside `tests/`,
  `test/`, `__tests__/`, `*.spec.*`, `*.test.*`, fixture dirs).
- Do NOT delete `.forge/bugs/*.json` entries (only status-update them).
- Do NOT auto-close GitHub Issues — only post "tempering validated fix"
  comments. A human closes.
- Do NOT exceed the `runtimeBudgets` — abort with `tempering-budget-exceeded`
  bug entry classified as `infra`, not a real product bug.
- Do NOT run tempering on the watcher's own project while the watcher is
  watching (no recursion).

## Extension surface (for non-GitHub users)

Teams on GitLab / Azure DevOps / Jira / Linear / on-prem plug in via the
existing `pforge ext` catalog. TEMPER-06 documents the contract:

```js
// .forge/extensions/<name>/tempering.mjs
export async function registerBug(bug, config) { /* push to issue tracker */ }
export async function updateBugStatus(bug, config) { /* ... */ }
export async function commentValidatedFix(bug, config) { /* ... */ }
```

Reference implementation: GitHub integration lives in core as the
first-class provider. GitLab / Azure DevOps / Jira templates ship in the
extensions catalog (stubs in `extensions/catalog.json` with
`extension-only` tag).

## Open questions parked for later (not blocking any phase)

| Question | Parked because |
|----------|---------------|
| Should tempering gate `pforge run-plan` from advancing if scan goes red? | Needs a quarter of real usage to calibrate. TEMPER-06 adds an opt-in; default is report-only. |
| Per-scanner cost caps in the budget report? | Overlaps with the existing `forge_cost_report`. Defer to TEMPER-05 if still needed then. |
| Should mutation testing run on every slice, or nightly? | Depends on runtime — TEMPER-05 will measure and pick a default. |
| UI load testing against staging vs local? | TEMPER-05 will gate on env detection from `.forge/env-config.json`. |

## Success criteria for the full arc

When TEMPER-06 merges, a fresh `pforge run-plan` on any supported stack
must automatically produce:

1. A `.forge/tempering/<runId>.json` per slice
2. Coverage-vs-minima per layer, visible on the Progress tab
3. At least one of: unit, integration, UI sweep, a11y, visual, load scan
   (depending on what the stack supports)
4. Any real bug discovered → `.forge/bugs/<bugId>.json` + (if configured)
   a GitHub Issue, without human intervention
5. A `forge_fix_proposal source=tempering-bug` producing an abandon-or-fix
   playbook for any open bug ≥ 14 days old
6. LiveGuard's composite health check (`forge_liveguard_run`) includes
   tempering status as a first-class health dimension

---

## Reading order for implementers

1. This arc doc (you are here)
2. [Phase-TEMPER-01.md](Phase-TEMPER-01.md) — storage + MCP foundation
3. [Phase-TEMPER-02.md](Phase-TEMPER-02.md) — execution harness
4. [Phase-TEMPER-03.md](Phase-TEMPER-03.md) — UI sweep
5. [Phase-TEMPER-04.md](Phase-TEMPER-04.md) — visual analyzer
6. [Phase-TEMPER-05.md](Phase-TEMPER-05.md) — perf + mutation + flake
7. [Phase-TEMPER-06.md](Phase-TEMPER-06.md) — bug registry + closed loop
