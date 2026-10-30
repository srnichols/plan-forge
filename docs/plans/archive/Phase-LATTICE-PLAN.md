# Phase-LATTICE: Code Chunker Interface, AST/Call-Graph Index, Blast-Radius Tooling (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-sdk/src/chunker.mjs`, `pforge-mcp/lattice.mjs`, `pforge-mcp/server.mjs`, capabilities, dashboard) + Tests + Docs
> **Estimated cost**: $14.00–$22.00 (10 slices, heaviest phase in the chain; AST + tests + dashboard tab)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: CocoIndex-code MCP research; Plan-Forge naming reconciliation (Lattice replaces Codex due to multi-collision with `codex-cli`, `GPT-5.3-codex`, Codex multi-agent role).
> **Position in chain**: 4 of 6 — depends on Phase-ANVIL (Lattice is a heavy Anvil consumer and the proof of its value). Feeds Phase-MEMORY-DOCS-SWEEP and Phase-MEMORY-QA.
> **Release target**: Plan-Forge `v2.95.0` (bumps from `2.95.0-dev` to `2.95.0` in Slice 10).

---

## Scope Contract

### In Scope

- `pforge-sdk/src/chunker.mjs` — defines the `CodeChunker` interface (typedef contract, since SDK is JS) plus zero-dep helpers:
  - `chunkRecord(record)` shape: `{ filePath, language, kind, name, startByte, endByte, startLine, endLine, contentHash, declares, references }` where `kind ∈ {"file","module","class","function","method","block"}`.
  - `validateChunk(record)` — schema check, zero-dep.
  - `chunkerCapability(impl)` — returns `{ languages, kinds, version }` describing what an impl can do.
- `pforge-sdk/src/chunker-pureJs.mjs` — fallback impl. Regex/line-based chunker for JS, TS, MJS, PY, SQL, MD. Coarse: file → function/class only. Required so Lattice works in environments without tree-sitter.
- `pforge-mcp/lattice-chunker-treesitter.mjs` — high-fidelity impl. Lazy-loads `tree-sitter` + per-language grammars **only if installed**. If the import throws, falls back to pure-JS with a one-time warning.
- `pforge-mcp/lattice.mjs` — index store + query API:
  - `latticeIndex({ paths, since })` — walks files (gitignore-aware), chunks each, computes `contentHash`, writes JSONL at `.forge/lattice/chunks.jsonl` + `.forge/lattice/edges.jsonl`. Always wrapped in `withAnvil` from Phase-ANVIL.
  - `latticeQuery({ name?, kind?, file?, language?, limit, cursor })` — paginated lookup.
  - `latticeCallers({ name, file? })` — reverse edges into `name`.
  - `latticeCallees({ name, file? })` — forward edges out of `name`.
  - `latticeBlast({ paths })` — BFS over the call graph; returns the transitive closure of callers (and tests touching those files), bounded.
  - `latticeStat()` — counts, last-index timestamp, chunker impl in use, Anvil hit rate, index byte size.
- `pforge-mcp/server.mjs` — handlers for five new MCP tools.
- `pforge-mcp/capabilities.mjs` — register them.
- `pforge-mcp/tools.json` — schema entries.
- Hotspot + regression upgrades (additive only):
  - `pforge-mcp/forge-tools/hotspot.mjs` (or equivalent) — when Lattice index exists, augments output with `callerCount`, `calleeCount`, `inBlastOf`. When index is missing, falls back to current grep-only behavior.
  - `pforge-mcp/forge-tools/regression-guard.mjs` — when Lattice exists, computes `blastRadius` for changed files and includes the affected test files. Otherwise, current behavior unchanged.
- Dashboard "Anvil & Lattice" tab:
  - `pforge-mcp/dashboard/anvil-lattice.html` (new)
  - `pforge-mcp/dashboard/anvil-lattice.css` (new)
  - `pforge-mcp/dashboard/anvil-lattice.mjs` (new) — fetches from `forge_anvil_stat`, `forge_lattice_stat`, `forge_pipelines_list` via the existing dashboard bridge.
  - Tab is registered in the dashboard nav alongside existing tabs.
