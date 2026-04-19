---
crucibleId: 054717f7-0093-42b1-a778-9803dd06bcca
source: self-hosted
status: planning
arc: FORGE-SHOP
---

# Forge Arc: **Forge Shop** — unify the shop floor

> **Status**: 📝 PLANNING — nothing shipped yet.
> **Estimated Effort**: 5 phases, ~8–10 execution slices total.
> **Risk Level**: Low-to-medium per slice (additive unification — no
> existing surfaces break).
> **Target Version band**: v2.48.x → v2.52.x (ships **after** the
> TEMPER arc completes).
> **Depends on**: TEMPER-06 merged (for correlationId thread to be
> fully populated).

---

## Why

After the Tempering arc ships, Plan Forge has five subsystems (Crucible,
Forge-execution, LiveGuard, Tempering, plus the preset/extension
layer) surfacing through **13 dashboard tabs**, **~40 MCP tools**, and
**8+ L2 record families**. Each is well-designed in isolation. The
*whole* is not.

Operators say "one Forge shop" — and right now Plan Forge is a shop
with 13 separate workbenches and no foreman's desk. This arc builds
the foreman's desk.

Five unification gaps, from the post-TEMPER system audit:

| Gap | User-visible problem |
|-----|----------------------|
| **G2** No overview / Home tab | "What's the state of my shop right now?" requires clicking 4+ tabs |
| **G3** No formal review queue | Pending human decisions scatter across Crucible stalls, Tempering quorum-inconclusive, visual baselines, bug classification, fix approvals |
| **G4** No notification layer | Everything is dashboard-poll; critical incidents / regressions silently wait |
| **G7** No global search | "Find me that bug / smelt / incident / run" requires knowing which tab |
| **G11** No unified timeline | Debugging "what happened Tuesday at 3pm?" needs 5 separate file greps |

## Design principles

1. **Aggregate, never rewrite.** Every unification surface reads from
   existing L2/L3 records. No new writer replaces an existing one.
2. **CorrelationId is the join key.** The thread introduced in
   TEMPER-ARC cross-cutting contracts is what makes all five gaps
   solvable cheaply.
3. **Extensions-first for notifications.** Core ships webhook only.
   Slack / Teams / Email / PagerDuty go in the extensions catalog with
   the same contract pattern as Tempering bug adapters.
4. **Search is filesystem-native.** No new database, no new index
   service. Scans L2 records on the fly; uses OpenBrain L3 only for
   fuzzy/semantic queries via existing `searchMemory()`.

## Phase breakdown

| Phase | Ships | Slices | Version band |
|-------|-------|--------|--------------|
| [FORGE-SHOP-01](Phase-FORGE-SHOP-01.md) | Home tab — shop-floor 4-quadrant view + unified activity feed | 2 | v2.48.x |
| [FORGE-SHOP-02](Phase-FORGE-SHOP-02.md) | Review queue primitive — `.forge/review-queue/` + tab + MCP tools | 2 | v2.49.x |
| [FORGE-SHOP-03](Phase-FORGE-SHOP-03.md) | Notification layer — webhook core + Slack/Teams/Email/PagerDuty extension stubs | 2 | v2.50.x |
| [FORGE-SHOP-04](Phase-FORGE-SHOP-04.md) | Global search — `forge_search` MCP + dashboard header bar | 1 | v2.51.x |
| [FORGE-SHOP-05](Phase-FORGE-SHOP-05.md) | Unified timeline — `forge_timeline` MCP + Timeline tab | 1–2 | v2.52.x |

Each phase is **independently shippable**. Dashboards, CLIs, and MCP
tools keep working as each lands.

## Cross-cutting contracts

### Home tab layout (frozen in FORGE-SHOP-01)

Four equal quadrants, plus a footer activity feed:

```
┌───────────────────────┬───────────────────────┐
│  🔥 Crucible funnel   │  ⚒ Active runs       │
│  (total/finalized/    │  (in-flight plans,    │
│   stalled)            │   last slice outcome) │
├───────────────────────┼───────────────────────┤
│  🛡 LiveGuard health  │  🔨 Tempering status  │
│  (drift / incidents / │  (coverage / last     │
│   fix proposals)      │   scan / open bugs)   │
├───────────────────────┴───────────────────────┤
│  ▤ Unified activity feed (all hub events)    │
│    with correlationId grouping toggle         │
└───────────────────────────────────────────────┘
```

All four quadrants: single-click drill-through to the owning tab with
filter pre-applied.

### Review queue record shape (frozen in FORGE-SHOP-02)

