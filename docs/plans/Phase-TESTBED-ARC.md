---
crucibleId: 4d994c81-62b0-46e7-ab9c-71e741752809
source: self-hosted
status: planning
arc: TESTBED-RECURSIVE
---

# Forge Arc: **Testbed Recursive Validation** — prove the closed loop

> **Status**: 📝 PLANNING — runs **after** all coding arcs complete.
> **Estimated Effort**: 3 phases, ~6 execution slices total.
> **Risk Level**: Low for Plan Forge itself (this arc validates, it
> does not extend). High-value findings likely — expect follow-up
> fix phases in Plan Forge and the testbed.
> **Target Version band**: v2.53.x → v2.55.x.
> **Depends on**: TEMPER-06 merged AND FORGE-SHOP-05 merged.

---

## Why

Plan Forge is a meta-tool: it manages the development of software
projects. The only credible proof that it works is to use it on a real
project end-to-end and watch what breaks.

**Target**: `E:\GitHub\plan-forge-testbed` — the existing test-app
repository, kept deliberately separate from Plan Forge itself. It is
where Plan Forge eats its own output.

This arc runs Plan Forge through its **own closed loop, on the
testbed**, recursively. Every subsystem gets exercised under real
conditions:

- Crucible smelts real feature ideas for the testbed
- Forge executes the hardened plans
- Tempering scans the testbed's coverage, runs tests, flags bugs
- Fix-proposals flow back into Crucible as new smelts
- LiveGuard monitors the testbed's shipped artefacts
- The Forge Shop dashboard shows the entire flow in one view

And we record what works, what is awkward, and what is broken. The
output is a **defect log + UX backlog** that feeds the next release
cycle of Plan Forge itself.

## Design principles

1. **The testbed is a user, not a developer surface.** We do not edit
   Plan Forge code from inside the testbed. Findings become issues in
   Plan Forge's own tracker.
2. **Log everything with correlationId.** Every action in the recursive
   test uses the TEMPER correlationId thread so the final report can
   show one unbroken chain per feature tested.
3. **Boring beats clever.** We validate that the documented happy path
   works before stress-testing edge cases. Manual's chapter 8 script is
   the literal first recursive scenario run.
4. **Every finding is actionable.** No "feels slow" without a
   perf-budget violation referenced. No "UI is confusing" without a
   specific screen + task + time-to-completion measured.

## Phase breakdown

| Phase | Ships | Slices | Version band |
|-------|-------|--------|--------------|
| [TESTBED-01](Phase-TESTBED-01.md) | Testbed harness — runner, logger, defect-log schema | 2 | v2.53.x |
| [TESTBED-02](Phase-TESTBED-02.md) | Happy-path recursive run — manual ch8 script + 5 seeded features | 2 | v2.54.x |
| [TESTBED-03](Phase-TESTBED-03.md) | Chaos + perf + long-horizon scenarios + findings triage | 2 | v2.55.x |

## Scope

### In-scope

- **Recursive test harness** — a runner in Plan Forge that drives
  `pforge run-plan` against fixture plans in the testbed, captures
  every L1/L2/L3 artifact produced, and writes a defect log.
- **Happy-path scenarios** (TESTBED-02):
  1. Manual chapter 8 "closed loop in 10 minutes" — literal replay
  2. Spec-to-shipped on a new feature (add a REST endpoint)
  3. Bug found → fix-proposal → closed-loop validation
  4. Coverage gap flagged → test added → gap closed
  5. Visual regression detected → baseline approved → unflagged
- **Chaos scenarios** (TESTBED-03):
  1. Simulated OpenBrain outage mid-slice → does fallback work?
  2. LLM provider timeout mid-quorum → does quorum degrade gracefully?
  3. `git push --force` on a testbed branch Plan Forge is running on
     → does the watcher anomaly fire?
  4. Corrupted `.forge.json` → does `forge_validate` catch it?
  5. Two `pforge run-plan` instances in parallel → does the hub
     distinguish them?
- **Perf scenarios** (TESTBED-03):
  1. 10k hub events — dashboard still responsive? (FORGE-SHOP-01 budget)
  2. 1k L2 records — `forge_search` still sub-second?
  3. 500-page Playwright sweep — does TEMPER-03 stay within budget?
- **Long-horizon scenarios** (TESTBED-03):
  1. 14-day bug with no fix plan — does `tempering-bug-unaddressed` fire?
  2. 7-day stale smelt — does `crucible-stalled` fire?
  3. OpenBrain queue accumulates 1000 items — does drain catch up?

### Scheduling stub (G6 from the system audit)

TESTBED-01 includes a small but important sub-deliverable: **GitHub
Actions templates** for the three schedule-worthy Plan Forge tasks,
shipped in `templates/schedules/`:

