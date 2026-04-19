---
crucibleId: 3f8d7a91-2e45-4c68-9b13-d2f41a8e6b07
source: self-hosted
status: draft
phase: FORGE-SHOP-03
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-03: Notification layer — webhook core + extension stubs

> **Status**: 📝 DRAFT — ready for Session 2 execution
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (external I/O, auth credentials, rate
> limiting — test-guards non-negotiable)
> **Target Version**: v2.50.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)
Prior phase: [Phase-FORGE-SHOP-02.md](Phase-FORGE-SHOP-02.md)

---

## Why

FORGE-SHOP-02 (v2.49.0) shipped the review queue — the operator can
see pending decisions on one tab. But the shop is still **pull-only**:
critical incidents, blocker reviews, and visual regressions silently
wait on the dashboard until somebody opens the browser.

Plan Forge already ships the **OpenClaw bridge** (v2.29) with basic
Telegram/Slack/Discord webhook delivery wired to LiveGuard incidents.
But it:

- lives in a single adapter file, not a pluggable registry
- is invoked **only from incident creation** — review-queue, bug
  registration, visual regressions don't trigger it
- has no routing rules (every subscribed channel gets every event)
- has no rate limiting (10 events/sec = 10 pings per channel)
- has no delivery-failure handling

FORGE-SHOP-03 ships the **notification layer**: a thin core that
consumes hub events (the existing bus), routes by rule, sends via
adapter plugins, and rate-limits. Slack/Teams/Email/PagerDuty adapters
land as **extension stubs** with the full adapter contract frozen —
enough to validate the plugin shape; complete implementations ship
in the extensions catalog.

## Scope Contract

### In-scope

**Slice 03.1 — Notification core + routing + webhook adapter**

- `.forge/notifications/config.json` — new file, frozen shape per
  arc doc §"Notification routing":

  ```jsonc
  {
    "enabled": true,
    "adapters": {
      "webhook": { "enabled": true, "url": null }
    },
    "routes": [
      { "when": { "event": "incident-opened", "severity": ">=high" }, "via": ["webhook"] },
      { "when": { "event": "tempering-visual-regression-detected" }, "via": ["webhook"] },
      { "when": { "event": "review-queue-item-added", "severity": "blocker" }, "via": ["webhook"] }
    ],
    "rateLimit": { "perMinute": 10, "digestAfter": 5 }
  }
  ```

  - File auto-created on first tool call via
    `ensureNotificationsDirs(projectRoot)` helper in
    `orchestrator.mjs`. Never overwrites existing config.
- `pforge-mcp/notifications/` — **new directory**, 3 files:
  - `core.mjs` — event consumer, route matcher, rate limiter,
    delivery dispatcher (~220 LOC)
  - `adapter-contract.mjs` — JSDoc-only contract defining the
    `send({ event, route, formattedMessage, correlationId })`
    interface plus `validate(config)` for per-adapter config checks
  - `webhook-adapter.mjs` — generic HTTP POST adapter (~90 LOC)
- Route matcher logic (pure function, ~60 LOC in `core.mjs`):
  - Matches `when.event` against hub-event `type` (glob supported,
    e.g., `tempering-*`)
  - Optional `when.severity` filter with comparison operators
    (`=`, `>=`, `>`, `<=`, `<`). Only applies when event payload has
    a `severity` field
  - Returns array of matched `via` adapter names
- Rate limiter (~50 LOC, token-bucket per adapter):
  - `perMinute: N` — hard cap on `send()` calls per adapter per
    minute
  - `digestAfter: K` — when `K` events match the same route within
    a 60-second window, coalesce into a single digest notification
    at the end of the window instead of sending individually
  - Digests emit `notification-digested` hub event instead of per-item
- Hook the existing hub:
  - `hub.on('*', notifyCore.ingest)` — notification core subscribes
    to ALL hub events; filters via route matcher. Single subscriber,
    low overhead.
  - Respects `NODE_ENV !== "test"` — no notifications from unit tests
- MCP tools:
  - **`forge_notify_send`** — direct send, bypasses routing. Input:
    `{ via: "webhook"|"slack"|"teams"|..., payload, formattedMessage? }`.
    Used by agents for ad-hoc dispatches. `writesFiles: false`,
    `network: true`, `risk: "medium"`
  - **`forge_notify_test`** — dry-run verification. Input:
    `{ adapter?: string }`. Validates config for all or one adapter,
    sends a test payload (if `dryRun: false`), returns per-adapter
    status. `writesFiles: false`, `risk: "low"`
- TOOL_METADATA entries in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.50.0"`; full contracts
- Hub events:
  - `notification-sent` (payload: `adapter`, `event`, `correlationId`,
    `deliveryMs`)
  - `notification-rate-limited` (payload: `adapter`, `event`,
    `reason: "token-bucket" | "digested"`)
  - `notification-send-failed` (payload: `adapter`, `event`,
    `errorCode`, `attemptCount`) — **never swallowed**; Watcher flags
