# Phase-MEMORY-QA: End-to-End Validation of Hallmark, Anvil, Lattice, and Capability Negotiation (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Tests (integration + testbed) + scripts + a single docs entry. No production code edits.
> **Estimated cost**: $8.00–$13.00 (7 slices, integration-heavy with a real OpenBrain target)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: User request after approving prior phases: *"we should also add a QA test at the end to try and validate our new memory updates are working as designed."*
> **Position in chain**: 6 of 6 — final phase. Depends on Phase-HALLMARK-CONTRACT, Phase-PROVENANCE (released `v0.7.0`), Phase-ANVIL, Phase-LATTICE (released `v2.95.0`), Phase-MEMORY-DOCS-SWEEP (docs accurate).
> **Release target**: Adds tests + a testbed scenario. Bumps Plan-Forge patch to `v2.95.1` only if test scaffolding lands in the public test surface (Slice 7 decides; default = no version bump, tests are internal CI).

---

## Scope Contract

### In Scope

#### Integration test suite — Plan-Forge

- `pforge-mcp/tests/integration/memory-upgrade/` (new directory) — nine test files, one per scenario below:
  1. `01-hallmark-roundtrip.test.mjs` — `buildProvenance` → `validateProvenance` → store as JSON → reparse → still valid.
  2. `02-capability-negotiation.test.mjs` — Real OpenBrain target (testcontainer or env-pointed). Probes `/health`, verifies cached `capabilities`, asserts second L3 write does not re-probe.
  3. `03-provenance-conditional-write.test.mjs` — Toggle a mocked OpenBrain `/health` to return `["provenance"]` vs `[]`; verify Plan-Forge writes provenance only in the first case.
  4. `04-source-roundtrip.test.mjs` — Write a memory with provenance through `POST /memories`, query via `match_thoughts_by_source(file, hash)`, assert the originating chunk is returned.
  5. `05-anvil-cache-behavior.test.mjs` — Wrap a synthetic tool with `withAnvil`. Assert miss → hit on identical inputs; miss when input byte changes; miss when codeHash changes.
  6. `06-slag-heap-dlq.test.mjs` — Force OpenBrain to 500 once, then 200. Assert record lands on DLQ, then drains successfully on the next `anvilDlqDrain` call.
  7. `07-lattice-callers-accuracy.test.mjs` — Index a fixture project with three known caller→callee edges. Assert `forge_lattice_callers` returns exactly those edges.
  8. `08-hallmark-show-source.test.mjs` — Capture a memory citing `src/foo.mjs#42-60`. `forge_hallmark_show <id>` returns the cited source file/byte range; `forge_hallmark_verify <id>` re-reads the bytes and reports `verified: true`.
  9. `09-backward-compat-old-openbrain.test.mjs` — Point at OpenBrain v0.6.x fixture (mocked `/health` returns 404 or `capabilities: []`). Assert Plan-Forge continues to write memories successfully without provenance and surfaces a one-time warning + `openbrain-too-old` hub event.
- `pforge-mcp/tests/integration/memory-upgrade/fixtures/` — shared fixtures:
  - `tiny-project/` — 6 .mjs files, 2 .py files, known function names + edges.
  - `expected-callers.json`, `expected-hallmark-records.json`.
- `pforge-mcp/tests/integration/memory-upgrade/helpers/` — testkit:
  - `mock-openbrain.mjs` — Hono-style HTTP mock that can swap `capabilities`, fail on demand, and assert request shape.
  - `with-tmp-forge-home.mjs` — `mkdtempSync` wrapper that points all `.forge/*` paths at a tmp dir.

#### Testbed scenario

- `pforge-mcp/testbed/scenarios/memory-upgrade-e2e.mjs` (new) — a `forge_testbed_run` scenario:
  1. Spin up a tiny in-process project.
  2. Boot the orchestrator with a mock-OpenBrain pointed at it.
  3. Run a 3-slice fixture plan exercising `forge_analyze` (Anvil-wrapped), `forge_sweep`, and `brain_capture` (Hallmark + capability-aware).
  4. Run `forge_lattice_index` on the project.
  5. Inspect `.forge/anvil/`, `.forge/lattice/`, OpenBrain captured records — verify all expected artifacts exist.
  6. Emit a JSON summary the testbed schema expects.
- Registered in the testbed scenario index so `forge_testbed_happypath --scenario=memory-upgrade-e2e` discovers it.

#### Script