- Tests:
  - `pforge-sdk/tests/chunker.test.mjs`
  - `pforge-sdk/tests/chunker-pureJs.test.mjs`
  - `pforge-mcp/tests/lattice-chunker-treesitter.test.mjs` (skipped via `it.skipIf(!hasTreeSitter)` when grammar deps absent)
  - `pforge-mcp/tests/lattice-index.test.mjs`
  - `pforge-mcp/tests/lattice-query.test.mjs`
  - `pforge-mcp/tests/lattice-callers-callees.test.mjs`
  - `pforge-mcp/tests/lattice-blast.test.mjs`
  - `pforge-mcp/tests/hotspot-lattice-augment.test.mjs`
  - `pforge-mcp/tests/regression-guard-blast.test.mjs`
  - `pforge-mcp/tests/dashboard-anvil-lattice.test.mjs` (DOM smoke via the existing dashboard test harness)
- New MCP tools (five):
  - `forge_lattice_index`
  - `forge_lattice_query`
  - `forge_lattice_callers`
  - `forge_lattice_blast`
  - `forge_lattice_stat`
- CLI: `pforge lattice index|query|callers|blast|stat` parity in `pforge.ps1` + `pforge.sh`.
- CHANGELOG + version bump from `2.95.0-dev` to `2.95.0`.

### Out of Scope

- **Replacing `forge_search`** — Lattice is *structural*, `forge_search` is *textual*. Both stay. Optional Lattice-augmented search is a future phase.
- **Cross-repo call graphs** — Lattice indexes the current repo only. Submodule traversal is a future enhancement.
- **A `forge_lattice_diff` tool** — diff is implicit via the `since` arg of `latticeIndex`. A dedicated diff tool waits for a real consumer.
- **Persisting the call graph to OpenBrain** — Lattice is per-repo, machine-local, regeneratable. L3 storage is the wrong layer.
- **AI-powered chunk descriptions** — chunk records are mechanical. Summarization is a future Crucible flow.
- **A new dashboard for chunks** — only the Anvil & Lattice tab. Chunk browsing happens via CLI / `forge_lattice_query`.
- **Replacing existing `forge_hotspot` or `forge_regression_guard` output schemas** — Lattice augmentation is *additive only*.
- **Tree-sitter as a hard dependency** — pforge stays zero-runtime-dep at install time; tree-sitter is an opt-in via `pforge ext add lattice-treesitter` (or manual `npm i tree-sitter tree-sitter-javascript ...`).

### Forbidden Actions