- **L3 capture** on `notification-send-failed` via `captureMemory`:
  tags `notification`, `failure`, `<adapter>`. Payload: `adapter`,
  `errorCode`, `attemptCount`. Never payload body content.
- Telemetry: OTEL span per `send()` with adapter, duration, success
- **Forbidden from unit tests**: notification core must detect
  `process.env.NODE_ENV === "test"` and become a no-op. Write a test
  that exercises this guard explicitly

**Slice 03.2 — Extension stubs + Config subtab + watcher wire-in**

Four **extension adapter stubs** — registered in the extensions
catalog but not shipped in core:

1. `extensions/notify-slack/` — package skeleton:
   - `package.json` with `"pforge-extension": { "kind": "notify-adapter", "name": "slack" }`
   - `index.mjs` exports `adapter` object conforming to
     `adapter-contract.mjs`. Implementation stub: throws
     `ErrNotImplemented` with clear "install a Slack SDK" message
   - `README.md` — install steps + config sample
   - Test fixture + 2 smoke tests validating the contract shape
2. `extensions/notify-teams/` — same skeleton
3. `extensions/notify-email/` — same skeleton, SMTP-focused
4. `extensions/notify-pagerduty/` — same skeleton, `integrationKey`-focused
   
- Each stub is independently installable via `pforge ext add notify-slack`.
  Until installed, `notifications.config.json` can reference them but
  the adapter `validate()` returns `{ ok: false, reason: "not-installed" }`
- `extensions/catalog.json` — add the 4 new entries with `kind: "notify-adapter"`
- Dashboard additions:
  - **Config subtab "Notifications"** (under existing Config tab):
    - Adapter grid: one card per known adapter (webhook + 4 stubs).
      Each card shows: `enabled` toggle, config fields (URL / webhook /
      integrationKey / SMTP), "Test" button that calls
      `forge_notify_test`, last-delivery status
    - Routes editor: table of routes with `event`, `severity`, `via`
      dropdown. Add/remove rows; save writes to
      `.forge/notifications/config.json`
    - Rate-limit section: `perMinute` + `digestAfter` inputs
  - Home-tab activity feed: color `notification-sent` / `notification-send-failed`
    events distinctly (feed already exists from SHOP-01)
- Watcher additions:
  - New anomaly rule `notification-delivery-failing` (severity:
    warn) — 3+ `notification-send-failed` events for the same
    adapter in the last hour. Added to `detectWatchAnomalies` +
    `recommendFromAnomalies`
  - Watcher chip: append `Notify: <sent today> / <failed today>`
- `forge_smith` panel: new "Notifications:" row showing
  `enabled adapters / routes configured / events sent today /
  failures today`

### Out of scope (later)

- Full Slack/Teams/Email/PagerDuty implementations (ship in
  extensions catalog in follow-up PRs, not this core)
- Persistent delivery queue with retry backoff — hub events are
  already persistent in `.forge/hub-events.jsonl`, and the watcher
  detects failure patterns. A dedicated retry queue is YAGNI until
  proven necessary
- Per-user notification preferences / routing — single-operator tool
  for now
- End-to-end encryption / PGP / signed webhooks — add when a user
  requests it
- Rich message formatters per platform — basic string formatting
  only this phase

### Forbidden actions

- Do NOT send notifications from within unit tests — check
  `NODE_ENV === "test"` in the core's `ingest()` function, write
  a test that proves the guard
- Do NOT store secrets in `.forge/notifications/config.json` —
  config fields for webhook URLs, integration keys, SMTP passwords
  MUST reference environment variables (e.g.,
  `"webhookUrl": "${env:SLACK_WEBHOOK_URL}"`). Core resolves the
  template before invoking the adapter
- Do NOT commit `.forge/notifications/config.json` to the repo —
  add to gitignore
- Do NOT retry a failed delivery inside the core — emit
  `notification-send-failed` and let the watcher surface the
  pattern. Retries are caller-owned
- Do NOT let a slow adapter block the hub — wrap `send()` in
  `Promise.race([send, timeout(5_000)])`; timeout counts as a
  failure
- Do NOT let adapter throws escape to the hub subscription —
  catch-and-convert to `notification-send-failed` event
- Do NOT cascade: if a notification about a `notification-send-failed`
  event matches a route, **do not** notify about that meta-event.
  Core filters out events where `event.type.startsWith('notification-')`
  from route matching
- Do NOT add new MCP tools beyond the two specified (`send` + `test`).
  Route and config management goes through the Config subtab UI only

## Slices

### Slice 03.1 — Core + routing + webhook adapter + rate limiter