- `scripts/memory-qa-smoke.sh` and `scripts/memory-qa-smoke.ps1` — operator-runnable smoke that:
  1. Verifies `pforge anvil stat`, `pforge hallmark show --help`, `pforge lattice stat` return without error.
  2. Verifies `forge_capabilities` lists 15 new tools.
  3. Verifies `.forge/anvil/` and `.forge/lattice/` are in the suggested `.gitignore` template.
  4. Verifies `OpenBrain /health` (if `OPENBRAIN_URL` set) responds and includes `provenance` capability when version >= 0.7.0.
- Both scripts exit non-zero on any failure with a specific failing-check name in the output.

#### One docs entry

- `docs/MEMORY-ARCHITECTURE.md` (modify) — add a "QA & Validation" section at the bottom pointing at the testbed scenario name and the smoke script. Single section, ≤ 30 lines added. (This is the only allowed docs edit in this phase — testbed location must be discoverable.)

#### Plan post-mortem capture

- After all slices pass, the user runs `forge_run_plan --report` for this plan. The report is committed into the plan file's Post-Mortem section in Slice 7.

### Out of Scope

- **Production code changes.** This phase tests existing code. If a test reveals a bug, file a `forge_bug_register` issue and proceed; the fix is scheduled into `v2.95.1` work.
- **Unit-test gap-filling for Hallmark/Anvil/Lattice modules.** Those landed in prior phases. This phase is *integration + end-to-end*.
- **Performance benchmarking.** A perf phase is a separate concern; this phase asserts correctness.
- **Real-database OpenBrain CI run.** Tests use a mock-OpenBrain HTTP server by default; the real-OpenBrain integration is opt-in via `OPENBRAIN_URL` env var (Slice 2 supports both modes).
- **Load testing / chaos testing.** Outside scope.
- **Crucible flow validation.** Crucible writes will pick up provenance automatically once `brain.mjs` is upgraded; this phase doesn't test Crucible-specific paths.
- **Tree-sitter-specific Lattice tests** — those landed in Phase-LATTICE Slice 3. This phase tests Lattice with whatever chunker is installed (pure-JS by default).

### Forbidden Actions

- **Do NOT modify `pforge-mcp/brain.mjs`, `anvil.mjs`, `lattice.mjs`, `pipelines.mjs`, or `pforge-sdk/src/hallmark.mjs`.** Tests assert the existing surface. Bugs go to a separate fix phase.
- **Do NOT introduce a runtime dep.** Tests use `node:test` or the existing vitest stack and zero-dep mocks.
- **Do NOT depend on a live external network in CI.** Real OpenBrain is opt-in via env; default CI path uses the mock.
- **Do NOT skip tests with `it.skip`.** Failing tests must fail visibly so the plan execution surfaces them. Conditional skips (e.g., `it.skipIf(!process.env.OPENBRAIN_URL)`) are allowed only on the real-network test mode.
- **Do NOT write to `.forge/` outside a tmp directory.** All tests use the `with-tmp-forge-home.mjs` helper. Slice gate audits.
- **Do NOT seed OpenBrain with permanent test data.** All inserts during the real-OpenBrain mode use a project label `memory-qa-<timestamp>` and are torn down in `afterAll`. Slice 2 implements this discipline.
- **Do NOT modify the Plan-Forge release tag `v2.95.0`.** If Slice 7 bumps to `v2.95.1` for test-scaffolding visibility, that is a *new* tag.
- **Do NOT add new MCP tools.** This phase is read-only on the tool surface.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Mock vs real OpenBrain in CI | RESOLVED | Default = mock (zero-network, fast, deterministic). Real = opt-in via `OPENBRAIN_URL` + `OPENBRAIN_API_KEY` env vars. Slice 2 provides both paths. |
| 2 | Test runner | RESOLVED | vitest (matches existing pforge-mcp test stack — no new tooling). |
| 3 | Fixture project size | RESOLVED | 8 source files total (6 mjs + 2 py), ~400 lines combined. Big enough for callers/callees, small enough to keep test runtime under 5s. |
| 4 | DLQ test side effects | RESOLVED | All DLQ files written to tmp dir (via helper). Slice 5 includes assertion that no DLQ files appear outside the tmp dir during the suite. |
| 5 | Capability cache reset for testing | RESOLVED | `brain.mjs` exports an internal `_resetCapabilityCache()` for tests only (added in Phase-ANVIL Slice 3 if not already). If absent, tests use a fresh subprocess per assertion. (Decision: test in subprocess if no reset hook exists. Slice 2 checks.) |
| 6 | Testbed scenario invocation | RESOLVED | Discoverable via `forge_testbed_happypath`. Scenario file follows the existing schema in `pforge-mcp/testbed/`. |
| 7 | Smoke-script error reporting | RESOLVED | Exit code = number of failing checks. Stdout shows `[OK] <check>` / `[FAIL] <check> - <reason>`. Parseable for CI dashboards. |
| 8 | Failure handling discipline | RESOLVED | If a test reveals a bug: register it via `forge_bug_register`, mark the test `it.fails(...)` or `it.fixme(...)` only with a tracked bug id in the test name. NEVER skip silently. |
| 9 | Where the smoke script lives | RESOLVED | `scripts/` at repo root. Discoverable; not bundled into the published package. |
| 10 | Whether to publish test artifacts | RESOLVED | No. Tests stay in `pforge-mcp/tests/integration/memory-upgrade/`. Not exported. |
| 11 | Cross-repo coordination | RESOLVED | OpenBrain v0.7.0 fixture for backward-compat test is a recorded HTTP fixture, NOT a separate container. Keeps this phase repo-local. |
| 12 | Patch version bump | RESOLVED | Default = no bump. If Slice 7 reveals a documentation gap that warrants a docs-only `v2.95.1` patch, that's a separate phase. |