- **Do NOT add tree-sitter or any grammar to `pforge-mcp/package.json` `dependencies`.** Must be `optionalDependencies` at most, or — preferred — left to the user/extension.
- **Do NOT degrade `forge_hotspot` or `forge_regression_guard` outputs when Lattice is absent.** The augmentation is additive. Existing snapshots and response schemas hold.
- **Do NOT call `latticeIndex` automatically from the orchestrator boot path.** Index is on-demand or via watcher; boot-time indexing would balloon startup time on large repos.
- **Do NOT index files outside the repo.** Walk respects `.gitignore` and refuses absolute paths outside the workspace root. Test the fence.
- **Do NOT exceed bounded payloads** — `forge_lattice_query` defaults `limit: 25`, hard max `200`. `forge_lattice_blast` caps BFS at depth 5 with a `truncated: true` flag when hit. ACI guidance from `architecture-principles.instructions.md`.
- **Do NOT silently fall back to pure-JS** — every fallback emits a one-time warning to stderr and includes `chunker: "pureJs"` in `latticeStat()` output.
- **Do NOT couple `lattice.mjs` to `brain.mjs`.** Lattice is a code-graph index, not memory. Hallmark stays out of this phase.
- **Do NOT publish `pforge-sdk` as part of this phase.** Chunker types ship as part of the v0.3.0 SDK release, gated separately. This phase consumes the new file from a workspace install.
- **Do NOT block Slice 10 release on tree-sitter test pass** — if `lattice-chunker-treesitter.test.mjs` is skipped (no deps installed in CI), that is acceptable. The pure-JS path must be fully green.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Chunker interface location | RESOLVED | `pforge-sdk/src/chunker.mjs`. Sharing the contract via SDK lets external tools and the tree-sitter impl agree on the same record shape. |
| 2 | Default chunker impl in v2.95.0 | RESOLVED | Pure-JS. Tree-sitter is opt-in via extension. Keeps install footprint tiny. |
| 3 | Index storage format | RESOLVED | JSONL at `.forge/lattice/{chunks,edges}.jsonl`. Append-friendly, grep-friendly, trivial to rebuild. No SQLite for v1. |
| 4 | Edge model | RESOLVED | Directed: `(callerChunkId, calleeName)`. Resolution to a chunk happens at query time. Avoids commit-stamping the whole graph on every index. |
| 5 | `latticeIndex` parallelism | RESOLVED | Sequential for v1. File-walking dominates anyway. Worker_threads if profiling proves it's worth it (post-release). |
| 6 | Gitignore semantics | RESOLVED | Use `git ls-files --cached --others --exclude-standard` when in a git repo; fall back to a small `.gitignore` parser using existing pforge code. |
| 7 | Blast-radius depth cap | RESOLVED | 5 levels of BFS, hard cap. Beyond that, returns `truncated: true` with the boundary frontier. |
| 8 | Test-file detection for blast | RESOLVED | Heuristic: any file matching `**/tests/**`, `**/test/**`, `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*` that imports/calls any chunk in the blast set. |
| 9 | Anvil cache key for Lattice | RESOLVED | `hash(filePath + ":" + contentHash + ":" + chunkerImpl + ":" + chunkerVersion)` — per-file granularity so an unchanged file's chunks are cache hits across `latticeIndex` runs. |
| 10 | Tool placement (one big or many small) | RESOLVED | Five focused tools (`index`, `query`, `callers`, `blast`, `stat`). `callees` is a query mode flag on `query` to keep the surface tight. Decision revisited if needed. |
| 11 | Dashboard tab name | RESOLVED | "Anvil & Lattice" — one tab, two cards. Aligns with the metallurgy theme and the fact that both ship in the same release. |
| 12 | Migration for users with `Codex` references in their plans | RESOLVED | Lattice is a *new* name (no production users of the prior "Codex" name exist outside this design conversation). No migration tool needed. |
| 13 | `forge_lattice_index --since=<sha>` semantics | RESOLVED | Re-index only files changed in `git diff --name-only <sha> HEAD`. Anvil supplies the per-file cache; this flag skips the file walk for unchanged files. |
| 14 | What `latticeStat` exposes for ACI | RESOLVED | `{ chunks, edges, languages: {<lang>: count}, lastIndexedAt, chunkerImpl, chunkerVersion, anvilHitRate, indexBytes }` — bounded summary, no chunk content. Detailed dumps require `forge_lattice_query`. |

---

## Acceptance Criteria

### Chunker contract

- **MUST**: `validateChunk(record)` returns `{ ok: true }` for a record with all required fields and rejects each missing field with a specific error code.
- **MUST**: Both `chunker-pureJs.mjs` and `lattice-chunker-treesitter.mjs` pass a shared "contract conformance" test that runs the same set of 12 fixture inputs through each impl and asserts `validateChunk(out) === { ok: true }` for every output.
- **MUST**: `chunkerCapability(pureJsImpl)` returns `{ languages: ["js","ts","mjs","py","sql","md"], kinds: ["file","function","class"], version: "1.x.y" }`.

### Pure-JS chunker

- **MUST**: A 200-line JS file with 3 top-level functions and 1 class produces ≥ 4 chunks (file + each declaration) with non-overlapping `[startByte, endByte)` ranges.
- **MUST**: Files in a language not on the supported list produce a single `file`-kind chunk with the whole content (graceful degradation).

