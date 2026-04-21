---
crucibleId: grandfathered-phase-28.5-tempering-triage
lane: full
source: human
---

# Phase-28.5 — Tempering Triage (v2.63.1)

> **Target release**: v2.63.1
> **Status**: Draft — queued behind Phase-29 (do not launch until Phase-29 ships v2.63.0)
> **Depends on**: Phase-29 tag `v2.63.0` landing on master.
> **Branch strategy**: Direct to `master`. Small, surgical fixes to tempering visual-diff + baselines pipeline.
> **Session budget**: 5 slices in **1 session**. ~45 min, budget ≤ $5.
> **Design posture**: Patch release. Four defect fixes plus ship. No new features. No schema changes. Existing tests must remain green; new tests lock each fix behind a regression guard.

---

## Specification Source

**GitHub Issue**: [#85 — visual-diff scanner: spawnWorker DI not forwarded by runTemperingRun + manifest staleness + promoteBaseline sort bug](https://github.com/srnichols/plan-forge/issues/85) (state: OPEN; reported 2026-04-21 against v2.61.0)

**External reporter's summary** (verbatim headings):
> *"Three related defects surfaced while debugging a false visual-diff regression downstream. All three compound: the analyzer can't run at all without fix #1, and even if it did, #2 and #3 would still yield false positives. [...] Downstream, all three conspired to produce a visual-diff regression with diff=0.250185546875 that persisted across 5 reruns, three baseline re-promotions, and one full config revert."*

Reporter filed **four** defects total (numbered 1–4 in the issue body). All four are in-scope for this phase.

**Related**: #84 (OpenBrain queue drain — shipped in v2.62.3).

---

## Feature Specification

### Problem Statement

The tempering subsystem (`pforge-mcp/tempering/`) is the post-slice quality gate that runs visual regression, UI crawls, and contract checks. Four compounding defects currently cause the visual-diff scanner to:

1. **Always return `inconclusive`** regardless of API keys — `spawnWorker` is never forwarded to the scanner.
2. **Ignore `.forge/secrets.json`** when deciding whether API keys are available — only env vars are checked, contradicting the project-wide convention.
3. **Diff against stale screenshots** — `screenshot-manifest.json` is written once and never refreshed per run, so visual-diff reads yesterday's paths.
4. **Pick stale `validate-*` artifacts over fresh `run-*`** — `promoteBaseline`'s `readdirSync().sort().reverse()` gives `validate-*` alphabetical priority over `run-*`.

Together they produce persistent false-positive regressions that cannot be cleared without manual PowerShell intervention. Defect #1 is the main blocker: quorum via the visual-diff LLM analyzer never fires.

### What changes

| # | Surface | Defect | Fix | Test |
|---|---|---|---|---|
| 1 | [pforge-mcp/tempering/runner.mjs](pforge-mcp/tempering/runner.mjs), [server.mjs](pforge-mcp/server.mjs#L2345), [orchestrator.mjs](pforge-mcp/orchestrator.mjs#L5583) | `spawnWorker` DI gap | `runTemperingRun` accepts `spawnWorker` and forwards to both branches (`visualDiffScannerImpl` override and the dynamic `runVisualDiffScan` import). Callers in `forge_tempering_run` and `maybeRunPostSliceTempering` pass through the real `spawnWorker` from `pforge-mcp/brain.mjs` / orchestrator. | DI forwarding test: mock `visualDiffScannerImpl`, verify it receives `spawnWorker`. |
| 2 | [pforge-mcp/tempering/scanners/visual-diff.mjs:392](pforge-mcp/tempering/scanners/visual-diff.mjs) + shared helper | `hasKey` ignores `.forge/secrets.json` | Extract `loadSecretFromForge` from [orchestrator.mjs:592](pforge-mcp/orchestrator.mjs#L592) to a shared module (`pforge-mcp/secrets.mjs`) — single source of truth. Visual-diff imports it and checks `env?.KEY \|\| loadSecretFromForge("KEY")` for all three providers. Orchestrator re-exports the shared helper (zero behavior change). | Scanner test: write `.forge/secrets.json` with `XAI_API_KEY`, no env var → `hasKey === true`, explanation no longer `"no API key configured"`. |
| 3 | [pforge-mcp/tempering/scanners/ui-playwright.mjs](pforge-mcp/tempering/scanners/ui-playwright.mjs), [visual-diff.mjs](pforge-mcp/tempering/scanners/visual-diff.mjs) | Stale `screenshot-manifest.json` | `ui-playwright` rewrites `.forge/tempering/screenshot-manifest.json` at end of each run with the paths just written (atomic: tmp + rename). `visual-diff`, when resolving `entry.path`, prefers the current-run artifact if it exists on disk and is newer than `entry.path` (compare `statSync().mtimeMs`). Falls back to manifest path if current-run artifact missing. | Integration test: write a manifest from "Monday run", then do a "Tuesday run" that writes new screenshots — visual-diff must read Tuesday's paths. Verify `mtime` preference. |
| 4 | [pforge-mcp/tempering/baselines.mjs:128](pforge-mcp/tempering/baselines.mjs) | `promoteBaseline` sort+reverse picks `validate-*` | Replace alphabetical `.sort().reverse()` with mtime-descending sort. When no `runId` is supplied, filter candidate directories to `run-*` prefix (skip `validate-*`). Explicit `runId` passes through unchanged. | Baseline test: create `validate-2026-04-01/`, `run-2026-04-20/`, `run-2026-04-21/` in artifacts dir; no `runId` → picks `run-2026-04-21`. With `validate-*` newer by mtime but no runId → still skipped. |

### User Scenarios

1. **Investigate-band diff with API key in secrets.json**: User runs `pforge run-plan ...`, slice finishes, post-slice tempering fires. Visual-diff detects a 0.25 diff (investigate band). Before v2.63.1 → `inconclusive: no spawnWorker provided`. After v2.63.1 → `spawnWorker` forwarded, `hasKey` sees `XAI_API_KEY` from `.forge/secrets.json`, scanner dispatches to Grok, gets a structured `{ verdict, severity, explanation }` back. Quorum event fires. No user action required.

2. **Second run of the day**: User runs `ui-playwright` at 09:00, then again at 14:00. Before v2.63.1 → the 14:00 visual-diff reads the 09:00 manifest, diffs against noon-lit screenshots, produces stable false regressions. After v2.63.1 → 14:00 `ui-playwright` overwrites the manifest; 14:00 visual-diff reads 14:00 paths. Clean diff.

3. **Baseline promotion after CI ran validate**: User promotes a baseline with no explicit `runId`. Before v2.63.1 → `validate-2026-04-01/` wins alphabetically, stale CI screenshot gets promoted. After v2.63.1 → `run-*` filter skips `validate-*`, latest `run-*` by mtime promoted correctly.

4. **Orchestrator post-slice hook**: `maybeRunPostSliceTempering` now forwards `spawnWorker` → tempering runner → visual-diff scanner. Post-slice quorum decisions reflect actual LLM verdicts, not fallback `inconclusive`.

5. **Tests continue to pass**: Existing test suite (3285 tests as of v2.63.0) remains green. New tests add a small, targeted regression guard for each defect. No existing test should need modification beyond optionally asserting the new `spawnWorker` DI parameter.

### Acceptance Criteria

- **MUST**: `runTemperingRun(opts)` in [pforge-mcp/tempering/runner.mjs:385](pforge-mcp/tempering/runner.mjs) accepts `spawnWorker = null` as a destructured option and forwards it to both the `visualDiffScannerImpl(...)` call (line ~699) and the `runVisualDiffScan(...)` call (line ~704). JSDoc updated to document the new parameter.
- **MUST**: `forge_tempering_run` in [pforge-mcp/server.mjs](pforge-mcp/server.mjs#L2345) passes the real `spawnWorker` from the brain/worker subsystem into `runTemperingRun({ ..., spawnWorker })`.
- **MUST**: `maybeRunPostSliceTempering` in [pforge-mcp/orchestrator.mjs](pforge-mcp/orchestrator.mjs#L5583) passes `spawnWorker` through. If the orchestrator's post-slice caller does not already have a spawnWorker reference, add one injected via the `runTemperingRun` parameter set already flowing in (`runTemperingRun` is DI'd at orchestrator line 5529; add `spawnWorker` alongside).
- **MUST**: New module [pforge-mcp/secrets.mjs](pforge-mcp/secrets.mjs) exports `loadSecretFromForge(key: string): string | null` with identical behavior to the existing private helper at [orchestrator.mjs:592](pforge-mcp/orchestrator.mjs). `orchestrator.mjs` imports from the new module (deletes its private copy). Zero behavior change; pure relocation.
- **MUST**: [visual-diff.mjs:392](pforge-mcp/tempering/scanners/visual-diff.mjs) `hasKey` check becomes:
  ```js
  const hasKey =
    (env?.ANTHROPIC_API_KEY || loadSecretFromForge("ANTHROPIC_API_KEY")) ||
    (env?.OPENAI_API_KEY    || loadSecretFromForge("OPENAI_API_KEY"))    ||
    (env?.XAI_API_KEY       || loadSecretFromForge("XAI_API_KEY"));
  ```
- **MUST**: `ui-playwright` scanner writes `.forge/tempering/screenshot-manifest.json` atomically (tmp + rename) at end of each run with the paths it just wrote. Manifest entry shape preserved. Overwrites prior manifest.
- **MUST**: `visual-diff` scanner, when resolving each manifest entry's screenshot path, checks whether a current-run artifact exists at `<artifactsDir>/<runId>/ui-playwright/<urlHash>.png`. If so, compares `mtimeMs` with the manifest `entry.path` file and picks the newer. If the manifest file is missing on disk, falls back to current-run artifact. If neither exists, skip with existing `no-screenshot-manifest` / skipped-frame path.
- **MUST**: `promoteBaseline` in [baselines.mjs:114](pforge-mcp/tempering/baselines.mjs) replaces the `.sort().reverse()` block with mtime-descending sort. When `opts.runId` is not supplied, filters candidate directories to those starting with `run-` (skips `validate-*` and any other prefix). With explicit `runId`, no filter applied.
- **MUST**: Unit tests added for each of the four fixes (see per-slice test lists below). Tests are **additive** — no existing tempering test is modified except to thread `spawnWorker` where needed.
- **MUST**: Full test suite green: `cd pforge-mcp && npx vitest run` exits 0 with count ≥ 3277 + 4 new tests = 3281+.
- **MUST**: `CHANGELOG.md` gains a `## v2.63.1 — Tempering Triage` entry with a bullet per defect and a back-link to #85.
- **MUST**: `VERSION` file and all stamps updated to `2.63.1` (badges, metrics, README tagline, `package.json` files).
- **MUST**: `forge_capabilities` version string reflects 2.63.1.
- **SHOULD**: Issue #85 commented with release link after ship.
- **MAY**: A short note added to `.github/instructions/self-repair-reporting.instructions.md` citing the four-defect compound as an example of when to escalate an external bug report. Nice-to-have; low cost.

### Out of Scope

- **No changes to tempering bands, verdict taxonomy, or severity mapping**. Fixes are restricted to the four defects above.
- **No changes to the `spawnWorker` implementation itself** — only forwarding.
- **No schema change to `screenshot-manifest.json`**. Manifest entries keep the same fields; only the refresh cadence changes.
- **No DLQ replay for past false regressions**. Users can manually re-promote baselines post-ship; no migration.
- **No new tempering features**. This is a patch release. Phase-30+ candidates (multi-baseline, perceptual diff thresholds) are explicitly deferred.
- **No Phase-29 Forge-Master Studio regressions** — Phase-29 does not touch the tempering surface; merge conflicts expected to be zero.

---

## Executable Slices (5 Slices · 1 Session · ~45 min · Budget ≤ $5)

All slices `[sequential]` — each builds on the previous.

---

#### Slice 1: spawnWorker DI forwarding [sequential] {#slice-1}

**Goal**: Thread `spawnWorker` through `runTemperingRun` into the visual-diff scanner (both DI and dynamic-import branches). Update both call sites (`server.mjs` and `orchestrator.mjs`) to pass it through.

**Files**:
- `pforge-mcp/tempering/runner.mjs` — modify `runTemperingRun(opts)`:
  - Destructure `spawnWorker = null` alongside existing DI options (near line 406, after `visualDiffScannerImpl`).
  - Update the `visualDiffScannerImpl(...)` call at ~line 699 to include `spawnWorker` in the payload.
  - Update the `runVisualDiffScan(...)` call at ~line 704 to include `spawnWorker` in the payload.
  - Update the JSDoc block above `runTemperingRun` to document `spawnWorker`.
- `pforge-mcp/server.mjs` — modify the `forge_tempering_run` tool handler at ~line 2345:
  - Pass the server-scope `spawnWorker` into `runTemperingRun({ ..., spawnWorker })`. The `brain.mjs` / worker subsystem already exposes `spawnWorker`; import it if not already in scope, else reference the existing binding.
- `pforge-mcp/orchestrator.mjs` — modify `maybeRunPostSliceTempering` at ~line 5511:
  - Add `spawnWorker` to the destructured DI params (alongside existing `runTemperingRun`).
  - Pass it to `runTemperingRun({ ..., spawnWorker })` at ~line 5583.
  - Update the orchestrator's caller of `maybeRunPostSliceTempering` to supply `spawnWorker` — it is already in orchestrator scope (used at lines 577, 1084 for model calls).
- `pforge-mcp/tests/tempering-spawnworker-di.test.mjs` — new test file:
  1. `runTemperingRun({ visualDiffScannerImpl: mock, spawnWorker: sentinel, ... })` — mock asserts it received `spawnWorker === sentinel` in its opts.
  2. `runTemperingRun({ spawnWorker: sentinel, ... })` with the dynamic-import path — stub `runVisualDiffScan` via `importFn` override if the runner supports it; otherwise verify via a spy on the module cache. Assert sentinel reaches the scanner.
  3. Omitting `spawnWorker` keeps existing behavior (passed as `undefined`, scanner falls through to `inconclusive` path) — lock the back-compat.

**Depends on**: Phase-29 `v2.63.0` tag.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/tempering/runner.mjs:385-420` — `runTemperingRun` signature.
- `pforge-mcp/tempering/runner.mjs:698-708` — both visual-diff dispatch branches.
- `pforge-mcp/tempering/scanners/visual-diff.mjs:380-400` — the `spawnWorker` consumer.
- `pforge-mcp/server.mjs:2345` — `forge_tempering_run` call site.
- `pforge-mcp/orchestrator.mjs:5511-5583` — `maybeRunPostSliceTempering` DI + call.

**Traces to**: MUST (runTemperingRun accepts spawnWorker; both call sites forward; tests cover DI and back-compat).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/tempering-spawnworker-di.test.mjs"
bash -c "grep -q 'spawnWorker' pforge-mcp/tempering/runner.mjs"
bash -c "grep -c 'spawnWorker' pforge-mcp/tempering/runner.mjs | awk '{ if (\$1 >= 3) exit 0; else exit 1 }'"
bash -c "grep -q 'spawnWorker' pforge-mcp/orchestrator.mjs && grep -q 'runTemperingRun.*spawnWorker\\|spawnWorker.*runTemperingRun' pforge-mcp/orchestrator.mjs || grep -q 'spawnWorker,' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 2: Shared loadSecretFromForge + visual-diff hasKey fix [sequential] {#slice-2}

**Goal**: Extract `loadSecretFromForge` to a shared module and use it in the visual-diff `hasKey` check so `.forge/secrets.json` is consulted consistently.

**Files**:
- `pforge-mcp/secrets.mjs` — new module:
  - `export function loadSecretFromForge(key)` — body identical to the existing private helper at `orchestrator.mjs:592-602`.
  - JSDoc notes: "Shared across orchestrator, tempering scanners, and any future consumer. File is gitignored via `**/.forge/`."
- `pforge-mcp/orchestrator.mjs` — delete the private `loadSecretFromForge` at line 592 and `import { loadSecretFromForge } from "./secrets.mjs";` at the top of the file. Verify both call sites (lines 577 and 1084) still work unchanged.
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — add `import { loadSecretFromForge } from "../../secrets.mjs";` at the top. Replace line 392:
  ```js
  const hasKey =
    (env?.ANTHROPIC_API_KEY || loadSecretFromForge("ANTHROPIC_API_KEY")) ||
    (env?.OPENAI_API_KEY    || loadSecretFromForge("OPENAI_API_KEY"))    ||
    (env?.XAI_API_KEY       || loadSecretFromForge("XAI_API_KEY"));
  ```
- `pforge-mcp/tests/secrets.test.mjs` — new test file:
  1. `loadSecretFromForge("XAI_API_KEY")` with a tmp `.forge/secrets.json` containing `{ "XAI_API_KEY": "xai-abc" }` → returns `"xai-abc"` (use `process.chdir` in a tmp dir).
  2. Missing file → returns `null`.
  3. Malformed JSON → returns `null` (silent).
  4. Key absent from valid file → returns `null`.
- `pforge-mcp/tests/tempering-visual-diff-secrets.test.mjs` — new test file:
  1. Scanner invoked with no env keys but a valid `.forge/secrets.json` (XAI present) → `hasKey === true` path taken. With `spawnWorker === null`, `explanation === "no spawnWorker provided"` (not `"no API key configured"`).
  2. Scanner invoked with no env keys and no secrets file → `explanation === "no API key configured"` (back-compat).

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:585-602` — existing `loadSecretFromForge` body.
- `pforge-mcp/tempering/scanners/visual-diff.mjs:388-400` — `hasKey` block.

**Traces to**: MUST (secrets.mjs shared module; visual-diff consults secrets.json; orchestrator re-uses shared helper; tests cover both paths).

**Validation Gate**:
```bash
bash -c "test -f pforge-mcp/secrets.mjs"
bash -c "grep -q 'export function loadSecretFromForge' pforge-mcp/secrets.mjs"
bash -c "grep -q 'from \"./secrets.mjs\"' pforge-mcp/orchestrator.mjs"
bash -c "grep -q 'loadSecretFromForge' pforge-mcp/tempering/scanners/visual-diff.mjs"
bash -c "! grep -q 'function loadSecretFromForge' pforge-mcp/orchestrator.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/secrets.test.mjs tests/tempering-visual-diff-secrets.test.mjs"
```

---

#### Slice 3: Screenshot manifest freshness [sequential] {#slice-3}

**Goal**: `ui-playwright` rewrites the manifest at end of each run; `visual-diff` prefers current-run artifacts by mtime.

**Files**:
- `pforge-mcp/tempering/scanners/ui-playwright.mjs` — at end of the scan (after all screenshots written, before returning the scanner result):
  - Build `entries` array `[{ url, urlHash, path }]` for every screenshot just written.
  - Atomic write to `<cwd>/.forge/tempering/screenshot-manifest.json`:
    ```js
    const manifestPath = resolve(cwd, ".forge", "tempering", "screenshot-manifest.json");
    const tmpPath = manifestPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
    renameSync(tmpPath, manifestPath);
    ```
  - Wrap in try/catch — manifest-write failure must not fail the scan (log warn, continue).
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — inside the per-entry loop that reads `entry.path`, add freshness preference:
  - Compute `currentRunPath = resolve(artifactsDir, runId, "ui-playwright", urlHash + ".png")`.
  - If `currentRunPath` exists:
    - If `entry.path` exists and `statSync(entry.path).mtimeMs >= statSync(currentRunPath).mtimeMs` → use `entry.path`.
    - Else → use `currentRunPath` (manifest is stale or missing).
  - If `currentRunPath` missing and `entry.path` missing → existing skipped-frame path unchanged.
- `pforge-mcp/tests/tempering-manifest-freshness.test.mjs` — new test file:
  1. Write a manifest with a path pointing to a file with an old mtime. Create a newer file under the current-run artifact path. Scanner picks the newer file — assertion via a sentinel byte pattern or via mocking `readFileSync`.
  2. Manifest path points to a missing file, current-run artifact exists → scanner uses current-run artifact.
  3. Both missing → skipped-frame path (existing `no-screenshot-manifest` reason preserved).
- `pforge-mcp/tests/tempering-ui-playwright-manifest.test.mjs` — new test file:
  1. Invoke `ui-playwright` scanner (with playwright mocked) → manifest file exists at expected path, contains entries for all URLs scanned, is valid JSON.
  2. Manifest from a prior run gets overwritten (not appended) — assert file contents match the latest run's entries.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/tempering/scanners/ui-playwright.mjs` — end-of-scan hook location.
- `pforge-mcp/tempering/scanners/visual-diff.mjs:90-120` — manifest read + per-entry loop start.
- `pforge-mcp/tempering/baselines.mjs:85` — existing manifest path reference.

**Traces to**: MUST (ui-playwright writes manifest atomically; visual-diff prefers current-run by mtime; tests cover both refresh and fallback paths).

**Validation Gate**:
```bash
bash -c "grep -q 'screenshot-manifest.json' pforge-mcp/tempering/scanners/ui-playwright.mjs"
bash -c "grep -q 'mtimeMs' pforge-mcp/tempering/scanners/visual-diff.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/tempering-manifest-freshness.test.mjs tests/tempering-ui-playwright-manifest.test.mjs"
```

---

#### Slice 4: promoteBaseline mtime sort + run-* filter [sequential] {#slice-4}

**Goal**: Fix `promoteBaseline` auto-discovery to prefer the most recent `run-*` directory by mtime, not alphabetical reverse.

**Files**:
- `pforge-mcp/tempering/baselines.mjs` — modify `promoteBaseline` at line ~128:
  - Replace:
    ```js
    const runs = readdirSync(artRoot)
      .filter((d) => { try { return statSync(resolve(artRoot, d)).isDirectory(); } catch { return false; } })
      .sort()
      .reverse();
    ```
    with:
    ```js
    const runs = readdirSync(artRoot)
      .filter((d) => { try { return statSync(resolve(artRoot, d)).isDirectory(); } catch { return false; } })
      .filter((d) => runId ? true : d.startsWith("run-"))  // skip validate-*, etc.
      .map((d) => ({ name: d, mtime: statSync(resolve(artRoot, d)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.name);
    ```
  - Semantic guard: when `runId` is explicitly provided, filter inside the loop is already `if (runId && run !== runId) continue;` — unchanged. The top-level filter above only excludes non-`run-*` when `runId` is unset.
- `pforge-mcp/tests/tempering-baselines-sort.test.mjs` — new test file:
  1. Create tmp artifacts dir with `validate-2026-04-01/`, `run-2026-04-20/`, `run-2026-04-21/`, each with a screenshot at the expected sub-path. No `runId` supplied → `promoteBaseline` picks from `run-2026-04-21` (newest `run-*`).
  2. Same layout, but `validate-2026-04-30/` is the newest by mtime. No `runId` → still picks `run-2026-04-21` (validate-* filtered out).
  3. Explicit `runId: "validate-2026-04-01"` → picks that run (filter bypassed).
  4. Empty artifacts dir → throws `NO_SCREENSHOT` (existing behavior preserved).

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/tempering/baselines.mjs:114-170` — `promoteBaseline` body.

**Traces to**: MUST (mtime sort replaces alphabetical; run-* filter applied when no runId; tests cover the specific regression scenario from #85).

**Validation Gate**:
```bash
bash -c "! grep -q '\\.sort()\\s*\\.reverse()' pforge-mcp/tempering/baselines.mjs"
bash -c "grep -q 'mtimeMs' pforge-mcp/tempering/baselines.mjs"
bash -c "grep -q 'startsWith(\"run-\")' pforge-mcp/tempering/baselines.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/tempering-baselines-sort.test.mjs"
```

---

#### Slice 5: Ship v2.63.1 [sequential] {#slice-5}

**Goal**: Stamp version, update CHANGELOG, sweep metrics, verify full suite green. Defer tag + release to human.

**Files**:
- `VERSION` → `2.63.1`
- `CHANGELOG.md` — prepend:
  ```markdown
  ## v2.63.1 — Tempering Triage (2026-04-DD)

  Patch release fixing four compounding defects in the tempering visual-diff
  and baselines pipeline that produced persistent false-positive regressions.

  **Fixed (#85)**:
  - visual-diff scanner: `spawnWorker` now forwarded through `runTemperingRun`
    into both the DI and dynamic-import scanner branches. Investigate-band
    diffs now invoke the LLM analyzer instead of returning `inconclusive`.
  - visual-diff `hasKey` check now consults `.forge/secrets.json` via the
    shared `loadSecretFromForge` helper (extracted from orchestrator to
    `pforge-mcp/secrets.mjs`).
  - `ui-playwright` scanner rewrites `.forge/tempering/screenshot-manifest.json`
    atomically at end of each run. `visual-diff` prefers current-run artifacts
    over stale manifest entries by mtime comparison.
  - `promoteBaseline` auto-discovery now sorts candidate runs by mtime
    (descending) and filters out non-`run-*` directories when no `runId` is
    supplied — previously `validate-*` artifacts could win alphabetically.

  **Related**: #84 (shipped v2.62.3).
  ```
- `package.json` (root), `pforge-mcp/package.json`, `pforge-master/package.json`, `pforge-sdk/package.json` — `"version": "2.63.1"`.
- `docs/_metrics.json` — bump `version` to `2.63.1`, `testsPassing` and `testsTotal` to the new count (3277 + 4 slice-1 + 2 slice-2a + 2 slice-2b + 2 slice-3a + 2 slice-3b + 4 slice-4 = **3293**; verify exact count via vitest output). Move `v2.63.0` into `versionBadges` alongside v2.62.3.
- `docs/index.html` — hero badge to `v2.63.1`; dashboard preview stats `28+/3293/67`.
- `README.md` tagline → `67 MCP Tools · 45+ CLI Commands · 19 Agents · 13 Skills · 9 Presets · 7 Adapters · 3293 Tests · v2.63.1` (update the tests count from the actual vitest count).
- `pforge-mcp/capabilities.mjs` — version string to `2.63.1`.
- Run `scripts/check-metrics.ps1` → must print `[OK] No stale metric aliases found.`

**Depends on**: Slices 1–4.

**Branch**: `master`.

**Context files**:
- `CHANGELOG.md` — prior v2.62.3 entry for format reference.
- `docs/_metrics.json` — `_knownStaleAliases`, `versionBadges` shape.
- `scripts/check-metrics.ps1` — verification tool.

**Traces to**: MUST (version stamp; CHANGELOG; metrics sweep; all four package.jsons; README tagline; full suite green with new tests counted).

**Validation Gate**:
```bash
bash -c "grep -q '^2.63.1$' VERSION"
bash -c "grep -q 'v2.63.1' CHANGELOG.md"
bash -c "grep -q '\"version\": \"2.63.1\"' package.json"
bash -c "grep -q '\"version\": \"2.63.1\"' pforge-mcp/package.json"
bash -c "grep -q '2.63.1' docs/_metrics.json"
bash -c "grep -q 'v2.63.1' README.md"
bash -c "cd pforge-mcp && npx vitest run 2>&1 | tail -5 | grep -q 'Tests.*passed'"
```

---

## Forbidden Actions

Do NOT edit any of these files in this phase:
- `pforge-mcp/memory.mjs` — unrelated; Phase-28.4 surface.
- `pforge-mcp/brain.mjs` — unrelated; spawnWorker is imported, not modified.
- `pforge-mcp/forge-master/*` — Phase-28/29 scope.
- `pforge-master/**` — Phase-29 new-package scope.
- Any plan file under `docs/plans/` other than this one and `DEPLOYMENT-ROADMAP.md` (status update only).
- Any file under `extensions/` — extension catalog untouched.

## Scope Contract

- **In scope**: `pforge-mcp/tempering/runner.mjs`, `pforge-mcp/tempering/scanners/visual-diff.mjs`, `pforge-mcp/tempering/scanners/ui-playwright.mjs`, `pforge-mcp/tempering/baselines.mjs`, `pforge-mcp/secrets.mjs` (new), `pforge-mcp/orchestrator.mjs` (relocate loadSecretFromForge), `pforge-mcp/server.mjs` (thread spawnWorker), new test files under `pforge-mcp/tests/`, version/metrics files listed in Slice 5.
- **Out of scope**: any other file. Drift detection should flag edits outside the in-scope list.

## Rollback

- Pre-launch tag: `pre-phase-28.5` on master (human creates before launching).
- Revert path: `git reset --hard pre-phase-28.5 && git push origin master --force-with-lease` (only if the release is broken and not yet consumed downstream).
- Forward-fix preferred — the surface is small enough that a v2.62.5 hotfix is cheaper than a revert.

## Post-Ship

- Comment on issue #85 with the v2.63.1 release URL and a summary of the four fixes.
- Add an entry to `docs/plans/DEPLOYMENT-ROADMAP.md` under Phase-28.x.
- Consider a note in `.github/instructions/self-repair-reporting.instructions.md` citing this phase as an example of an external four-defect compound (MAY).
