# BUG: `pforge self-update` doesn't invalidate `.forge/update-check.json` cache, banner stays stuck

**Filed**: 2026-04-21
**Severity**: Medium — cosmetic in effect but erodes trust in the self-update pipeline (user thinks the update didn't work)
**Status**: Fixed in v2.62.0
**Observed on**: v2.61.0 (dashboard banner still showing "v2.57.0 available (you have v2.50.0-dev)" after a clean `pforge self-update` + `pforge smith`)

---

## Symptom

1. Dashboard header shows the correct post-update version (e.g. `v2.61.0`).
2. Dashboard "update available" banner simultaneously shows an older pairing: *"v2.57.0 available (you have v2.50.0-dev)"*.
3. User clicks Update now → it runs but the banner persists (server still reads the stale cache until TTL expires or the file is hand-edited).

Screenshot: dashboard header `v2.61.0` on the left, update banner on the right says `v2.57.0 available (you have v2.50.0-dev)` with an `Update now` button.

## Root Cause

Two cooperating bugs, both in the update pipeline:

### 1. `pforge self-update` leaves `.forge/update-check.json` untouched

`pforge-mcp/update-check.mjs` caches the last GitHub release check at `.forge/update-check.json` with a 24-hour TTL:

```json
{
  "current": "2.50.0-dev",
  "latest": "2.57.0",
  "isNewer": true,
  "checkedAt": "2026-04-21T05:14:22Z"
}
```

When `pforge self-update` runs (code in `pforge-mcp/update-from-github.mjs`), it:
- Downloads the latest release tarball
- Overwrites framework files (including `VERSION`)
- **Does not clear, rewrite, or touch** `.forge/update-check.json`

Result: for the next ~24 hours after a self-update, the cache still says the user is behind.

### 2. `/api/update-status` partially compensates — but only if the server has been restarted

`server.mjs` (`/api/update-status` handler) reads `VERSION` fresh on every request, then calls `checkForUpdate({ currentVersion: current, ... })`. Inside `checkForUpdate`, when the cache is still fresh:

```js
return { ...cached, current: currentVersion, isNewer: compareVersions(currentVersion, cached.latest) < 0, fromCache: true };
```

So IF the running server has this logic AND VERSION on disk was updated, it should return `isNewer: false` and the banner should not render.

BUT the MCP server is a long-lived process. A user who:
- Was running the v2.50.0-dev server before the update
- Ran `pforge self-update` (updated files on disk)
- Did **not** restart the MCP server process
- Loads the dashboard

...is hitting an old server process that serves the endpoint with older logic (or, more importantly, reads `VERSION` once at startup and caches it in module scope). The running process's view of "current" is still `2.50.0-dev`.

Compounds with bug #1: even if restarted, the stale cache JSON is still on disk and the recomputed `isNewer` result depends on *both* live VERSION and cached `latest` — if `latest` is also stale (e.g. `2.57.0` when GitHub actually has `2.61.0`), the client will show a subtly-wrong banner for the remainder of the 24h TTL.

## Repro

1. Start from a fresh install at v2.50.0-dev.
2. Open the dashboard and let the update-check run (populates `.forge/update-check.json` with `{current: 2.50.0-dev, latest: <whatever is newest at that moment>, isNewer: true}`).
3. Run `pforge self-update` — VERSION goes to (say) `2.61.0`.
4. Without restarting the MCP server, reload the dashboard.
5. Observe: header shows `v2.61.0`, banner still says "v<old-latest> available (you have v2.50.0-dev)".

## Proposed Fixes

### Fix A — `self-update` invalidates the cache (minimal, do this)

At the end of `update-from-github.mjs` successful flow, write a fresh cache entry reflecting reality:

```js
// After VERSION has been updated and framework files landed:
const newVersion = readFileSync(resolve(projectDir, "VERSION"), "utf-8").trim();
const cachePath = resolve(projectDir, ".forge", "update-check.json");
try {
  const payload = {
    current: newVersion,
    latest: newVersion,
    isNewer: false,
    url: null,
    publishedAt: null,
    checkedAt: new Date().toISOString(),
    fromCache: false,
  };
  writeFileSync(cachePath, JSON.stringify(payload, null, 2));
} catch { /* non-fatal */ }
```

Or even simpler: delete the file (`unlinkSync`) and let the next dashboard load populate a fresh one from GitHub.

### Fix B — auto-restart the MCP server after self-update

`pforge self-update` already knows the install is changing under the running server. It should:
1. Detect if an MCP server is running (PID file at `.forge/mcp-server.pid` — already exists)
2. POST to `/api/server/restart` (the endpoint we added in v2.61.0 for the restart button)
3. Wait for it to come back up before declaring success

That way the user never ends up in the "files updated but in-memory state stale" zone.

### Fix C — banner compares `isNewer` with live recomputation on the client

Already happens server-side in `checkForUpdate`, but add a belt-and-suspenders on the dashboard:

```js
// app.js ~L3477
if (data.current && data.latest && !compareClientSide(data.current, data.latest)) {
  return; // silently suppress — don't trust stale server answers
}
```

Minor. Probably not worth the complexity given A+B cover it.

### Fix D — TTL guard: shorten TTL after a VERSION change is detected

`checkForUpdate` could check VERSION mtime vs. cache mtime. If VERSION was modified after the cache was written, treat the cache as expired regardless of TTL:

```js
const versionMtime = statSync(versionFile).mtimeMs;
const cacheMtime = statSync(cachePath).mtimeMs;
if (versionMtime > cacheMtime) {
  // VERSION changed after this cache was written — stale.
  return await refreshFromNetwork();
}
```

Cheap, surgical, and works even when Fix A is forgotten on some future release path.

## Recommended action

Apply **Fix A** (cache write at end of `self-update`) and **Fix D** (VERSION mtime vs. cache mtime check). Both are small, both are defensive, and together they make the banner self-heal under any combination of update paths (dashboard `Update now` button, CLI `pforge self-update`, manual git pull of a sibling clone, etc.).

Fix B (auto-restart) is desirable but larger scope — track separately.

## Related

- `pforge-mcp/update-check.mjs` — cache read/write
- `pforge-mcp/update-from-github.mjs` — self-update flow
- `pforge-mcp/server.mjs` — `/api/update-status` handler and `/api/server/restart` endpoint
- `pforge-mcp/dashboard/app.js:~3477` — banner render logic
- v2.61.0 already added the ⟳ restart button; leveraging it in Fix B is a natural extension.

## Workaround (until fixed)

After `pforge self-update`:
1. Click the ⟳ (restart server) button in the dashboard header — restarts the MCP process so it picks up the new VERSION and code.
2. Manually delete `.forge/update-check.json` to force a fresh network check on next dashboard load.

Or CLI-only:
```powershell
Remove-Item .forge\update-check.json -ErrorAction SilentlyContinue
Stop-Process -Id (Get-Content .forge\mcp-server.pid) -ErrorAction SilentlyContinue
# Restart however you normally start the server
```
