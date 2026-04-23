---
crucibleId: 8406b431-fee8-4a0d-baec-49775a3b1e8b
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.5 — Forge-Master Daily Digest

> **Target release**: v2.76.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-37 shipped (v2.71.0) for probe harness. Optional but recommended: Phase-38.1 + 38.3.

## Core Problem

Forge-Master is reactive — only answers when asked. A real system-AI proactively surfaces:
- Lane-match deltas vs prior day (probe harness regression).
- Open meta-bugs older than 7 days.
- Phases stuck "in-progress" >14 days in `DEPLOYMENT-ROADMAP.md`.
- Drift score drops below threshold.
- Unusual cost spikes vs 7-day moving average.

Today the user has to remember to check the dashboard. Daily digest pushes one consolidated summary through existing notify channels (slack/email/webhook from `extensions/notify-*`).

## Design Constraints

- **Reuse existing notifiers.** No new notification surface — routes through `extensions/notify-{slack,teams,email,pagerduty}` and the webhook path. Honors Phase-32 "no new write tool" by reusing infrastructure that's already a write surface for incidents/drift.
- **Idempotent.** Digest writes `.forge/digests/<YYYY-MM-DD>.json`; rerun on same day is a no-op (or `--force` to regenerate).
- **Pure read over forge artifacts.** Reads probe results, meta-bugs, roadmap, drift history, cost history. Never modifies them.
- **Cron-optional.** Phase ships the generator as `pforge digest [--date <iso>]` CLI command + GitHub Actions example workflow. No cron daemon installed.
- **Severity-gated.** Digest body labels each section "info" / "warn" / "alert"; routing rules can filter (e.g. only alert sections to PagerDuty).
- **Honest empty.** On a quiet day, digest says "no significant deltas — all green" rather than fabricating signals.

## Candidate Slices

### Slice 1 — Digest aggregator

**Scope**: New `pforge-mcp/digest/aggregator.mjs` exporting `buildDigest({projectDir, date, baselineDate}) → {sections: [...], generatedAt}`. New `pforge-mcp/tests/digest-aggregator.test.mjs`.

- Sections: `probe-deltas`, `aging-bugs`, `stalled-phases`, `drift-trend`, `cost-anomaly`. Each emits 0..N items with severity.
- **Gate**: vitest on aggregator test green.

### Slice 2 — Digest renderer (markdown + JSON)

**Scope**: New `pforge-mcp/digest/render.mjs` — markdown for human, JSON for machine. Templates emit consistent structure usable by Slack blocks and email.

- **Gate**: snapshot test verifies markdown + JSON round-trip stable.

### Slice 3 — CLI command + notifier dispatch

**Scope**: `pforge.ps1` + `pforge.sh` add `digest [--date <iso>] [--notify] [--force]`. With `--notify`, dispatches via `extensions/notify-*` configured channels per `notify.config.json` routing rules.

- **Gate**: `pforge digest --date 2026-04-22` emits markdown + writes `.forge/digests/2026-04-22.json`; rerun no-op.

### Slice 4 — GitHub Actions workflow + dashboard tile + release v2.76.0

**Scope**: `.github/workflows/forge-daily-digest.yml` example (commented out — user opts in). Dashboard adds "Yesterday's Digest" tile reading the latest `.forge/digests/`. CHANGELOG, ROADMAP, version bump.

- **Gate**: dashboard test renders tile from a fixture digest file.

## Out of Scope

- ❌ Real-time alerts — those are LiveGuard's job.
- ❌ Modifying notify-* extensions to add new channels.
- ❌ Auto-resolving stale items (read-only digest).
- ❌ Cross-project digest aggregation.
