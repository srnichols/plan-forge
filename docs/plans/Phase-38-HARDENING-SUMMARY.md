# Phase-38 Hardening Summary

> **Generated**: 2026-04-23
> **Hardener**: Claude Sonnet 4.6 (Copilot CLI plan hardener)
> **Series**: Forge-Master System-AI Tier — Phase 38.1 → 38.8

---

## 8 Hardened Plans

| # | Plan | Target Release | Consistency Score | Status |
|---|------|---------------|-------------------|--------|
| 1 | [Phase-38.1 — FM Conversation Memory](Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md) | v2.72.0 | **89/100** ✅ |  Hardened |
| 2 | [Phase-38.2 — FM Cross-Session Recall](Phase-38.2-FM-CROSS-SESSION-RECALL-v2.73-PLAN.md) | v2.73.0 | **89/100** ✅ | Hardened |
| 3 | [Phase-38.3 — Knowledge Graph](Phase-38.3-FM-KNOWLEDGE-GRAPH-v2.74-PLAN.md) | v2.74.0 | **86/100** ✅ | Hardened |
| 4 | [Phase-38.4 — Planner-Executor Split](Phase-38.4-FM-PLANNER-EXECUTOR-v2.75-PLAN.md) | v2.75.0 | **89/100** ✅ | Hardened |
| 5 | [Phase-38.5 — Daily Digest](Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md) | v2.76.0 | **88/100** ✅ | Hardened |
| 6 | [Phase-38.6 — Pattern Surfacing](Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md) | v2.77.0 | **89/100** ✅ | Hardened |
| 7 | [Phase-38.7 — Quorum Advisory Mode](Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md) | v2.78.0 | **87/100** ✅ | Hardened |
| 8 | [Phase-38.8 — Embedding Intent Fallback](Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md) | v2.79.0 | **85/100** ✅ | Hardened |

All 8 plans achieved the ≥ 85/100 consistency threshold on first hardening pass. No revisions required.

---

## Total Estimated Cost (Execution)

| Plan | Slices | Est. Tokens | Est. Cost (sonnet) |
|------|--------|------------|-------------------|
| 38.1 — Conversation Memory | 4 | ~36K | $0.08 |
| 38.2 — Cross-Session Recall | 4 | ~32K | $0.07 |
| 38.3 — Knowledge Graph | 4 | ~37K | $0.09 |
| 38.4 — Planner-Executor | 4 | ~44K | $0.10 |
| 38.5 — Daily Digest | 4 | ~30K | $0.06 |
| 38.6 — Pattern Surfacing | 4 | ~38K | $0.08 |
| 38.7 — Quorum Advisory | 4 | ~41K | $0.09 * |
| 38.8 — Embedding Fallback | 4 | ~44K | $0.10 |
| **Total** | **40** | **~342K** | **~$0.87–$1.50** |

> Slice 5 (Recursive Test-Hardening) adds up to 5 iterations per plan (convergence target: 2 consecutive zero-defect iterations). Budget the high end (~$0.15/phase) for initial runs on this infrastructure-heavy series.

---

## Recursive Test-Hardening Loop Coverage

All 8 plans include a mandatory Slice 5: **Recursive Test-Hardening Loop**. Each loop:
1. Runs a load harness (100 cycles, phase-specific)
2. Injects 5 failure modes (hostile I/O, race conditions, schema drift)
3. Runs the probe harness regression (≥22/24 OK, ≥16/18 lane-match)
4. Runs `pforge self-check sweep`
5. Files bugs and fixes defects (default fix model: `claude-sonnet-4.6`)
6. Iterates until 2 consecutive zero-defect runs OR 5-iteration cap

**Escalation policy** — when bugs prove hard, switch to the strongest reasoner. If the same defect re-appears across 2 consecutive iterations, OR a fix attempt fails its own re-run gate, OR iteration ≥ 3 still has open defects, the fix-generation model is escalated to **`claude-opus-4.7`** for the remainder of the loop. Iteration accounting (`iterations.md`) records the active model per iteration so escalation cost stays auditable.

| Phase | Hostile Input Focus | Key Race / Fault |
|-------|--------------------|--------------------|
| 38.1 | 10 MB JSONL; EACCES; mid-rotation crash | Concurrent writers on fm-sessions |
| 38.2 | All-OFFTOPIC corpus; cyclic JSONL | Concurrent `buildIndex` |
| 38.3 | Cyclic edge fixture; corrupted snapshot | Infinite loop in `neighbors()` |
| 38.4 | Hanging model step; circular DAG | 30s timeout enforcement |
| 38.5 | 1000 bugs; corrupted cost-history | Idempotency on same-day re-run |
| 38.6 | 500 run fixtures; pattern injected into hardener prompt | Phase-32 violation detection |
| 38.7 | 1-of-3 model hang; all-3 fail | Quorum on non-advisory lane guard |
| 38.8 | 500-entry LRU eviction; `@xenova/transformers` absent | Concurrent cache write |

