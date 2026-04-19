---
crucibleId: b4e7f21d-6a38-4c95-9e42-7d81cb5a2f63
source: self-hosted
status: complete
phase: FORGE-SHOP-02
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-02: Review queue primitive

> **Status**: ✅ COMPLETE — Slice 02.1 shipped (a02578a), Slice 02.2 shipped via PR #69 (v2.49.0 in-flight)
> **Estimated Effort**: 2 slices
> **Risk Level**: Low-to-medium (new L2 writer + cross-subsystem feed
> hooks; additive — no existing surfaces removed or reshaped)
> **Target Version**: v2.49.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)
Prior phase: [Phase-FORGE-SHOP-01.md](Phase-FORGE-SHOP-01.md)

---

## Why

After FORGE-SHOP-01 shipped the Home tab (v2.48.0), the operator can
see shop-floor state in one glance — but pending **human decisions**
still scatter across five subsystems:

- **Crucible stalls** — ideas awaiting a "proceed / defer" call
- **Tempering quorum-inconclusive** — scanner runs where the
  three-model verdict disagreed past threshold
- **Visual baselines** — pixel-diff scanner flagged a change that
  might be intentional ("approve new baseline?")
- **Bug classifier** — auto-classified severity the operator may want
  to override
- **Fix-plan approval** — LiveGuard `forge_fix_proposal` outputs
  waiting for green-light before PR creation

Each today produces an `event`, writes its own L2 record, and hopes
the operator clicks the right tab. FORGE-SHOP-02 ships the **review
queue** — one L2 family that any subsystem can push to, one tab where
the operator clears them, and one MCP surface for agents to query +
resolve programmatically. The Home tab's activity feed (shipped 01.2)
already has a drill-through hook ready to adopt the new Review tab as
its drill-through target for review-item events.

## Scope Contract

### In-scope

**Slice 02.1 — Storage contract + MCP tools**

- `.forge/review-queue/` directory auto-created by a new
  `ensureReviewQueueDirs(projectRoot)` helper in `orchestrator.mjs`
- Record shape (frozen in arc doc §"Review queue record shape"):

  ```jsonc
  {
    "itemId": "review-2026-04-19-001",
    "createdAt": "...ISO...",
    "source": "crucible-stall | tempering-quorum-inconclusive | tempering-baseline | bug-classify | fix-plan-approval",
    "correlationId": "...",
    "severity": "blocker | high | medium | low",
    "title": "...human-readable...",
    "context": {
      "recordRef": ".forge/bugs/bug-123.json",
      "evidenceLinks": ["..."],
      "suggestedActions": ["approve", "reject", "defer"]
    },
    "status": "open | resolved | deferred",
    "resolvedBy": null,
    "resolvedAt": null,
    "resolution": null
  }
  ```

- File layout: one file per item —
  `.forge/review-queue/<itemId>.json`. Atomic writes via existing
  `atomicWriteJson` helper pattern.
- `itemId` generator: `review-<YYYY-MM-DD>-<3-digit-zero-padded
  sequence>` (sequence scoped to the date; reset at midnight).
- Readers in `orchestrator.mjs`:
  - `readReviewQueueState(targetPath)` — returns
    `{ total, open, resolved, deferred, lastActivityTs, bySeverity: {..}, bySource: {..} }`
    or `null` if dir missing
  - `listReviewItems(targetPath, { status?, source?, severity?, correlationId?, limit? })`
    — bounded list (default 50, max 500)
  - `readReviewItem(targetPath, itemId)` — single record or null
- MCP tools:
  - **`forge_review_add`** — **writer**. Accepts
    `{ source, severity, title, context?, correlationId? }`. Validates
    `source` is one of the 5 enum values; validates `severity`;
    assigns `itemId` and `createdAt`; writes file; emits
    `review-queue-item-added` hub event. Returns the full record.
  - **`forge_review_list`** — **reader**. Same filters as
    `listReviewItems`; plus pagination (`cursor`, `limit`).
  - **`forge_review_resolve`** — **writer**. Accepts
    `{ itemId, resolution: "approve" | "reject" | "defer", resolvedBy?, note? }`.
    Validates item exists and is `open`; updates to `resolved` or
    `deferred` atomically; emits `review-queue-item-resolved`.
- TOOL_METADATA entries in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.49.0"`; full
  `consumes`/`produces`/`errors`. Writer tools carry
  `writesFiles: true` and `risk: "low"`.
- Hub events:
  - `review-queue-item-added` (payload: `itemId`, `source`,
    `severity`, `correlationId`)
  - `review-queue-item-resolved` (payload: `itemId`, `resolution`,
    `resolvedBy`)