### Tree-sitter chunker

- **MUST** (skipped if grammars absent): Same 200-line JS fixture as above produces a chunk per top-level declaration AND a chunk per method inside the class (`kind: "method"`).
- **MUST**: When `tree-sitter` import fails, `lattice.mjs` substitutes the pure-JS impl and logs exactly one warning (verified by mock).

### Lattice index

- **MUST**: `latticeIndex({ paths: ["./src"] })` writes `.forge/lattice/chunks.jsonl` and `.forge/lattice/edges.jsonl`. Both files exist and are valid JSONL (one JSON per line, parseable).
- **MUST**: A second `latticeIndex` call with the same input on an unchanged tree results in ≥ 95% Anvil hit rate (sampled via `latticeStat().anvilHitRate`).
- **MUST**: `latticeIndex({ paths: ["./src"], since: "HEAD~1" })` only re-chunks files in `git diff --name-only HEAD~1 HEAD` — verified by spy on the chunker.
- **MUST**: Files matched by `.gitignore` are not indexed.
- **MUST**: An attempt to index an absolute path outside the workspace root throws `ERR_LATTICE_PATH_OUTSIDE_REPO`.

### Lattice queries

- **MUST**: `forge_lattice_query({ name: "handleClick" })` returns chunks whose `name === "handleClick"` paginated by `limit` (default 25, max 200).
- **MUST**: `forge_lattice_callers({ name: "validateProvenance" })` returns chunks that reference `validateProvenance` in their `references` array.
- **MUST**: `forge_lattice_blast({ paths: ["src/hallmark.mjs"] })` returns `{ callers: [...], tests: [...], depth, truncated }` with `depth <= 5` and `truncated: true` when frontier hit.
- **MUST**: Empty result paths return `{ items: [], total: 0, message: "No chunks matched <criteria>. Did you run forge_lattice_index?" }` — friendly message per ACI standard.

### Adoption (additive augmentation)

- **MUST**: `forge_hotspot` output gains `{ callerCount, calleeCount, inBlastOf }` per file when Lattice index exists. Schema snapshot diff shows ONLY additive fields.
- **MUST**: When `.forge/lattice/chunks.jsonl` does not exist, `forge_hotspot` returns its prior schema verbatim (no new fields, no errors).
- **MUST**: `forge_regression_guard` output gains a `blastRadius: { files: [...], tests: [...], depth, truncated }` field when Lattice exists; absent otherwise.

### Dashboard

- **MUST**: A new "Anvil & Lattice" nav entry exists in the dashboard.
- **MUST**: The tab renders an Anvil card (entries, bytes, top-5 tools by hit rate, DLQ count) and a Lattice card (chunks, edges, languages chart, last index age, chunker impl).
- **MUST**: The tab fetches data via the existing dashboard bridge — no direct file reads, no new XHR origins.
- **MUST**: When `.forge/lattice/` is empty, the Lattice card shows an empty state with a "Run `forge_lattice_index`" hint, not a stack trace.

### MCP surface

- **MUST**: All five Lattice tools appear in `forge_capabilities` with `addedIn: "2.95.0"`, schema, descriptions, intent tags, and examples.
- **MUST**: Each tool obeys the ACI guards from `architecture-principles.instructions.md`: bounded payloads, paginated lists, structured empty-state messages.

### CLI

- **MUST**: `pforge lattice index|query|callers|blast|stat` in PowerShell and bash dispatch to the corresponding MCP tools with matching flags.

### Backward compatibility

- **MUST**: Full pforge-mcp + pforge-sdk test suite passes.
- **MUST**: No existing tool's response schema changes when Lattice is uninstalled / not yet indexed.
- **MUST**: `pforge run-plan` on a repo with no `.forge/lattice/` runs to completion without any Lattice errors.

---

## Execution Slices

### Slice 1: `pforge-sdk/src/chunker.mjs` — contract + validator + tests [sequential]

**Goal**: Lock the chunk record shape so both impls agree. Smallest, lowest-risk start.