---

---

## Dependency Graph

```
Phase-37 (v2.71.0 — shipped)
   ├── 38.1 Conversation Memory     ← foundation for 38.2, 38.5*, 38.8
   │     └── 38.2 Cross-Session Recall
   │           └── 38.8 Embedding Fallback  (also needs 38.1)
   ├── 38.3 Knowledge Graph          ← foundation for 38.4, 38.6
   │     ├── 38.4 Planner-Executor
   │     └── 38.6 Pattern Surfacing
   ├── 38.5 Daily Digest             (independent; richer with 38.1 + 38.3 data)
   └── 38.7 Quorum Advisory Mode     (fully independent)
```

\* 38.5 benefits from 38.1 session data and 38.3 graph data but ships independently.

---

## Recommended Execution Order

### Sprint A — Foundations in parallel (ship first)

Run these three plans in parallel as separate execution sessions (they share no files):

| Priority | Plan | Rationale |
|----------|------|-----------|
| 🥇 | **38.1** — Conversation Memory | Foundation for 38.2, 38.5, and 38.8. Highest leverage — unlocks 3 downstream phases. Start immediately. |
| 🥇 | **38.3** — Knowledge Graph | Foundation for 38.4 and 38.6. No dependencies on 38.1. Parallel execution saves ~1 week. |
| 🥇 | **38.7** — Quorum Advisory Mode | Fully independent. High user-value feature. Parallelize freely. |

### Sprint B — Second tier (after Sprint A completes)

| Priority | Plan | Waits For | Rationale |
|----------|------|-----------|-----------|
| 🥈 | **38.2** — Cross-Session Recall | 38.1 | Reads the session log produced by 38.1. |
| 🥈 | **38.4** — Planner-Executor | 38.3 | Uses `forge_graph_query` from 38.3. |
| 🥈 | **38.5** — Daily Digest | Phase-37 only (shipped) | Can ship immediately after Sprint A completes for richer data; can also ship in parallel with Sprint A if delivery speed matters. |
| 🥈 | **38.6** — Pattern Surfacing | 38.3 | Reads graph from 38.3; 38.4 and 38.6 can parallelize since they don't share files. |

### Sprint C — Capstone

| Priority | Plan | Waits For | Rationale |
|----------|------|-----------|-----------|
| 🥉 | **38.8** — Embedding Fallback | 38.1, 38.2 (optional) | Requires fm-sessions log from 38.1 for cache warm-up. Optional: sharing embedding store with 38.2 recall index. Ship last to get the warmest cache. |

### Optimal fast-track (if resource-constrained, sequential order)

`38.1 → 38.3 → 38.2 → 38.4 → 38.6 → 38.5 → 38.7 → 38.8`

This order satisfies all dependencies while delivering the highest-leverage features first.

---

## Phase-32 Guardrail Compliance

All 8 plans explicitly include the 4 Phase-32 Forbidden Actions in their Scope Contract:

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor.
- ❌ No principles-violation detector.
- ❌ No new write tool.

New MCP tools (`forge_graph_query`, `forge_patterns_list`) are added to the **advisory lane only**, verified by dedicated lane-restriction tests in Phase-38.3 and Phase-38.6.

---

## Key Architectural Decisions Across All 8 Plans

| Decision | Applies To | Resolution |
|----------|-----------|------------|
| Session file format | 38.1, 38.2, 38.8 | JSONL per session under `.forge/fm-sessions/`; replyHash not full text |
| Cross-session isolation | 38.2 | Index keyed by absolute `projectDir` path |
| Graph storage | 38.3, 38.4, 38.6 | In-memory + snapshot JSON; no graph DB |
| Quorum default | 38.7 | `"off"` — user explicitly opts in |
| Embedding deps | 38.8 | `@xenova/transformers` optional peer dep; `hash-bag` zero-dep fallback |
| Gate portability | All | `npx vitest run <full/path/to/test/file>` directly — no `bash -c`, no `/tmp/`, no nested shells |

---

## Risks Summary (Cross-Plan)

| Risk | Plans Affected | Mitigation |
|------|---------------|------------|
| `.forge/fm-sessions/` disk growth | 38.1, 38.2, 38.8 | 200-turn cap with archive rotation (38.1); 500-entry LRU cache (38.8) |
| Phase-32 guardrail drift (tool added to wrong lane) | 38.3, 38.6 | Lane-restriction tests pin the constraint permanently |
| Token cost escalation with all features enabled simultaneously | 38.2, 38.4, 38.7 | Each feature has opt-out prefs; quorum default is `"off"` |
| Windows path separator issues | All | `path.join` used throughout; Windows gate patterns tested |
