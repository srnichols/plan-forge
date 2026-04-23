---
crucibleId: 1bf3f9c7-bf79-441e-925e-9ea7642ece82
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.8 — Forge-Master Embedding Intent Fallback

> **Target release**: v2.79.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0) for `confidence` field. Phase-38.1 shipped (v2.72.0) for fm-sessions log. Phase-38.2 optional (recall index can share embedding store).

---

## Specification Source

- **Problem**: Phase-37's two-stage classifier (keyword → router-model API call) costs an API call per ambiguous prompt and requires a provider key. The Phase-33 zero-key path falls back to OFFTOPIC for ambiguous prompts.
- **Root cause**: No intermediate stage exists between keyword scoring and the expensive router-model call.
- **Contract**: After this phase, a "stage 1.5" cosine-match against an embedding cache of previously-classified prompts is inserted. When cosine match ≥ 0.85, the cached classification is inherited (no API call). Cache populated write-through after every successful classification. Must work fully offline (zero-key path) once warm.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-master/src/embedding/provider.mjs` — async `embed(text) → Float32Array`. Two implementations:
  - `pforge-master/src/embedding/transformers-mini.mjs` — uses `@xenova/transformers` (lazy-load, optional peer dep).
  - `pforge-master/src/embedding/hash-bag.mjs` — zero-dep deterministic hash bag-of-words fallback.
  - Auto-selects `transformers-mini` when package available, falls back to `hash-bag`.
- New `pforge-master/src/embedding/cache.mjs` — `addEntry({text, classification, confidence})`, `query(text, {threshold, topK})`, `evictLRU()`. Persist + load from `.forge/fm-sessions/embedding-cache.bin`. LRU cap: 500 entries.
- New `pforge-master/src/__tests__/embedding-provider.test.mjs`.
- New `pforge-master/src/__tests__/embedding-cache.test.mjs`.
- `pforge-master/src/intent-router.mjs` — add stage 1.5 between keyword scoring and stage-2 router-model call; cache populated write-through after every successful classification.
- Pref `forgeMaster.embeddingFallback: true|false` (default `true`) in `loadPrefs`/`savePrefs`.
- Dashboard tile: cache size + hit rate in `pforge-mcp/dashboard/forge-master.js`.
- Probe harness `scripts/probe-forge-master.mjs` — report `viaCounts: {keyword, embedding, router}` per run.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.79.0 release metadata.

### Out of Scope

- ❌ Cloud embeddings — must work offline / zero-key.
- ❌ Replacing the keyword scorer or stage-2 router — this is a stage IN BETWEEN.
- ❌ Modifying lane allowlists.
- ❌ Embedding the full reply — only the user prompt is embedded.
- ❌ Changing build/operational/troubleshoot lane tool lists (Phase-32 guardrail).

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ `@xenova/transformers` must remain an optional peer dependency — do not add it to `pforge-master/package.json` as a required dep.
- ❌ The embedding cache must not be queried when `forgeMaster.embeddingFallback === false`.
- ❌ No probe regression: embedding fallback must not cause any probe's lane assignment to change vs the Phase-37 baseline.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Local embedding model | Resolved | `@xenova/transformers` `all-MiniLM-L6-v2` (lazy-load, optional peer dep); falls back to `hash-bag` |
| 2 | Cosine threshold | Resolved | 0.85 initial; calibrated against 24 probes so no probe regresses |
| 3 | Cache size cap | Resolved | 500 entries, LRU eviction |
| 4 | Cache file location | Resolved | `.forge/fm-sessions/embedding-cache.bin` (binary float32 format) |
| 5 | Cache population | Resolved | Write-through: after every successful classification, call `addEntry` |
| 6 | Default pref | Resolved | `embeddingFallback: true` |

---

## Acceptance Criteria

### Slice 1 — Embedding provider abstraction

- **MUST**: `pforge-master/src/embedding/provider.mjs` exports async `embed(text) → Float32Array`.
- **MUST**: `pforge-master/src/embedding/hash-bag.mjs` implements a zero-dep deterministic hash bag-of-words baseline producing a `Float32Array`.
- **MUST**: `pforge-master/src/embedding/transformers-mini.mjs` lazy-loads `@xenova/transformers` and returns embeddings from `all-MiniLM-L6-v2`; if the package is not installed, throws a clear error (provider.mjs catches this and falls back to hash-bag).
- **MUST**: `provider.mjs` auto-selects `transformers-mini` when `@xenova/transformers` is installed; falls back to `hash-bag` otherwise.
- **MUST**: Both providers produce a `Float32Array` with consistent length for same input (deterministic on repeated calls with same text).
- **MUST**: `pforge-master/src/__tests__/embedding-provider.test.mjs` passes covering: `hash-bag` deterministic output, `hash-bag` vector length, provider fallback behavior (mock missing package).

### Slice 2 — Embedding cache + cosine query

- **MUST**: `pforge-master/src/embedding/cache.mjs` exports `addEntry({text, classification, confidence})`, `query(text, {threshold, topK})`, `evictLRU()`, `save(filePath)`, `load(filePath)`.
- **MUST**: `query` returns entries whose cosine similarity to the query embedding is ≥ `threshold`.
- **MUST**: `query` returns at most `topK` results, sorted by descending similarity.
- **MUST**: `evictLRU` removes the least-recently-used entry when count > 500.
- **MUST**: `save` writes a binary file (Float32 vectors + metadata) to `filePath`; `load` restores it.
- **MUST**: `pforge-master/src/__tests__/embedding-cache.test.mjs` passes covering: add/query round-trip at threshold 0.85, threshold filtering (low similarity not returned), LRU eviction at 500-cap, save/load round-trip.

### Slice 3 — Wire as stage 1.5 in `classify()`

- **MUST**: `pforge-master/src/intent-router.mjs` calls the embedding cache between keyword scoring and stage-2 router-model.
- **MUST**: If best cache match cosine ≥ 0.85, `classify()` returns `{lane, confidence, via: "embedding-cache"}` without invoking stage-2.
- **MUST**: `classify()` calls `addEntry` after every successful classification (write-through cache population).
- **MUST**: When `deps.embeddingFallback === false` (opt-out), embedding stage is completely skipped.
- **MUST**: Existing `pforge-master/src/__tests__/classifier-calibration.test.mjs` continues to pass with no lane regressions (embedding cache starts empty in tests — falls through to keyword/stage-2 paths).
- **MUST**: New test verifies: a second `classify()` call for a highly similar prompt returns `via: "embedding-cache"` without invoking the stage-2 mock.

### Slice 4 — Probe harness + release v2.79.0

- **MUST**: `scripts/probe-forge-master.mjs` reports `viaCounts: {keyword, embedding, router}` in the results summary after a warm-cache run.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.
- **MUST**: Full probe harness run achieves ≥ 22/24 OK (same bar as Phase-37 baseline).
- **MUST**: After a warm-up run, at least 1 probe is routed via `"embedding-cache"` (reported in `viaCounts.embedding ≥ 1`).
- **MUST**: `pref.embeddingFallback` is exposed in `GET/PUT /api/forge-master/prefs`.
- **MUST**: Dashboard tile in `pforge-mcp/dashboard/forge-master.js` shows cache size and hit rate.
- **MUST**: `VERSION` contains exactly `2.79.0`.
- **MUST**: `CHANGELOG.md` has a `[2.79.0]` section mentioning `embedding fallback`, `all-MiniLM-L6-v2`, and `via: embedding-cache`.
- **MUST**: `ROADMAP.md` reflects Phase-38.8 / v2.79.0 as shipped.
- **MUST**: Git tag `v2.79.0` applied.

### Quality bar

- **SHOULD**: Cache hit rate (after warm run) ≥ 30% across the 24-probe harness (set after first calibration run).
- **SHOULD**: Embedding cache file is gitignored (`.forge/fm-sessions/` already gitignored from Phase-38.1).
- **SHOULD**: `@xenova/transformers` installation instructions added to `pforge-master/README.md` under an "Optional: richer embeddings" section.

---


### Slice 38.8 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.8/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.8/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Embedding provider abstraction [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-master/src/embedding/provider.mjs`
- `pforge-master/src/embedding/hash-bag.mjs`
- `pforge-master/src/embedding/transformers-mini.mjs`
- `pforge-master/src/__tests__/embedding-provider.test.mjs`

