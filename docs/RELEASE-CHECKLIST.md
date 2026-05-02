# Release Checklist (hotfix or feature)

> **Use this for every shipped tag.** Built from real release procedures (`/memories/repo/release-procedure.md`), distribution invariants (`/memories/repo/setup-update-invariants.md`), and the v2.50.0–v2.53.2 / v2.76.0–v2.80.1 / v2.82.0 → v2.82.1 incident lessons. Skipping a step has historically broken `pforge self-update` for downstream users.

---

## 0 — Before you cut the release

- [ ] All target issues / bug IDs are listed in the commit message and CHANGELOG entry.
- [ ] Tests pass for everything you touched. Note pre-existing failures in your status report — do not let unrelated baseline failures block a hotfix.
- [ ] No formatter regressions snuck in. `git diff HEAD` against changed files should show only intentional changes (a real one bit us in v2.82.1: `tools.json#forge_run_plan.description` had been silently truncated by an editor between turns).
- [ ] Working tree clean OR all staged changes belong to this release.

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
$repo = Get-ChildItem .github/instructions -Filter "*.instructions.md" | Select-Object -ExpandProperty Name
foreach ($f in $repo) {
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

`project-principles.instructions.md` is the one exception — it ships from `templates/.github/instructions/` (user-editable). Everything else ships from `.github/instructions/`.

### 1c. Pipeline prompts ship via glob — but smith name-checks them

`setup.{ps1,sh}` and `pforge update` use `*.prompt.md` glob to copy. Smith name-checks the pipeline prompts:

```
step0-specify-feature, step1-preflight-check, step2-harden-plan,
step3-execute-slice, step4-completeness-sweep, step5-review-gate,
step6-ship, project-profile
```

If you add a new step-N prompt, add it to smith's `$requiredPipeline` list in `pforge.ps1` AND `pforge.sh`. `project-principles.prompt.md` ships from `templates/` (user-customizable).

### 1d. MCP files are recursively copied

`pforge update` recursively scans `pforge-mcp/` (excluding `node_modules`, `.forge`, `coverage`). Any new file under `pforge-mcp/` ships automatically — no manual list to update.

`pforge-master/`, `pforge-sdk/` are dev-repo-only and **not** copied by `pforge update`. If you ever ship them to consumers, add an explicit recursive-copy block to `pforge.ps1` AND `pforge.sh`.

---

## 2 — Version files (single source of truth)

Three files MUST agree at the tagged commit. Mismatch broke `pforge self-update` for weeks (v2.50.0–v2.52.0, v2.76.0–v2.80.1).

| File | Format | Authority |
|---|---|---|
| `VERSION` | `2.82.1` (no leading `v`, no trailing newline, no `-dev`) | Tag verification, `release-guard.yml` workflow |
| `pforge-mcp/package.json` | `"version": "2.82.1"` | npm/MCP server |
| `CHANGELOG.md` | `## [2.82.1] — YYYY-MM-DD — title` | User-visible release notes |

```pwsh
# Set both version files atomically
Set-Content -NoNewline -Encoding utf8 -Path VERSION -Value "2.82.1"
$pkg = Get-Content pforge-mcp/package.json -Raw | ConvertFrom-Json
$pkg.version = "2.82.1"
($pkg | ConvertTo-Json -Depth 20) | Set-Content -Encoding utf8 pforge-mcp/package.json
```

Verify:
```pwsh
Get-Content VERSION -Raw  # → 2.82.1
(Get-Content pforge-mcp/package.json -Raw | ConvertFrom-Json).version  # → 2.82.1
```

**Drift to be aware of** (pre-existing, doesn't affect consumers — only `pforge-mcp/package.json` ships):
- `package.json` (root) — `2.65.0-dev`, never bumped after v2.65.0
- `pforge-master/package.json` — drifts from main
- `pforge-sdk/package.json` — independent versioning (`0.1.x`)

If you bring these into lockstep, do it in a separate commit so the release commit stays focused.

---

## 3 — Release sequence (DO NOT DEVIATE)

Skipping any step has burned us before. Each step has the exact command that worked.

### Step 1 — CHANGELOG promotion

Promote `[Unreleased]` → `[X.Y.Z] — YYYY-MM-DD — short title`. Do NOT delete the `[Unreleased]` heading; keep it as a placeholder for the next cycle.

### Step 2 — Set clean VERSION

```pwsh
Set-Content -NoNewline -Encoding utf8 -Path VERSION -Value "X.Y.Z"
# (also pforge-mcp/package.json — see §2)
```

### Step 3 — Release commit

```pwsh
git add -A
git commit -m "chore(release): vX.Y.Z" -m "<short summary, bullets per fix>"
```

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
```

If `resolve-tag` warns, Releases are behind tags. Backfill missing ones (see §6).

### Step 9 — Bump back to dev

```pwsh
Set-Content -NoNewline -Encoding utf8 -Path VERSION -Value "X.Y+1.0-dev"
$pkg = Get-Content pforge-mcp/package.json -Raw | ConvertFrom-Json
$pkg.version = "X.Y+1.0-dev"
($pkg | ConvertTo-Json -Depth 20) | Set-Content -Encoding utf8 pforge-mcp/package.json

git add VERSION pforge-mcp/package.json
git commit -m "chore: bump VERSION to X.Y+1.0-dev"
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

```pwsh
cd pforge-mcp
npx vitest run tests/<changed-suites> --reporter=dot   # MUST be 100%
npx vitest run --reporter=dot                          # may have baseline failures
```

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
[ ] §1a Hooks mirrored (.github/hooks/ ⊆ templates/.github/hooks/)
[ ] §1b Every instruction file enumerated in setup.{ps1,sh} + pforge.{ps1,sh}
[ ] §1c New step-N prompts added to smith's required list (if any)
[ ] §2  VERSION + pforge-mcp/package.json both = X.Y.Z (no -dev)
[ ] §3.1 CHANGELOG promoted [Unreleased] → [X.Y.Z]
[ ] §3.3 git commit -m "chore(release): vX.Y.Z"
[ ] §3.4 git push origin master
[ ] §3.5 git tag -a vX.Y.Z HEAD -m "..."
[ ] §3.5 git show vX.Y.Z:VERSION → exactly "X.Y.Z"
[ ] §3.6 git push origin vX.Y.Z
[ ] §3.7 gh release create vX.Y.Z --notes-from-tag --verify-tag
[ ] §3.8 gh release list → vX.Y.Z marked "Latest"
[ ] §3.8 resolve-tag returns {"ok":true,"tag":"vX.Y.Z"} with no warning
[ ] §3.9 Bump VERSION + pforge-mcp/package.json → X.Y+1.0-dev (separate commit)
[ ] §3.9 git push origin master
```

---

## Appendix — Why this exists

| Incident | Root cause | Fix shipped in |
|---|---|---|
| v2.50.0/v2.51.0/v2.52.0 broken installs | Tarballs shipped `VERSION=-dev` | v2.52.1 + `release-guard.yml` |
| v2.76.0–v2.80.1 invisible releases | Tags pushed, Releases never cut | v2.81.0 backfill + drift warning in `update-from-github.mjs` |
| v2.59.x consumers missed `PreCommit.mjs` | Hook only in `.github/hooks/`, not `templates/` | v2.59.x housekeeping mirror |
| Rummag landed on `2.54.0-dev` via sibling clone | `pforge update` fell back to dev sibling | v2.53.2 dev-source guard |
| v2.82.1 — consumers missed `postSlice` hook + `self-repair-reporting.instructions.md` | Hook + instruction file not enumerated in setup/update | v2.82.1 sync repair |

Each of those cost real users real time. This checklist exists so it doesn't happen again.
