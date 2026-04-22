---
lane: full
source: human
hardened: false
status: outline
---

# Phase-31.1 — `pforge version-bump` Rebuild

> **Target release**: v2.65.1 (patch)
> **Status**: **Outline — not yet hardened.** Run `step2-harden-plan.prompt.md` before `pforge run-plan`.
> **Depends on**: v2.65.0 shipped. Closes meta-bug [#91](https://github.com/srnichols/plan-forge/issues/91).
> **Branch strategy**: Direct to `master`. Pure internal refactor + tests; no public CLI surface change, no config schema change. Caller-visible behaviour changes are (a) non-zero exit on any target failure, (b) new `--dry-run` honoured, (c) new `--strict` flag that makes "pattern not found" fatal.
> **Session budget**: 1 session, ~4 slices.

---

## Problem Statement

The `Invoke-VersionBump` function in [pforge.ps1](pforge.ps1#L4100-L4152) is a **wrong-abstraction** bug masquerading as a regex bug:

1. **Wrong abstraction** — A single `foreach` applies regex `-replace` to every target. But VERSION is semantically a whole-file rewrite, not a substitution. The loop's own semantic produced `2.65.02.65.0` during the v2.65.0 release because PowerShell's `-replace '.*'` matches both the full string AND the zero-width end-of-string position.
2. **Silent failures** — `⚠️ pattern not found` is logged but `$updated` doesn't increment and the exit code stays 0. A release can ship with README/ROADMAP untouched and CI won't notice. Observed during v2.65.0 release: README "track record" silently skipped.
3. **No post-write validation** — After replacement, nothing re-reads the file to confirm the target version string is now present. The function lied during v2.65.0 ("Updated 5 files") while VERSION contained garbage.
4. **`--dry-run` lie** — The global `--dry-run` flag is advertised in help text but `Invoke-VersionBump` ignores it entirely.
5. **Zero test coverage** — A command that mutates 5 files across every release has no vitest / Pester coverage. Grep `pforge-mcp/tests` for `version-bump` → 0 hits.
6. **ps1 / sh drift risk** — Only ps1 was observed failing, but [pforge.sh](pforge.sh) almost certainly has the same regex pattern. No tests means no parity check.

This is **not** a one-line `.*` → `(?s)\A.*\z` fix. That closes #91 but leaves architectural smells 2–6 in place, and one careless addition of a new target (e.g. `llms.txt`, `action.yml`) reintroduces the same class of bug.

## Specification Source

- **Field input**: v2.65.0 release on 2026-04-22 produced `VERSION = "2.65.02.65.0"`. Manual `Set-Content` was required before tagging. Issue #91 filed via `forge_meta_bug_file` with root-cause diagnosis at [pforge.ps1#L4114](pforge.ps1#L4114).
- **Architecture anchor**: Work contained to [pforge.ps1](pforge.ps1) (`Invoke-VersionBump`), [pforge.sh](pforge.sh) (parity port), and new tests under `pforge-mcp/tests/version-bump.test.mjs` (cross-shell fixture harness invoking both scripts against a temp repo). No MCP tool additions. No `.forge.json` schema change.
- **Explicit non-goal**: This plan does NOT consolidate version into a single source-of-truth file (e.g. forcing all 5 targets to read `VERSION` at runtime). That's a larger conversation (release-tooling consolidation) and belongs in Phase-32+. This plan makes the existing 5-target model **correct and testable**.

---

## Candidate Slices (pre-hardening)

> Numbers are provisional. Final DAG emerges from `step2-harden-plan.prompt.md`.

### Slice 1 — Target abstraction + VERSION overwrite strategy

**Goal**: Replace the inline `@{ File = ...; Pattern = ...; Replace = ... }` hashtable loop with an explicit strategy-based `VersionTarget` list.

- Each target declares `Strategy = 'Overwrite' | 'RegexReplace'`
- `Overwrite` writes the new version as the entire file content (no regex involved)
- `RegexReplace` runs the existing `-replace` logic
- VERSION target becomes `Overwrite`; all others stay `RegexReplace`
- No behavioural change beyond VERSION now being correctly overwritten

**Validation Gate**: `bash -c "cd e:/GitHub/Plan-Forge && pwsh -NoProfile -File pforge.ps1 version-bump 9.9.9 --dry-run && git checkout -- VERSION"` *(smoke test — real gate comes in Slice 4)*

### Slice 2 — Post-write validation + non-zero exit on failure

**Goal**: After every target write, re-read the file and assert the target version string is present. If absent (or if any target hit the "pattern not found" path), exit non-zero.

- Add `ValidateAfter` predicate to each target — minimum contract: `(Select-String -Path $file -Pattern $version -SimpleMatch)` returns at least one match
- New `--strict` flag promotes "pattern not found" from warning to fatal
- Default behaviour (no flag) still warns on pattern-not-found but now also **exits non-zero** if any target failed to write or validate
- Emit a structured summary at the end: `Updated N/M targets, 0 failures` vs `Updated 3/5 targets, 2 failures — see warnings above`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/version-bump.test.mjs -t 'exits non-zero'"`

### Slice 3 — Honour `--dry-run`

**Goal**: The global `--dry-run` flag currently does nothing in `version-bump`. Make it preview the diff without writing.

- Parse `--dry-run` in `Invoke-VersionBump` argument loop
- For each target, compute the would-be new content and print a unified diff (3 lines of context) against the current content
- Print `(dry-run) no files modified` summary line
- Exit 0 on successful dry-run (even if `--strict` would have failed — dry-run is a preview, not a gate)

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/version-bump.test.mjs -t 'dry-run'"`

### Slice 4 — Cross-shell parity tests + sh port

**Goal**: Lock behaviour in tests and port the fix to [pforge.sh](pforge.sh).

- New `pforge-mcp/tests/version-bump.test.mjs` — vitest harness that:
  - Creates a temp repo with fixture VERSION / package.json / index.html / README.md / ROADMAP.md
  - Invokes `pforge.ps1 version-bump 9.9.9` via child_process on Windows
  - Invokes `pforge.sh version-bump 9.9.9` via child_process on posix (gated by `process.platform`)
  - Asserts every target is byte-exact against a golden file
  - Asserts exit code 0 on success, non-zero on missing-pattern + `--strict`
  - Asserts `--dry-run` produces diff output and leaves files untouched
- Port the same Target-strategy + post-validation logic to `pforge.sh`
- Both scripts must produce identical output (modulo line endings) on the same input

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/version-bump.test.mjs"`

### Slice 5 — Release v2.65.1

**Goal**: Dogfood the rebuilt command on itself.

- Run `pforge version-bump 2.65.1 --dry-run` — verify diff output is correct
- Run `pforge version-bump 2.65.1 --strict` — all 5 targets must succeed
- Promote `[Unreleased]` → `[2.65.1]` in CHANGELOG
- Tag `v2.65.1`, push, create GitHub release closing #91

**Validation Gate**: `bash -c "test \"$(cat VERSION)\" = \"2.65.1\" && git rev-parse v2.65.1 >/dev/null 2>&1"`

---

## Forbidden Actions

- Do NOT collapse the 5-target model into a single source-of-truth file — that's Phase-32 scope
- Do NOT remove the RegexReplace strategy — HTML badges and README patterns legitimately need it
- Do NOT add new targets (llms.txt, action.yml, plugin.json) — audit their version pinning is a separate conversation
- Do NOT break the existing `.\pforge.ps1 version-bump <v>` CLI signature

## Required Decisions

- **Default exit code on "pattern not found"**: The current silent-warn behaviour is a bug, but flipping directly to fatal may break CI pipelines that accept the warn. Decision: non-strict mode warns but exits non-zero **only if at least one hard failure occurred** (VERSION overwrite failed, or a target wrote but post-validation didn't find the new version). "Pattern not found" on an optional target (README) warns and exits 0 unless `--strict` is set.
- **sh port parity scope**: Full parity or just VERSION fix? Recommendation: full parity — same Target abstraction, same tests. The cost is ~80 lines of bash vs a 3-char regex fix, but it prevents the same bug from surfacing the first time someone runs the release from WSL.

## Acceptance Criteria

*To be generated by `step2-harden-plan.prompt.md`. Rough draft:*

- MUST — `pforge version-bump 9.9.9` produces VERSION containing exactly `9.9.9` (no duplication, no trailing `-dev`)
- MUST — If any target fails post-write validation, exit code is non-zero
- MUST — `pforge version-bump 9.9.9 --dry-run` leaves all files unchanged and prints a diff preview
- MUST — `pforge version-bump 9.9.9 --strict` exits non-zero on first pattern-not-found
- MUST — `pforge.sh version-bump` produces byte-identical output to `pforge.ps1 version-bump` on the same inputs (modulo line endings)
- MUST — vitest suite covers: happy path, VERSION byte-exact, pattern-not-found warn, pattern-not-found --strict fail, dry-run no-write, cross-shell parity (posix gate)
- SHOULD — Summary line reports `Updated N/M targets, X failures`
- SHOULD — Diff output uses unified-diff format (3 lines context)