---

## Acceptance Criteria

### Scenario 1 — Hallmark roundtrip

- **MUST**: `buildProvenance({ toolName: "test" })` → serialize → parse → `validateProvenance(parsed) === { ok: true }`.
- **MUST**: Tampering with any required field after serialization causes `validateProvenance` to return `{ ok: false, errors: [...] }` with at least one error specifying the field name.

### Scenario 2 — Capability negotiation

- **MUST**: First L3 write triggers exactly one `GET /health` request (verified by mock-OpenBrain hit counter).
- **MUST**: Second L3 write triggers zero `GET /health` requests.
- **MUST**: `_resetCapabilityCache()` (or subprocess restart) re-enables the probe.

### Scenario 3 — Provenance conditional write

- **MUST**: When mock `/health` returns `{ capabilities: ["provenance"] }`, `POST /memories` body includes `metadata.provenance`.
- **MUST**: When mock `/health` returns `{ capabilities: [] }`, `POST /memories` body OMITS `metadata.provenance` and the test captures a `console.warn` containing `openbrain-too-old`.

### Scenario 4 — Source roundtrip

- **MUST**: Capture a memory citing `src/foo.mjs` byte range `[120, 180)` with `contentHash`.
- **MUST**: `match_thoughts_by_source({ file: "src/foo.mjs", hash: <hash> })` (RPC from Phase-PROVENANCE) returns at least one record whose `id` matches the captured memory.

### Scenario 5 — Anvil cache behavior

- **MUST**: A wrapped tool invoked twice with identical args runs its inner function exactly once. (Spy-counter assertion.)
- **MUST**: Mutating one byte of input or `codeHashSeed` causes a second inner-function run.

### Scenario 6 — Slag-heap DLQ

- **MUST**: Mock OpenBrain configured to return 500 once. Memory write attempt results in `.forge/anvil/dlq/<today>.jsonl` (in tmp) gaining one record. Hub event `l3-deferred` was emitted.
- **MUST**: A subsequent `anvilDlqDrain` with mock now returning 200 drains the record and the file is empty (or deleted).

### Scenario 7 — Lattice callers accuracy

- **MUST**: Index fixture project. `forge_lattice_callers({ name: "frobnicate" })` returns exactly the chunks the fixture marks as callers (compared via `expected-callers.json`).
- **MUST**: A name with zero callers returns `{ items: [], message: "..." }` (friendly-empty per ACI standard).

### Scenario 8 — `forge_hallmark_show` / `forge_hallmark_verify`

- **MUST**: `forge_hallmark_show <id>` returns the originating `sourceFile`, `byteRange`, `contentHash` matching what was captured.
- **MUST**: `forge_hallmark_verify <id>` re-reads `sourceFile` at `byteRange`, hashes it, and returns `{ verified: true }` when unchanged.
- **MUST**: After modifying the source file, the next `forge_hallmark_verify <id>` returns `{ verified: false, currentHash, expectedHash }`.

### Scenario 9 — Backward compat (old OpenBrain)

- **MUST**: Mock OpenBrain returning HTTP 404 on `/health` (legacy behavior) is treated as "no provenance capability".
- **MUST**: Memory write still succeeds; record stored without provenance.
- **MUST**: One `openbrain-too-old` hub event fires for the lifetime of the process — not one per write.

### Testbed scenario