- `.github/workflows/plan-forge-nightly-mutation.yml` — runs
  `forge_tempering_run --full-mutation` nightly
- `.github/workflows/plan-forge-weekly-drift.yml` — runs
  `forge_drift_report` weekly
- `.github/workflows/plan-forge-daily-sweep.yml` — runs
  `forge_sweep` daily

Plan Forge itself does NOT ship a scheduler daemon. Users wire via
GitHub Actions (template), cron (documented), or Task Scheduler
(documented for Windows).

### CLI parity audit (G8 from the system audit)

TESTBED-01 includes a `scripts/audit-cli-parity.mjs` check that for
every MCP tool in `capabilities.mjs`, asserts a matching `pforge`
CLI command exists in `pforge.ps1` and `pforge.sh`. Gaps become
defect-log entries, not build breaks.

### OTel export (G9 from the system audit)

TESTBED-03 includes a one-slice add: dashboard server exposes
`/metrics` in OpenMetrics text format (Prometheus-compatible). Hub
event counts, tool-latency histograms, queue depths. Cheap addition;
real SRE value.

### Out of scope

- Rewriting the testbed (it stays as-is; we use it as a canary)
- Any Plan Forge feature work triggered by findings — those become
  issues and feed the next release cycle, not this arc
- Replacing manual testing (this is additive validation, not a unit
  test suite)

### Forbidden actions

- Do NOT commit testbed secrets into Plan Forge logs
- Do NOT edit testbed production code from the recursive harness —
  the harness drives Plan Forge which drives the testbed; no
  shortcuts
- Do NOT silence a failing assertion to make a scenario "pass" —
  every failure is a defect-log entry
- Do NOT run chaos scenarios against the real testbed `main` branch —
  always branch first

## Defect log schema (frozen in TESTBED-01)

```jsonc
// docs/plans/testbed-findings/<date>-<slug>.json
{
  "findingId": "finding-2026-06-01-login-flow-stall",
  "date": "2026-06-01",
  "scenario": "happy-path-02",
  "correlationId": "...",
  "severity": "blocker | high | medium | low | polish",
  "surface": "crucible | forge-exec | tempering | liveguard | forge-shop | cli | docs",
  "title": "...",
  "expected": "...",
  "observed": "...",
  "reproSteps": ["..."],
  "artefacts": ["path/to/screenshot", "path/to/log"],
  "suggestedOwnerArc": "TEMPER | FORGE-SHOP | ...",
  "status": "open | fixed | wontfix | duplicate",
  "linkedPlanForgeIssue": null
}
```

## Hub events introduced

- `testbed-scenario-started`
- `testbed-scenario-completed`
- `testbed-finding-logged`

## MCP tools introduced

| Tool | Added in | Purpose |
|------|----------|---------|
| `forge_testbed_run` | TESTBED-01 | Execute a fixture scenario against the testbed |
| `forge_testbed_findings` | TESTBED-02 | Query defect log |

## Success criteria for the full arc

- All 5 happy-path scenarios complete end-to-end without human
  intervention (human review checkpoints are expected and count as
  passing)
- All 5 chaos scenarios produce correct degradation behavior (not
  "no crash" — the *specified* degradation)
- Perf scenarios stay within FORGE-SHOP-01 budgets
- Long-horizon scenarios trigger the right anomalies within ±10% of
  specified time windows
- Final defect log has ≤ 5 `blocker` findings and ≤ 15 `high`
  findings — if higher, a pre-v3.0 stabilization phase is warranted
  before any new arc starts
- CLI-parity audit passes (no unmatched MCP tools)
- `/metrics` endpoint returns valid OpenMetrics text consumable by
  Prometheus
- The arc's own recursive-test run is captured as chapter 9 of the
  manual: "Plan Forge validating itself"

## Dependencies

- **Requires TEMPER-06 merged** (full closed loop)
- **Requires FORGE-SHOP-05 merged** (timeline + search for
  correlationId recall during finding triage)
- **Requires testbed repo** at `E:\GitHub\plan-forge-testbed` to be
  reachable and on a green `main`

## Reading order for implementers

1. This arc doc
2. [Phase-TESTBED-01.md](Phase-TESTBED-01.md) — harness + schedules + CLI parity
3. [Phase-TESTBED-02.md](Phase-TESTBED-02.md) — happy-path scenarios
4. [Phase-TESTBED-03.md](Phase-TESTBED-03.md) — chaos + perf + long-horizon + OTel

> **Note:** Per-phase docs (01–03) will be drafted in a follow-up
> planning session once TEMPER and FORGE-SHOP are both well underway.
> The arc contract above is the stable target; the scenarios list may
> grow as real issues are discovered during TEMPER/FORGE-SHOP
> execution.
