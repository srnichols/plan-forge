---
crucibleId: 5e2a7b94-8c15-4d62-a3f7-9b8e4c2a1d58
source: self-hosted
status: draft
phase: TESTBED-02
arc: TESTBED-RECURSIVE
---

# Phase TESTBED-02: Happy-path recursive run — manual ch8 + 5 seeded scenarios

> **Status**: 📝 DRAFT — ready for Session 1 hardening
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (drives real `pforge run-plan` invocations
> against the testbed repo; each scenario costs real LLM tokens;
> failing scenarios are the *point* — they become defect-log entries,
> not build breaks)
> **Target Version**: v2.53.x → v2.54.0

See arc overview: [Phase-TESTBED-ARC.md](Phase-TESTBED-ARC.md)
Depends on: TESTBED-01 ✅ (harness + `forge_testbed_run` + defect-log schema)

---

## Why

TESTBED-01 shipped the runner, the defect-log writer, and the
scheduling/CLI-parity sub-deliverables. What it did NOT ship is any
actual scenarios — `docs/plans/testbed-scenarios/` is an empty
directory with a README.

TESTBED-02 populates the **happy-path** scenario suite. These are
scenarios Plan Forge is *supposed* to handle. If they fail, that is
the finding we want. Chaos, perf, and long-horizon scenarios land in
TESTBED-03.

The literal first scenario is the manual's chapter 8 "closed loop in
10 minutes" walkthrough replayed by the harness against the testbed.
If the documented happy path doesn't pass on a fresh run, every
other piece of the manual is suspect.

## Scope Contract

### In-scope

**Slice 1 — Seed 5 happy-path scenarios + `forge_testbed_happypath` tool**

Five fixture scenarios in `docs/plans/testbed-scenarios/`:

1. **`happy-path-01-manual-ch8.json`** — literal replay of
   `docs/manual/book-manual-plan.md` chapter 8. Crucible smelt →
   harden → run-plan → assert slice count, commit count, CHANGELOG
   entry, and tag. Expected completion: single pass, zero retries.

2. **`happy-path-02-new-rest-endpoint.json`** — the seeded feature
   is "add GET /api/health/deep". Scenario asserts: plan file
   created, endpoint exists after execution, test file exists,
   Playwright smoke passes, CHANGELOG updated.

3. **`happy-path-03-bug-to-fix.json`** — introduces a known bug in
   the testbed (e.g. off-by-one in pagination), runs `forge_tempering_run`
   to detect, verifies a fix-proposal flows into Crucible as a smelt,
   and the resulting plan closes the loop.

4. **`happy-path-04-coverage-gap.json`** — removes a test file from
   the testbed, runs `forge_tempering_run`, asserts a coverage-gap
   finding fires, asserts a fix-plan is proposed that restores the
   test, and the test actually runs green.

5. **`happy-path-05-visual-regression.json`** — changes a CSS
   variable in the testbed, runs Playwright visual sweep, asserts a
   regression is flagged, approves the baseline via the documented
   command, re-runs, asserts no regression remains.

New MCP tool: `forge_testbed_happypath` — runs all 5 scenarios
sequentially, writes one defect-log entry per failure, returns a
summary `{ total, passed, failed, findings: [] }`.

CLI parity: `pforge testbed happypath` in both `pforge.ps1` and
`pforge.sh`.

**Slice 2 — Execute the suite + ship the first defect-log report**

- Run `forge_testbed_happypath` against the testbed **live**, from
  the dev machine, in `--quorum=power` mode.
- Every finding becomes a `docs/plans/testbed-findings/` entry with
  severity triage.
- A **summary markdown** lands in `docs/plans/testbed-findings/README.md`
  listing the run date, scenario pass rate, and a link to each finding.
- Findings severity `blocker` or `high` get filed as GitHub issues
  automatically via `gh issue create` inside the harness. Severity
  `medium` and below stay in the defect log only.
- This is the slice that produces the **evidence artifact** for
  TESTBED-02: a real defect-log directory with real findings from
  a real run. It is committed to the repo.

### Out of scope

- Chaos scenarios (TESTBED-03 Slice 1)
- Perf scenarios (TESTBED-03 Slice 1)
- Long-horizon scenarios (TESTBED-03 Slice 2)
- Fixing any of the findings — those flow into the next release
  cycle as normal phase plans
- Extending the testbed repo to make scenarios "easier" — the
  testbed is the canary; we observe it, we don't massage it

### Forbidden actions

- Do NOT silence or downgrade a failing scenario to make it "pass" —
  every failure is a defect-log entry with full L1+L2 capture
- Do NOT run scenarios against the testbed's `main` branch — always
  branch into `testbed/<scenarioId>` first (runner enforces this)
- Do NOT commit testbed secrets into Plan Forge logs — the runner
  scrubs env vars matching `*_TOKEN`, `*_KEY`, `*_SECRET` before
  persisting
- Do NOT edit testbed production code from the harness — scenarios
  can mutate fixtures in the testbed, but the harness itself is
  read-only against `plan-forge-testbed/src/**`
- Do NOT skip a scenario because "it will fail" — that IS the finding

### Files agent may touch

