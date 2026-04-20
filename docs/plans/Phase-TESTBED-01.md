---
crucibleId: 6c1e4a82-5d93-4b76-a284-f3c8b9e5d107
source: self-hosted
status: complete
phase: TESTBED-01
arc: TESTBED-RECURSIVE
shippedAt: 2026-04-20
commits:
  - 898bfd1  # Slice 01 — forge_testbed_run core + defect-log + scenarios
  - 869b7be  # Slice 02 — forge_testbed_findings + scheduling templates + CLI-parity audit
---

# Phase TESTBED-01: Testbed harness — runner, logger, defect-log schema

> **Status**: ✅ COMPLETE — shipped 2026-04-20 (targeting v2.51.0)
> **Estimated Effort**: 2 slices
> **Risk Level**: Low-medium (new harness code; no changes to
> existing subsystems; testbed repo is the only external
> dependency and it already exists)
> **Target Version**: v2.53.0

See arc overview: [Phase-TESTBED-ARC.md](Phase-TESTBED-ARC.md)
Depends on: TEMPER-06 ✅, FORGE-SHOP-05 (in flight)

---

## Why

Plan Forge is a meta-tool. The only credible proof it works is to
run it end-to-end against a real project and observe what breaks.
`E:\GitHub\plan-forge-testbed` is the canary repo — deliberately
separate from Plan Forge itself, already cloned on the development
machine.

TESTBED-01 builds the **harness**: a runner that drives
`pforge run-plan` against fixture scenarios in the testbed, captures
every L1/L2/L3 artifact produced, and writes structured **defect-log
entries** into `docs/plans/testbed-findings/`. TESTBED-02 and -03
then supply the scenarios.

This phase also delivers two audit sub-deliverables from the arc doc:

- **G6 scheduling stub** — GitHub Actions templates for nightly
  mutation / weekly drift / daily sweep
- **G8 CLI-parity audit** — automated script asserting every MCP
  tool has a matching `pforge` CLI command

## Scope Contract

### In-scope

**Slice 1 — `forge_testbed_run` core + defect-log writer + scenarios dir layout**

- `pforge-mcp/testbed/` — **new directory**, 3 files:
  - `runner.mjs` — scenario executor (~220 LOC)
  - `defect-log.mjs` — structured finding writer conforming to the
    frozen schema in the arc doc (~90 LOC)
  - `scenarios.mjs` — scenario registry + fixture loader (~110 LOC)
- `docs/plans/testbed-scenarios/` — **new directory**, empty with
  README describing the fixture format:
  ```jsonc
  // docs/plans/testbed-scenarios/<id>.json
  {
    "scenarioId": "happy-path-01-manual-ch8",
    "kind": "happy-path" | "chaos" | "perf" | "long-horizon",
    "description": "...",
    "testbedPath": "E:\\GitHub\\plan-forge-testbed",
    "setup": [
      { "cmd": "git checkout -b testbed/<scenarioId>" }
    ],
    "execute": [
      { "tool": "pforge", "args": ["run-plan", "fixtures/plan-X.md"] }
    ],
    "assertions": [
      { "kind": "file-exists", "path": ".forge/runs/<latest>/events.log" },
      { "kind": "event-emitted", "event": "run-completed", "within": "10m" },
      { "kind": "correlationId-thread", "minSize": 3 }
    ],
    "teardown": [
      { "cmd": "git checkout master" },
      { "cmd": "git branch -D testbed/<scenarioId>" }
    ],
    "expectedDuration": "10m",
    "timeoutBudget": "15m"
  }
  ```
- `docs/plans/testbed-findings/` — **new directory**, gitignored
  `.placeholder` file to keep directory present. Real findings land
  as `<date>-<slug>.json` files matching the arc's frozen schema:
  - `findingId`, `date`, `scenario`, `correlationId`, `severity`,
    `surface`, `title`, `expected`, `observed`, `reproSteps`,
    `artefacts`, `suggestedOwnerArc`, `status`, `linkedPlanForgeIssue`