**Files**:
- `pforge-sdk/src/chunker.mjs` (new)
- `pforge-sdk/tests/chunker.test.mjs` (new)
- `pforge-sdk/src/index.mjs` (modify — export chunker symbols)

**Depends On**: nothing.

**Validation Gate**:
```bash
cd pforge-sdk && npx vitest run tests/chunker.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 2: Pure-JS chunker + tests [sequential]

**Goal**: Zero-dep fallback impl. Lets every consumer have a chunker without installing anything.

**Files**:
- `pforge-sdk/src/chunker-pureJs.mjs` (new)
- `pforge-sdk/tests/chunker-pureJs.test.mjs` (new)
- `pforge-sdk/tests/fixtures/chunker/` (new — 12 small source files across languages)

**Depends On**: Slice 1.

**Validation Gate**:
```bash
cd pforge-sdk && npx vitest run tests/chunker-pureJs.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 3: Tree-sitter chunker (lazy-loaded) + tests [sequential]

**Goal**: High-fidelity impl, opt-in.

**Files**:
- `pforge-mcp/lattice-chunker-treesitter.mjs` (new)
- `pforge-mcp/tests/lattice-chunker-treesitter.test.mjs` (new — uses `it.skipIf(!hasTreeSitter)`)

**Depends On**: Slice 2.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/lattice-chunker-treesitter.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 4: `lattice.mjs` index — `latticeIndex` + persistence [sequential]

**Goal**: Walk → chunk → persist → Anvil-wrap. Smallest meaningful Lattice unit.

**Files**:
- `pforge-mcp/lattice.mjs` (new — `latticeIndex` + `latticeStat`)
- `pforge-mcp/tests/lattice-index.test.mjs` (new)

**Depends On**: Slice 3, Phase-ANVIL Slice 1 (need `withAnvil`).

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/lattice-index.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 5: `latticeQuery` + `latticeCallers` + `latticeCallees` + tests [sequential]

**Goal**: Read API. Separate from index so test failures here don't block indexer dev.

**Files**:
- `pforge-mcp/lattice.mjs` (modify)
- `pforge-mcp/tests/lattice-query.test.mjs` (new)
- `pforge-mcp/tests/lattice-callers-callees.test.mjs` (new)

**Depends On**: Slice 4.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/lattice-query.test.mjs tests/lattice-callers-callees.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 6: `latticeBlast` BFS + tests [sequential]

**Goal**: Bounded-depth blast radius with test-file detection.

**Files**:
- `pforge-mcp/lattice.mjs` (modify)
- `pforge-mcp/tests/lattice-blast.test.mjs` (new)

**Depends On**: Slice 5.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/lattice-blast.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 7: Five MCP tool handlers + capabilities + tools.json + CLI [sequential]

**Goal**: Expose Lattice through MCP and CLI surfaces. Per-tool ACI bounds enforced here.

**Files**:
- `pforge-mcp/server.mjs` (modify — handlers)
- `pforge-mcp/capabilities.mjs` (modify — register)
- `pforge-mcp/tools.json` (modify — schemas)
- `pforge.ps1` (modify — `lattice` subcommand)
- `pforge.sh` (modify — same)
- `pforge-mcp/tests/lattice-mcp-handlers.test.mjs` (new)