**Depends On**: Phase-38.1 shipped (v2.72.0) — embedding cache file lives under `.forge/fm-sessions/`.

**Context Files**:
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs) — stage-2 pattern to insert before
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Create `pforge-master/src/embedding/` directory.
2. `hash-bag.mjs`: tokenize, hash each token with a 32-bit hash, set corresponding index in a 512-length Float32Array; L2-normalize.
3. `transformers-mini.mjs`: dynamic `import('@xenova/transformers')`, call `pipeline('feature-extraction', 'all-MiniLM-L6-v2')`, return Float32Array of embedding.
4. `provider.mjs`: try `transformers-mini`, catch import error, fall back to `hash-bag`; memoize selected provider.
5. Unit tests: hash-bag determinism, fallback mocking.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/embedding-provider.test.mjs
```

**Commit**: `feat(embedding): provider abstraction — hash-bag zero-dep + transformers-mini optional`

---

### Slice 2 — Embedding cache + cosine query [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-master/src/embedding/cache.mjs`
- `pforge-master/src/__tests__/embedding-cache.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/embedding/provider.mjs](../../pforge-master/src/embedding/provider.mjs) (Slice 1)

**Steps**:
1. Implement cosine similarity: dot product / (|A| × |B|).
2. Cache entry: `{id, text, vector: Float32Array, classification, confidence, lastUsed}`.
3. `query`: embed input text, compute cosine for all entries, filter ≥ threshold, sort descending, return top-K.
4. Binary persistence: write header (count, dim) + packed Float32 vectors + JSON metadata sidecar.
5. Unit tests: threshold filtering, LRU eviction at 501 entries, save/load.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/embedding-cache.test.mjs
```