```jsonc
{
  "itemId": "review-2026-05-10-001",
  "createdAt": "...",
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

### Notification routing (frozen in FORGE-SHOP-03)

```jsonc
// .forge/notifications/config.json
{
  "enabled": true,
  "adapters": {
    "webhook": { "enabled": true, "url": null },
    "slack": { "enabled": false, "webhookUrl": null, "channel": null },
    "teams": { "enabled": false, "webhookUrl": null },
    "email": { "enabled": false, "smtp": {...}, "to": [] },
    "pagerduty": { "enabled": false, "integrationKey": null }
  },
  "routes": [
    { "when": { "event": "incident-opened", "severity": ">=high" }, "via": ["pagerduty", "slack"] },
    { "when": { "event": "tempering-visual-regression-detected" }, "via": ["slack"] },
    { "when": { "event": "cost-budget-warn" }, "via": ["email"] },
    { "when": { "event": "review-queue-item-added", "severity": "blocker" }, "via": ["slack"] }
  ],
  "rateLimit": { "perMinute": 10, "digestAfter": 5 }
}
```

### Search surface (frozen in FORGE-SHOP-04)

```
forge_search --query <text> --tags <a,b> --since <date> --correlationId <id>
  → hits: [{ source, recordRef, snippet, score, correlationId }]
```

Searches L2 first (filesystem glob + JSON field match), L3 second
(OpenBrain `searchMemory`), merges and ranks by recency + tag match.

### Timeline surface (frozen in FORGE-SHOP-05)

```
forge_timeline --from <ts> --to <ts> [--correlationId <id>]
  → events: [{ ts, source, event, correlationId, payload }]
```

Merges these L2 logs by timestamp:

- `.forge/hub-events.jsonl`
- `.forge/runs/<id>/events.log`
- `.forge/liveguard-memories.jsonl`
- `.forge/openbrain-queue.jsonl`
- `.forge/watch-history.jsonl`
- `.forge/tempering/<runId>.json`
- `.forge/bugs/<bugId>.json`
- `.forge/incidents/*.json`

## Hub events introduced

- `review-queue-item-added` (FORGE-SHOP-02)
- `review-queue-item-resolved` (FORGE-SHOP-02)
- `notification-sent` (FORGE-SHOP-03)
- `notification-rate-limited` (FORGE-SHOP-03)

## MCP tools introduced

| Tool | Added in | Purpose |
|------|----------|---------|
| `forge_review_add` | FORGE-SHOP-02 | Register a pending human decision |
| `forge_review_list` | FORGE-SHOP-02 | Query queue with filters |
| `forge_review_resolve` | FORGE-SHOP-02 | Mark an item resolved/deferred |
| `forge_notify_send` | FORGE-SHOP-03 | Direct notify (bypasses routing) |
| `forge_notify_test` | FORGE-SHOP-03 | Verify adapter config |
| `forge_search` | FORGE-SHOP-04 | Cross-subsystem text/tag search |
| `forge_timeline` | FORGE-SHOP-05 | Merged L2 timeline query |

## Dashboard surfaces introduced

- **Home tab** (FORGE-SHOP-01) — 4-quadrant + activity feed
- **Review tab** (FORGE-SHOP-02) — queue list + detail + resolve UI
- **Notifications subtab** of Config (FORGE-SHOP-03) — adapter config
  + routing rules + test buttons
- **Header search bar** (FORGE-SHOP-04) — omni-search across all tabs
- **Timeline tab** (FORGE-SHOP-05) — merged L2 timeline with
  correlationId group-by toggle

## Forbidden actions

- Do NOT duplicate writers — every Home-tab / Review-queue / Search /
  Timeline surface READS from existing L2 records only
- Do NOT create new correlationIds; always inherit from context
- Do NOT swallow notification delivery failures — emit
  `notification-send-failed` so the Watcher can flag the adapter
- Do NOT index OpenBrain on every search — `forge_search` must be cheap
  on cold L2-only queries; L3 is additive, optional
- Do NOT send notifications from inside unit tests (always check
  `process.env.NODE_ENV !== "test"`)

## Success criteria for the full arc

When FORGE-SHOP-05 merges:

1. A fresh operator opens the dashboard and the Home tab tells them
   the entire state of their shop in one view
2. Every pending human decision (regardless of origin) shows in the
   Review tab within 5 seconds of creation
3. A configured Slack webhook receives a notification within 10 seconds
   of a `high+`-severity incident
4. `forge_search "login regression"` returns hits across bugs, smelts,
   runs, and incidents in a single call
5. `forge_timeline --correlationId <id>` returns every L1/L2 record
   belonging to one idea's full journey through the loop
6. Dashboard remains responsive with 10,000+ hub-events and 1,000+
   L2 records (perf budget per FORGE-SHOP-01)

## Reading order for implementers

1. This arc doc (you are here)
2. [Phase-FORGE-SHOP-01.md](Phase-FORGE-SHOP-01.md) — Home tab
3. [Phase-FORGE-SHOP-02.md](Phase-FORGE-SHOP-02.md) — Review queue
4. [Phase-FORGE-SHOP-03.md](Phase-FORGE-SHOP-03.md) — Notifications
5. [Phase-FORGE-SHOP-04.md](Phase-FORGE-SHOP-04.md) — Global search
6. [Phase-FORGE-SHOP-05.md](Phase-FORGE-SHOP-05.md) — Unified timeline

> **Note:** Per-phase docs (01–05) will be drafted in a follow-up
> planning session once TEMPER-01 through TEMPER-03 have shipped and
> real operator feedback has shaped the precise record shapes. The
> arc contract above is the stable target.