**Depends On**: Slice 6.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/lattice-mcp-handlers.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok && grep -q 'lattice' ../pforge.ps1 && grep -q 'lattice' ../pforge.sh && echo ok
```

---

### Slice 8: `forge_hotspot` + `forge_regression_guard` augmentation + tests [sequential]

**Goal**: Light-touch additive enhancement; backward-compat fence asserted.

**Files**:
- `pforge-mcp/forge-tools/hotspot.mjs` or equivalent (modify)
- `pforge-mcp/forge-tools/regression-guard.mjs` or equivalent (modify)
- `pforge-mcp/tests/hotspot-lattice-augment.test.mjs` (new)
- `pforge-mcp/tests/regression-guard-blast.test.mjs` (new)

**Depends On**: Slice 7.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/hotspot-lattice-augment.test.mjs tests/regression-guard-blast.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 9: Dashboard "Anvil & Lattice" tab + smoke test [sequential]

**Goal**: Operator visibility.

**Files**:
- `pforge-mcp/dashboard/anvil-lattice.html` (new)
- `pforge-mcp/dashboard/anvil-lattice.css` (new)
- `pforge-mcp/dashboard/anvil-lattice.mjs` (new)
- `pforge-mcp/dashboard/index.html` (modify — nav entry)
- `pforge-mcp/tests/dashboard-anvil-lattice.test.mjs` (new)

**Depends On**: Slice 8.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/dashboard-anvil-lattice.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 10: CHANGELOG + version bump to `2.95.0` + capabilities snapshot regen [sequential]

**Goal**: Ship.

**Files**:
- `CHANGELOG.md` (modify — convert `[Unreleased]` to `[2.95.0]`, add Lattice entries)
- `VERSION` (modify — `2.95.0`)
- `pforge-mcp/package.json` (modify — `2.95.0`)
- `pforge-mcp/capabilities.mjs` (modify if regen snapshot path lives here)
- `docs/capabilities.md` (modify — regenerated via `pforge smith --dump-capabilities` or equivalent)

**Depends On**: Slice 9.

**Validation Gate**:
```bash
grep -q '^2.95.0$' VERSION && grep -q '"version": "2.95.0"' pforge-mcp/package.json && grep -q '## \[2.95.0\]' CHANGELOG.md && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Tree-sitter not portable across Win/Linux/macOS | Lazy import; pure-JS fallback always available. CI marks tree-sitter tests skipped on platforms without the grammar binary. |
| Index file grows large on big repos | JSONL is compressible; `forge_lattice_stat` reports bytes; documented as operator concern. Anvil hits keep re-index fast. |
| Edge resolution at query time is too slow | Bench in Slice 5; if > 200ms on a 5k-chunk index, add a tiny in-memory inverted index at module load. Acceptable for v1. |
| Pure-JS chunker mislabels boundaries on weird syntax | Document as "coarse"; tree-sitter is the precise path. Tests focus on common shapes. |
| Hotspot/regression schema diff regression | Snapshot tests for both tools' outputs WITHOUT Lattice present. Run in Slice 8 before adding the augmentation. |
| Dashboard XHR origin mismatch | Reuse the existing dashboard bridge — no new fetches. Slice 9 test covers. |
| ".forge/lattice/" committed accidentally | Add `.forge/lattice/` to the suggested `.gitignore` in `templates/` (this happens in Phase-MEMORY-DOCS-SWEEP, not here). |
| Blast radius explodes (every file calls a util) | Hard depth cap (5) + `truncated: true` flag. Frontier returned so operators can opt to drill manually. |

---

## Definition of Done

- All ten slices pass their validation gates.
- Full pforge-mcp + pforge-sdk suites green.
- `forge_capabilities` reports `2.95.0` with five new Lattice tools listed.
- A fresh clone running `pforge lattice index` on the Plan-Forge repo itself completes and produces a non-empty `.forge/lattice/chunks.jsonl`.
- A second `pforge lattice index` run reports ≥ 95% Anvil hit rate via `forge_lattice_stat`.
- The dashboard "Anvil & Lattice" tab renders both cards with live data on a freshly indexed repo.
- `git diff` summary shows no modifications outside the In Scope file list.
- Tagged release `v2.95.0` is *prepared* (commit + tag deferred to a separate `git push` step; this phase ends ready-to-ship).

---

## Post-Mortem

_To be filled in after execution. Capture:_
- Tree-sitter grammar coverage gaps encountered (which languages were under-served?).
- Anvil hit rate on a real second-run index (target ≥ 95%).
- Blast-radius truncation rate — how often do real queries hit depth 5?
- Adoption: which existing tools benefited most from the Lattice augmentation?
- Did separating chunker contract (SDK) from impl (MCP) pay off when adding the tree-sitter impl?