- **MUST**: `forge_testbed_happypath` lists `memory-upgrade-e2e` in its scenarios output.
- **MUST**: Running the scenario produces a summary JSON containing keys `{ anvilHits, anvilMisses, latticeChunks, hallmarkRecords, dlqCount }` and all values are non-negative numbers.
- **MUST**: Scenario teardown removes the tmp directory (asserted by post-run filesystem check).

### Smoke script

- **MUST**: `scripts/memory-qa-smoke.sh` and `.ps1` both exist, both have identical check sets, both exit 0 on a fresh post-Phase-LATTICE checkout.
- **MUST**: Each failing check prints `[FAIL] <name> - <reason>`.
- **MUST**: When `OPENBRAIN_URL` is unset, OpenBrain-specific checks print `[SKIP] <name> - OPENBRAIN_URL not set` and do not count as failures.

### Forbidden-action fence

- **MUST**: `git diff --name-only` from Slice 1 base to Slice 7 head shows ZERO entries matching `pforge-mcp/brain.mjs`, `pforge-mcp/anvil.mjs`, `pforge-mcp/lattice.mjs`, `pforge-mcp/pipelines.mjs`, `pforge-sdk/src/hallmark.mjs`.
- **MUST**: Only test files, fixtures, helpers, scripts, the one allowed `docs/MEMORY-ARCHITECTURE.md` section, and the testbed scenario file are modified.

### Bug-reporting discipline

- **MUST**: Any failing test that reveals a real bug is recorded via `forge_bug_register` BEFORE marking the test `it.fails` or `it.fixme`. The test name must include the bug id.

---

## Execution Slices

### Slice 1: Testkit — `mock-openbrain.mjs` + `with-tmp-forge-home.mjs` + fixture project [sequential]

**Goal**: Foundation that every later scenario depends on. Build once.

**Files**:
- `pforge-mcp/tests/integration/memory-upgrade/helpers/mock-openbrain.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/helpers/with-tmp-forge-home.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/fixtures/tiny-project/**` (new — 8 source files)
- `pforge-mcp/tests/integration/memory-upgrade/fixtures/expected-callers.json` (new)
- `pforge-mcp/tests/integration/memory-upgrade/fixtures/expected-hallmark-records.json` (new)
- `pforge-mcp/tests/integration/memory-upgrade/helpers/helpers.test.mjs` (new — meta-test that asserts the helpers work)

**Depends On**: Phase-MEMORY-DOCS-SWEEP (final phase before this).

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/helpers/helpers.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 2: Scenarios 1–3 (Hallmark roundtrip + capability negotiation + conditional write) [sequential]

**Goal**: Cover the contract layer: provenance schema and capability negotiation, which everything else assumes.

**Files**:
- `pforge-mcp/tests/integration/memory-upgrade/01-hallmark-roundtrip.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/02-capability-negotiation.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/03-provenance-conditional-write.test.mjs` (new)

**Depends On**: Slice 1.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/0[123]-*.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 3: Scenario 4 (source roundtrip — RPC) [sequential]

**Goal**: Exercise the new OpenBrain RPC end-to-end. Mock OpenBrain implements `match_thoughts_by_source` per Phase-PROVENANCE contract.

**Files**:
- `pforge-mcp/tests/integration/memory-upgrade/04-source-roundtrip.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/helpers/mock-openbrain.mjs` (modify — implement RPC fixture)

**Depends On**: Slice 2.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/04-*.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 4: Scenarios 5–6 (Anvil cache behavior + DLQ) [sequential]

**Goal**: Cache semantics + failure-isolation guarantees.

**Files**:
- `pforge-mcp/tests/integration/memory-upgrade/05-anvil-cache-behavior.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/06-slag-heap-dlq.test.mjs` (new)

**Depends On**: Slice 3.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/0[56]-*.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 5: Scenarios 7–9 (Lattice callers + Hallmark show/verify + backward compat) [sequential]

**Goal**: Cover Lattice + Hallmark inspection tools + the old-OpenBrain compat guarantee.

**Files**:
- `pforge-mcp/tests/integration/memory-upgrade/07-lattice-callers-accuracy.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/08-hallmark-show-source.test.mjs` (new)
- `pforge-mcp/tests/integration/memory-upgrade/09-backward-compat-old-openbrain.test.mjs` (new)

**Depends On**: Slice 4.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/0[789]-*.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 6: Testbed scenario + registration [sequential]

**Goal**: The all-in-one happy path discoverable via the existing testbed surface.

**Files**:
- `pforge-mcp/testbed/scenarios/memory-upgrade-e2e.mjs` (new)
- `pforge-mcp/testbed/scenarios/index.mjs` or equivalent (modify — register scenario)
- `pforge-mcp/tests/integration/memory-upgrade/10-testbed-scenario.test.mjs` (new — meta-test that runs the testbed scenario via the public `forge_testbed_happypath` API and asserts the summary shape)