**Commit**: `feat(embedding): embedding cache with LRU, cosine query, and binary persistence`

---

### Slice 3 — Wire as stage 1.5 in `classify()` [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to modify**:
- `pforge-master/src/intent-router.mjs`

**Files to create**:
- `pforge-master/src/__tests__/embedding-stage15.test.mjs`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs)
- [pforge-master/src/__tests__/classifier-calibration.test.mjs](../../pforge-master/src/__tests__/classifier-calibration.test.mjs)

**Steps**:
1. In `classify(message, opts)`: after keyword scoring, before stage-2 call, check `opts.embeddingFallback !== false` → call `cache.query(message, {threshold: 0.85, topK: 1})`.
2. If match found, return `{lane: match.classification.lane, confidence: match.classification.confidence, via: "embedding-cache", ...}`.
3. After every successful classification (any path), call `cache.addEntry(...)` asynchronously (fire-and-forget; do not await in critical path).
4. Guard: if embedding cache throws, log warning and continue to stage-2.
5. Write `embedding-stage15.test.mjs`: prime cache with a known entry, call `classify` with a similar prompt, assert `via: "embedding-cache"`, assert stage-2 mock was NOT called.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/embedding-stage15.test.mjs ; npx vitest run pforge-master/src/__tests__/classifier-calibration.test.mjs
```

feat(embedding): wire embedding stage-1.5 into classify() with write-through cache`

---

