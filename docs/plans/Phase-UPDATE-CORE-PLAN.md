# Phase UPDATE-CORE — One Node implementation of the update scan and setup's preset tables

> **Status**: **✅ Complete 2026-10-03** — ships in v3.30.0. See `## What actually shipped`.
> **Issue**: [#299](https://github.com/srnichols/plan-forge/issues/299)
> **Tracks**: `pforge-mcp/update-plan.mjs` (new), `pforge-mcp/preset-catalog.json` (new), `pforge.ps1` `Invoke-Update`, `pforge.sh` `cmd_update`, `setup.ps1`, `setup.sh`, tests.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute ✅ → Review ✅ → Ship (3.30.0)
> **Session budget**: 7 slices. Break after S3 (PowerShell wired) and resume with `pforge run-plan --resume-from 4`.

---

## What actually shipped

- `pforge-mcp/update-plan.mjs` (`plan` / `report`) holds the update scan; `pforge.ps1` lost about 300 lines and `pforge.sh` about 190. Both shells print identical `UPDATE` / `NEW` / `KEEP` lists for every fixture (`update-plan-baseline.test.mjs`).
- D1: PowerShell now adds missing shared and internal instructions as `NEW`, as Bash did.
- `pforge-mcp/preset-catalog.json` feeds setup's stack labels, default commands and shared-file list in both shells.
- Found while running it: slices 3–4 sent guidance files to the update guard even when no guard was available, failing under Windows PowerShell 5.1; fixed in both shells with a regression test (1c5935d9). One shared test helper (`tests/helpers/update-runtime.mjs`) now lists the modules a fake update source needs.
- Slice 6's gate rehearsed the `-dev` HEAD, which `rehearse.mjs` refuses by design (#316). Rehearsed a VERSION 3.30.0 commit instead: 229/0 from v3.29.0 and from v3.29.3. A new gate-lint rule, `release-rehearsal-in-gate`, flags this at hardening time.

## Execution Hold

Lift the hold only when all of these are true:

- [x] v3.29.0 is tagged and released (3.29.0–3.29.3 shipped). This phase rewrites the updater that 3.29.0 ships, so it must start from a released baseline that `scripts/release/rehearse.mjs` can update *from*.
- [x] No other in-flight plan is editing `pforge.ps1`, `pforge.sh`, `setup.ps1` or `setup.sh`.
- [x] `git status` is clean on `planning/main`.

**To resume**: set Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-UPDATE-CORE-PLAN.md`.

---

## Why this phase exists

`pforge update` exists twice: `Invoke-Update` in `pforge.ps1` (about 930 lines) and `cmd_update` in `pforge.sh` (about 850 lines). Most of the bugs fixed in 3.27–3.29 were the two copies drifting apart or tripping on one shell's quirks:

- #296: Windows PowerShell 5.1 loaded PowerShell 7 modules.
- #297: Git Bash read JSON with the Windows Store `python3` / `grep -P`.
- `setup.sh` rejected php and rust; `setup.ps1` wrote an empty stack label.
- 3.29: both updaters assumed `custom` without `.forge.json` (fixed with `pforge-mcp/detect-preset.mjs`).

The parts already moved to Node behave identically in both shells: the update guard (`update-guard.mjs`), pending review (`update-pending.mjs`), preset detection (`detect-preset.mjs`) and the Node support check (`node-support.mjs`).

**Parity gaps confirmed in the current code (2026-10-02):**

| Gap | PowerShell `Invoke-Update` | Bash `cmd_update` |
|---|---|---|
| Shared and internal instructions the project lacks | Skipped: only files the project already has are offered (`Test-Path $dstFile`) | Added as NEW (`_pf_check` queues missing files) |
| `.forge.json` migration (`modelRouting.default`, `hooks`) | Migrated | **Closed in 3.29:** both shells call `pforge-mcp/migrate-forge-config.mjs` after the copy step. |

---

## Scope Contract

### In Scope

- `pforge-mcp/update-plan.mjs` (new): the update scan, never-update list, preset ownership, dedupe, `.forge.json` migration, and the report text.
- `pforge-mcp/preset-catalog.json` (new): per-preset stack label, build/test/lint/dev defaults, and the shared/internal instruction lists that setup and update both use.
- `pforge.ps1` `Invoke-Update` and `pforge.sh` `cmd_update`: replace the scan, categories, migration and report with a call to `update-plan.mjs`. Keep in the shells: argument parsing, source location (`--from-github`, sibling, `updateSource`), the `-dev` refusal, the confirmation prompt, applying the copies, the wrapper self-replace handling (#177), cache invalidation, and `npm install`.
- `setup.ps1` and `setup.sh`: read stack labels, defaults and shared-file lists from `preset-catalog.json` instead of their own `switch` / `case` tables.
- Tests: new unit tests for `update-plan.mjs`, plus updated end-to-end tests.

### Out of Scope

- `update-guard.mjs`, `update-pending.mjs` and `detect-preset.mjs` behaviour (`update-plan.mjs` only calls them).
- `update-from-github.mjs` (download, tag resolution, audit log).
- Setup's interactive prompts and file-copy steps beyond the preset tables.
- New update features or flags.

### Forbidden

- `pforge-mcp/update-guard.mjs`
- `pforge-mcp/update-from-github.mjs`
- `pforge-mcp/shipped-guidance-hashes.json` (except by regenerating it with `node scripts/build-shipped-guidance-hashes.mjs`)
- `presets/**` content
- Removing any file category from what update delivers today. The output must be a superset that differs only by the two parity-gap fixes.

---

## Shared Contract

Every slice uses these shapes exactly (#308).

**`node pforge-mcp/update-plan.mjs plan --source <dir> --project <dir> [--presets a,b] [--json]`** prints one JSON document:

```json
{
  "sourceVersion": "3.30.0",
  "currentVersion": "3.29.0",
  "presets": ["dotnet"],
  "presetSource": "forge.json",
  "operations": [
    { "category": "prompts", "action": "update", "src": ".github/prompts/step0-specify-feature.prompt.md", "dst": ".github/prompts/step0-specify-feature.prompt.md", "guided": true }
  ],
  "configMigrations": [{ "key": "modelRouting.default", "value": "claude-opus-5.5" }],
  "neverUpdate": [".github/copilot-instructions.md"]
}
```

- `src` is relative to `--source`; `dst` is relative to `--project`; both use `/`.
- `action` is `"new"` or `"update"`. Unchanged files are omitted.
- `guided: true` marks guidance files that must go through `update-guard.mjs` (the current `Select-GuidedFiles` / guarded set).
- `category` is one of `prompts`, `agents`, `instructions`, `runbook`, `preset`, `skills`, `hooks`, `mcp`, `sdk`, `master`, `cli`, `validation`, `core`.
- `presetSource` is `"forge.json"`, `"detected"` or `"default"`.
- Exit codes: `0` success, `2` usage error, `3` source invalid (no `VERSION`).

**`preset-catalog.json`**: `{ "presets": { "<name>": { "label": "...", "build": "...", "test": "...", "lint": "...", "dev": "..." } }, "internalInstructions": [...], "sharedInstructions": [...] }`, with exactly the values `setup.ps1` and `setup.sh` use today.

**Parity decisions (Required Decisions D1, D2) apply to both shells.**

---

## Required Decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | Missing shared/internal instructions: add them, or update existing ones only? | **Add them**, as Bash does. Setup installs them, so a missing one means an older install that predates the file. The guard still keeps edited copies. |
| D2 | Config migration in Bash | **Done in 3.29** with `migrate-forge-config.mjs`, which both shells already call. `update-plan.mjs` reports its pending additions as `configMigrations`; applying them stays with that module. |
| D3 | Where does the report text come from? | `update-plan.mjs report` renders it from the plan JSON so both shells print the same lines; colour stays in the shells. |
| D4 | Ship target | 3.30.0 (MINOR: changed delivery of missing instructions). |

---

## Acceptance Criteria

- **MUST**: Only `update-plan.mjs` decides which files an update offers. Neither shell has its own category scan.
- **MUST**: For the fixture projects in `update-plan.test.mjs` (dotnet, typescript, multi-preset, no `.forge.json`, custom), both shells apply exactly the operations `plan --json` lists.
- **MUST**: The end-to-end suites `update-guard-cli.test.mjs`, `update-from-github-cleanup.test.mjs`, `update-pending.test.mjs`, `setup-preset-defaults.test.mjs` and `setup-noninteractive.test.mjs` pass unchanged in both shells.
- **MUST**: Both parity gaps are closed (D1, D2), with a test for each.
- **MUST**: `node scripts/release/rehearse.mjs --previous-tag v3.29.0` passes with 0 failed.
- **SHOULD**: `Invoke-Update` and `cmd_update` shrink by at least 40% each.

---

## Execution Slices

### Slice 1: Characterize today's updates [scope: pforge-mcp/tests/update-plan-baseline.test.mjs, pforge-mcp/tests/fixtures/update-plan/**]

1. Build fixture source and project trees under `pforge-mcp/tests/fixtures/update-plan/` covering: dotnet, typescript, `dotnet,azure-iac`, no `.forge.json`, and `custom`, each with one edited guidance file and one missing shared instruction.
2. Write `update-plan-baseline.test.mjs`, which runs `update --dry-run` in each shell on each fixture and parses the `UPDATE` / `NEW` / `KEEP` lines into a sorted list. Save the lists as `.baseline.json` snapshots.
3. Assert the two shells' lists match except for the documented gaps; list those differences explicitly in the test so later slices can flip them.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/update-plan-baseline.test.mjs
```

### Slice 2: update-plan.mjs scan and migration [depends: Slice 1] [scope: pforge-mcp/update-plan.mjs, pforge-mcp/preset-catalog.json, pforge-mcp/tests/update-plan.test.mjs]

**WorkerTimeoutMs**: 90m

1. Create `pforge-mcp/preset-catalog.json` with the values `setup.ps1` and `setup.sh` use today. Add a test that `setup-preset-defaults.test.mjs`'s expectations match the catalog.
2. Create `pforge-mcp/update-plan.mjs` with the `plan` and `report` commands from the Shared Contract. Port each category from `Invoke-Update` (prompts, agents, internal and shared instructions with preset ownership, runbook docs, preset files, hooks, shared skills, MCP/SDK/Forge-Master recursive scans, CLI, validation and core files, dedupe). Use `detect-preset.mjs` when `.forge.json` has no preset. Apply D1 and D2.
3. Write `update-plan.test.mjs`: one test per category, the never-update list, preset ownership of `testing` and `security`, D1 and D2, and output-shape validation against the Shared Contract.
4. Make the Slice 1 fixtures' `plan --json` output equal the PowerShell baseline plus the D1 additions.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/update-plan.test.mjs pforge-mcp/tests/update-plan-baseline.test.mjs
node pforge-mcp/update-plan.mjs plan --source . --project pforge-mcp/tests/fixtures/update-plan/dotnet/project --json
```

### Slice 3: PowerShell uses update-plan.mjs [depends: Slice 2] [scope: pforge.ps1]

**WorkerTimeoutMs**: 60m

1. In `Invoke-Update`, replace everything from "Define update categories" through the "Report" section with a call to `update-plan.mjs plan --json` and `report`. Map `operations` back into the existing `$updates`, `$newFiles` and guided lists, so the confirm, apply, guard, pending and self-replace steps stay unchanged.
2. Keep the existing `migrate-forge-config.mjs` call after the copy step (added in 3.29); do not reimplement migration.
3. Fall back with a clear error if the source has no `update-plan.mjs`. That means a source older than 3.30, so tell the user to self-update.

**Validation Gate**:
```bash
pwsh -NoProfile -Command "$t=$null;$e=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path pforge.ps1),[ref]$t,[ref]$e);if($e.Count){throw 'parse errors'}"
npx --prefix pforge-mcp vitest run pforge-mcp/tests/update-guard-cli.test.mjs pforge-mcp/tests/update-plan-baseline.test.mjs pforge-mcp/tests/update-pending.test.mjs
```

### Slice 4: Bash uses update-plan.mjs [depends: Slice 2] [scope: pforge.sh]

**WorkerTimeoutMs**: 60m

1. In `cmd_update`, replace the `_pf_check` scan, category loops and report with the same `update-plan.mjs` calls. Parse `--json` with `node -e`, never `python3` or `grep -P` (#297).
2. Keep the existing `migrate-forge-config.mjs` call (added in 3.29, closing D2).
3. Keep `_pf_gh_cleanup`, the guard partition, the self-replace-safe dispatch and the `-dev` refusal as they are.

**Validation Gate**:
```bash
bash -n pforge.sh
npx --prefix pforge-mcp vitest run pforge-mcp/tests/update-guard-cli.test.mjs pforge-mcp/tests/update-from-github-cleanup.test.mjs pforge-mcp/tests/update-plan-baseline.test.mjs
```

### Slice 5: Setup reads preset-catalog.json [depends: Slice 2] [scope: setup.ps1, setup.sh]

1. In `setup.ps1`, replace the stack-label and default-command `switch` blocks and the shared-file list with values from `pforge-mcp/preset-catalog.json` (`ConvertFrom-Json`).
2. In `setup.sh`, replace the `STACK_LABEL` / `DEFAULT_*` `case` blocks and `SHARED_FILES` with `node -p` reads of the catalog.
3. An unknown preset must still fail with the existing "Unknown preset" message in both shells.

**Validation Gate**:
```bash
bash -n setup.sh
npx --prefix pforge-mcp vitest run pforge-mcp/tests/setup-preset-defaults.test.mjs pforge-mcp/tests/setup-noninteractive.test.mjs pforge-mcp/tests/setup-node-floor-path.test.mjs
```

### Slice 6: Coherence — both shells, whole update [depends: Slice 3, Slice 4, Slice 5] [scope: pforge-mcp/tests/update-plan-baseline.test.mjs, CHANGELOG.md, docs/CLI-GUIDE.md]

1. Flip the documented-gap entries in `update-plan-baseline.test.mjs`. The two shells must now produce identical operation lists for every fixture.
2. Run the release rehearsal from v3.29.0 against a commit with VERSION set to the release (rehearse.mjs refuses a -dev ref, #316).
3. Add the CHANGELOG `[Unreleased]` entries (D1 behaviour change, Bash config migration) and update the CLI guide's "What it does" list for `pforge update`.

**Validation Gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/update-plan-baseline.test.mjs pforge-mcp/tests/update-plan.test.mjs pforge-mcp/tests/update-guard-cli.test.mjs
```

---

## Re-anchor Checkpoints

After each slice, check:
- Does every changed file sit inside the slice's `[scope:]`?
- Do both shells still pass `update-guard-cli.test.mjs`?
- Is anything outside the Shared Contract (output shape, exit codes) being invented?

## Stop Conditions

- A Slice 1 baseline difference between the shells that is not one of the two documented gaps. Stop, file it, and decide before porting.
- Any end-to-end suite listed under Acceptance Criteria needs changing to pass. That means delivered behaviour changed; stop and review.
- The rehearsal reports any FAIL.
- A slice needs to touch a Forbidden file.

## Definition of Done

- [ ] All MUST acceptance criteria pass.
- [ ] Full `pforge-mcp` vitest suite green; `bash -n` and the PowerShell parser clean for all four scripts.
- [ ] Reviewer Gate passed (zero 🔴 Critical), including Shared Contract conformance.
- [ ] CHANGELOG and CLI guide updated; #299 closed with a link to the merge.