- Runner behavior (`runner.mjs`):
  - Accepts `{ scenarioId, testbedPath?, dryRun? }` — resolves
    testbed path from config (`testbed.path` in `.forge.json`) or
    the default `E:\GitHub\plan-forge-testbed`
  - Pre-flight: testbed repo exists, on clean working tree, HEAD
    matches `testbed.expectedHead` if specified (prevents running
    against a broken testbed)
  - Emits `testbed-scenario-started` hub event with
    `{ scenarioId, correlationId, testbedPath }` (correlationId is
    a new UUID per scenario run, threaded into every downstream
    event)
  - Executes `setup` steps in order; failure aborts with finding
    logged (severity: `high`, surface: `cli`)
  - Executes `execute` steps; each step captures stdout, stderr,
    exit code, duration
  - Runs `assertions` against captured artefacts + hub events +
    filesystem state
  - Executes `teardown` regardless of assertion outcome (cleanup
    must always happen)
  - Emits `testbed-scenario-completed` with
    `{ scenarioId, correlationId, status: "passed"|"failed",
    failedAssertions: [...], durationMs }`
  - Every failed assertion becomes a defect-log entry via
    `defect-log.mjs`
- Defect-log writer:
  - `logFinding(finding)` — validates against frozen schema,
    emits `testbed-finding-logged` hub event, writes
    `docs/plans/testbed-findings/<date>-<slug>.json`
  - `slug` derived from `title` (kebab-case, max 40 chars,
    de-duplicated with `-2`, `-3` suffix if collision)
  - `listFindings({ status?, severity?, since? })` — reads the dir,
    returns matching entries sorted by date desc
  - `updateFindingStatus(findingId, status, linkedPlanForgeIssue?)`
    — idempotent status transitions: `open → fixed|wontfix|duplicate`
- Assertion kinds supported (all validated in scenarios):
  - `file-exists` — path resolves relative to testbed root
  - `file-contains` — regex match against file contents
  - `event-emitted` — hub event appears within `within` time window
  - `correlationId-thread` — events sharing the scenario's
    correlationId count reaches `minSize`
  - `exit-code` — last execute step matches expected code
  - `duration-under` — last execute step under `budgetMs`
  - `artefact-count` — files under `.forge/runs/<latest>/` meet
    `min` count
- MCP tool:
  - **`forge_testbed_run`** — input:
    `{ scenarioId, testbedPath?, dryRun? }`. Output:
    `{ scenarioId, correlationId, status, durationMs,
    assertions: [...], findings: [...] }`.
    `writesFiles: true` (writes defect log + hub events),
    `network: false`, `risk: "medium"`
- TOOL_METADATA entry in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.53.0"`; full contract
- Hub events (frozen per arc):
  - `testbed-scenario-started` (payload: `scenarioId`, `correlationId`,
    `testbedPath`)
  - `testbed-scenario-completed` (payload: `scenarioId`,
    `correlationId`, `status`, `failedAssertions`, `durationMs`)
  - `testbed-finding-logged` (payload: `findingId`, `severity`,
    `surface`, `correlationId`)
- Telemetry: OTEL span per scenario run with scenarioId, duration,
  assertion count, finding count
- **L3 capture** on every `testbed-finding-logged` with severity
  `blocker` or `high` via `captureMemory`: tags `testbed`,
  `finding`, `<surface>`, `<severity>`. Payload redacted of file
  contents
- Tests in `pforge-mcp/tests/testbed-runner.test.mjs` (**new**,
  ~28 tests):
  - Each assertion kind (7 kinds × 2 fixtures: passing + failing)
  - Pre-flight: testbed missing → fail fast with clear message
  - Pre-flight: dirty working tree → fail fast
  - Pre-flight: HEAD mismatch when expected → fail fast
  - Teardown runs even after assertion failure
  - Defect log writer schema validation (required fields, enum
    values)
  - Defect log slug generation + collision handling
  - `listFindings` filters by status/severity/since
  - `updateFindingStatus` idempotency
  - Hub events emitted in correct order
  - correlationId threaded through all events
  - Dry-run skips `execute` + `teardown`, runs `setup` + assertions
  - Scenario-not-found error clear
  - Scenario fixture schema validation
