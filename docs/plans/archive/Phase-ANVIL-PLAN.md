# Phase-ANVIL: Δ-only Memoization, Hallmark Writer, Slag-Heap DLQ, Capability-Negotiating L3 Client (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/anvil.mjs`, `pforge-mcp/brain.mjs`, `pforge-mcp/pipelines.mjs`, capabilities + tools.json) + Tests + Docs
> **Estimated cost**: $8.00–$14.00 (7 slices, medium-large surface, mostly TypeScript-style mjs + tests)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: CocoIndex-inspired memory upgrade research (May 16, 2026).
> **Position in chain**: 3 of 6 — depends on Phase-HALLMARK-CONTRACT (the schema) and Phase-PROVENANCE (OpenBrain v0.7.0 published). Feeds Phase-LATTICE (which is the first heavy Anvil consumer).
> **Release target**: Plan-Forge `v2.95.0-dev` (final bump deferred to Phase-LATTICE Slice 10).

---

## Scope Contract

### In Scope

- `pforge-mcp/anvil.mjs` — new module exporting:
  - `withAnvil(toolFn, { toolName, inputs, codeHashSeed })` — memoization wrapper. Computes `cacheKey = sha256(toolName + ":" + sha256(inputs) + ":" + codeHash)`. On hit, returns cached payload + `{ anvil: { hit: true, key, ageMs } }`. On miss, runs `toolFn`, stores payload on disk under `.forge/anvil/<entity>/<sha256>.json`, returns payload + `{ anvil: { hit: false, key } }`.
  - `anvilStat()` — read-only summary: entries, total bytes, oldest mtime, per-tool hit/miss counts (from a sibling `.forge/anvil/stats.json`).
  - `anvilClear({ tool?, olderThanMs? })` — bounded deletion. Defaults are a no-op; requires at least one filter.
  - `anvilRebuild({ since: "<sha>" })` — selectively invalidates entries whose `codeHash` changed since the given git commit (no auto-rerun; the next caller misses cleanly).
  - `anvilDlqAppend(record)` / `anvilDlqList({ limit })` / `anvilDlqDrain(callback)` — per-record failure isolation at the L3 boundary.
- `pforge-mcp/brain.mjs` — three changes:
  1. Import `validateProvenance`, `buildProvenance`, `mergeProvenance` from `pforge-sdk/hallmark`.
  2. Every L2 write (`l2Remember`) merges a Hallmark provenance envelope into the stored value's `metadata` (or top-level `provenance` field for non-metadata schemas).
  3. Every L3 write (`l3Remember`) goes through a new `withL3Boundary(record)` helper that:
     - Validates provenance.
     - Probes OpenBrain `GET /health` once per process and caches `capabilities`.
     - If `capabilities.includes("provenance")` → write with provenance.
     - Else → write without provenance + log a one-time warning + emit hub event `openbrain-too-old`.
     - On any HTTP/network failure → `anvilDlqAppend(record)` + hub event `l3-deferred`.
  4. On orchestrator start, drain `anvilDlqDrain` before serving any tool calls.
- `pforge-mcp/pipelines.mjs` — new module exporting `pipelinesList()` and `pipelinesStats()`. Enumerates the four standing capture pipelines (orchestrator→memory, watcher→drift, hub→sessionReplay, crucible→thoughts) with last-write timestamps, throughput, and Anvil hit rates pulled from `anvil.mjs`.
- Anvil adoption inside four read-only tools — wrap their inner pure function with `withAnvil`:
  - `forge_analyze`
  - `forge_sweep`
  - `forge_hotspot`
  - `forge_tempering_scan`
- New MCP tools (registered in `pforge-mcp/tools.json` + handler in `pforge-mcp/server.mjs`):
  - `forge_anvil_stat`
  - `forge_anvil_clear`
  - `forge_anvil_rebuild`
  - `forge_anvil_dlq_list`
  - `forge_anvil_dlq_drain`
  - `forge_hallmark_show` (input: `id` or `cacheKey`) → returns provenance envelope.
  - `forge_hallmark_verify` (input: `id`) → re-hashes the cited source and reports drift.
  - `forge_pipelines_list`
- New tests:
  - `pforge-mcp/tests/anvil.test.mjs`
  - `pforge-mcp/tests/brain-hallmark.test.mjs`
  - `pforge-mcp/tests/brain-capability-negotiation.test.mjs`
  - `pforge-mcp/tests/brain-dlq.test.mjs`
  - `pforge-mcp/tests/pipelines.test.mjs`
  - `pforge-mcp/tests/anvil-adoption.test.mjs` (one assertion per wrapped tool that the second identical call is a cache hit)
