---
crucibleId: 2d8f5a41-7b36-4e92-c18d-f5a3b6e2c9d4
source: self-hosted
status: draft
phase: AUTO-UPDATE-01
---

# Phase AUTO-UPDATE-01: True auto-install with `pforge update --from-github`

> **Status**: 📝 DRAFT — ready for Session 2 execution
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (fetches+extracts remote tarball; touches
> framework files on user systems — never-update list + dry-run are
> mandatory guards)
> **Target Version**: v2.53.0
> **Closes**: [#75](https://github.com/srnichols/plan-forge/issues/75)

---

## Why

Field report: multi-PC Plan Forge deployments do not stay current.
The auto-updater is **detection-only** today:

- `pforge smith` + `update-check.mjs` poll GitHub Releases API every
  24 h and surface a drift banner
- `pforge update [source]` requires a **local Plan Forge clone** as
  source; if none exists (or the clone is stale), the update command
  either fails ("source not found") or installs yesterday's code

No path exists to install a release **directly from GitHub** without
cloning the repo first. Other PCs that never cloned Plan Forge cannot
update at all.

AUTO-UPDATE-01 closes the gap with `pforge update --from-github`:
download release tarball → extract to temp → run the existing
file-copy logic → clean up. Zero new install steps for users; one
new flag.

## Scope Contract

### In-scope

**Slice 1 — `pforge update --from-github` (PowerShell + bash)**

- `pforge.ps1` `Invoke-Update` function — add `--from-github` and
  optional `--tag <tag>` parameters:
  - When `--from-github` is set, the function:
    1. Resolves tag: if `--tag` omitted, GET
       `https://api.github.com/repos/srnichols/plan-forge/releases/latest`
       and read `tag_name`
    2. Downloads `https://api.github.com/repos/srnichols/plan-forge/tarball/<tag>`
       to `.forge/cache/update-<tag>.tar.gz` (4-second connect
       timeout, 30-second total, 50 MB max — reject oversized)
    3. Verifies the download (non-empty, starts with gzip magic
       bytes `0x1F 0x8B`, SHA-256 computed + logged for audit)
    4. Extracts to `.forge/cache/update-<tag>/` using `tar` on
       Windows (bundled with Windows 10+) / macOS / Linux
    5. Sets the resolved tarball-root path as the source_path and
       continues through the existing file-copy flow
    6. On success, cleans up `.forge/cache/update-<tag>.tar.gz` and
       `.forge/cache/update-<tag>/` (keeps the last one for rollback
       only when `--keep-cache`)
  - Error paths: network failure, 4xx/5xx, gzip-invalid, tarball too
    large, extraction failure, disk full — each emits a clear
    `pforge` error prefix + underlying cause; never partially-writes
    framework files
- `pforge.sh` mirror (cURL + `tar xzf`)
- Existing `pforge update <path>` (no flag) behavior **unchanged** —
  back-compat is a hard requirement
- `--tag v2.49.1`, `--tag latest` (explicit override), `--tag HEAD`
  (rejected with `ERR_NO_HEAD_TAG` — this command is for releases,
  not dev builds)
- New `.forge.json` key: `update.fromGitHub.cacheDir` (default
  `.forge/cache/`) — user can override for sandboxed environments
- New `.forge.json` key: `update.fromGitHub.maxTarballBytes` (default
  `52428800` / 50 MB) — hard cap against supply-chain tarball bloat
- **Never-update list respected** — existing protection logic runs
  unchanged; tarball source is irrelevant to the safety layer
- **Dry-run honored** — `--dry-run` with `--from-github` fetches and
  extracts but skips file copy; reports what would change
- Tests in `pforge-mcp/tests/update-from-github.test.mjs` (**new**,
  ~16 tests — covers the JS-level helpers even though the command
  lives in PS/bash):
  - Latest-tag resolver hits `releases/latest`, reads `tag_name`
  - Explicit tag `v2.49.1` used verbatim
  - Tag `HEAD` rejected with `ERR_NO_HEAD_TAG`
  - Tarball URL format (`/tarball/<tag>`)
  - Gzip magic-byte check rejects malformed download
  - 50 MB cap enforced (fixture with >50 MB response rejected)
  - SHA-256 computed + logged
  - Fetch timeout 4s connect / 30s total (mocked)
  - 404 on tag → clear error, no partial write
  - Network failure → clear error, no retry loop (re-run to retry)
  - Temp dir cleanup after success
  - `--keep-cache` preserves temp dir for rollback
  - Dry-run downloads + extracts but skips copy
  - Never-update list applied against extracted tarball root
  - `maxTarballBytes` config override honored
  - `cacheDir` config override honored
- Cross-shell integration smoke tests in
  `pforge-mcp/tests/update-from-github-shell.test.mjs` (**new**,
  ~6 tests, skippable on CI without internet via `CI_SKIP_NETWORK=1`):
  - PowerShell path exits 0 on a known tag (v2.49.1 fixture)
  - Bash path exits 0 on same tag
  - Both paths idempotent (second run is a no-op if already current)

**Slice 2 — `pforge self-update` + dashboard "Update now" + smith refresh flag**

- `pforge.ps1` + `pforge.sh` — new command `self-update`:
  - Wraps `update-check.mjs` + `update --from-github`:
    1. Call `checkForUpdate()` (force refresh — bypass 24 h cache)
    2. If `isNewer: false`, exit 0 with "already current"
    3. If `isNewer: true`, prompt (unless `--yes`) and run
       `update --from-github --tag <latest.tag_name>`
  - Config-guarded: `.forge.json` `autoUpdate.enabled` (default
    `false` — opt-in). When disabled, `self-update` still works
    but emits a once-per-session info log "auto-update is opt-in;
    this is a manual invocation"
  - Flag `--yes` / `-y` auto-confirms (for CI/scheduled runs)
- `pforge smith` — new `--refresh-version-cache` flag:
  - Deletes `.forge/version-check.json` and `.forge/update-check.json`
  - Triggers fresh GitHub API call
  - Useful after a manual update or when investigating "why is my
    other PC not seeing the new version?"
- Dashboard banner becomes actionable:
  - `pforge-mcp/dashboard/index.html` — when
    `/api/update-status` returns `isNewer: true`, render a banner
    with text "New release available: v<tag> — Update now" + button
  - Button dispatches to `POST /api/self-update` which invokes
    `pforge self-update --yes` (async, streams progress as SSE)
  - Progress states: `checking` → `downloading` → `extracting` →
    `applying` → `done` | `failed`
  - When `autoUpdate.enabled: false`, button shows "Install now
    (opt-in)"; when `true`, same button label — the opt-in gate is
    only about background polling, not manual clicks
- `POST /api/self-update` endpoint in `server.mjs`:
  - `network: true`, `writesFiles: true`, `risk: "high"`
  - Rate-limited: max 1 call per 5 min
  - Returns `{ runId, stream: "/api/self-update/<runId>/stream" }`
  - SSE stream yields per-state update; terminal frame includes
    exit code
- `forge_smith` panel: new "Auto-update:" row showing
  `enabled / cache age / last tag seen / last check ts`
- `capabilities.mjs` updates for smith output
- Tests in `pforge-mcp/tests/self-update.test.mjs` (**new**,
  ~12 tests):
  - `checkForUpdate` force-refresh path (cache file deleted)
  - `autoUpdate.enabled: false` → manual invocation still works,
    info-log emitted
  - `--yes` skips prompt
  - `isNewer: false` → exits 0 without calling update-from-github
  - SSE stream emits all 5 states in order on happy path
  - Rate limit: second call within 5 min returns 429
  - Smith `--refresh-version-cache` deletes both cache files
  - Smith auto-update row shows correct fields
- Tests in `pforge-mcp/tests/dashboard-update-banner.test.mjs`
  (**new**, jsdom, ~8 tests):
  - Banner hidden when `isNewer: false`
  - Banner shown with tag name when `isNewer: true`
  - Button click triggers POST + subscribes to SSE stream
  - Progress UI updates on each SSE frame
  - Terminal failure frame renders error message with retry link
  - Button disabled while update in flight
  - `autoUpdate.enabled: false` label variant
  - XSS: tag name escaped in banner render

### Out of scope (later)

- Scheduled background auto-install (cron / Windows Scheduled Task /
  launchd) — `self-update` is invocation-based this phase; scheduling
  can be a user-side wrapper or a later phase
- Rollback to previous version from the dashboard — `--keep-cache`
  preserves the prior tarball on disk; CLI-only rollback for now
  (`pforge update --from-github --tag <prev>`)
- Signing / Sigstore verification of tarballs — SHA-256 logging only
  this phase. Signature verification deserves its own phase once
  release signing is set up
- Partial / incremental updates — always a full tarball this phase
- Multi-project update orchestration — per-project invocation only
- Auto-update of the MCP server while it is running — if
  pforge-mcp/ files change, the existing "restart MCP" notice from
  `pforge update` remains. Hot-swap is out of scope
- VS Code extension auto-install of Plan Forge Copilot integrations —
  separate surface

### Forbidden actions

- Do NOT partially write framework files on download/extract failure
  — staging happens entirely in the cache dir; copy to project only
  after extract verifies
- Do NOT fetch from any URL other than
  `api.github.com/repos/srnichols/plan-forge/...` — hardcode the
  repo; do not accept a `--repo` flag (supply-chain risk). A future
  fork-support phase can add that with signature verification
- Do NOT skip the SHA-256 audit log — even without signature
  verification, we want the hash recorded in
  `.forge/update-audit.log` for every `--from-github` install
- Do NOT cache the GitHub API token in config — if a user sets
  `GITHUB_TOKEN` env var for rate limits, honor it per-invocation
  without persisting
- Do NOT auto-run `self-update` from the MCP server — it is an
  explicit CLI / dashboard button action only. No polling loop
  triggers an install
- Do NOT skip the rate limiter on `/api/self-update` — an attacker
  with dashboard access could otherwise spam update attempts
- Do NOT bypass the never-update list for tarball source files —
  existing protection applies identically to `--from-github` source
- Do NOT overwrite `.forge.json` in the target project — the update
  command has never touched user config, and must not start. Only
  `templateVersion` field is written, per existing behavior
- Do NOT call `self-update` from within a `run-plan` worker — the
  orchestrator must detect in-progress plan execution and refuse
  with `ERR_UPDATE_DURING_RUN` (workers should not mutate the
  framework they're executing under)

## Slices

### Slice 1 — `pforge update --from-github` core (PowerShell + bash)

**Files touched:**
- `pforge.ps1` — `Invoke-Update` extension: `--from-github`,
  `--tag`, `--keep-cache` (~120 LOC)
- `pforge.sh` — cmd_update mirror with `curl` + `tar xzf` (~100 LOC)
- `pforge-mcp/update-from-github.mjs` — **new**, ~160 LOC;
  shared helpers invoked by both shells via `node -e` when
  downloading + verifying (keeps business logic testable in JS)
- `pforge-mcp/tests/update-from-github.test.mjs` — **new**, ~16 tests
- `pforge-mcp/tests/update-from-github-shell.test.mjs` — **new**,
  ~6 tests (skippable on CI without network)
- `docs/CLI-GUIDE.md` — `--from-github` flag documented
- `docs/capabilities.md` — update command section refreshed

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test in
PR body: delete `../plan-forge` clone, run
`./pforge.ps1 update --from-github --dry-run`; confirm tarball
downloads, extracts, and dry-run reports file diffs without
writing. Second run without `--dry-run` applies.

### Slice 2 — `pforge self-update` + dashboard banner + smith refresh

**Files touched:**
- `pforge.ps1` + `pforge.sh` — new `self-update` command (~80 LOC
  each)
- `pforge.ps1` + `pforge.sh` — `smith --refresh-version-cache` flag
  (~20 LOC each)
- `pforge-mcp/server.mjs` — `POST /api/self-update` endpoint with
  SSE stream (~90 LOC)
- `pforge-mcp/dashboard/index.html` — banner markup
- `pforge-mcp/dashboard/app.js` — banner render + button handler +
  SSE client (~120 LOC)
- `pforge-mcp/capabilities.mjs` — Auto-update smith row
- `pforge-mcp/tests/self-update.test.mjs` — **new**, ~12 tests
- `pforge-mcp/tests/dashboard-update-banner.test.mjs` — **new**,
  ~8 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` —
all pass. Manual smoke-test: on a PC without a local clone, load
the dashboard, observe banner for a newer release, click "Update
now", observe SSE progress, confirm files updated.

## Success Criteria

- `pforge update --from-github` works on a PC with **zero local
  clone** — end-to-end from fetch to file-copy, tested
- Back-compat: existing `pforge update <local-path>` unchanged
- Never-update list applies identically to tarball source
- Dry-run honored with `--from-github`
- SHA-256 logged in `.forge/update-audit.log` for every install
- Tarball size cap (50 MB default) enforced
- `pforge self-update --yes` succeeds when a newer release exists
- `pforge smith --refresh-version-cache` forces fresh check
- Dashboard banner renders + button triggers end-to-end install
- Rate limit on `/api/self-update` enforced (1 per 5 min)
- `ERR_UPDATE_DURING_RUN` guard when a run-plan is active
- Zero new TODO/FIXME/stub markers on touched files
- Test count +42
- CHANGELOG entry under `[Unreleased]` targeting v2.53.0
- `Phase-AUTO-UPDATE-01.md` `status: draft` → `in_progress` →
  `complete`
- Issue [#75](https://github.com/srnichols/plan-forge/issues/75)
  closed with commit refs

## Dependencies

**From prior phases:**
- `pforge-mcp/update-check.mjs` (existing) — `checkForUpdate()`
  helper reused + extended with a force-refresh parameter
- `pforge-mcp/capabilities.mjs` smith panel (existing) — pattern
  for new row
- `.forge.json` config system (existing) — new keys follow the same
  defaults-merged-at-load pattern
- Existing `pforge update <path>` file-copy + never-update list
  machinery — Slice 1 layers on top

**On later phases:**
- Signature / Sigstore verification (future) — SHA-256 audit log
  from this phase is the groundwork
- Scheduled background self-update (future) — `self-update --yes`
  is the primitive a scheduler would invoke
- Auto-update notifications via SHOP-03 notification layer — emit
  `auto-update-available` hub event when a check detects drift;
  operators can route that to Slack/PagerDuty/webhook. Phase adds
  the event emission so SHOP-03 adapters can consume it

## Release notes

Ships as v2.53.0. Opt-in by default: `autoUpdate.enabled: false`
means the dashboard banner + manual CLI invocation are the only
paths. No background polling beyond the existing 24 h notifier.

## Notes for the executing agent

- The **Node helper module** (`update-from-github.mjs`) is the key
  design decision — putting network fetch + tarball verify in JS
  instead of shell-native means we get real tests, not shell smoke
  only. PowerShell/bash call into it via `node -e` or a thin
  subprocess
- **`tar` is assumed present on all supported platforms** — Windows
  10+ ships `tar.exe`, macOS and Linux ship it in the base install.
  Do not bundle a tar implementation. If `tar` is absent, emit
  `ERR_NO_TAR` with install instructions
- The **50 MB cap** is defensive. Current release tarballs are
  well under. If the project grows, bump via `.forge.json`
  `update.fromGitHub.maxTarballBytes`
- **SSE implementation** in `server.mjs` — use native `res.write`
  with `data: <json>\n\n` framing; do not pull in an SSE library.
  Existing dashboard already uses WebSocket; SSE here is
  **one-shot progress streaming**, simpler than bidirectional
- The **`ERR_UPDATE_DURING_RUN` guard** reads the orchestrator's
  state via the hub or a PID file. Reuse whatever signal indicates
  "a run is active" rather than inventing a new one — the hub
  emits `run-started` / `run-completed` which the guard can
  subscribe to and cache a flag
- **Audit log format** (`.forge/update-audit.log` — new file, JSONL):
  `{ ts, from: "github", tag, sha256, sizeBytes, source: "manual|self-update",
    filesChanged: N, outcome: "success|failed", error? }` — one line per
  install attempt. Gitignored (local audit trail, not repo history)
- The **config-validate pass** at run-start does not need to change
  for this phase — new keys have safe defaults and are read lazily
- **PowerShell quirks**: `Invoke-WebRequest` for HTTPS download is
  sufficient for Win10+. Set `-UseBasicParsing` and `-TimeoutSec`.
  Honor `GITHUB_TOKEN` via `-Headers @{Authorization = "token $env:GITHUB_TOKEN"}`
  when set
- **Bash quirks**: `curl -fsSL --connect-timeout 4 --max-time 30`
  with `Authorization: token $GITHUB_TOKEN` header when set.
  Verify `tar` with `command -v tar`
- The **dashboard banner** should appear only on tabs where it's
  non-intrusive. Render in the shell header, not inside a tab —
  that way it doesn't shift tab content layout