- Tests in `pforge-mcp/tests/testbed-defect-log.test.mjs` (**new**,
  ~8 tests, separate file for focus):
  - Schema enforcement rejects missing severity
  - Frozen enum values for severity, surface, status, ownerArc
  - File written under `docs/plans/testbed-findings/`
  - Directory auto-created when missing
  - Idempotent re-log dedupe by `findingId`

**Slice 2 — Scheduling templates + CLI-parity audit + `forge_testbed_findings` tool**

- `templates/schedules/` — **new directory**:
  - `plan-forge-nightly-mutation.yml` — GitHub Actions workflow:
    ```yaml
    name: Plan Forge Nightly Mutation
    on:
      schedule:
        - cron: '0 6 * * *'  # 06:00 UTC daily
      workflow_dispatch:
    jobs:
      mutation:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '20' }
          - run: npm ci
            working-directory: pforge-mcp
          - run: ./pforge.sh tempering run --full-mutation
          - uses: actions/upload-artifact@v4
            with:
              name: tempering-mutation-${{ github.run_id }}
              path: .forge/tempering/
    ```
  - `plan-forge-weekly-drift.yml` — weekly (`cron: '0 6 * * 1'`,
    Mondays 06:00 UTC) running `pforge liveguard drift
    --autoIncident` with artifact upload
  - `plan-forge-daily-sweep.yml` — daily (`cron: '0 5 * * *'`,
    05:00 UTC) running `pforge sweep` with artifact upload
  - `README.md` — installation instructions, cron equivalents
    (for users on cron not Actions), Windows Task Scheduler
    equivalents
- `scripts/audit-cli-parity.mjs` — **new**, ~120 LOC:
  - Loads `pforge-mcp/capabilities.mjs` TOOL_METADATA, extracts
    every `forge_*` tool name
  - Parses `pforge.ps1` + `pforge.sh` for top-level command
    routing (switch/case blocks, `cmd_*` function definitions)
  - For each MCP tool, derives the expected CLI command using
    the mapping convention (`forge_run_plan` → `pforge run-plan`,
    `forge_testbed_run` → `pforge testbed run`, etc.)
  - Reports: `{ matched: [...], mcpOnly: [...], cliOnly: [...] }`
  - Exit code 0 if matched-count equals tool count; 1 otherwise
  - **NOT a build break** — runs as an informational audit; any
    gap becomes a defect-log entry via `forge_testbed_findings`
    with severity `medium`, surface `cli`
- `scripts/audit-cli-parity.test.mjs` — **new**, ~8 tests:
  - Matched tool passes
  - MCP-only tool reported
  - CLI-only function reported (not a miss, just noted)
  - Convention mapping: underscore → space, nested path → sub-command
- MCP tool:
  - **`forge_testbed_findings`** — input:
    `{ status?, severity?, since?, limit? }`. Output:
    `{ findings: [...], total, truncated }`. `writesFiles: false`,
    `network: false`, `risk: "low"`
- TOOL_METADATA entry + regenerated `tools.json`; `addedIn: "2.53.0"`
- `forge_smith` panel: new **"Testbed:"** row showing:
  `scenarios registered / findings open (by severity) / last
  scenario ts / CLI-parity: N matched / N total`
- `capabilities.mjs` updates for Testbed row
- Tests in `pforge-mcp/tests/testbed-findings-tool.test.mjs`
  (**new**, ~10 tests):
  - Filter by status, severity, since; all combinations
  - Limit + truncation
  - Empty directory → `{ findings: [], total: 0 }`
  - Malformed finding file skipped with warn
  - Sort order: date desc

### Out of scope (later)

- Actual scenarios — happy-path / chaos / perf / long-horizon all
  land in TESTBED-02 and TESTBED-03
- GitHub App or a daemon scheduler for Plan Forge itself — templates
  are the deliverable this phase. Users wire via Actions, cron, or
  Task Scheduler. See arc doc