**Depends On**: Slice 5.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/integration/memory-upgrade/10-*.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 7: Smoke scripts + docs section + final fence + post-mortem [sequential]

**Goal**: Operator-runnable smoke + the one allowed docs edit + the forbidden-action fence assertion + post-mortem write.

**Files**:
- `scripts/memory-qa-smoke.sh` (new)
- `scripts/memory-qa-smoke.ps1` (new)
- `docs/MEMORY-ARCHITECTURE.md` (modify — add "QA & Validation" section, ≤30 lines)
- `docs/plans/Phase-MEMORY-QA-PLAN.md` (modify — fill in Post-Mortem section)

**Depends On**: Slice 6.

**Validation Gate**:
```bash
test -x scripts/memory-qa-smoke.sh && test -f scripts/memory-qa-smoke.ps1 && grep -q 'QA & Validation' docs/MEMORY-ARCHITECTURE.md && [ "$(git diff --name-only HEAD~7 HEAD -- 'pforge-mcp/brain.mjs' 'pforge-mcp/anvil.mjs' 'pforge-mcp/lattice.mjs' 'pforge-mcp/pipelines.mjs' 'pforge-sdk/src/hallmark.mjs' | wc -l)" = "0" ] && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Mock-OpenBrain drifts from real OpenBrain contract | The mock is fixture-driven from the OpenBrain spec in `e:/GitHub/OpenBrain/docs/04-MCP-SERVER.md`. Phase-MEMORY-DOCS-SWEEP keeps that spec current. Real-OpenBrain opt-in mode catches drift periodically. |
| Capability cache pollution across tests | Each test uses `_resetCapabilityCache()` (Decision 5) or runs in subprocess. Slice 2 verifies the reset hook exists; if absent, falls back to subprocess. |
| `.forge/` leak from a careless test | Slice 1 helpers force tmp dirs; final fence (Slice 7) checks `git status` for stray `.forge/` files. |
| Flaky tests from race conditions in mock HTTP | Mock uses a single in-process Hono-style handler with sequential request handling. No real ports unless `OPENBRAIN_URL` is set. |
| Backward-compat test missing a real failure mode | The test exercises both 404 on `/health` and an explicit `capabilities: []` response. If real-world OpenBrain returns yet another shape, file a bug; this phase tests the documented contract. |
| Test runtime balloons | 8-file fixture keeps Lattice fast. Soft target: each scenario < 2s, full suite < 30s. Slice gates use `--reporter=dot` to keep output bounded. |
| Bug discovered mid-phase blocks completion | Discipline (Decision 8 / Forbidden Action 1): file the bug, mark `it.fixme(<bug-id>)`, complete the phase, schedule the fix for `v2.95.1`. |
| Real-OpenBrain mode pollutes production data | All real-mode inserts tagged `project = "memory-qa-<timestamp>"` with mandatory afterAll teardown. Slice 2 enforces. |

---

## Definition of Done

- All seven slices pass their validation gates.
- Full pforge-mcp suite (`cd pforge-mcp && npx vitest run`) green, including the new integration directory.
- `forge_testbed_happypath` lists and runs `memory-upgrade-e2e` successfully.
- `scripts/memory-qa-smoke.sh` on bash and `.ps1` on PowerShell both exit 0 on a freshly built repo.
- `git status` after the suite is clean — no stray tmp files.
- The fence assertion (Slice 7 gate) confirms zero production-code edits.
- Post-Mortem section of this plan is filled in with: bug count, real-OpenBrain mode result (if exercised), runtime summary, any gaps found.
- A summary line is added to `CHANGELOG.md` under the already-released `[2.95.0]` as a tail note: `- QA: end-to-end memory-upgrade test suite added (see scripts/memory-qa-smoke.*).` (This is a CHANGELOG append, not a version bump — allowed because it's documentation of test coverage shipped after the release.)

---

## Post-Mortem

_To be filled in after execution. Capture:_
- Number of bugs surfaced and their IDs (filed via `forge_bug_register`).
- Was the real-OpenBrain opt-in path exercised? On what version? Any drift between mock and real?
- Total suite runtime; per-scenario runtime breakdown.
- Did the testbed scenario reveal anything the unit-level integration tests missed?
- Did the capability-negotiation cache behave correctly across all subprocess boundaries?
- Recommended follow-ups for `v2.95.1` or later phases (perf, chaos, real-DB CI lane).
