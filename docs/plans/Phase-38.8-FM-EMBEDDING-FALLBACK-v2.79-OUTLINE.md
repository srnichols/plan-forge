---
crucibleId: 1bf3f9c7-bf79-441e-925e-9ea7642ece82
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.8 — Forge-Master Embedding Intent Fallback

> **Target release**: v2.79.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-37 shipped (v2.71.0) for `confidence` field. Phase-38.1 shipped (v2.72.0) for fm-sessions log.
> **Optional**: Phase-38.2 shipped — recall index can share the embedding store.

## Core Problem

The two-stage classifier from Phase-37 works as: stage 1 keyword scoring → if low confidence, stage 2 router-model API call. Stage 2 costs an API call per ambiguous prompt and requires a provider key (the Phase-33 zero-key path falls back to OFFTOPIC).

Embedding fallback adds a stage 1.5: cosine-match the prompt against an embedding cache of previously-classified prompts (from Phase-38.1 conversation log). When a strong cosine match exists (≥ 0.85), inherit that classification. Only fall to stage 2 when no match. Result: cuts API spend on repeat patterns, works fully offline once cache is warm.

## Design Constraints

- **Local embeddings.** Use a small local embedding model (e.g. `all-MiniLM-L6-v2` via `@xenova/transformers` if a peer dep, or hashed-bag-of-words as a zero-dep fallback). NEVER ship a hard dep on cloud embeddings — must work on the zero-key path.
- **Reuses Phase-38.1 fm-sessions log.** No separate prompt corpus. Index keyed on the prompt + final classification + confidence after disambiguation.
- **Cosine threshold tuned by probe harness.** Initial threshold 0.85 — calibrated against the 24 probes so no probe regresses lane assignment.
- **Bounded cache.** Max 500 prompts in the embedding cache; evict by LRU. Persisted to `.forge/fm-sessions/embedding-cache.bin`.
- **Skip on opt-out.** Pref `forgeMaster.embeddingFallback: true | false`, default true. Honors users who don't want any local model loaded.
- **No tool-list mutations.** Pure classifier optimization; lane allowlists unchanged.

## Candidate Slices

### Slice 1 — Embedding provider abstraction

**Scope**: New `pforge-master/src/embedding/provider.mjs` — async `embed(text) → Float32Array`. Two implementations: `transformers-mini.mjs` (uses `@xenova/transformers` if installed, lazy-load) and `hash-bag.mjs` (zero-dep deterministic hash bag-of-words baseline). Auto-select transformers when available, fall back to hash-bag. New `pforge-master/src/__tests__/embedding-provider.test.mjs`.

- **Gate**: vitest verifies both providers produce vectors of expected shape, deterministic for same input.

### Slice 2 — Embedding cache + cosine query

**Scope**: New `pforge-master/src/embedding/cache.mjs` — `addEntry({text, classification, confidence})`, `query(text, {threshold, topK})`, `evictLRU()`, persist + load from binary file. New test file.

- **Gate**: vitest verifies add/query round-trip, threshold filtering, LRU eviction at 500-cap.

### Slice 3 — Wire as stage 1.5 in `classify()`

**Scope**: `pforge-master/src/intent-router.mjs` — between keyword scoring and stage-2 router-model, query embedding cache. If best match cosine ≥ 0.85, return that classification with `via: "embedding-cache"`. Cache populated after every successful classification (write-through).

- **Gate**: existing classifier-calibration test stays green; new test verifies cache hit returns inherited classification without invoking stage-2 mock.

### Slice 4 — Probe harness + release v2.79.0

**Scope**: Probe harness reports `viaCounts: {keyword, embedding, router}` per run. CHANGELOG documents typical hit-rate after warm cache. Pref endpoint exposes `embeddingFallback`. Dashboard tile shows cache size + hit rate.

- **Gate**: full probe harness ≥ 22/24 OK AND ≥1 probe routed via `embedding-cache` after a warm-up run.

## Out of Scope

- ❌ Cloud embeddings (must work offline / zero-key).
- ❌ Replacing the keyword scorer or stage-2 router (this is a stage IN BETWEEN).
- ❌ Modifying lane allowlists.
- ❌ Embedding the full reply (only the user prompt is embedded).
