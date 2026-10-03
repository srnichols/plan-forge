# Release Checklist (hotfix or feature)

> **Use this for every shipped tag.** Built from real release procedures (`/memories/repo/release-procedure.md`), distribution invariants (`/memories/repo/setup-update-invariants.md`), and the v2.50.0–v2.53.2 / v2.76.0–v2.80.1 / v2.82.0 → v2.82.1 incident lessons. Skipping a step has historically broken `pforge self-update` for downstream users.

---

## 0 — Before you cut the release

- [ ] All target issues / bug IDs are listed in the commit message and CHANGELOG entry.
- [ ] Tests pass for everything you touched. Note pre-existing failures in your status report — do not let unrelated baseline failures block a hotfix.
- [ ] No formatter regressions snuck in. `git diff HEAD` against changed files should show only intentional changes (a real one bit us in v2.82.1: `tools.json#forge_run_plan.description` had been silently truncated by an editor between turns).
- [ ] If documentation CSS (`docs/assets/tailwind.css`) was modified, run `npm run build:css` to rebuild and commit both `tailwind.built.css` and `tailwind.built.css.sha256`. `node docs/manual/maintain.mjs` will fail with a HIGH CSS issue if the built file diverges from the recorded hash.
- [ ] Refresh Copilot AI-credit pricing when model defaults or cost estimates changed: `node scripts\sync-copilot-pricing.mjs` and `node scripts\sync-copilot-pricing.mjs --check`. Commit `pforge-mcp/copilot-pricing.json` when it drifts. Then run `node scripts\check-model-drift.mjs`; it must report no drift: no default retiring within 30 days (`pforge-mcp/model-retirements.json`), none missing from Copilot, and pricing current. The weekly **Model Drift** workflow runs the same check between releases and tracks findings in one issue.
- [ ] Regenerate the shipped-guidance index after the last change to any instruction, prompt, agent, skill, hook, preset, template or runbook file: `node scripts\build-shipped-guidance-hashes.mjs`, then `node scripts\build-shipped-guidance-hashes.mjs --check`. Commit `pforge-mcp/shipped-guidance-hashes.json`. `pforge update` treats a project file whose content is not in this index as customized and keeps it, so a stale index makes the next update report unmodified files as `KEEP`.
- [ ] Working tree clean OR all staged changes belong to this release.
- [ ] Audit both the root workspace lock and the standalone `pforge-mcp` lock. Run a fresh standalone install when either changes; root-workspace success alone does not validate the dependency set consumers install. Review findings rather than treating `npm install` exit 0 as a clean security audit.

---

## 1 — Distribution sync invariants (run before commit)

These are the patterns that broke real users in v2.59.x and earlier. Verify each.

### 1a. Hooks mirror

```pwsh
# Every file in .github/hooks/ MUST also exist in templates/.github/hooks/
$repoHooks = Get-ChildItem .github/hooks -File | Select-Object -ExpandProperty Name
$tmplHooks = Get-ChildItem templates/.github/hooks -File | Select-Object -ExpandProperty Name
$missing = $repoHooks | Where-Object { $_ -notin $tmplHooks }
if ($missing) { Write-Error "Hooks missing from templates: $missing" } else { "OK: hooks mirrored" }
```

If anything is missing, copy it across:
```pwsh
Copy-Item .github/hooks/<name> templates/.github/hooks/<name> -Force
```

