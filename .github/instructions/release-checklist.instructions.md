---
description: Plan Forge release procedure — auto-loads when editing release-related files. Maintainer-only; NOT shipped to consuming projects.
applyTo: 'VERSION,CHANGELOG.md,setup.ps1,setup.sh,pforge.ps1,pforge.sh,validate-setup.ps1,validate-setup.sh,pforge-mcp/package.json,package.json,templates/.github/hooks/**,.github/hooks/**'
priority: high
---

# Release Checklist auto-loader

> **You are editing a release-touching file.** Before tagging, read [docs/RELEASE-CHECKLIST.md](../../docs/RELEASE-CHECKLIST.md) end-to-end.

---

## Why this file exists

Plan Forge has shipped broken releases multiple times because invariants weren't checked:
- v2.50.0/v2.51.0/v2.52.0 — `VERSION` shipped as `-dev` inside the tarball
- v2.76.0–v2.80.1 — tags pushed but no GitHub Release cut, `pforge self-update` invisible to users for weeks
- v2.59.x — `PreCommit.mjs` hook only mirrored to consuming projects after a downstream complaint
- v2.82.0 — `postSlice` hook + `self-repair-reporting.instructions.md` missing from setup/update enumerations

The canonical checklist lives at [docs/RELEASE-CHECKLIST.md](../../docs/RELEASE-CHECKLIST.md). Follow it for every tagged release.

---

## Quick gates (verify before commit)

| Gate | Command | Pass criteria |
|---|---|---|
| Hooks mirrored | `diff <(ls .github/hooks) <(ls templates/.github/hooks)` | Every file in `.github/hooks/` also in `templates/.github/hooks/` (`plan-forge.json` is templates-only) |
| Instruction enumeration | See §1b of checklist | Every `.github/instructions/*.instructions.md` is enumerated in setup.{ps1,sh} + pforge.{ps1,sh} (except `project-principles` which ships from `templates/`) |
| VERSION sync | `git show vX.Y.Z:VERSION` after tagging | Exactly `X.Y.Z`, no `-dev`, no trailing newline |
| Release exists | `node pforge-mcp/update-from-github.mjs resolve-tag` | `{"ok":true,"tag":"vX.Y.Z"}` with NO `warning` field |

---

## Editor cues

- Editing **`VERSION`**: must be a clean `X.Y.Z` at tag time. Pick the segment from the commit content (see SemVer rule below) — do NOT just strip `-dev` from the current value. Bump-back is a SEPARATE commit after the release commit. Never combine.
- Editing **`CHANGELOG.md`**: promote `[Unreleased]` → `[X.Y.Z] — YYYY-MM-DD — title`, keep `[Unreleased]` as a placeholder for the next cycle.
- Editing **`pforge-mcp/package.json`**: the `version` field must agree with `VERSION`. Use `version-bump` flow or set both manually.

## SemVer rule (the recurring footgun)

Plan Forge follows [SemVer 2.0.0](https://semver.org/). **Do NOT default to MINOR.** Pick the segment from the commit content:

| Commits in release | Segment | Example |
|---|---|---|
| Only `fix:` / `perf:` / `refactor:` / `chore:` / `docs:` / `test:` / `style:` / `ci:` | **PATCH** (Z) | `3.6.1` → `3.6.2` |
| At least one `feat:` (new tool, flag, instruction file, capability) | **MINOR** (Y) | `3.6.5` → `3.7.0` |
| Any `!:` or `BREAKING CHANGE:` footer | **MAJOR** (X) | `3.9.2` → `4.0.0` |

**Bump-back segment MUST match what was just shipped**:
- Shipped PATCH `X.Y.Z` → bump to `X.Y.(Z+1)-dev` (e.g. `3.6.2` → `3.6.3-dev`)
- Shipped MINOR `X.Y.0` → bump to `X.(Y+1).0-dev` (e.g. `3.7.0` → `3.8.0-dev`)
- Shipped MAJOR `X.0.0` → bump to `(X+1).0.0-dev` (e.g. `4.0.0` → `5.0.0-dev`)

The bump-back biases the *next* maintainer toward a segment. If you ship a `fix:` hotfix but bump to `X.Y+1.0-dev`, the next contributor inherits a `VERSION` that screams "next release is a minor" — and the next hotfix gets shipped as one. This is why v3.6.1 (a hotfix) left `VERSION=3.7.0-dev` and prompted the question.

**If you find `VERSION` already drifted** (e.g. reads `3.7.0-dev` but the next release is a hotfix that should be `3.6.2`): reset `VERSION` + `pforge-mcp/package.json` to the correct next-dev value in a standalone `chore: reset VERSION` commit BEFORE starting the release sequence. See [docs/RELEASE-CHECKLIST.md §6 → "VERSION drifted past intended next release"](../../docs/RELEASE-CHECKLIST.md#version-drifted-past-intended-next-release).
- Editing **`.github/hooks/<file>`**: mirror to `templates/.github/hooks/<file>` in the same commit, or it won't reach consumers.
- Editing **`.github/instructions/<file>.instructions.md`**: add to `setup.ps1` `$sharedFiles`, `setup.sh` `SHARED_FILES`, `pforge.ps1` `$sharedInstructions`, AND `pforge.sh` `for instr_name in ...` — all four. (Exception: this very file, which is dev-only.)
- Editing **`setup.ps1` / `setup.sh` / `pforge.ps1` / `pforge.sh`**: if you change distribution behavior, update [docs/RELEASE-CHECKLIST.md §1](../../docs/RELEASE-CHECKLIST.md#1--distribution-sync-invariants-run-before-commit) so the next maintainer sees the new invariant.

---

## Distribution scope

This instruction file is intentionally **NOT** mirrored to consuming projects:

- It is **NOT** added to `setup.ps1` `$sharedFiles`
- It is **NOT** added to `setup.sh` `SHARED_FILES`
- It is **NOT** added to `pforge.ps1` `$sharedInstructions`
- It is **NOT** added to `pforge.sh` `for instr_name in ...`

The release procedure is Plan Forge maintainer business; downstream projects have their own release flows.

If a future contributor moves it into the shared list, that's a regression — strip it back out and add a comment explaining why.
