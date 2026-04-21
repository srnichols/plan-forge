---
crucibleId: grandfathered-phase-28.1-bug-sweep
lane: full
source: human
---

# Phase-28.1 — Bug-Sweep Hotfix (GH #82, #83 + self-update stale cache)

> **Target release**: v2.62.0
> **Status**: Draft
> **Depends on**: Phase-28 Forge-Master MVP work on `master` (commits `f12bdd3` through `ea638ea`). The tag `v2.61.0` was consumed by Phase-27.2 before Phase-28 landed, so Phase-28's Forge-Master MVP ships here together with the bug fixes in a single combined v2.62.0 release.
> **Branch strategy**: Direct to `master`. All fixes are small, scoped, and independently testable.
> **Source**: Two open GitHub issues filed 2026-04-21 (#82, #83) and one self-reported regression (`docs/bugs/BUG-self-update-stale-cache.md`) filed after Phase-28 self-update dogfood.
> **Session budget**: 6 slices in **1 session**.
> **Design posture**: Pure defect correction + one release. No new features. No surface changes beyond a fresh cache write at self-update completion.

---

## Specification Source

### GH #82 — Windows `spawn claude ENOENT`

- **Symptom**: `pforge run-plan` on Windows fails with `Failed to spawn claude: spawn claude ENOENT` before any slice work begins.
- **Root cause**: `pforge-mcp/orchestrator.mjs:1330` calls `spawn(cmd, args, { ... })` without `shell: true`. On Windows, npm installs CLIs as `.cmd` shims (e.g., `claude.cmd`). Node `child_process.spawn` does not resolve `.cmd` without a shell unless `shell: true` is set.
- **Fix**: Add `shell: process.platform === "win32"` to the spawn options. Affects `claude`, `codex`, and any future npm-global CLI worker.
- **Reporter**: Author ran Windows 11 + Node v22.18.0 + `@anthropic-ai/claude-code` v2.1.114 from a fresh install.

### GH #83 — Gate linter flags ASCII box art as `blocked-command`

- **Symptom**: Plans with decorative ASCII diagrams (box-drawing characters) in slice bodies fail `lintGateCommands` pre-flight with 28+ `blocked-command` errors per diagram. Example: `Phase-6A-Public-Repo-Publish.md` slice 8.
- **Root cause**: `looksLikeProse()` in `pforge-mcp/orchestrator.mjs:4411` does not recognize box-drawing characters (`┌ ┐ └ ┘ ├ ┤ │ ─` and their Unicode codepoints in the `U+2500`–`U+257F` range) as prose. Lines like `│  Layer 1: azd up` start with `│` (U+2502), get tokenized as a command named `│`, and fail the allowlist check.
- **Fix**: Extend `looksLikeProse()` to return `true` when the line starts with any codepoint in the box-drawing range `U+2500`–`U+257F`. These lines are by definition documentation, not executable commands.
- **Cross-platform**: Parser issue, not OS-specific. Fix lands in one module and benefits all platforms.

### BUG — self-update doesn't invalidate `.forge/update-check.json`

- **Symptom**: After `pforge self-update`, dashboard header shows correct new version but the "update available" banner keeps showing old `{current, latest}` for up to 24h (the cache TTL).
- **Root causes** (two cooperating):
  1. `pforge-mcp/update-from-github.mjs` writes the new `VERSION` but never rewrites or deletes `.forge/update-check.json`.
  2. `checkForUpdate()` in `pforge-mcp/update-check.mjs` trusts the cache when `age < ttlMs`, regardless of whether `VERSION` changed underneath.
- **Fix A** (minimal): At the end of a successful self-update, write a fresh cache entry with the new VERSION and `isNewer: false`. Called from the CLI path (`pforge.ps1` / `pforge.sh` Invoke-SelfUpdate) after `Invoke-Update` completes.
- **Fix D** (defense-in-depth): In `checkForUpdate()`, when a cache file exists, compare `statSync(versionFile).mtimeMs > statSync(cachePath).mtimeMs`. If VERSION is newer than the cache, discard the cache and refresh from the network (or return a "self-healing" placeholder that forces the next call to refresh).
- **Rationale for both**: Fix A catches the current code path. Fix D is a belt-and-suspenders guarantee that works for every future update mechanism (manual file edit, git sync, tarball extraction, etc.).

---

## Feature Specification

### Problem Statement

Three independent defects surfaced in the same week:

1. Windows users cannot run `pforge run-plan` at all (hard blocker).
2. Any plan with ASCII diagrams — a common documentation pattern — cannot pass pre-flight.
3. After self-update, the dashboard falsely advertises an outdated update until the 24h cache expires or the user manually restarts and deletes the cache file.

Each is small in code footprint but each is a visible regression. Phase-27.2 already consumed the `v2.61.0` tag, leaving Phase-28's Forge-Master MVP on `master` without a release tag. Combining the hotfix with Phase-28's missing release into a single `v2.62.0` ship is cleaner than two back-to-back releases and avoids a dangling "Forge-Master code is in master but has no release" state.

### User Scenarios

1. **Windows dev runs `pforge run-plan`**. Slice 1 spawns the `claude.cmd` worker, gets stdout back, and moves through the plan. No `ENOENT` crash.
2. **Author writes a slice description with an ASCII diagram** to illustrate a deployment model. `pforge run-plan` pre-flight skips the box-art lines as prose and does not report `blocked-command`. The slice's actual validation gates (in the fenced `bash` block after `**Validation Gate**:`) still lint normally.
3. **Dashboard user clicks Update now (or runs `pforge self-update` from CLI)**. After the update lands and they reload the dashboard, the banner is gone. The next time a genuinely newer release appears on GitHub, the banner comes back correctly.
4. **User manually edits `VERSION`** (e.g., testing a local bump). Next dashboard load bypasses the stale cache because the VERSION mtime is newer than the cache mtime, and `checkForUpdate()` refreshes from the network.
5. **`forge_master_ask` tool becomes generally available** under the v2.62.0 release — no functional change versus its current state on master, but now there is a git tag pinning the behavior for downstream installs.

### Acceptance Criteria

- **MUST**: `pforge-mcp/orchestrator.mjs` spawn options include `shell: process.platform === "win32"`. Covered by a new unit test that stubs `spawn` and asserts the options passed include `shell` when `process.platform === "win32"`.
- **MUST**: `looksLikeProse()` returns `true` for any non-empty line whose first non-whitespace character is in the Unicode range `U+2500`–`U+257F`. Covered by a new test using sample box-drawing characters.
- **MUST**: `lintGateCommands` on a plan with ASCII-box-art in slice bodies produces zero `blocked-command` errors. Existing Phase 6A plan (or a fixture mirroring it) is the regression test.
- **MUST**: `Invoke-SelfUpdate` in `pforge.ps1` rewrites `.forge/update-check.json` with `{ current: <new VERSION>, latest: <new VERSION>, isNewer: false, checkedAt: <now> }` after a successful update. `pforge.sh` gets the same behavior for parity.
- **MUST**: `checkForUpdate()` treats the cache as stale when `fs.statSync(versionFile).mtimeMs > fs.statSync(cachePath).mtimeMs`. Covered by a new unit test that writes VERSION, writes cache, sleeps 10ms, touches VERSION, and asserts the next call returns `fromCache: false`.
- **MUST**: v2.62.0 CHANGELOG entry covers **both** Phase-28 Forge-Master MVP (the accumulated work on master) **and** Phase-28.1 fixes. Separate sub-sections under `[2.62.0]`.
- **MUST**: `git show v2.62.0:VERSION` returns `2.62.0` at the end of slice 6.
- **SHOULD**: `docs/bugs/BUG-*.md` files get "Fixed in v2.62.0" stamps at the top of each fix-adjacent file.
- **MAY**: A short `docs/manual/windows-notes.md` section summarizing why `shell: true` is needed on Windows and how to recognize `ENOENT` symptoms in future.

### Out of Scope

- **Fix B** (auto-restart the MCP server after self-update) from `BUG-self-update-stale-cache.md` — larger scope, requires PID detection and health-check wait. Track as a separate phase.
- Estimator recommendation tagging (separate `BUG-api-xai-worker-text-only.md` issue) — tracked independently, not in this bundle.
- Step-2 prompt changes (`BUG-step2-gate-portability.md`) — prompt hardening is design work, not a runtime hotfix. Separate phase.
- Any Forge-Master behavior changes — this phase only ships the existing Phase-28 code under a proper tag.

---

## Executable Slices (6 Slices · 1 Session · ~30–60 min · Budget ≤ $5)

> All slices are `[sequential]` — they touch overlapping files (orchestrator.mjs, update-check.mjs) where ordering matters for reviewability. Total complexity budget kept low by keeping each fix under 30 lines of production code.

---

#### Slice 1: Windows `spawn` shim fix (GH #82) [sequential] {#slice-1}

**Goal**: Add `shell: process.platform === "win32"` to the worker spawn call in orchestrator.mjs and verify with a unit test.

**Files**:
- `pforge-mcp/orchestrator.mjs` — add `shell: process.platform === "win32"` to the spawn options at line ~1330.
- `pforge-mcp/tests/orchestrator-spawn-shell.test.mjs` — new test: mocks `node:child_process`, calls the spawn helper (or exercises the branch directly), asserts options include `shell: true` when platform is `win32` and falsey otherwise.

**Depends on**: None.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:1310-1350` — the worker-spawn branch.

**Traces to**: MUST (shell flag present; unit test covers platform dispatch).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-spawn-shell.test.mjs"
bash -c "cd pforge-mcp && grep -q 'shell: process.platform === \"win32\"' orchestrator.mjs"
```

---

#### Slice 2: Box-drawing character prose detection (GH #83) [sequential] {#slice-2}

**Goal**: Teach `looksLikeProse()` that lines starting with Unicode box-drawing characters are documentation, not commands.

**Files**:
- `pforge-mcp/orchestrator.mjs` — extend `looksLikeProse()` (line ~4411) with a new rule: if the first non-whitespace character has codepoint in `0x2500`–`0x257F`, return `true`.
- `pforge-mcp/tests/orchestrator.test.mjs` — append three tests under the existing `looksLikeProse` describe block:
  1. Line starting with `│` returns `true`.
  2. Line starting with `┌─────` returns `true`.
  3. Regular command `npm test` with a box-drawing character in the middle (e.g., a Windows output redirection) is NOT misclassified as prose.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:4411-4430` — existing `looksLikeProse` rules.

**Traces to**: MUST (prose rule added; tests cover three cases).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs -t 'looksLikeProse'"
bash -c "cd pforge-mcp && grep -q '0x2500' orchestrator.mjs && grep -q '0x257F' orchestrator.mjs"
```

---

#### Slice 3: Regression guard — lintGateCommands skips ASCII diagrams (GH #83) [sequential] {#slice-3}

**Goal**: Add an end-to-end regression test so this class of false-positive can never silently return.

**Files**:
- `pforge-mcp/tests/fixtures/plan-with-ascii-diagram.md` — minimal fixture plan with one slice whose body contains a multi-line box-drawing diagram and a real validation gate below it.
- `pforge-mcp/tests/lint-ascii-diagram.test.mjs` — new test: calls `lintGateCommands(fixturePath)`, asserts `result.errors.filter(e => e.rule === 'blocked-command')` is empty and the actual gate command is still present in `result` (not dropped).

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:4256` — `lintGateCommands`.
- Original issue #83 example plan (conceptually, not a direct import — the fixture is inlined).

**Traces to**: MUST (regression test exists and passes).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/lint-ascii-diagram.test.mjs"
```

---

#### Slice 4: Self-update invalidates cache (Fix A) [sequential] {#slice-4}

**Goal**: After a successful `pforge self-update` (CLI), rewrite `.forge/update-check.json` so the banner self-heals on next dashboard load.

**Files**:
- `pforge.ps1` — in `Invoke-SelfUpdate`, after `Invoke-Update` returns successfully, re-read `VERSION` and write the cache file with the new version and `isNewer: false`.
- `pforge.sh` — equivalent change for the bash CLI.
- `pforge-mcp/tests/update-check.test.mjs` — extend existing suite: a test that simulates the self-update path by invoking a small helper (new export `writeFreshCache(projectDir, version)` in `update-check.mjs`) and asserting the cache contents match expectations.
- `pforge-mcp/update-check.mjs` — new exported helper `writeFreshCache(projectDir, version)` used by both the CLIs and the test (avoids shell-script test gymnastics). ~10 lines.

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge.ps1:5055-5155` — `Invoke-SelfUpdate`.
- `pforge-mcp/update-check.mjs:57-70` — `writeCache` internal helper.

**Traces to**: MUST (cache rewritten after CLI self-update; new helper covered by test).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/update-check.test.mjs -t 'writeFreshCache|self-update cache'"
bash -c "grep -q 'writeFreshCache' pforge-mcp/update-check.mjs"
bash -c "grep -q 'update-check.json' pforge.ps1"
```

---

#### Slice 5: checkForUpdate honors VERSION mtime (Fix D) [sequential] {#slice-5}

**Goal**: Defense-in-depth. Even if some future code path bypasses Slice 4, the cache self-invalidates when VERSION is edited.

**Files**:
- `pforge-mcp/update-check.mjs` — in `checkForUpdate()`, before trusting the cache-is-fresh branch, compare `statSync(versionFile).mtimeMs` with `statSync(cachePath).mtimeMs`. If VERSION is newer, treat cache as stale and fall through to the network-refresh path (or return `null` if network is suppressed). ~8 lines.
- `pforge-mcp/tests/update-check.test.mjs` — new test: write cache, sleep 20ms, touch VERSION with a newer mtime, call `checkForUpdate({ currentVersion, projectDir, fetchImpl: spyFetch })`, assert spyFetch was called (i.e., cache was bypassed).

**Depends on**: Slice 4.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/update-check.mjs:105-120` — the `if (cached && cached.checkedAt)` cache-trust branch.

**Traces to**: MUST (cache bypassed when VERSION is newer; unit test covers).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/update-check.test.mjs -t 'mtime|VERSION mtime'"
bash -c "cd pforge-mcp && npx vitest run tests/update-check.test.mjs"
```

---

#### Slice 6: Ship v2.62.0 [sequential] {#slice-6}

**Goal**: CHANGELOG, VERSION bump, tag, GitHub release, post-release bump to 2.62.1-dev. v2.62.0 is the first tag to contain Phase-28 Forge-Master MVP **and** the Phase-28.1 fixes.

**Files**:
- `CHANGELOG.md` — new `[2.62.0]` section. Two subsections: **"Forge-Master MVP (Phase-28)"** summarizing slices 1–8 of the Phase-28 work already on master (subsystem scaffold, intent router, memory retrieval, tool bridge, reasoning loop, session persistence, tool registration, agent guidance docs), and **"Bug fixes (Phase-28.1)"** listing GH #82, GH #83, and the self-update stale-cache fix.
- `VERSION` — `2.62.0` for the tag commit, then `2.62.1-dev` post-tag.
- `pforge-mcp/package.json` — version `2.62.0`.
- `docs/bugs/BUG-*.md` — stamp "**Fixed in v2.62.0**" at the top of each of the three bug reports addressed here.
- `.git/COMMIT_MSG_v2.62.0.txt` — prepared commit message.

**Depends on**: Slice 5 + all tests passing.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` — existing `[2.61.0]` entry for format reference.
- `docs/bugs/BUG-api-xai-worker-text-only.md`, `docs/bugs/BUG-self-update-stale-cache.md`, `docs/bugs/BUG-step2-gate-portability.md` — the latter two stay "Open" since they're not fully fixed here (Fix B + step-2 prompt changes are deferred).

**Traces to**: MUST (VERSION=2.62.0 at tag; bump-back to 2.62.1-dev; CHANGELOG covers Phase-28 + Phase-28.1).

**Validation Gate**:
```bash
bash -c "git show v2.62.0:VERSION | grep -q '^2.62.0$'"
bash -c "cd pforge-mcp && npx vitest run"
bash -c "grep -q '## \\[2.62.0\\]' CHANGELOG.md"
```

---

## Forbidden Actions

- No changes to Forge-Master behavior or API surface. The tool ships exactly as it exists on master today.
- No refactors of unrelated modules. Each slice touches only the files listed.
- No dependency version bumps unless required by a security fix (none expected).
- No modification of `pforge.ps1`'s overall argument-parsing structure — the Invoke-SelfUpdate change is localized to the post-success branch.

## Rollback Plan

Before Slice 1, create a `pre-phase-28.1` branch/tag. On any slice failure that cannot be recovered within the slice's retry budget, `git reset --hard pre-phase-28.1` and file a new hotfix phase with narrower scope. The release itself is cheap to redo (no data migrations, no persistent state changes).

## Agent Notes

- Slice 4 and Slice 5 both touch `update-check.mjs`. Keep changes minimal and additive — a single new export plus a short mtime branch. Do not rewrite `checkForUpdate`'s control flow.
- Slice 1's test needs to stub `child_process.spawn` carefully to avoid actually spawning. Use vitest's `vi.mock('node:child_process', ...)` pattern; see `tests/orchestrator.test.mjs` for prior examples.
- Slice 3's fixture should use real box-drawing Unicode characters (`│`, `┌`, `└`, etc.), not ASCII approximations. Character encoding is the whole point of the test.
- When Slice 6 edits `CHANGELOG.md`, read the existing `[2.61.0]` section for format cues. Keep subsection dividers (`###`) consistent with prior releases.