- `pforge-mcp/capabilities.mjs` — register the eight new MCP tools (name, description, schema, intent tags).
- `pforge-mcp/package.json` — declare `pforge-sdk` as a workspace dep (already inside the same repo tree).
- `CHANGELOG.md` — `[Unreleased]` Added entry.

### Out of Scope

- **Lattice (the AST/code index)** — Phase-LATTICE. Anvil is the substrate Lattice will sit on; it must not assume Lattice exists.
- **Adoption inside the orchestrator's slice executor** — execution slices are not pure functions of inputs (LLM non-determinism), so memoization is wrong. Anvil is for **read-only** tool outputs.
- **A standalone `forge_dlq_*` tool family** — DLQ surfaces under `forge_anvil_dlq_*` since the Anvil module owns it.
- **A persistent process for periodic DLQ drain** — drain runs once at orchestrator boot and on-demand via the MCP tool. No background timer.
- **A new dashboard tab** — Phase-DOCS-SWEEP authors the dashboard surface and links Anvil/Hallmark stats into it.
- **Cache eviction policy beyond TTL** — `.forge/anvil/` grows. Operators clear it via `forge_anvil_clear` or `pforge anvil clear`. Phase-LATTICE may add an LRU policy later.
- **Streaming Anvil hits to the live hub** — only the `anvil.hit` boolean is added to existing tool responses; no new hub event types.
- **OpenBrain server changes** — entirely Phase-PROVENANCE's scope. This phase only consumes the published API.

### Forbidden Actions