- **L3 capture** on `review-queue-item-resolved` via existing
  `captureMemory()` — tags `review`, `<source>`, `<resolution>`;
  payload: `itemId` + severity + resolution + correlationId (no
  free-text context). Never blocks the writer; OpenBrain outages
  fall through to `.forge/openbrain-queue.jsonl` as usual.
- Home tab extension (from FORGE-SHOP-01): add an `openReviews`
  count to `readHomeSnapshot` **activeRuns quadrant** — single
  integer; no new quadrant. Renders as a subscript "(3 pending reviews)"
  on the active-runs card. Do **not** create a fifth quadrant.

**Slice 02.2 — Review tab UI + producer hooks**

- New **Review tab** in the dashboard (between Home and Crucible in
  tab-strip order):
  - Two-pane layout: left list (filterable by source / severity /
    status) + right detail pane (title, context, evidence links,
    action buttons)
  - Filter chips: source (5 values), severity (4 values), status (3
    values) — multi-select
  - Action buttons per open item: Approve / Reject / Defer (+
    optional note textarea). Buttons call `forge_review_resolve`.
  - Empty-state when no open items: "🧹 Shop floor clear — no
    pending reviews"
  - 15-second refresh (reuses `startPanelRefresh`); paused on blur
  - `data-testid` on every list item, filter chip, detail field,
    action button
- Producer hooks — **minimal wire-ins** into existing subsystems:
  - **Crucible** — when `ideaStalled` transition fires, call
    `forge_review_add({ source: "crucible-stall", severity: "medium", title: <idea title>, correlationId: <existing>, context: { recordRef: <crucible record path> } })`
    via a new helper `maybeAddStallReview(ideaId)` in
    `orchestrator.mjs`. Idempotent — if an open review already
    exists for that `correlationId + source`, do nothing.
  - **Tempering** — when a scanner emits `tempering-quorum-inconclusive`
    (from TEMPER-04 / 06), the existing event handler gets a
    `maybeAddTemperingReview` call that mirrors the Crucible pattern.
  - **Bug classifier** (TEMPER-06) — only when severity is `critical`
    and the auto-classified source is `functional`: call
    `forge_review_add({ source: "bug-classify", severity: "blocker", title: <bug title>, correlationId: <bugId>, context: { recordRef: <bug file> } })`.
    Do not flood the queue with every minor bug.
  - **Visual baselines** (TEMPER-04) — when a visual-diff run detects
    a regression AND the operator has set `autoQueueReview: true`
    in `.forge/tempering/config.json`, auto-add a
    `tempering-baseline` review.
  - **Fix-plan approval** (LiveGuard) — when `forge_fix_proposal`
    completes with a proposal that includes file edits, add a
    `fix-plan-approval` review with severity matching the incident.
- Home tab `activeRuns` quadrant: surface the `openReviews` count
  from 02.1; clicking opens the Review tab with `status=open`
  filter pre-applied.
- Watcher anomaly:
  - `review-queue-backlog` (severity: warn) — more than 10 open
    reviews, or any `blocker`-severity review open for > 4h. Added
    to `detectWatchAnomalies` and `recommendFromAnomalies`.
- `forge_smith` panel: add a "Review queue" row with `open / resolved
  today / oldest-open age`.

### Out of scope (land later)

- Notification delivery of new reviews (FORGE-SHOP-03)
- Global search over review items (FORGE-SHOP-04)
- Timeline merge of review events (FORGE-SHOP-05)
- Any multi-tenant / per-user review assignment
- Review item escalation rules engine
- Any change to existing Crucible / Tempering / LiveGuard writers
  beyond the 5 tiny hook wire-ins listed above
- Deleting review items (resolved/deferred items remain on disk for
  the timeline in 05)

### Forbidden actions

- Do NOT accept free-text `source` values — enum only; reject with
  `ERR_INVALID_SOURCE` otherwise
- Do NOT emit notifications — `review-queue-item-added` must stay
  hub-event-only; FORGE-SHOP-03 owns the notification route
- Do NOT mutate the item record after resolution (append-only-ish;
  resolution fields fill in, nothing else changes)
- Do NOT auto-create reviews from inside unit tests (check
  `process.env.NODE_ENV !== "test"` in every producer hook)
- Do NOT add a `delete` action; deferred items stay on disk
- Do NOT cascade: if a `correlationId` has 5 open reviews from 5
  different sources, leave them separate — they're different
  decisions
- Do NOT swallow errors from the producer hooks — on failure, log
  via `logWarn` and continue the parent operation (never block
  Crucible / Tempering / LiveGuard on a queue write failure)

## Slices

### Slice 02.1 — Storage + MCP tools (3 writers/readers)

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `ensureReviewQueueDirs`,
  `readReviewQueueState`, `listReviewItems`, `readReviewItem`,
  `itemId` generator, enum validators (~220 LOC)
- `pforge-mcp/server.mjs` — 3 tool handlers:
  `forge_review_add`, `forge_review_list`, `forge_review_resolve`
  (~130 LOC)