History: `PreCommit.mjs` (#74) and `postSlice` (v2.82.1) were each created in `.github/hooks/` only, so downstream projects never received them via `setup` until a sync pass mirrored them.

### 1b. Shared instruction files enumeration

Every `.github/instructions/*.instructions.md` MUST be enumerated in **all four** of:

| File | Pattern |
|---|---|
| [setup.ps1](../setup.ps1) | `$sharedFiles = @( @{ Src = "..."; Dst = "..." } ... )` |
| [setup.sh](../setup.sh) | `SHARED_FILES=( "..." ... )` |
| [pforge.ps1](../pforge.ps1) | `$sharedInstructions = @("...", ...)` |
| [pforge.sh](../pforge.sh) | `for instr_name in "..." "..."; do` |

Verification:
```pwsh
# Maintainer-only instruction files that intentionally do NOT ship to consumers
# (their own frontmatter says so). Skip them when checking enumeration.
$maintainerOnly = @('release-checklist.instructions.md', 'aci-design.instructions.md')

$repo = Get-ChildItem .github/instructions -Filter "*.instructions.md" | Select-Object -ExpandProperty Name
foreach ($f in $repo) {
  if ($maintainerOnly -contains $f) { continue }
  $name = $f
  $hits = @(
    (Select-String -Path setup.ps1   -Pattern $name -Quiet),
    (Select-String -Path setup.sh    -Pattern $name -Quiet),
    (Select-String -Path pforge.ps1  -Pattern $name -Quiet),
    (Select-String -Path pforge.sh   -Pattern $name -Quiet)
  )
  if ($hits -contains $false) { Write-Warning "$name missing from one of setup/update scripts" }
}
```

`project-principles.instructions.md` ships from `templates/.github/instructions/`
and remains user-editable. Architecture, clean-code, security, self-repair,
status, and testing instructions ship from `presets/shared/.github/instructions/`
(consumer-facing, stack-neutral); the remaining shared instructions
(ai-plan-hardening-runbook, context-fuel, git-workflow) ship from
`.github/instructions/`. When a selected stack preset has its own copy of any of
these (every stack preset ships `testing` and `security`), setup and update use
the preset's copy instead. Release and ACI-authoring instructions are
maintainer-only. The string scan above is an
inventory hint, not proof of copying: inspect the actual lists and verify the
installed files so a comment mentioning a filename cannot create a false pass.

### 1c. Pipeline prompts ship via glob — but smith name-checks them

`setup.{ps1,sh}` and `pforge update` use `*.prompt.md` glob to copy. Smith name-checks the pipeline prompts:

```
step0-specify-feature, step1-preflight-check, step2-harden-plan,
step3-execute-slice, step4-completeness-sweep, step5-review-gate,
step6-ship, project-profile
```

If you add a new step-N prompt, add it to smith's `$requiredPipeline` list in `pforge.ps1` AND `pforge.sh`. `project-principles.prompt.md` ships from `templates/` (user-customizable).

### 1d. MCP files are recursively copied

Both `setup` and `pforge update` copy `pforge-mcp/`, `pforge-master/`, and
`pforge-sdk/` recursively. These are all consumer runtime packages, not dev-only
directories. New modules beneath them ship without a per-file enumeration.
Verify the recursive-copy blocks in all four scripts; do not infer delivery
from a file existing in the source checkout.

For runtime packaging changes, exercise both a fresh install and an update
from the previous release in temporary consumer projects, in both shells.
`scripts/release/rehearse.mjs` (§3 Step 3a) does this from the release
archive; `scripts/release/verify-public.mjs` (§3 Step 8) covers the GitHub
download.
Check that newly added modules arrive, moved adapters resolve from their new
locations, and the consumer's own version and configuration survive updating.
The release archive must retain all three packages but exclude phase plans,
archives, cleanup findings, and the root maintainer `AGENTS.md`.

Verify all nine `presets/<stack>/AGENTS.md` templates exist in the actual
archive, not just in the checkout. The root exclusion must be `/AGENTS.md`;
an unanchored `AGENTS.md` rule removes consumer templates at every depth.
For previous Bash updater versions, test a fresh invocation after an in-place
wrapper update: old loaded code may fail after copying its fixed replacement.

Exercise the GitHub download/extract branch as well as local-source updates.
In Git Bash, a native Windows path returned by the Node downloader must be
converted before GNU tar interprets its drive colon as a remote host. A local
source update does not test this boundary. Never replace a published tag to
repair a post-publication finding; publish the next patch and document any
one-time recovery required by already-installed updater code.

### 1e. Routing and runtime contract

Compare routing defaults and the Node floor with the previous release; do not
flip defaults as part of release preparation. Since v3.29 the Copilot SDK
route is the default (`routing.copilotSdk: "prefer"`), with `"off"` as the
opt-out. The flip was based on #307's cost-parity evidence: the SDK cost 33–36%
less than spawn on the same tasks (`scripts/benchmark/sdk-parity.mjs`). Re-run
the benchmark when the SDK or the Copilot CLI changes major version, and
confirm the SDK still costs no more than 5% above spawn.

---

## 2 — Version files (single source of truth)

These MUST agree at the tagged commit. Mismatch broke `pforge self-update` for weeks (v2.50.0–v2.52.0, v2.76.0–v2.80.1).

| File | Format | Authority |
|---|---|---|
| `VERSION` | `2.82.1` (no leading `v`, no trailing newline, no `-dev`) | Tag verification, `release-guard.yml` workflow |
| `pforge-mcp/package.json` | `"version": "2.82.1"` | npm/MCP server |
| `pforge-master/package.json`, root `package.json` | `"version": "2.82.1"` | Forge-Master package (ships to consumers), workspace root |
| `package-lock.json`, `pforge-mcp/package-lock.json` | workspace entries `"version": "2.82.1"` | npm lockfiles |
| `CHANGELOG.md` | `## [2.82.1] — YYYY-MM-DD — title` | User-visible release notes |

### 2a. Choose the right version segment (SemVer — DO NOT DEFAULT TO MINOR)

> **Recurring footgun**: The `VERSION` file's `-dev` suffix biases the maintainer toward whatever the previous bump-back chose. Decide the segment from the **change content**, not from what `VERSION` currently reads. If `VERSION` is wrong for the change you're shipping, fix `VERSION` first (see §6 — "VERSION drifted past intended next release").

Plan Forge follows [SemVer 2.0.0](https://semver.org/). Decide the segment from the dominant commit type in the release:

| Release content | Segment to bump | Example | When to use |
|---|---|---|---|
| Bug fix, perf, refactor, doc-only patch, internal cleanup | **PATCH** (Z) | `3.6.1` → `3.6.2` | Hotfix releases. `fix:` / `perf:` / `refactor:` / `chore:` / `docs:` commits only. **No new tools, no new flags, no schema changes.** |
| Backward-compatible feature, new tool, new flag, new instruction file | **MINOR** (Y) | `3.6.5` → `3.7.0` | At least one `feat:` commit. Adds capability that consumers can opt into. |
| Breaking change to CLI flags, MCP tool surface, config schema, removed/renamed public command | **MAJOR** (X) | `3.9.2` → `4.0.0` | `feat!:` / `fix!:` commit or any commit footer containing `BREAKING CHANGE:`. Always announce in CHANGELOG migration notes. |

**Decision algorithm** (mechanical — apply in order, stop at first match):

1. Any commit in this release contains `BREAKING CHANGE:` or `!:` → **MAJOR**.
2. Any commit in this release uses `feat:` prefix → **MINOR**.
3. Otherwise (only `fix:` / `perf:` / `refactor:` / `chore:` / `docs:` / `test:` / `style:` / `ci:`) → **PATCH**.

**Self-check**: Read the CHANGELOG entry you just promoted in §3.1. If the headline word is "Hotfix" / "Fix" / "Patch" but the version jumps Y, you've broken SemVer — go back and pick PATCH.

Real failures this rule prevents:
- v3.6.1 was a `fix:` hotfix ("Brain Replay Receipt Integrity Hotfix"), but `VERSION` already read `3.7.0-dev` from the previous bump-back. The next hotfix would have shipped as `v3.7.0` and burned the minor number on a one-line parser fix.
- Any time `VERSION` reads `X.Y+1.0-dev` after a feature release but the next thing to ship is a hotfix, you MUST first reset `VERSION` to `X.Y.Z+1-dev` before starting §3.

```pwsh
# Write VERSION (no trailing newline) and every package version and lockfile entry above
node scripts/sync-versions.mjs 2.82.1
```

Verify:
```pwsh
node scripts/sync-versions.mjs --check  # → All package versions match 2.82.1
```

The script changes only version values, so key order, indentation and line endings stay as they are. `pforge-sdk/package.json` is versioned independently (`0.x`) and is left alone. `pforge-mcp/tests/version-sync.test.mjs` fails when any of these disagree with `VERSION`.

---

## 3 — Release sequence (DO NOT DEVIATE)

Skipping any step has burned us before. Each step has the exact command that worked.

**Automated:** `scripts/release/ship.mjs` runs this whole section, from the `to-master` sync through Step 9 and the `to-planning` sync, with the commands below:

```pwsh
# Dry run: preflight, then the plan with every command, nothing changed
node scripts/release/ship.mjs --version X.Y.Z --title "<title>" --worktree ../Plan-Forge-release-<ver>
# Release
node scripts/release/ship.mjs --version X.Y.Z --title "<title>" --worktree ../Plan-Forge-release-<ver> --execute
# Resume after fixing a failed step (preflight is skipped)
node scripts/release/ship.mjs ... --execute --from-step <step-id>
```

Preflight requires a clean `planning/main` that is in sync with `origin`, a clean release worktree on `master`, a non-empty `[Unreleased]`, a version newer than every tag, a tag name that is free on `origin`, and a signed-in `gh`. The release and bump-back commits refuse files other than the version files and `CHANGELOG.md`. You still choose the version (§2a) and add the `release-checks.json` entries (Step 3a) before running it.

Before Step 1, sync consumer code from `planning/main` onto `master` using
`scripts/sync-master.ps1 -Direction to-master` or its Bash twin. Check the
resulting branch contains no development-only artifacts and preserves the
consumer templates. After the release and dev bump, use `to-planning` to
restore the development superset; do not merge the scrub commit back without
the restore/assertion step. Verify the only final branch differences are the
declared dev-only paths.

### Step 1 — CHANGELOG promotion

Promote `[Unreleased]` → `[X.Y.Z] — YYYY-MM-DD — short title`. Do NOT delete the `[Unreleased]` heading; keep it as a placeholder for the next cycle.

### Step 2 — Set clean VERSION

Pick `X.Y.Z` per §2a (SemVer decision). **Do not** just strip `-dev` from the current `VERSION` — that bakes in whatever segment the previous bump-back chose.

```pwsh
# If §2a says PATCH and VERSION currently reads e.g. 3.7.0-dev (minor bump-back)
# but the next release is a hotfix from 3.6.1, set the right number explicitly:
node scripts/sync-versions.mjs 3.6.2
```

### Step 3 — Release commit

```pwsh
git add VERSION package.json package-lock.json pforge-mcp/package.json pforge-mcp/package-lock.json pforge-master/package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z" -m "<short summary, bullets per fix>"
```

### Step 3a — Rehearse the release commit

```pwsh
node scripts/release/rehearse.mjs            # --previous-tag defaults to the highest tag below VERSION
```

From a `git archive` of `HEAD` (what consumers download), in PowerShell and Git Bash, it runs:

- a fresh setup;
- setup from the previous release with consumer customizations, then an update with the previous release's wrapper and another with the new one.

Customizations must survive, the update guard must keep an edited guidance file, and every entry in `scripts/release/release-checks.json` must hold.

It also refuses a tag that already exists on origin at another commit, and a version that is not newer than every release tag there (#128).

Before running it, add an entry to `release-checks.json` for each user-visible fix in this release. Update the model default there when it changes.

The command exits 1 on any FAIL; the logs and `results.txt` are in `%TEMP%/pf-release-rehearsal` (`--logs <dir>` to move them).

The **Release Rehearsal** workflow runs the same rehearsal on a Windows runner when the push in Step 4 lands.

### Step 4 — Push master

```pwsh
git push origin master
```

### Step 5 — Annotate tag at the release commit

```pwsh
git tag -a vX.Y.Z HEAD -m "vX.Y.Z - <title>" -m "" -m "<body>"
git show vX.Y.Z:VERSION   # MUST print exactly X.Y.Z (no -dev, no newline)
```

### Step 6 — Push tag

```pwsh
git push origin vX.Y.Z
```

### Step 7 — Cut GitHub Release (MANDATORY)

```pwsh
gh release create vX.Y.Z --notes-from-tag --verify-tag --title "vX.Y.Z - <title>"
```

> **A pushed tag is NOT a Release.** `pforge self-update` only sees Releases (via `/releases/latest`). v2.76.0–v2.80.1 shipped tags without Releases and `self-update` silently returned v2.75.1 for weeks.

If `--notes-from-tag` errors, run from inside the repo dir (it conflicts with `--repo`).

### Step 8 — Verify the Release is live

```pwsh
gh release list --limit 3
# Top entry MUST be vX.Y.Z marked "Latest"

node pforge-mcp/update-from-github.mjs resolve-tag
# MUST print {"ok":true,"tag":"vX.Y.Z"} with NO "warning" field

$env:GITHUB_TOKEN = (gh auth token)   # avoids API rate limits
node scripts/release/verify-public.mjs
# Projects installed from the previous release run `pforge self-update` over the real
# download, in PowerShell and Git Bash, with and without a root VERSION of their own.
# MUST end "N passed, 0 failed"
```

The **Release Rehearsal** workflow's `verify-public` job runs the same check when the Release is published.

If `resolve-tag` warns, Releases are behind tags. Backfill missing ones (see §6).

### Step 9 — Bump back to dev (match the segment you just shipped)

The bump-back segment **MUST match** the segment you just released — do NOT always bump minor. Otherwise the next maintainer (or agent) inherits a `VERSION` that biases them toward the wrong segment and burns version numbers on the wrong kind of change.

| Just shipped | Next dev version | Example |
|---|---|---|
| PATCH (`X.Y.Z`) | `X.Y.(Z+1)-dev` | shipped `3.6.2` → bump to `3.6.3-dev` |
| MINOR (`X.Y.0`) | `X.(Y+1).0-dev` | shipped `3.7.0` → bump to `3.8.0-dev` |
| MAJOR (`X.0.0`) | `(X+1).0.0-dev` | shipped `4.0.0` → bump to `5.0.0-dev` |

**Why this matters**: `VERSION` is the default for the *next* release. If you ship a hotfix as `3.6.2` and bump to `3.7.0-dev`, the next contributor — even if they're also fixing a one-line bug — will see `3.7.0-dev` and assume the next release is `v3.7.0`. The recurring pattern of "why do hotfixes keep bumping minor?" lives here.

The bump-back is always to the **next likely** release of the same kind. If the next release turns out to be a different kind, see §6 — "VERSION drifted past intended next release" — to correct it before starting §3.

```pwsh
# Example: just shipped 3.6.2 (PATCH). Bump to 3.6.3-dev.
node scripts/sync-versions.mjs 3.6.3-dev

git add VERSION package.json package-lock.json pforge-mcp/package.json pforge-mcp/package-lock.json pforge-master/package.json
git commit -m "chore: bump VERSION to 3.6.3-dev"
git push origin master
```

The bump-back commit is **separate** from the release commit so the tag can sit between them.

---

## 4 — What NOT to do

- ❌ Tag at the plan-closeout commit if VERSION still reads `-dev`. (`release-guard.yml` will reject the push.)
- ❌ Combine the clean-VERSION commit with the dev bump-back. They MUST be separate.
- ❌ Skip step 7 (cutting the Release). Tag without Release = invisible to `pforge self-update`.
- ❌ `git tag <name> <sha>` where `<sha>` is itself a tag — creates a nested tag. Use `<sha>^{}` to dereference.
- ❌ Recreate an old release without re-running `gh release edit <real-latest> --latest`. Recreate flips "Latest" to the most-recent publish.

---

## 5 — Test triage policy

Before tagging, run the touched suites and the broader suite:

Run from the repository root, using the default Vitest reporter:

```pwsh
npx vitest run pforge-mcp/tests/<changed-suite>.test.mjs
npm test
```

The root script runs every package's test suite. Do not substitute a bare
root Vitest run for that workspace-wide gate, and do not use `--reporter=basic`
with Vitest 4. Record the real exit code and Vitest summary, not matching
application log lines that deliberately exercise failures inside passing tests.

A baseline failure is acceptable for a hotfix release IF and ONLY IF:
1. The failure existed at HEAD before your changes (verify with `git stash; npx vitest run; git stash pop`).
2. The failure is unrelated to the issues being fixed.
3. Your status report explicitly notes the pre-existing baseline.

If any test you touched fails OR your changes increase the failure count, fix it before tagging.

---

## 6 — Disaster recovery

### Tag pushed with VERSION=`-dev`

```pwsh
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# Fix VERSION, recommit, redo steps 5-7
```

### Release is missing for an existing tag

```pwsh
$tags = @('vX.Y.Z', 'vA.B.C')
foreach ($t in $tags) {
  gh release create $t --title $t --notes-from-tag --verify-tag
}
gh release edit <real-latest-tag> --latest  # restore Latest marker
```

### `pforge self-update` returns wrong version

```pwsh
node pforge-mcp/update-from-github.mjs resolve-tag
# If "warning" field appears, Releases are behind tags — see above
```

### Sibling-clone update served `-dev` build

v2.53.2 added a guard: `Invoke-Update` (pforge.ps1) and `cmd_update` (pforge.sh) refuse if `source_version` matches `-dev` AND `current_version` doesn't AND `--allow-dev` not set. If a user reports landing on a `-dev` build, point them at `pforge self-update` (the `--from-github` path is authoritative).

### VERSION drifted past intended next release

Symptom: `VERSION` reads e.g. `3.7.0-dev` (minor bump-back from the previous release) but the next thing you're shipping is a hotfix that should be `3.6.2`.

This happens when a previous release used the old unconditional `X.Y+1.0-dev` rule, OR when the maintainer of the previous release picked the wrong segment for the bump-back.

Fix it BEFORE starting §3 (do not just override in §3 step 2 — also correct the historical commit message intent by leaving a one-liner in the new commit message):

```pwsh
# Re-set VERSION and the package versions to the correct next-dev for the change you're about to ship.
# Example: VERSION says 3.7.0-dev, but next release is a hotfix from 3.6.1 → reset to 3.6.2-dev.
node scripts/sync-versions.mjs 3.6.2-dev

git add VERSION package.json package-lock.json pforge-mcp/package.json pforge-mcp/package-lock.json pforge-master/package.json
git commit -m "chore: reset VERSION to 3.6.2-dev (next release is a hotfix, not a minor)"
git push origin master
```

Now proceed with §3 normally. The release commit and tag will use the correct segment.

### User reports `pforge self-update` says "Already current" but they're on a higher version than the latest release

v2.82.2 added explicit downgrade detection. `pforge self-update`:
- Without `--force`: prints a warning that local VERSION is HIGHER than the latest release, lists the likely causes (fork bumped past upstream, manual VERSION edit, sibling-clone with dev version baked in), and explicitly says "doing nothing on purpose — refuses to silently downgrade." Exits 0.
- With `--force` alone: prints `⚠ DOWNGRADE: ...` and exits 1 unless `--downgrade` is also passed. `--force` does NOT imply `--downgrade`.
- With `--force --downgrade`: proceeds with the install over the higher local version, after a `↻ Proceeding with explicit downgrade` line.

If a user genuinely wants the older release (e.g. their local v2.96.0 is corrupt or from a fork they want to abandon), the explicit form is `pforge self-update --force --downgrade`.

---

## 7 — Quick checklist (printable)

```
[ ] §0  Tests pass on touched suites; baseline failures noted
[ ] §0  No formatter regressions in diff
[ ] §0  Both workspace and standalone MCP dependency audits reviewed; changed locks installed and tested
[ ] §0  If docs CSS was changed: `npm run build:css` run and `docs/assets/tailwind.built.css.sha256` committed
[ ] §1a Hooks mirrored (.github/hooks/ ⊆ templates/.github/hooks/)
[ ] §1b Every instruction file enumerated in setup.{ps1,sh} + pforge.{ps1,sh}
[ ] §1c New step-N prompts added to smith's required list (if any)
[ ] §2a Picked SemVer segment from commit content (PATCH for fix:, MINOR for feat:, MAJOR for !:)
[ ] §2  node scripts/sync-versions.mjs X.Y.Z, then --check passes (no -dev)
[ ] §3.1 CHANGELOG promoted [Unreleased] → [X.Y.Z]
[ ] §3.3 git commit -m "chore(release): vX.Y.Z"
[ ] §3.3a node scripts/release/rehearse.mjs → 0 failed (release-checks.json updated for this release)
[ ] §3.4 git push origin master
[ ] §3.5 git tag -a vX.Y.Z HEAD -m "..."
[ ] §3.5 git show vX.Y.Z:VERSION → exactly "X.Y.Z"
[ ] §3.6 git push origin vX.Y.Z
[ ] §3.7 gh release create vX.Y.Z --notes-from-tag --verify-tag
[ ] §3.8 gh release list → vX.Y.Z marked "Latest"
[ ] §3.8 resolve-tag returns {"ok":true,"tag":"vX.Y.Z"} with no warning
[ ] §3.8 node scripts/release/verify-public.mjs → 0 failed (public download, both shells)
[ ] §3.9 node scripts/sync-versions.mjs <next-dev> (PATCH→Z+1, MINOR→Y+1.0, MAJOR→X+1.0.0) — separate commit
[ ] §3.9 git push origin master
```

---

## Appendix — Why this exists

| Incident | Root cause | Fix shipped in |
|---|---|---|
| v2.50.0/v2.51.0/v2.52.0 broken installs | Tarballs shipped `VERSION=-dev` | v2.52.1 + `release-guard.yml` |
| v2.76.0–v2.80.1 invisible releases | Tags pushed, Releases never cut | v2.81.0 backfill + drift warning in `update-from-github.mjs` |
| v2.59.x consumers missed `PreCommit.mjs` | Hook only in `.github/hooks/`, not `templates/` | v2.59.x housekeeping mirror |
| A consumer project landed on `2.54.0-dev` via sibling clone | `pforge update` fell back to dev sibling | v2.53.2 dev-source guard |
| v2.82.1 — consumers missed `postSlice` hook + `self-repair-reporting.instructions.md` | Hook + instruction file not enumerated in setup/update | v2.82.1 sync repair |

Each of those cost real users real time. This checklist exists so it doesn't happen again.