- **Do NOT memoize anything that performs I/O outside `.forge/anvil/`.** Anvil wraps pure functions. If a tool reads `src/**`, the file contents must be part of the `inputs` hash, not done inside the wrapped function. Slice 4 audits the four adopted tools for this.
- **Do NOT swallow validator errors.** A failing `validateProvenance` is a programmer bug in the caller — log and refuse to write. Never write without provenance after a validation failure (that would silently lose lineage).
- **Do NOT block the orchestrator on DLQ drain.** Drain is best-effort with a 5-second budget; if it doesn't finish, the rest stays for the next boot.
- **Do NOT probe `GET /health` more than once per process lifetime.** Cache the `capabilities` array in a module-level variable. Re-probe only on explicit `forge_anvil_clear --capabilities-cache`.
- **Do NOT couple `anvil.mjs` to `pforge-sdk/hallmark`.** Anvil is a generic memoization cache. Hallmark is a brain-write concern. Slice 1 hands Anvil an opaque `codeHashSeed`; the Hallmark writer in `brain.mjs` is what knows about provenance.
- **Do NOT change the public input or output schema of `forge_analyze`, `forge_sweep`, `forge_hotspot`, or `forge_tempering_scan`.** Wrapping is additive — responses gain `anvil: { hit, key }` but every existing field stays identically shaped.
- **Do NOT write to `.forge/` from a test that does not point at a tmp directory.** Tests `mkdtempSync` and pass the path via `deps.cwd` injection.
- **Do NOT delete a DLQ record until the drain callback returns `{ ok: true }` for it.** Failed re-drives stay on the heap.
- **Do NOT publish a release in this phase.**

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Cache key composition | RESOLVED | `sha256(toolName + ":" + sha256(JSON.stringify(inputs)) + ":" + codeHash)`. JSON canonicalization handled by `JSON.stringify` with sorted-key replacer. |
| 2 | `codeHash` source | RESOLVED | Caller-supplied via `codeHashSeed` arg. Tool wrappers compute `sha256(readFileSync(thisFile))` once at module load. Avoids re-hashing on every call. |
| 3 | On-disk layout | RESOLVED | `.forge/anvil/<toolName>/<sha256>.json` (sharded by tool — keeps per-tool clears fast and per-tool stats trivial). |
| 4 | Cache hit metadata location | RESOLVED | Response payload gets a non-enumerable-ish `anvil: { hit, key, ageMs }` field at top level. Documented as additive; consumers may ignore. |
| 5 | DLQ format | RESOLVED | `.forge/anvil/dlq/<YYYY-MM-DD>.jsonl` — one JSON record per line, append-only, daily-sharded. Drain reads oldest-first. |
| 6 | DLQ retention | RESOLVED | None automatic. Files persist until `forge_anvil_dlq_drain` succeeds them off or operator deletes them. Forbidden Action 8. |
| 7 | Capability probe trigger | RESOLVED | Lazy — on the first L3 write attempt. Not at server boot (avoids hard dep on OpenBrain being up). |
| 8 | Capability probe timeout | RESOLVED | 2 seconds. On timeout, assume no `provenance` capability and proceed (degraded mode). |
| 9 | `anvilClear` safety | RESOLVED | Requires at least one of `tool` or `olderThanMs`. Calling with no args throws `ERR_ANVIL_NO_FILTER`. Prevents accidental nuke. |
| 10 | Adoption gate per tool | RESOLVED | A tool adoption is acceptable iff (a) its result is a pure function of its declared `inputs` and on-disk content captured by `inputsHash`, AND (b) its happy-path latency is > 50ms (caching trivia is waste). Slice 4 audits both per tool. |
| 11 | Pipeline registry seed | RESOLVED | Hand-curated array in `pipelines.mjs`. The four standing pipelines are well-known; auto-discovery is over-engineering for v1. |
| 12 | DLQ drain concurrency | RESOLVED | Sequential, oldest-first. Drain stops on first non-transient error to avoid hammering a sick OpenBrain. |
| 13 | Provenance for non-source captures | RESOLVED | Captures without a source file (e.g., quorum decisions) use only the three required Hallmark fields; `sourceFile`/`byteRange`/`contentHash` stay absent (the schema marks them optional). |
| 14 | CLI surface | RESOLVED | `pforge anvil stat|clear|rebuild|dlq list|dlq drain` and `pforge hallmark show <id>|verify <id>`. PowerShell + bash parity. (CLI wiring lives in this phase's Slice 6.) |

---

## Acceptance Criteria

### Anvil core

- **MUST**: `withAnvil(fn, opts)` called twice with identical `inputs` and `codeHashSeed` invokes `fn` exactly once.
- **MUST**: Changing one byte of `inputs` invokes `fn` a second time. Changing one byte of `codeHashSeed` invokes `fn` a second time.
- **MUST**: A response from a cache hit contains `anvil: { hit: true, key: "<sha256>", ageMs: <int>0> }`.
- **MUST**: A response from a cache miss contains `anvil: { hit: false, key: "<sha256>" }`.
- **MUST**: `anvilStat()` reports counts that match `ls .forge/anvil/<tool>/*.json | wc -l` per tool.
- **MUST**: `anvilClear({})` (no filter) throws `ERR_ANVIL_NO_FILTER`. `anvilClear({ tool: "forge_sweep" })` deletes only `.forge/anvil/forge_sweep/`.
- **MUST**: `anvilRebuild({ since: "<sha>" })` walks `git diff --name-only <sha> HEAD` and deletes anvil entries whose stored `codeHashSeed` references one of those files. Does not re-run the tool — next caller misses cleanly.

### Hallmark writer in brain.mjs

- **MUST**: Every successful `l2Remember(key, value)` results in a stored object whose `metadata.provenance` (or top-level `provenance` for schemas without `metadata`) is a Hallmark v1 envelope. Verified by reading the file back and calling `validateProvenance` from `pforge-sdk/hallmark`.
- **MUST**: A `value` that the caller forgot to pass `provenance` for is auto-stamped with a `buildProvenance({ toolName: deps.toolName })` envelope. (Fallback — keeps consumers from losing lineage silently.)
- **MUST**: A `value` with a caller-supplied invalid provenance causes `l2Remember` to return `{ ok: false, error: "ERR_BAD_PROVENANCE", details: [...] }`. No file is written.

### Capability-negotiating L3 client

- **MUST**: On the first L3 write, the client issues exactly one `GET /health` to OpenBrain.
- **MUST**: When `capabilities` includes `"provenance"`, the L3 write payload includes `metadata.provenance`.
- **MUST**: When `capabilities` omits `"provenance"` (or `/health` 404s, or times out at 2s), the L3 write proceeds without provenance, a one-time `console.warn` fires, and a hub event `openbrain-too-old` is emitted.
- **MUST**: The probe is cached for the lifetime of the process. A second L3 write does NOT re-probe (verified by mock counter).

### Slag-heap DLQ

- **MUST**: A 5xx response from OpenBrain on L3 write causes `anvilDlqAppend(record)` to run; the record lands in `.forge/anvil/dlq/<today>.jsonl`. Hub event `l3-deferred` fires.
- **MUST**: `anvilDlqList({ limit: 10 })` returns the 10 oldest pending records with their original `record`, `attemptedAt`, and `error`.
- **MUST**: `anvilDlqDrain(async (rec) => ({ ok: true }))` removes every record from the heap and returns `{ drained: N, remaining: 0 }`. With `{ ok: false }` callback, returns `{ drained: 0, remaining: N }` (Forbidden Action 8).
- **MUST**: Orchestrator boot calls `anvilDlqDrain` once with a 5-second total budget. The result is logged at INFO with a per-record summary capped at 5 lines.

### Adoption (the four tools)

- **MUST**: For each of `forge_analyze`, `forge_sweep`, `forge_hotspot`, `forge_tempering_scan`: calling the tool twice in a row with the same inputs in the same process produces `anvil.hit: false` then `anvil.hit: true`. (Acceptance test fixture; uses tmp project dir.)
- **MUST**: For each, the second call's wall-time is < 30% of the first call's wall-time. (Soft perf gate; hard floor is functional, perf is a nice-to-have asserted only when first call > 100ms.)
- **MUST**: For each, the existing public response schema is unchanged — verified by diffing JSON Schema snapshots stored in `tests/fixtures/tool-schemas/`.

### Pipelines

- **MUST**: `forge_pipelines_list` returns an array of exactly the four standing pipelines, each with `{ name, source, sink, lastWriteAt, throughputPerMin, anvilHitRate }`.
- **MUST**: When no anvil entries exist for a tool, `anvilHitRate` is `null` (not `0` — preserves the "no data" signal).

### MCP tool surface

- **MUST**: The eight new tools appear in `forge_capabilities` output with `addedIn: "2.95.0"`, complete `inputSchema`, descriptions, intent tags, and `example` blocks.
- **MUST**: Each new tool's MCP handler is wired in `pforge-mcp/server.mjs` and returns the documented response shape.

### CLI

- **MUST**: `pforge anvil stat`, `pforge anvil clear --tool=<name>`, `pforge anvil dlq list`, `pforge hallmark show <id>` all work from PowerShell and bash with identical flag names.

### Backward compatibility

- **MUST**: Every existing pforge-mcp test still passes. No existing tool changes its response schema (Forbidden Action 6).
- **MUST**: A `pforge` install pointing at an OpenBrain v0.6.x server (no `provenance` capability) writes L3 records successfully without provenance.

---

## Execution Slices

### Slice 1: `anvil.mjs` core — `withAnvil`, `anvilStat`, `anvilClear`, `anvilRebuild` + tests [sequential]

**Goal**: Pure memoization cache with no Hallmark, no DLQ, no integrations. Smallest unit of meaningful function.

**Files**:
- `pforge-mcp/anvil.mjs` (new)
- `pforge-mcp/tests/anvil.test.mjs` (new)

**Depends On**: nothing.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/anvil.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 2: DLQ surface inside `anvil.mjs` — append/list/drain + tests [sequential]

**Goal**: Per-record failure isolation as a sibling responsibility of the cache (same module, different filesystem subtree).

**Files**:
- `pforge-mcp/anvil.mjs` (modify — add DLQ functions)
- `pforge-mcp/tests/anvil.test.mjs` (modify — add DLQ test cases)

**Depends On**: Slice 1.

**Validation Gate**:
```bash
cd pforge-mcp && node -e "import('./anvil.mjs').then(m=>['anvilDlqAppend','anvilDlqList','anvilDlqDrain'].forEach(f=>{if(typeof m[f]!=='function')process.exit(1)})).then(()=>console.log('ok'))"
```

---

### Slice 3: Hallmark writer + capability-negotiating L3 client in `brain.mjs` [sequential]

**Goal**: Wire `pforge-sdk/hallmark` into the L2 and L3 write paths with the capability-probe lifecycle. Phase-PROVENANCE must be released first so a real OpenBrain target exists for the integration test.

**Files**:
- `pforge-mcp/brain.mjs` (modify)
- `pforge-mcp/tests/brain-hallmark.test.mjs` (new)
- `pforge-mcp/tests/brain-capability-negotiation.test.mjs` (new)
- `pforge-mcp/package.json` (modify — declare pforge-sdk workspace dep if not already)

**Depends On**: Slice 2, Phase-HALLMARK-CONTRACT Slice 3, Phase-PROVENANCE Slice 5 (release tag).

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/brain-hallmark.test.mjs tests/brain-capability-negotiation.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 4: Wire DLQ into L3 boundary + boot-time drain + tests [sequential]

**Goal**: Every L3 write fans out through DLQ on failure. Orchestrator boot drains. Closes the lineage-loss hole.

**Files**:
- `pforge-mcp/brain.mjs` (modify — `withL3Boundary` helper)
- `pforge-mcp/orchestrator.mjs` (modify — call `anvilDlqDrain` on boot with 5s budget)
- `pforge-mcp/tests/brain-dlq.test.mjs` (new)

**Depends On**: Slice 3.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/brain-dlq.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 5: Anvil adoption — `forge_analyze`, `forge_sweep`, `forge_hotspot`, `forge_tempering_scan` + adoption test [sequential]

**Goal**: Real cache hits on real read-only tools. Per Decision 10, each adoption is audited for purity.

**Files**:
- `pforge-mcp/server.mjs` or per-tool module (modify — wrap the inner pure function with `withAnvil`)
- `pforge-mcp/tests/anvil-adoption.test.mjs` (new — one assertion per wrapped tool)

**Depends On**: Slice 4.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/anvil-adoption.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 6: Eight new MCP tools + CLI surface in `pforge.ps1` and `pforge.sh` [sequential]

**Goal**: Operator-visible surface. Tools registered in `capabilities.mjs` + `tools.json`, handlers in `server.mjs`, CLI parity in both shells.

**Files**:
- `pforge-mcp/capabilities.mjs` (modify — register the 8 tools)
- `pforge-mcp/tools.json` (modify — schema entries)
- `pforge-mcp/server.mjs` (modify — handlers)
- `pforge-mcp/pipelines.mjs` (new — list + stats)
- `pforge-mcp/tests/pipelines.test.mjs` (new)
- `pforge.ps1` (modify — `anvil` and `hallmark` subcommands)
- `pforge.sh` (modify — same)

**Depends On**: Slice 5.

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/pipelines.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok && grep -q 'anvil' ../pforge.ps1 && grep -q 'anvil' ../pforge.sh && echo ok
```

---

### Slice 7: CHANGELOG + version-line bump to `2.95.0-dev` [sequential]

**Goal**: Mark the in-flight release; full bump to `2.95.0` happens at end of Phase-LATTICE.

**Files**:
- `CHANGELOG.md` (modify — `[Unreleased]` Added entries for Anvil + Hallmark + Pipelines)
- `pforge-mcp/package.json` (modify — version `2.95.0-dev`)
- `VERSION` (modify — `2.95.0-dev`)

**Depends On**: Slice 6.

**Validation Gate**:
```bash
grep -q '2.95.0-dev' VERSION && grep -q '2.95.0-dev' pforge-mcp/package.json && grep -q 'Anvil' CHANGELOG.md && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Wrapping a non-pure tool produces stale results | Slice 5 audit gate per tool (Decision 10). Anvil itself includes `inputsHash` over file contents the tool reads — not just declared args. |
| `.forge/anvil/` grows unbounded | `forge_anvil_clear --olderThanMs=...` + `pforge anvil clear` exposed; documented as operator concern; Phase-LATTICE may add LRU. |
| OpenBrain transient outage floods the DLQ | DLQ is daily-sharded JSONL — append-only, no contention. Drain budget at boot caps recovery time. |
| Capability probe blocks first L3 write by 2s | Worst-case; only on first write. Subsequent writes are 0-overhead. Acceptable for the lineage guarantee. |
| Race between two pforge processes writing the same anvil key | Cache write is atomic via `tmp + rename`. Race produces one winner; either result is correct since both ran the same pure function. |
| L3 boundary refactor accidentally swallows existing OpenBrain errors | Slice 4 test asserts that a 5xx still propagates back to the caller as an error AND lands on the DLQ — both. |
| DLQ drain on boot adds startup latency | 5s hard cap. Drain runs after MCP server is bound to its port (visible to clients); only blocks tool dispatch until done. |
| `forge_hallmark_verify` becomes expensive at scale | Read-only operation against named entries. Documented as on-demand audit, not a hot path. |

---

## Definition of Done

- All seven slices pass their validation gates.
- Full pforge-mcp test suite green: `cd pforge-mcp && npx vitest run --reporter=dot` shows 100% pass.
- `forge_capabilities` lists eight new tools with `addedIn: "2.95.0"`.
- `pforge anvil stat` (PowerShell + bash) returns a structured summary on a fresh repo.
- A canary `pforge run-plan` against a 3-slice fixture plan shows ≥ 1 anvil hit and zero DLQ records.
- A `git diff` summary shows expected new modules + tests + CLI edits and nothing in user-source directories outside `pforge-mcp/`, `pforge-sdk/` (already done in Phase-HALLMARK), `pforge.ps1`, `pforge.sh`, `CHANGELOG.md`, `VERSION`.

---

## Post-Mortem

_To be filled in after execution. Capture:_
- Which of the four adopted tools delivered the highest hit rate? Lowest?
- Did the boot-time DLQ drain ever exceed the 5s budget — and on what shape of backlog?
- Any consumer broken by the `anvil: { hit }` field appearing on tool responses?
- How often did the capability probe time out (suggests OpenBrain liveness improvement work)?