- OTel `/metrics` endpoint — ships in TESTBED-03 per arc
- Automated issue-filing from defect log → GitHub issues —
  `linkedPlanForgeIssue` field is set manually this phase; auto-file
  helper in a later phase
- Cross-repo correlationId threading — scenarios run against one
  testbed at a time; multi-project federation is future work
- Interactive harness UI in dashboard — a Testbed tab could surface
  scenario runs + findings; decision deferred until we see usage
  patterns from TESTBED-02/03

### Forbidden actions

- Do NOT run scenarios against the testbed `main` branch — runner
  enforces a branch-off in every scenario's `setup` step; runner
  additionally validates current branch before `execute` runs
- Do NOT commit testbed artefacts (logs, screenshots, `.forge/`
  directories from the testbed) into Plan Forge's repo. Artefact
  paths in findings reference testbed-local paths only
- Do NOT silence a failing assertion to make a scenario "pass" —
  every failure is a defect-log entry; runner exit code reflects
  real outcome
- Do NOT edit testbed production code from the runner — the harness
  drives `pforge` which drives the testbed. No shortcuts, no direct
  file writes to testbed source
- Do NOT treat CLI-parity gaps as build breaks — they are findings
  the team triages, not failures the runner blocks on
- Do NOT store testbed secrets (API keys, tokens) in finding files
  — `defect-log.mjs` runs a redaction pass over `observed` and
  `artefacts` fields
- Do NOT let the runner swallow testbed failures silently — if a
  `setup` or `execute` step non-zero-exits, it becomes a finding
  and the scenario reports `failed`
- Do NOT run two scenarios in parallel against the same testbed —
  runner acquires a file lock at `.forge/testbed.lock`; second
  invocation waits or fails with `ERR_TESTBED_LOCKED`
- Do NOT modify the frozen arc schema (defect log fields, hub event
  names, scenario fixture shape) — changes require an arc-level
  amendment, not a phase-level decision

## Slices

### Slice 1 — `forge_testbed_run` core + defect-log writer + scenarios layout

**Files touched:**
- `pforge-mcp/testbed/runner.mjs` — **new**, ~220 LOC
- `pforge-mcp/testbed/defect-log.mjs` — **new**, ~90 LOC
- `pforge-mcp/testbed/scenarios.mjs` — **new**, ~110 LOC
- `pforge-mcp/server.mjs` — 1 tool handler for `forge_testbed_run`
  (~70 LOC)
- `pforge-mcp/capabilities.mjs` — 1 TOOL_METADATA entry
- `pforge-mcp/tools.json` — auto-regenerated
- `docs/plans/testbed-scenarios/README.md` — **new**, fixture format
  docs
- `docs/plans/testbed-findings/.placeholder` — **new**, empty
- `.gitignore` — ignore `docs/plans/testbed-findings/*.json` (findings
  are local audit trail, not repo history); keep `.placeholder`
  tracked
- `pforge-mcp/tests/testbed-runner.test.mjs` — **new**, ~28 tests
- `pforge-mcp/tests/testbed-defect-log.test.mjs` — **new**, ~8 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **tool count updated** (counts exactly depend on shipping order
of SHOP-04/05/07/06 and HOTFIX-2.50.1; this slice adds 1 tool).

### Slice 2 — Scheduling templates + CLI-parity audit + `forge_testbed_findings`

**Files touched:**
- `templates/schedules/plan-forge-nightly-mutation.yml` — **new**
- `templates/schedules/plan-forge-weekly-drift.yml` — **new**
- `templates/schedules/plan-forge-daily-sweep.yml` — **new**
- `templates/schedules/README.md` — **new**, install docs
- `scripts/audit-cli-parity.mjs` — **new**, ~120 LOC
- `scripts/audit-cli-parity.test.mjs` — **new**, ~8 tests
- `pforge-mcp/server.mjs` — 1 tool handler for `forge_testbed_findings`
  (~50 LOC)
- `pforge-mcp/capabilities.mjs` — 1 TOOL_METADATA entry + Testbed
  smith row
