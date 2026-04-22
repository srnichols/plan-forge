---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session harden of Phase-31.1 outline)
hardened_at: 2026-04-22
---

# Phase-31.1 — `pforge version-bump` Architectural Rebuild

> **Target release**: v2.65.1
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: v2.65.0 shipped. Closes meta-bug [#91](https://github.com/srnichols/plan-forge/issues/91).
> **Branch strategy**: Direct to `master`. Pure internal refactor + tests + shell parity port; CLI signature unchanged.
> **Session budget**: 1 session, 5 slices. No break recommended (all slices < 10 minutes each).

---

## Specification Source

- **Field input**: v2.65.0 release on 2026-04-22 produced `VERSION = "2.65.02.65.0"` via `.\pforge.ps1 version-bump 2.65.0`. Manual `Set-Content` was required before `git tag v2.65.0`. Root cause: [pforge.ps1#L4114](pforge.ps1#L4114) declares `Pattern = '.*'` for the VERSION target; PowerShell's `-replace` operator matches both the full-string token AND the zero-width end-of-string position, producing a doubled substitution. Secondary failures observed in the same run: README "track record" pattern silently skipped (function still reported success).
- **Architecture anchor**: All work contained to [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` function only), [pforge.sh](pforge.sh) (parity port of same function), and a new vitest suite `pforge-mcp/tests/version-bump.test.mjs`. No MCP tool additions. No `.forge.json` schema changes. No changes to the five target files' own content format.
- **Explicit non-goal**: This plan does NOT consolidate the 5-target version model into a single source-of-truth file (e.g. forcing all files to read VERSION at runtime). That's a release-tooling consolidation conversation for Phase-32+. This plan makes the existing model **correct, validated, and tested**.
- **Prior postmortems**: Meta-bug [#91](https://github.com/srnichols/plan-forge/issues/91) filed via `forge_meta_bug_file` on 2026-04-22 with root-cause diagnosis. No prior attempts to fix.

---

## Scope Contract

### In scope

- [pforge.ps1](pforge.ps1) — `Invoke-VersionBump` function body (lines ~4100–4152) and its argument parsing in the command dispatcher
- [pforge.sh](pforge.sh) — the equivalent `version-bump` function (parity port)
- `pforge-mcp/tests/version-bump.test.mjs` — new vitest harness
- `pforge-mcp/tests/fixtures/version-bump/` — new fixture directory with sample target files
- `CHANGELOG.md` — `[Unreleased]` → `[2.65.1]` promotion at ship time
- `ROADMAP.md` — Phase-31.1 completion entry at ship time

### Out of scope

- Adding new version targets (llms.txt, action.yml, plugin.json, docs/llms.txt)
- Collapsing version into a single source-of-truth file
- Any change to the public `pforge version-bump <v>` CLI signature or positional-arg parsing
- Any change to the content format of the 5 targeted files (VERSION, pforge-mcp/package.json, docs/index.html, README.md, ROADMAP.md)
- Any other pforge command (`init`, `run-plan`, `analyze`, etc.)
- Any dashboard, MCP tool, or orchestrator change
- Phase-31 artifacts (`docs/plans/Phase-31-*`)

### Forbidden actions

- Rename or remove the `version-bump` command from either script
- Remove the `RegexReplace` strategy — HTML badges and README patterns legitimately need substitution
- Add a new CLI command or flag beyond `--dry-run` (already exists globally) and `--strict` (new this phase)
- Introduce a new dependency in `pforge-mcp/package.json`
- Modify any `.forge/runs/**` historical log file
- Edit any `docs/plans/Phase-3[0-1]-*` (completed-phase artifacts)
- Change `capabilities.mjs` output shape

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Default behaviour when a RegexReplace target's pattern is not found | Resolved | **Warn-and-continue by default; fatal under `--strict`.** Rationale: flipping directly to fatal could break CI pipelines that currently accept the warn. Warn path exits non-zero **only if** a hard failure occurred (VERSION overwrite failed, or a target wrote but post-validation didn't see the new version). Pattern-not-found on an optional RegexReplace target exits 0 unless `--strict`. |
| 2 | sh port scope — full parity or VERSION-only | Resolved | **Full parity.** Same Target abstraction, same tests (gated by `process.platform === 'linux' \|\| 'darwin'` for the sh arm). Cost is ~80 lines of bash. Benefit: prevents the exact same class of bug from surfacing the first time someone releases from WSL. |
| 3 | Test harness invocation mode | Resolved | **Child-process invocation against a fresh temp repo** for every test case. Each test: (a) creates a temp dir, (b) seeds fixture files from `pforge-mcp/tests/fixtures/version-bump/`, (c) copies `pforge.ps1`/`pforge.sh` into the temp dir, (d) spawns the script with the args under test, (e) asserts file contents + exit code. Slow but hermetic. |
| 4 | `--dry-run` diff format | Resolved | **Unified diff, 3 lines of context, no colour.** Simpler to test (byte-exact comparison to a golden file) and no terminal-capability detection needed. Colour is a separate future enhancement. |
| 5 | Target abstraction encoding in ps1 | Resolved | **PSCustomObject list** with `File`, `Strategy`, `Pattern` (nullable for Overwrite), `Replace` (nullable for Overwrite), `Desc`, `Optional` (bool — controls strict-mode behaviour). No new class — PowerShell classes add boot cost and this is a script, not a module. |
| 6 | Release trigger for v2.65.1 | Resolved | **Slice 5 is the release slice.** Dogfoods the rebuilt command on itself. If Slice 5 can't cleanly bump to 2.65.1 with `--strict`, the phase is not done. |

No open TBDs.

---

## Acceptance Criteria

### Target abstraction + VERSION overwrite (Slice 1)

- **MUST**: `Invoke-VersionBump` in `pforge.ps1` defines targets as a `[PSCustomObject]` list with fields `File`, `Strategy` (`'Overwrite'` or `'RegexReplace'`), `Pattern`, `Replace`, `Desc`, `Optional`.
- **MUST**: The VERSION target has `Strategy = 'Overwrite'`, `Pattern = $null`, `Replace = $null`.
- **MUST**: Overwrite strategy calls `Set-Content $filePath $newVersion -NoNewline` — no regex involved.
- **MUST**: Running `.\pforge.ps1 version-bump 9.9.9` on a fresh repo produces VERSION with content exactly `9.9.9` (no newline, no duplication).
- **MUST**: All other targets keep `Strategy = 'RegexReplace'` with their existing pattern + replacement pairs unchanged.
- **SHOULD**: A helper function `Get-VersionTargets` returns the target list so tests can introspect it without running the mutation path.

### Post-write validation + exit codes (Slice 2)

- **MUST**: After every target write, the target file is re-read and asserted to contain the new version string as a substring. If absent, the target is logged as a hard failure.
- **MUST**: The function returns a non-zero exit code if any hard failure occurred (VERSION overwrite failed, any Overwrite target validation failed, any RegexReplace target wrote but validation didn't find the new version).
- **MUST**: "Pattern not found" on a RegexReplace target where `Optional = $true` warns but does NOT count as a hard failure under default mode.
- **MUST**: New `--strict` flag (parsed in the function argument loop) promotes every "pattern not found" to a hard failure regardless of `Optional`.
- **MUST**: Final summary line format: `Updated <written>/<total> targets, <failures> failure(s)` on stderr if failures > 0, stdout otherwise.
- **SHOULD**: On hard failure, the function prints the file path and the target description so the operator can locate the problem.

### `--dry-run` preview (Slice 3)

- **MUST**: `--dry-run` is parsed in `Invoke-VersionBump`'s argument loop (same style as `--strict`).
- **MUST**: Under `--dry-run`, NO files are modified — this is enforced by a top-of-function guard that skips all `Set-Content` calls when the flag is active.
- **MUST**: For each target, dry-run prints a unified diff with 3 lines of context comparing current content to projected content. No colour codes.
- **MUST**: Dry-run exits 0 even if a target would have failed under `--strict` — preview is informational.
- **MUST**: Final dry-run summary line: `(dry-run) would update <n>/<total> targets, <x> warning(s)`.
- **SHOULD**: Dry-run diff header mimics `git diff` format (`--- a/<path>` / `+++ b/<path>`) for familiarity.

### Cross-shell parity + tests (Slice 4)

- **MUST**: `pforge.sh` contains an equivalent `version_bump()` function with the same Target-strategy + post-validation + `--dry-run` + `--strict` semantics.
- **MUST**: Bash port uses associative arrays (or parallel arrays if bash 3 compat is required) to encode targets. VERSION uses a `cat > file` overwrite; other targets use `sed -i` (with BSD/GNU portability guard).
- **MUST**: `pforge-mcp/tests/version-bump.test.mjs` exists and covers: happy path (all 5 fixture targets updated), VERSION byte-exact, pattern-not-found default (warn, exit 0 unless VERSION failed), pattern-not-found `--strict` (fatal, non-zero), `--dry-run` leaves files untouched, `--dry-run` produces expected diff output.
- **MUST**: Test suite gates the sh arm on `process.platform !== 'win32'` using `test.skipIf`.
- **MUST**: On `win32`, the ps1 arm invokes `powershell.exe -NoProfile -File <temp>/pforge.ps1 version-bump ...`.
- **MUST**: On posix, the sh arm invokes `bash <temp>/pforge.sh version-bump ...`.
- **MUST**: Golden-file comparison for the dry-run diff — fixture `expected-dry-run.diff` in `tests/fixtures/version-bump/` holds the reference output.
- **SHOULD**: A single test case per shell asserts byte-identical output between ps1 and sh (skipped on Windows since only one shell is present).

### Release v2.65.1 (Slice 5)

- **MUST**: `.\pforge.ps1 version-bump 2.65.1 --dry-run` output is reviewed and the diff matches the expected 5-file changes.
- **MUST**: `.\pforge.ps1 version-bump 2.65.1 --strict` exits 0 with `Updated 5/5 targets, 0 failure(s)`.
- **MUST**: VERSION file contains exactly `2.65.1` (no duplication, no trailing `-dev`).
- **MUST**: `CHANGELOG.md` `[Unreleased]` section promoted to `[2.65.1] — 2026-04-22` with an entry describing the architectural rebuild and closing #91.
- **MUST**: `ROADMAP.md` reflects v2.65.1 and Phase-31.1 as shipped.
- **MUST**: Commit tagged `v2.65.1` and pushed. GitHub release created referencing issue #91 as closed.
- **SHOULD**: All vitest suites in `pforge-mcp/` pass (`npm --prefix pforge-mcp test -- --run`).

---

## Execution Slices

### Slice 1 — Target abstraction + VERSION overwrite strategy [sequential]

**Depends On**: — (entry slice)
**Context Files**: [pforge.ps1](pforge.ps1) (sections: help text around L93, `Invoke-VersionBump` L4100–4152, dispatcher L5631), `.github/instructions/architecture-principles.instructions.md`
**Scope**: [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` function body only)

1. Read current `Invoke-VersionBump` to confirm the exact shape of the existing `$targets` array.
2. Replace the inline `@{...}` hashtables with `[PSCustomObject]@{...}` entries carrying `File`, `Strategy`, `Pattern`, `Replace`, `Desc`, `Optional` fields.
3. VERSION entry becomes `Strategy='Overwrite'; Pattern=$null; Replace=$null; Optional=$false`.
4. All other entries become `Strategy='RegexReplace'` and keep their existing Pattern/Replace. README "track record" target is `Optional=$true` (observed silently skipping on v2.65.0 release). ROADMAP and HTML targets are `Optional=$false`.
5. Replace the single `foreach` body with a switch on `$t.Strategy`: Overwrite calls `Set-Content $filePath $newVersion -NoNewline`; RegexReplace keeps the existing `-replace` logic.
6. Extract the target list into a helper `Get-VersionTargets($newVersion)` returning the array (so Slice 4 tests can introspect).

**Validation Gate**:
```bash
bash -c "grep -q 'Get-VersionTargets' pforge.ps1 && grep -q \"Strategy = 'Overwrite'\" pforge.ps1 && grep -q \"Strategy = 'RegexReplace'\" pforge.ps1 && grep -q 'Set-Content.*-NoNewline' pforge.ps1 && echo OK"
```

Structural verification via grep. End-to-end VERSION correctness is verified by Slice 4's vitest suite (which spawns the script against fixture repos). Avoids nested pwsh-in-bash quoting — see [meta-bug #92](https://github.com/srnichols/plan-forge/issues/92).

**Stop Condition**: Any of the four required identifiers (`Get-VersionTargets`, Overwrite strategy, RegexReplace strategy, Set-Content with -NoNewline) is missing from `pforge.ps1`.

---

### Slice 2 — Post-write validation + non-zero exit on failure [sequential]

**Depends On**: Slice 1
**Context Files**: [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` as modified by Slice 1), `.github/instructions/architecture-principles.instructions.md`
**Scope**: [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` function body only)

1. Add `--strict` flag parsing at the top of `Invoke-VersionBump` (scan `$Arguments` for `--strict`, set `$Strict = $true`).
2. After each target's write (both Overwrite and RegexReplace paths), re-read the file and test for the new version string with `Select-String -Path $filePath -SimpleMatch $newVersion -Quiet`.
3. Classify outcomes into three buckets per target: `Written` (wrote + validated), `Warned` (pattern not found, target is Optional, not strict), `Failed` (wrote but validation missed, OR pattern not found under strict, OR Overwrite I/O error).
4. Track counts in `$written`, `$warned`, `$failed`.
5. Replace the existing final `Write-Host "Updated $updated files"` with a three-case summary:
   - `$failed -eq 0 -and $warned -eq 0`: green `Updated $written/$total targets, 0 failures` on stdout
   - `$failed -eq 0 -and $warned -gt 0`: yellow warning summary on stderr
   - `$failed -gt 0`: red failure summary on stderr + `exit 1`

**Validation Gate**:
```bash
bash -c "grep -q '\-\-strict' pforge.ps1 && grep -qE 'Select-String.*-Path|Get-Content.*-SimpleMatch' pforge.ps1 && grep -qE 'written|warned|failed' pforge.ps1 && grep -q 'Optional = .true' pforge.ps1 && echo OK"
```

Structural verification via grep. End-to-end strict-mode failure behaviour is verified by Slice 4's vitest suite. Avoids nested pwsh-in-bash quoting — see [meta-bug #92](https://github.com/srnichols/plan-forge/issues/92).

**Stop Condition**: `--strict` flag missing, post-write validation call missing, the three-bucket bookkeeping variables missing, or no Optional-flagged targets.

---

### Slice 3 — Honour `--dry-run` with unified diff preview [sequential]

**Depends On**: Slice 2
**Context Files**: [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` as modified), `.github/instructions/architecture-principles.instructions.md`
**Scope**: [pforge.ps1](pforge.ps1) (`Invoke-VersionBump` function body only)

1. Add `--dry-run` flag parsing alongside `--strict` in the argument loop.
2. At the top of the per-target loop, if `$DryRun`, compute the projected new content (for Overwrite: just `$newVersion`; for RegexReplace: run the replace in-memory without writing).
3. Implement a minimal `Get-UnifiedDiff` helper producing `--- a/$File` / `+++ b/$File` / `@@` hunk header / 3 lines context before + after + changed lines. PowerShell-only, no external tools.
4. Emit the diff to stdout. Do NOT call `Set-Content`.
5. At the end, print `(dry-run) would update <n>/<total> targets, <x> warning(s)` and exit 0.
6. Dry-run must NOT run post-write validation (nothing was written).

**Validation Gate**:
```bash
bash -c "grep -q '\-\-dry-run' pforge.ps1 && grep -q 'Get-UnifiedDiff\|unified.*diff\|UnifiedDiff' pforge.ps1 && grep -q '(dry-run)' pforge.ps1 && echo OK"
```

Structural verification via grep. End-to-end dry-run no-mutation + diff shape is verified by Slice 4's vitest suite (golden-file comparison against `expected-dry-run.diff`). Avoids nested pwsh-in-bash quoting — see [meta-bug #92](https://github.com/srnichols/plan-forge/issues/92).

**Stop Condition**: `--dry-run` flag parsing missing, unified-diff helper missing, or dry-run summary line missing.

---

### Slice 4 — Cross-shell parity (sh port) + vitest suite [sequential]

**Depends On**: Slice 3
**Context Files**: [pforge.ps1](pforge.ps1) (Slices 1–3 changes), [pforge.sh](pforge.sh) (current `version-bump` handler), `pforge-mcp/package.json`, `pforge-mcp/vitest.config.mjs`, `.github/instructions/testing.instructions.md`
**Scope**: [pforge.sh](pforge.sh), `pforge-mcp/tests/version-bump.test.mjs` (new), `pforge-mcp/tests/fixtures/version-bump/` (new directory with seed files)

1. Create fixtures: `tests/fixtures/version-bump/VERSION` (`1.0.0-dev`), `package.json` (minimal with `"version": "1.0.0-dev"`), `index.html` (with the two patterns the HTML target matches), `README.md` (with the track-record pattern), `ROADMAP.md` (with the current-release pattern), `expected-dry-run.diff` (golden file for version `2.0.0`).
2. Port Slice 1–3 logic to `pforge.sh`. Use a parallel-array encoding: `TARGET_FILES=(...)`, `TARGET_STRATEGIES=(...)`, etc. VERSION uses `printf '%s' "$new" > "$file"`; RegexReplace uses `sed -i.bak -E "s|$pattern|$replace|g" "$file" && rm "$file.bak"` (BSD/GNU portable form).
3. Parse `--dry-run` and `--strict` in the bash function.
4. Implement post-write validation with `grep -Fq "$new" "$file"`.
5. Implement dry-run diff with `diff -u` against the projected content written to a temp file.
6. Write `pforge-mcp/tests/version-bump.test.mjs` (vitest) covering the seven MUST criteria from the acceptance list. Use `child_process.spawnSync` for script invocation. Each test seeds a fresh temp dir via `fs.mkdtempSync`. Use `test.skipIf(process.platform === 'win32')` on the sh arm and the reverse on the ps1 arm.
7. Register the new test file — no config change should be needed since `vitest.config.mjs` globs `tests/**/*.test.mjs`.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/version-bump.test.mjs --reporter=default"
```

This is the end-to-end gate for Slices 1-3 as well — if any earlier slice's code is wrong, this vitest run will catch it here.

**Stop Condition**: Any test case in the new suite fails.

---

### Slice 5 — Release v2.65.1 (dogfood the rebuilt command) [sequential]

**Depends On**: Slice 4
**Context Files**: `CHANGELOG.md` (head + `[Unreleased]` section), `ROADMAP.md` (current release + backlog), [pforge.ps1](pforge.ps1) (Slices 1–3 changes), `.github/instructions/git-workflow.instructions.md`
**Scope**: `CHANGELOG.md`, `ROADMAP.md`, `VERSION`, `pforge-mcp/package.json`, `docs/index.html`, `README.md` (all mutated by the bump), git tag, GitHub release

1. Run `.\pforge.ps1 version-bump 2.65.1 --dry-run`. Review the output diff against expectations (5 targets: VERSION, pforge-mcp/package.json, docs/index.html × 2 patterns, ROADMAP.md; README may warn as Optional).
2. Run `.\pforge.ps1 version-bump 2.65.1 --strict`. Confirm `Updated 5/5` summary and exit 0. If any target fails, stop and fix before continuing.
3. Edit `CHANGELOG.md`: promote `[Unreleased]` → `[2.65.1] — 2026-04-22` with a single section summarising Slices 1–4 and noting the closure of #91.
4. Edit `ROADMAP.md`: update the current-release entry to v2.65.1 and add a "Phase-31.1 ✅" line under the 2.65.x release notes block.
5. `git add -A && git commit -m "chore(release): v2.65.1" -m "Closes #91. Architectural rebuild of pforge version-bump..."`.
6. `git tag -a v2.65.1 -m "v2.65.1 — version-bump architectural rebuild"`.
7. `git push origin master && git push origin v2.65.1`.
8. `gh release create v2.65.1 --title "v2.65.1 — version-bump rebuild (closes #91)" --notes-file <notes>` where notes summarise the rebuild.
9. Final smoke test: `cat VERSION` must equal `2.65.1`; `git rev-parse v2.65.1` must resolve.

**Validation Gate**:
```bash
bash -c "grep -q '^2.65.1$' VERSION && git rev-parse v2.65.1 >/dev/null 2>&1 && grep -q '\[2.65.1\]' CHANGELOG.md && echo OK"
```

**Stop Condition**: VERSION does not contain exactly `2.65.1`, or the v2.65.1 tag is absent, or CHANGELOG `[2.65.1]` section is missing.

---

## Rollback

- **After Slice 1–3**: `git revert <slice-commit>` on `pforge.ps1`. No data or schema changes.
- **After Slice 4**: `git revert` on `pforge.sh` + delete `tests/version-bump.test.mjs` + `tests/fixtures/version-bump/`. No consumers depend on the new function yet.
- **After Slice 5 tag**: Delete the tag (`git tag -d v2.65.1 && git push origin :refs/tags/v2.65.1`) and the GitHub release (`gh release delete v2.65.1`). Revert the release commit. Previous v2.65.0 remains the latest shipped version.

## Success Signals

- Meta-bug #91 closes with a commit reference linked to the Slice 5 release commit.
- The next version bump (v2.66.0 when Phase-32 ships) runs cleanly under `--strict` with no manual fixup.
- `pforge-mcp/tests/version-bump.test.mjs` appears in future test runs and holds the regression boundary.
