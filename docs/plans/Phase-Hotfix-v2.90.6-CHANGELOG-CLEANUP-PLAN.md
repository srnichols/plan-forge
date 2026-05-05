# Hotfix v2.90.6 — CHANGELOG Cleanup

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Documentation only
> **Estimated cost**: $0.05–$0.15 (2 slices, pure prose editing)
> **VERSION target**: 2.90.5 → 2.90.6 (patch)
> **Depends on**: All five prior hotfixes (so the entries to consolidate are stable)

---

## Feature Specification

### Problem Statement

The May 5 hotfix series produced multiple CHANGELOG entries that overlap or describe related work. Specifically:

- `[2.89.0]` — Section 9 added + dogfood runbook
- `[2.89.1]` — First dogfood run (caught the CLI plumbing gap)
- `[2.90.0]` — Phase B.1 fixed plumbing + REAL dogfood

Plus the upcoming `[2.90.1]` through `[2.90.5]` from this hotfix series. Reading the CHANGELOG in commit-order tells the right story but the front-of-file is now ~80 lines of dogfood-and-watchdog detail before a reader gets to anything else. This hotfix:

1. Folds the three Section-9-related entries (2.89.0, 2.89.1, 2.90.0) into a single canonical `[2.90.0]` entry that tells the two-stage story cleanly.
2. Adds a "Hotfix series 2.90.x" preamble at the top of `[Unreleased]` (or just below the most-recent release marker) explaining the series exists.
3. Verifies all entry headings follow `[X.Y.Z] — YYYY-MM-DD — <one-liner>` format consistently.
4. No content removal — old detail moves into a "Detailed history" subsection or a footnote, preserved for forensics.

The work is **strictly documentation-only**. No code, no tests changed. `VERSION` bumps to 2.90.6 as the marker for "after this point, CHANGELOG hygiene is baseline-clean".

### User Scenarios

**Scenario 1: New reader opens CHANGELOG.md**
1. Top of file shows `[Unreleased]` and (future) `[2.90.6] — CHANGELOG cleanup`.
2. Below: `[2.90.0]` is now a single canonical entry titled "Section 9 + dogfood + Phase B.1 CLI plumbing" with the two-stage narrative inline.
3. Below: the hotfix series 2.90.1 → 2.90.5 entries each have one-liner summaries, full detail intact.
4. Reader can skim the headlines without scrolling through 80 lines of dogfood gore.

**Scenario 2: Maintainer needs to find the original 2.89.0 release notes**
1. Maintainer reads the `[2.90.0]` consolidated entry's "Detailed history" subsection.
2. Sees "Originally shipped as 2.89.0 (Section 9 + runbook), 2.89.1 (first dogfood run revealed CLI gap), then 2.90.0 (Phase B.1 fix + real dogfood)."
3. Cross-references commits if needed.

### Acceptance Criteria

- [ ] **MUST**: `[2.89.0]` and `[2.89.1]` headings removed from `CHANGELOG.md`. Their content folded into a consolidated `[2.90.0]` entry.
- [ ] **MUST**: The consolidated `[2.90.0]` entry has subsections: `Added`, `Why this matters`, `Detailed history` (mentioning the original 2.89.x bumps and their commits).
- [ ] **MUST**: All `[X.Y.Z]` headings in CHANGELOG.md use the format `## [X.Y.Z] — YYYY-MM-DD — <one-liner>` (em-dash separator, not hyphen-minus).
- [ ] **MUST**: No CHANGELOG content is deleted — only re-organised. Run a word-count check: post-cleanup file is within ±10% of pre-cleanup.
- [ ] **MUST**: A new "Hotfix series 2.90.x" callout block at the top (just below the page header) summarises the six hotfixes for skim-readers.
- [ ] **MUST**: VERSION bumped to 2.90.6.
- [ ] **MUST**: A new entry `[2.90.6] — YYYY-MM-DD — CHANGELOG cleanup` exists with subsections `Changed`, `Why this matters`.
- [ ] **MUST**: A regression test `pforge-mcp/tests/changelog-format.test.mjs` asserts the heading format and refuses to allow `[2.89.x]` entries to re-appear.
- [ ] **SHOULD**: All hotfix-2.90.x entries cross-link to their PR/commit hash on GitHub.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| The consolidated entry's "Detailed history" subsection grows long (>30 lines) | Acceptable — better than losing the detail. |
| Some prior entries already use `-` instead of `—` | Hotfix may normalise them. Add to scope or punt. **Recommend**: punt, only normalise the affected entries. |
| Future hotfix re-introduces a `[2.89.x]` entry | The regression test fails the build. Author has to use a different version. |
| CHANGELOG.md has trailing newline issues from Set-Content | Hotfix preserves UTF-8 + LF line endings. |

### Out of Scope

- Migrating the CHANGELOG to a different format (e.g. machine-readable JSON).
- Adding a "Migration guide" subsection.
- Tagging git releases for each hotfix (that's a separate operational concern).
- Auto-generating CHANGELOG entries from commit messages.

---

## Scope Contract

### Inputs
- [CHANGELOG.md](../../CHANGELOG.md) — current state with 2.89.0, 2.89.1, 2.90.0 entries (which v2.90.5 will have appended hotfix entries between)

### Outputs
- **Modified**: `CHANGELOG.md` (consolidation + hygiene + new 2.90.6 entry)
- **New**: `pforge-mcp/tests/changelog-format.test.mjs` (regression guard)
- **Modified**: `VERSION`, `pforge-mcp/package.json`

### Forbidden Actions
- ❌ Deleting any historical detail (re-organise only)
- ❌ Modifying entries older than `[2.89.0]`
- ❌ Adding code changes (this hotfix is docs-only)
- ❌ Changing the CHANGELOG file format / structure beyond the heading-line normalisation

---

## Slice Plan

### Slice 1 — Consolidation + format normalisation
**Files in scope**: `CHANGELOG.md`
**Validation gate**:
```bash
node -e "const cl=require('fs').readFileSync('CHANGELOG.md','utf8'); const checks={no289:!/##\s+\[2\.89\./.test(cl), has290consolidated:/##\s+\[2\.90\.0\]/.test(cl), hasHistorySection:/Detailed history/.test(cl), hasHotfixSeriesCallout:/Hotfix series 2\.90\.x/i.test(cl)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.05

### Slice 2 — Regression test + 2.90.6 entry + version bump
**Files in scope**: `pforge-mcp/tests/changelog-format.test.mjs`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/changelog-format.test.mjs
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const checks={version:v==='2.90.6', has2906:/##\s+\[2\.90\.6\]/.test(cl)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.05

---

## Branch Strategy
- Branch: `hotfix/v2.90.6-changelog-cleanup`
- Base: `master` (after v2.90.5)

## Rollback Plan
- Pure documentation. `git revert <merge-commit>` restores the original entries.