- `pforge-mcp/tools.json` — auto-regenerated
- `pforge-mcp/tests/testbed-findings-tool.test.mjs` — **new**, ~10
  tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass. Additional manual gate: run `node scripts/audit-cli-parity.mjs`
and confirm output lists matched/mcpOnly/cliOnly categories cleanly.

## Success Criteria

- 2 new MCP tools registered (`forge_testbed_run`,
  `forge_testbed_findings`)
- Defect-log schema validation enforced (frozen fields + enums)
- Defect log writer produces valid entries under
  `docs/plans/testbed-findings/`
- 7 assertion kinds functional: `file-exists`, `file-contains`,
  `event-emitted`, `correlationId-thread`, `exit-code`,
  `duration-under`, `artefact-count`
- Pre-flight enforces testbed repo presence + clean tree + branch
- Teardown always runs, even after assertion failure
- File lock prevents parallel scenario runs
- 3 GitHub Actions workflow templates present in
  `templates/schedules/` with README
- CLI-parity audit script runs with exit code matching gap count
- Hub events emitted in correct order with correlationId threading
- `forge_smith` Testbed row shows scenario + finding + parity
  counts
- Zero new TODO/FIXME/stub markers on touched files
- Test count +54
- CHANGELOG entry under `[Unreleased]` targeting v2.53.0
- `Phase-TESTBED-01.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- TEMPER-06 ✅ — full closed loop (required per arc doc)
- FORGE-SHOP-05 (in flight) — timeline + correlationId threading
  makes scenario replay meaningful. This phase can **draft-and-ship**
  Slice 1 before SHOP-05 merges (runner doesn't read timeline); the
  richer correlationId recall during finding triage is a SHOP-05
  consumer
- Existing `pforge-mcp/capabilities.mjs` + `tools.json` regen
  pipeline
- Existing `pforge-mcp/hub.mjs` event bus
- Existing `pforge-mcp/telemetry.mjs` OTEL wiring
- Existing `E:\GitHub\plan-forge-testbed` repo on a clean `main`

**On later phases:**
- TESTBED-02 — supplies happy-path scenario fixtures that the
  runner executes
- TESTBED-03 — supplies chaos/perf/long-horizon fixtures plus the
  `/metrics` OTel endpoint
- AUTO-UPDATE-01 — scenarios will validate `pforge update
  --from-github` once that ships; no direct dependency this phase

## Notes for the executing agent

- The **assertion engine** is the highest-value part of Slice 1.
  Each kind is a small pure function; write the test first for each
  (TDD), then add the dispatch table. The dispatch table keeps the
  runner extensible without touching the core loop
- The **correlationId threading** must be verified end-to-end in
  at least one test: start a scenario, run two `execute` steps,
  assert every hub event emitted between start and completion
  shares the scenario's correlationId
- The **file lock** is simple: write `process.pid + ts` to
  `.forge/testbed.lock` on acquire, check for stale (> 1 hour) on
  attempt. Stale locks are auto-reclaimed with a warn
- The **defect-log schema validator** is a pure function — keep
  the frozen enum lists at the top of the file for easy audit.
  Don't import a schema library; a 40-line validator is sufficient
- The **CLI-parity mapping convention** needs to be documented in
  the script's header comment so future contributors know why
  `forge_run_plan` maps to `pforge run-plan` and not
  `pforge runplan`. Underscores become spaces; nested paths
  (e.g., `forge_testbed_run`) become subcommands (`pforge testbed
  run`)
- The **GitHub Actions templates** are shipped as `.yml` files
  but users must copy them to their own repo's
  `.github/workflows/`. The README explains this — do not
  auto-install them
- The **Testbed smith row** is cosmetic and easy to forget; bake
  it into the capabilities snapshot test so missing it is caught
- The **testbed path** default `E:\GitHub\plan-forge-testbed` is
  Windows-specific; on non-Windows platforms the runner reads
  `testbed.path` from `.forge.json` and errors with a clear
  `ERR_TESTBED_PATH_REQUIRED` if unset. Platform-specific defaults
  are documented but the config is authoritative
