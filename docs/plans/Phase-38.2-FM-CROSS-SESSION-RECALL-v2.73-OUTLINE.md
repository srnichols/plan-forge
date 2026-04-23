---
crucibleId: 5b1be390-d26a-4a76-bd72-ef27a73d55ea
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.2 — Forge-Master Cross-Session Recall

> **Target release**: v2.73.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-38.1 shipped (v2.72.0) — needs `.forge/fm-sessions/` JSONL log to read from.

## Core Problem

Phase-38.1 persists each turn to disk but Forge-Master never reads across sessions. The user keeps re-asking variants of the same question across days/weeks ("how do I configure quorum?", "why does the orchestrator hang on Windows?") and gets cold-start answers each time. A real system-AI surfaces "you asked something similar 8 days ago — here's what worked" as advisory context.

This phase reads (does not write) the Phase-38.1 log and builds a per-project recall index queried at classification time.

## Design Constraints

- **Read-only over `.forge/fm-sessions/**`.** This phase adds a reader, not a writer. Existing 38.1 persistence is the only producer.
- **Local index, not external service.** Index lives at `.forge/fm-sessions/recall-index.json` — refreshed lazily on first query of the day, or on `pforge fm-recall rebuild`. Pure tf-idf or BM25 over the `userMessage` field — no embeddings yet (38.8 owns embeddings).
- **Surfaced as advisory, never as ground truth.** When recall fires, the answer is annotated "Related prior turn (N days ago): <summary>" — Forge-Master still answers the new question fresh.
- **Top-K=3 cap.** Avoid context bloat; only the 3 most-similar prior turns considered.
- **Exclude trivial and offtopic turns.** Don't surface prior `OFFTOPIC` classifications — they're noise.
- **No cross-project leakage.** Index keyed by project root path; never reads sessions from other repos.

## Candidate Slices

### Slice 1 — BM25 indexer over fm-sessions

**Scope**: New `pforge-master/src/recall-index.mjs` exporting `buildIndex(projectDir)`, `queryIndex(text, {topK})`, `loadIndex(projectDir)`. New `pforge-master/src/__tests__/recall-index.test.mjs`.

- Index doc = `{turnId, sessionId, timestamp, userMessage, classification.lane, replyHash}`.
- Rebuilds incrementally based on `mtime` of session files vs index `lastBuiltAt`.
- **Gate**: vitest run on the new test file green; covers build, query, incremental refresh, exclusion of OFFTOPIC turns.

### Slice 2 — Wire recall into `runTurn`

**Scope**: `pforge-master/src/reasoning.mjs` — when `sessionId` is set AND lane is operational/troubleshoot/advisory, query recall index for top-3 related prior turns. Pass into reply prompt as "Related prior turns" section. Recall results NOT shown to UI as classification — they're a context augmentation.

- **Gate**: new test verifies a second `runTurn` for similar prompt surfaces the prior turn ID in the recall results returned.

### Slice 3 — Dashboard "related turns" panel + CLI command

**Scope**: Dashboard panel that shows "Recent related conversations" when present. CLI `pforge fm-recall query "<text>"` for ad-hoc inspection. CLI `pforge fm-recall rebuild` to force refresh.

- **Gate**: new dashboard test verifies the related-turns panel renders; CLI command exits 0 on a fresh repo (empty result OK).

### Slice 4 — Release v2.73.0

**Scope**: CHANGELOG, ROADMAP, version bump.

## Out of Scope

- ❌ Embedding-based similarity (that's Phase-38.8).
- ❌ Recall over Plan/Bug/Memory artifacts (those are graph nodes, owned by Phase-38.3).
- ❌ Modifying lane keyword sets or auto-escalation thresholds.
- ❌ Any new write tool.