**Files touched:**
- `pforge-mcp/notifications/core.mjs` — **new**, ~220 LOC
- `pforge-mcp/notifications/adapter-contract.mjs` — **new**, ~60 LOC
- `pforge-mcp/notifications/webhook-adapter.mjs` — **new**, ~90 LOC
- `pforge-mcp/orchestrator.mjs` — `ensureNotificationsDirs`,
  hub subscription wire-in (~50 LOC)
- `pforge-mcp/server.mjs` — 2 tool handlers (~90 LOC)
- `pforge-mcp/capabilities.mjs` — 2 TOOL_METADATA entries
- `pforge-mcp/tools.json` — auto-regenerated
- `.gitignore` — `.forge/notifications/config.json` added
- `pforge-mcp/tests/notifications-core.test.mjs` — **new**, ~24 tests
  (route matching, rate limiter token-bucket, digest coalescing,
  env-var template resolution, NODE_ENV=test no-op, meta-event
  filtering)
- `pforge-mcp/tests/notifications-webhook.test.mjs` — **new**, ~12
  tests (mock HTTP server; success, timeout, 5xx, non-2xx)

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **57 tools** registered (was 55).

### Slice 03.2 — 4 extension stubs + Config subtab + watcher

**Files touched:**
- `extensions/notify-slack/{package.json,index.mjs,README.md,tests/*.mjs}` — **new**
- `extensions/notify-teams/{…}` — **new**
- `extensions/notify-email/{…}` — **new**
- `extensions/notify-pagerduty/{…}` — **new**
- `extensions/catalog.json` — 4 new entries
- `pforge-mcp/dashboard/index.html` — Config → Notifications subtab
  (adapter grid + routes editor + rate-limit inputs)
- `pforge-mcp/dashboard/app.js` — `renderNotificationsSubtab`,
  config save handlers (~160 LOC)
- `pforge-mcp/orchestrator.mjs` — 1 new watcher anomaly rule +
  chip extension
- `pforge-mcp/server.mjs` — `forge_smith` Notifications row
- `pforge-mcp/tests/notifications-stubs.test.mjs` — **new**, ~8 tests
  (each stub conforms to contract, `validate()` returns not-installed,
  catalog entry present)
- `pforge-mcp/tests/notifications-ui.test.mjs` — **new**, ~12 tests
  (jsdom adapter grid, routes editor add/remove, config save, test
  button calls `forge_notify_test`)
- `pforge-mcp/tests/notifications-watcher.test.mjs` — **new**, ~6
  tests (anomaly threshold, chip counters)

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test
in PR body: configure webhook URL via env var, trigger a
`incident-opened` event, observe POST arrives at fake endpoint.

## Success Criteria

- 2 new MCP tools registered (tool count 55 → 57)
- 4 extension stubs installable via `pforge ext add`; each validates
  the adapter contract shape
- Webhook core delivers on the 3 seed routes without secrets leaking
  (env-var template is the only supported pattern)
- Rate limiter proven under test (token-bucket + digest coalesce)
- Failure detection: `notification-delivery-failing` anomaly fires
  when 3+ consecutive failures hit one adapter within an hour
- Zero notifications sent during `npm test` (guard test present)
- Test count +62
- Zero new TODO/FIXME/stub markers on touched files
- CHANGELOG entry under `[Unreleased]` targeting v2.50.0
- `Phase-FORGE-SHOP-03.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- FORGE-SHOP-01 ✅ — Home-tab activity feed colors new events
- FORGE-SHOP-02 ✅ — `review-queue-item-added` is one of the seed
  routes
- Existing v2.29 OpenClaw bridge — **not** deprecated in this phase;
  remains the Telegram/Slack/Discord path for LiveGuard incidents.
  Migration to this core happens in a later cleanup phase when the
  extension-catalog adapters reach parity

**On later phases:**
- FORGE-SHOP-06 ask-bus — `notification-send-failed` events are
  correlation-id tagged; ask-bus can query them via
  `brain.correlation-thread`

## Notes for the executing agent

- The env-var template pattern (`${env:VAR_NAME}`) is the
  **only** secret-handling path. Write a test that proves a config
  with a literal URL `https://hooks.slack.com/...` is **rejected**
  with `ERR_LITERAL_SECRET` — force operators into env vars
- The `NODE_ENV === "test"` guard is a **must-not-ship-without**
  requirement. Put the test first, then the implementation
- The 4 extension stubs throw `ErrNotImplemented` from `send()` but
  must **not** throw from `validate()` — validate returns
  `{ ok: false, reason: "not-installed" }`. This lets the Config
  UI show the adapter card even when not wired up yet
- Digest coalescing can surprise — under test, prove that 5 events
  in 10s with `digestAfter: 5` produce exactly one delivery with
  `digestCount: 5` in the payload
- If the webhook URL is `null` AND the adapter is enabled, the
  core must log a `warn` once per session, not per event
