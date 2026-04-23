---
crucibleId: a32df102-30bf-46b0-a009-aa2d07f7ddac
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.1 — Forge-Master Conversation Memory

> **Target release**: v2.72.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-37 shipped (v2.71.0). No dependency on other 38.x phases — this is the foundation.
> **Series**: First of the **Forge-Master System-AI Tier** (Phase-38.1 → 38.8).

## Core Problem

Forge-Master today is near-stateless across turns. Each `runTurn` invocation in `pforge-master/src/reasoning.mjs` sees only the current message — no record of what the user asked 30 seconds ago, what tools fired, or what was returned. This forces the user to re-state context for every follow-up question and prevents Forge-Master from referencing its own prior reasoning.

This is the foundation of every other system-AI enhancement in the 38.x series:
- 38.2 builds a recall index over the log this phase persists.
- 38.5 (daily digest) summarizes the previous day's conversations.
- 38.8 (embedding fallback) embeds the prompts logged here.

Without 38.1, none of those phases have a substrate to read from.

## Design Constraints

- **Local file only.** Conversations persist to `.forge/fm-sessions/<sessionId>.jsonl` — one JSONL line per turn. Never sent off-machine. No cross-user data, no aggregation across projects.
- **Bounded.** Cap at 200 turns per session; rotate older turns into `.forge/fm-sessions/<sessionId>.archive.jsonl`. Active session stays small for fast load.
- **Read-only inside `runTurn`.** The reasoning loop reads prior turns to build "previous context" but does not require them. Existing single-turn callers (probe harness, dashboard one-shot) keep working unchanged.
- **No new write tool.** Persistence is a side-effect of `runTurn` itself — not a tool agents can call.
- **Session ID origin.** Dashboard generates session ID per browser tab; CLI/probe runs use `sessionId: "ephemeral"` (not persisted). Honors Phase-32 advisory-only constraint — nothing forces a session.
- **Privacy-first.** Provide `pforge fm-session purge <sessionId>` and `pforge fm-session purge --all` commands. Document in CLI guide.

## Candidate Slices

### Slice 1 — Session storage primitives

**Scope**: New `pforge-master/src/session-store.mjs` with `appendTurn`, `loadSession`, `purgeSession`, `rotateIfNeeded`. New test file `pforge-master/src/__tests__/session-store.test.mjs`.

- JSONL format: `{turn, timestamp, userMessage, classification, replyHash, toolCalls: [...]}`. Reply itself is hashed (sha256) — full reply NOT stored to keep file small and avoid sensitive output persistence.
- Rotation at 200 turns: oldest 100 move to `<sessionId>.archive.jsonl`.
- All paths under `.forge/fm-sessions/`; directory created on demand.
- **Gate**: `npx vitest run pforge-master/src/__tests__/session-store.test.mjs` green; covers append, load, rotate, purge, missing-file no-throw.

### Slice 2 — Wire `runTurn` to persist + read

**Scope**: `pforge-master/src/reasoning.mjs` — add optional `sessionId` to `runTurn` deps. When set, append a turn record after reply and surface `priorTurns` (last 10) in the classification context.

- New test: persisting + loading round-trips through `runTurn` with `sessionId: "test-session-1"`.
- When `sessionId` absent or `"ephemeral"`, no disk writes — existing tests keep passing.
- **Gate**: full `pforge-master` suite green AND new round-trip test green.

### Slice 3 — HTTP + dashboard integration

**Scope**: `pforge-master/src/http-routes.mjs` accepts `sessionId` from header `x-pforge-session-id` (browser-generated UUID) and threads into `runTurn`. Dashboard JS generates session ID once per tab and includes header. Add `GET /api/forge-master/session/:id` returning the last 10 turns (for "show history" UI).

- **Gate**: `npx vitest run pforge-master/tests/http-routes-sse.test.mjs` plus new session-route test green.

### Slice 4 — CLI purge command + release v2.72.0

**Scope**: `pforge.ps1` + `pforge.sh` add `fm-session list|purge <id>|purge --all`. `CHANGELOG.md` v2.72.0 entry. `ROADMAP.md` Phase-38.1 → shipped.

- **Gate**: `pforge fm-session list` exits 0; `pforge fm-session purge --all` removes the directory and exits 0.

## Out of Scope

- ❌ Cross-session recall (that's Phase-38.2).
- ❌ Embedding the persisted turns (that's Phase-38.8).
- ❌ Changing build/operational/troubleshoot lane tool lists.
- ❌ New write tools — persistence is implicit, not a tool call.