- `pforge-mcp/capabilities.mjs` — 3 TOOL_METADATA entries
- `pforge-mcp/tools.json` — auto-regenerated (do not hand-edit)
- `pforge-mcp/tests/review-queue-storage.test.mjs` — **new**, ~22
  tests (enum validation, atomic writes, itemId format, idempotence
  under concurrent adds, status transition rules)
- `pforge-mcp/tests/review-queue-tools.test.mjs` — **new**, ~18 tests
  (3 tool handlers, error codes, hub event emission, L3 capture)

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **55 tools** registered (was 52).

**Self-check before commit:**
- `forge_review_add` followed by `forge_review_list` returns the item
- `forge_review_resolve` flips status and emits the hub event
- Double-resolve returns `ERR_ALREADY_RESOLVED`
- `readReviewQueueState` returns `null` on a project with no queue dir

### Slice 02.2 — Review tab UI + 5 producer hooks + Home tab integration

**Files touched:**
- `pforge-mcp/dashboard/index.html` — Review tab pane, two-pane
  layout, filter chips, action buttons
- `pforge-mcp/dashboard/app.js` — `renderReviewPanel`,
  `renderReviewList`, `renderReviewDetail`, filter state management,
  refresh wiring, Home-tab `openReviews` sub-count (~220 LOC)
- `pforge-mcp/orchestrator.mjs` — producer-hook helpers:
  `maybeAddStallReview`, `maybeAddTemperingReview`,
  `maybeAddBugReview`, `maybeAddVisualBaselineReview`,
  `maybeAddFixPlanReview`; idempotence check via
  `listReviewItems({ correlationId, source, status: "open" })`
  (~160 LOC)
- `pforge-mcp/orchestrator.mjs` — `readHomeSnapshot.activeRuns`
  extended with `openReviews` integer; watcher anomaly
  `review-queue-backlog` added
- `pforge-mcp/server.mjs` — `forge_smith` Review row
- `pforge-mcp/tests/review-queue-producers.test.mjs` — **new**, ~18
  tests (each hook: idempotence, source routing, NODE_ENV=test guard)
- `pforge-mcp/tests/review-queue-ui.test.mjs` — **new**, ~15 tests
  (jsdom filter chips, action buttons call correct tool, empty-state)
- `pforge-mcp/tests/review-queue-watcher.test.mjs` — **new**, ~6 tests
  (new anomaly rule thresholds)

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke test in
PR body: open dashboard, Review tab loads, Home tab shows "(N pending
reviews)" sub-count.

**Self-check before commit:**
- Crucible stall → review appears in Review tab within 15 seconds
- Resolve button updates status and the item disappears from the
  default "open" filter
- Watcher chip shows `review-queue-backlog` warn when 11+ open
  reviews exist in fixture data

## Success Criteria

- All three review tools registered (tool count 52 → 55)
- 5 producer hooks wire in without modifying producer semantics
- Home tab `activeRuns` quadrant surfaces `openReviews` sub-count
- Review tab renders all 5 sources uniformly (one list, one detail
  pane, one action set)
- Idempotent producer hooks — no duplicate reviews under concurrent
  stalls or re-runs
- Perf: `listReviewItems` ≤ 100ms on 1 000 items (enforced test)
- Zero new TODO/FIXME/stub markers on touched files
- Test count +75–85
- `Phase-FORGE-SHOP-02.md` `status: draft` → `in_progress` → `complete`
- CHANGELOG entry under `[Unreleased]` targeting v2.49.0

## Dependencies from prior phases

- **FORGE-SHOP-01** merged (v2.48.0 — ✅ PR #68) — `readHomeSnapshot`
  exists and is the integration point for the `openReviews` sub-count
- Existing TEMPER-06 bug classifier + visual-diff scanner for
  producer-hook targets
- Existing LiveGuard `forge_fix_proposal` for producer-hook target

## Dependencies on later phases

**None.** If FORGE-SHOP-03–05 never ship, the Review tab still works
standalone. Notifications (03) layer on top of the existing
`review-queue-item-added` hub event.

## Notes for the executing agent

- The 5 producer hooks are the riskiest part — each must be **idempotent**
  (check for existing open review with same correlationId+source before
  writing) and **non-blocking** (a queue write failure must not throw
  out of the producer's parent transaction)
- The itemId sequence is date-scoped: two items at 23:59:59 and 00:00:01
  get `review-2026-04-19-003` and `review-2026-04-20-001` respectively
- Enum validation is critical — an accidentally-free-text `source`
  breaks filter chip UI silently. Reject in the tool handler; write a
  test for every invalid case
- The Home tab sub-count (`openReviews`) is the **only** change to
  the FORGE-SHOP-01 Home tab contract. Do not add quadrants