- `pforge-mcp/testbed/scenarios.mjs` — register new scenarios
- `pforge-mcp/testbed/runner.mjs` — wire up `happypath` mode if needed
- `pforge-mcp/capabilities.mjs` — register `forge_testbed_happypath`
- `pforge-mcp/tools.json` — tool schema entry
- `pforge.ps1` + `pforge.sh` — `testbed happypath` subcommand
- `docs/plans/testbed-scenarios/*.json` — 5 new scenario fixtures
- `docs/plans/testbed-scenarios/README.md` — update with scenario list
- `docs/plans/testbed-findings/README.md` — **new**, summary index
- `docs/plans/testbed-findings/<run-date>-*.json` — finding entries
  (quantity depends on run results)
- `CHANGELOG.md` — under `[Unreleased] — targeting 2.52.0`
- Tests under `pforge-mcp/tests/testbed-*.test.mjs`

### Files agent must NOT touch

- Anything under `plan-forge-testbed/src/**` (external repo;
  scenarios observe, they do not edit)
- `pforge-mcp/orchestrator.mjs` — the harness calls it, never
  modifies it
- Existing scenario fixtures from TESTBED-01 — those are frozen

## Slices

### Slice 1: Seed scenarios + `forge_testbed_happypath` tool

**Prompt context**:
You are implementing TESTBED-02 Slice 1. TESTBED-01 shipped the
harness (`pforge-mcp/testbed/`), the defect-log schema, and empty
`docs/plans/testbed-scenarios/` + `docs/plans/testbed-findings/`
directories. Your job is to seed 5 happy-path scenarios and expose
a new MCP tool + CLI command that runs them.

**Deliverables**:
1. 5 scenario JSON files in `docs/plans/testbed-scenarios/` matching
   the frozen fixture format from TESTBED-01
2. New MCP tool `forge_testbed_happypath` registered in
   `capabilities.mjs` + `tools.json` + wired to a handler in
   `testbed/runner.mjs`
3. New CLI command `pforge testbed happypath` in `pforge.ps1` +
   `pforge.sh` (symmetric)
4. Unit tests in `pforge-mcp/tests/testbed-happypath.test.mjs` —
   cover scenario loading, filter-by-kind, summary shape, defect-log
   entry generation. Mock the actual run-plan invocation (don't spawn
   real workers in unit tests)
5. `docs/plans/testbed-scenarios/README.md` updated with the
   happy-path suite table

**Validation gate**:
```
npm --prefix pforge-mcp test -- tests/testbed-happypath.test.mjs
npm --prefix pforge-mcp test -- tests/cli-parity.test.mjs
```

**Commit message format**:
`feat(testbed-02): seed 5 happy-path scenarios + forge_testbed_happypath tool`

### Slice 2: Execute the suite + defect-log report

**Prompt context**:
Run the happy-path suite you built in Slice 1 against the live
testbed repo at `E:\GitHub\plan-forge-testbed`. Use `--quorum=power`.
Capture findings. Do not fix them.

**Deliverables**:
1. Execute `pforge testbed happypath` end-to-end, live — this is
   the evidence run
2. Commit the resulting `docs/plans/testbed-findings/<date>-*.json`
   entries (one per failure; success produces zero files)
3. Author `docs/plans/testbed-findings/README.md` — a markdown
   index with: run date, commit SHA under test, scenario pass/fail
   table, and links to each finding JSON
4. For severity `blocker` or `high` findings: file GitHub issues via
   `gh issue create` with the finding body as the issue template.
   Capture the issue URLs back into the finding JSON under
   `.filedIssues[]`
5. Append a summary block under `[Unreleased] — targeting 2.52.0`
   in CHANGELOG.md: `### Testbed evidence — happy-path suite`

**Validation gate**:
```
# Evidence files exist
test -f docs/plans/testbed-findings/README.md
ls docs/plans/testbed-findings/*.json | wc -l  # >= 0 (may be zero on all-pass)

# Schema conformance on any findings
node pforge-mcp/testbed/validate-findings.mjs docs/plans/testbed-findings/
```

**Commit message format**:
`feat(testbed-02): execute happy-path suite + publish first defect-log report`

## Acceptance criteria

- [ ] 5 happy-path scenarios registered and runnable individually
      via `pforge testbed run <scenarioId>`
- [ ] `pforge testbed happypath` runs all 5 in sequence with a
      machine-readable summary
- [ ] Unit tests cover scenario loading, summary shape, and defect-log
      writer integration (all green)
- [ ] CLI parity check passes (`scripts/audit-cli-parity.mjs` from
      TESTBED-01)
- [ ] Live evidence run committed to `docs/plans/testbed-findings/`
      with a README index
- [ ] Any blocker/high findings filed as GitHub issues and linked
      from their finding JSON
- [ ] CHANGELOG `[Unreleased]` has a "Testbed evidence" entry
- [ ] No testbed source files edited (verified via the harness
      write-guard)

## Post-phase handoff

After TESTBED-02 ships:

- **If 0 findings**: celebrate once, then write TESTBED-03 to stress
  the happy path with chaos/perf/long-horizon scenarios
- **If 1+ findings**: triage into the v2.54.x release cycle.
  Blockers get a dedicated HOTFIX phase. Highs become regular phase
  plans. Mediums/lows go on the polish backlog. TESTBED-03 still
  ships next.

This phase does NOT bump a release tag on its own; it rolls into
whatever release captures its evidence commit (likely v2.54.0
alongside TESTBED-03 prep).