### Slice 4 — Probe harness + release v2.79.0 [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `scripts/probe-forge-master.mjs`
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.
- `pforge-master/src/http-routes.mjs` — expose `embeddingFallback` in prefs
- `pforge-mcp/dashboard/forge-master.js` — cache stats tile
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [scripts/probe-forge-master.mjs](../../scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.
- [pforge-master/src/http-routes.mjs](../../pforge-master/src/http-routes.mjs)

**Steps**:
1. Probe harness: accumulate `via` field from each classification response; print `viaCounts` summary at end.
2. Add `embeddingFallback` to `loadPrefs`/`savePrefs` with default `true`.
3. Dashboard tile: GET `/api/forge-master/cache-stats` → `{size, hitRate, maxSize: 500}`.
4. Bump VERSION, write CHANGELOG, update ROADMAP, tag.

**Validation Gate**:
```r
node scripts/probe-forge-master.mjs --keyword-only --timeout=90 ; node -e "const fs=require('fs');if(fs.readFileSync('VERSION','utf8').trim()!=='2.79.0')throw new Error('VERSION');console.log('ok')"
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.
```

chore(release): v2.79.0 — Forge-Master embedding intent fallback`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.79.0 released).

**Context Files**:
- [pforge-master/src/embedding/provider.mjs](pforge-master/src/embedding/provider.mjs)
- [pforge-master/src/embedding/cache.mjs](pforge-master/src/embedding/cache.mjs)
- [pforge-master/src/intent-router.mjs](pforge-master/src/intent-router.mjs)

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.8.mjs`. 100 classify() cycles with cache warm-up then cold-start. Edge cases: empty cache, cache at 500-entry LRU eviction boundary, unicode prompts, max-length 8192-char prompts. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.8/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Embedding cache binary file corrupted — assert `loadCache` falls back to empty cache, no throw.
- `@xenova/transformers` not installed — assert hash-bag provider used, all probes still pass.
- Cache at 500-entry cap: add entry 501 — assert oldest entry evicted, no OOM.
- Cosine threshold returns false positive (wrong lane inherited) — assert probe-harness catches regression and fails iteration.
- Concurrent writes to `embedding-cache.bin` — assert no corruption (tmpfile+rename pattern).

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.8-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.8/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.8/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.8/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.8.mjs --validate-converged ; npx vitest run pforge-master/src/__tests__/embedding-provider.test.mjs ; pforge analyze docs/plans/Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md
```

**Commit**: `test(38.8): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Confirm `hash-bag.mjs` is deterministic (same input → identical Float32Array on every run). Confirm `@xenova/transformers` is NOT in `package.json` required deps.

**After Slice 2**: Confirm LRU eviction test passes with a 501-entry fixture (must evict exactly 1). Confirm cosine similarity implementation returns 1.0 for identical vectors.

**After Slice 3**: Run `classifier-calibration.test.mjs` — zero probe regressions allowed. Confirm `via: "embedding-cache"` only appears on cache HIT, not on keyword or stage-2 paths.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] No probe lane regressions vs Phase-37 baseline (≥ 22/24 OK, ≥ 16/18 lane-match in keyword-only mode).
- [ ] At least 1 probe routes via `"embedding-cache"` after warm-up run.
- [ ] `@xenova/transformers` remains optional — system works with zero external deps (hash-bag path).
- [ ] `classifier-calibration.test.mjs` passes unchanged.
- [ ] `VERSION` = `2.79.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.79.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Any probe's lane assignment changes vs Phase-37 baseline (embedding cache introduces regression) → stop, debug cache threshold or embedding similarity.
- ❌ `hash-bag.mjs` produces non-deterministic vectors (floating point instability) → fix before Slice 2.
- ❌ `@xenova/transformers` added as required dependency (not optional) → revert.
- ❌ Embedding cache throws and `classify()` propagates error (must log + continue) → fix in Slice 3.
- ❌ `classifier-calibration.test.mjs` fails after Slice 3 wiring → do not proceed to Slice 4.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `hash-bag` embeddings are too low-quality to achieve 0.85 cosine threshold reliably | Lower effective threshold when `hash-bag` is active (e.g., 0.92 for hash-bag vs 0.85 for MiniLM); expose in config |
| 2 | First warm-up run produces 0 cache hits (cache starts empty) | Expected behavior — document in CHANGELOG that cache benefits appear after first run; `viaCounts.embedding = 0` is acceptable on first run |
| 3 | Binary cache file becomes corrupt on partial write (process killed mid-write) | Write to `.tmp` file then rename — atomic write prevents partial corruption |
| 4 | `@xenova/transformers` model download on first use is 50+ MB and blocks the first request | Trigger background download on server start (not on first classify call); show progress in dashboard |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~10K | ~$0.02 |
| Slice 2 | ~12K | ~$0.03 |
| Slice 3 | ~14K | ~$0.03 |
| Slice 4 | ~8K | ~$0.02 |
| **Total** | **~44K** | **~$0.10** |

---

## Session Break Points

After Slice 2 — Slice 3 requires holding the cosine cache API, the `classify()` stage structure, and the probe regression constraint simultaneously; fresh session avoids confusion between the two Slice layers.
