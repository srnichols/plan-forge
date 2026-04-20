# Plan Forge Memory Architecture

> **Status**: Design reference  
> **Since**: v2.35  
> **Audience**: contributors adding new MCP tools, skills, or storage surfaces

---

## TL;DR

Plan Forge has **three tiers of memory**, organised by substrate, not by feature:

| Tier | Name | Backing | Lifetime | Query model | Cost |
|------|------|---------|----------|-------------|------|
| **L1** | Hub (volatile) | process RAM (`activeHub.history`) | server process | event replay | free |
| **L2** | Structured (left brain) | files on disk (`.forge/`, `.github/`, `docs/plans/`) | repo | exact lookup | free |
| **L3** | Semantic (right brain) | OpenBrain (Postgres + pgvector) | cross-project, forever | fuzzy / associative | network + embed |

Every MCP tool **must** write to L2. Tools whose output has cross-project or cross-time value **should** also write to L3. L1 is emitted automatically by any tool that publishes to the hub.

This mirrors a CPU memory hierarchy — fastest/smallest at L1, slowest/largest at L3 — and an operator's two-brain metaphor: deterministic filing cabinets on the left, associative recall on the right.

---

## Why three tiers

The framing that led here:

> *"On one side we have semantic search with Postgres, and on the other are our static files and configurations — two types of memory."*

That split is clean: files vs embeddings. But once you trace the data path of a running tool (`forge_run_plan`, `forge_watch_live`), a third surface appears: the **in-process hub buffer** that replays recent events to newly-connected WebSocket clients. It's neither a file nor a DB — it's RAM — and it has its own lifetime and query semantics. Naming it L1 makes the full hierarchy honest.

---

## L1 — Hub (volatile)

**Backing**: `activeHub.history` — a bounded ring buffer in the MCP server process.  
**Lifetime**: until the server restarts.  
**Query model**: "give me the last N events" on WebSocket connect; live stream thereafter.  
**Consumers**: dashboard tabs, `forge_watch_live`, external WS subscribers.

**Writers**: every tool that publishes a hub event. Examples:

| Event | Emitted by |
|-------|-----------|
| `slice-started` / `slice-completed` | orchestrator |
| `quorum-*` | quorum runner |
| `escalated` | escalation chain |
| `skill-step-*` | skill runner |
| `watch-snapshot-completed` / `watch-anomaly-detected` / `watch-advice-generated` | watcher |
| LiveGuard `health-*`, `incident-*`, `drift-*`, etc. | LiveGuard tools |

**Schema**: see [`pforge-mcp/EVENTS.md`](../pforge-mcp/EVENTS.md).

**Rule**: L1 is the *only* tier that streams. Dashboards and live tailers read from L1. Don't tail L2; don't tail L3.

---

## L2 — Structured (left brain)

**Backing**: files on disk. Known schemas. Append-only (`.jsonl`) or overwrite (`.json`).  
**Lifetime**: repo lifetime. Version-controlled where appropriate, gitignored where volatile.  
**Query model**: exact lookup — you know the path, you read the file.  
**Consumers**: every MCP tool, every agent, every skill, every hook, every CI job.

### The L2 map

| Path | Writer | Shape | Purpose |
|------|--------|-------|---------|
| `.forge.json` | user / `pforge update` | JSON | Project policy (thresholds, presets, hooks) |
| `.forge/runs/<id>/events.log` | orchestrator | text | Per-run truth log |
| `.forge/runs/<id>/slice-N.json` | orchestrator | JSON | Per-slice artifact |
| `.forge/runs/<id>/summary.json` | orchestrator | JSON | Run outcome |
| `.forge/model-performance.json` | orchestrator | JSON | Escalation-chain input |
| `.forge/quorum-history.json` | orchestrator | JSONL | Adaptive threshold input |
| `.forge/health-dna.json` | LiveGuard health | JSON fingerprint | Health scoring |
| `.forge/liveguard-memories.jsonl` | 10 LG tools via `captureMemory()` | JSONL | Local LG history (mirrors L3 captures) |
| `.forge/watch-history.jsonl` | watcher | JSONL | Watcher snapshot history |
| `.forge/drift-history.json` | drift report | JSON | Drift trend |
| `.forge/fix-proposals.json` | fix proposal | JSON | Fix-plan index |
| `.forge/regression-history.json` | regression guard | JSONL | Gate history |
| `.forge/deploy-journal.jsonl` | deploy journal | JSONL | Deploy log |
| `.forge/secret-scan-cache.json` | secret scan | JSON | Scan cache |
| `.forge/incidents/*.json` | incident capture | JSON per incident | Incident ledger |
| `.forge/openbrain-queue.jsonl` | `captureMemory()` | JSONL | **Bridge** — flush buffer for L3 when OpenBrain is unreachable |
| `.github/instructions/*.md` | repo | markdown | Agent guardrails |
| `.github/agents/*.md` | repo | markdown | Agent personas |
| `.github/hooks/**` | repo | scripts + JSON | Lifecycle hooks |
| `.github/prompts/*.prompt.md` | repo | markdown | Pipeline prompts |
| `docs/plans/*.md` | user | markdown | Feature plans |
| `docs/plans/PROJECT-PRINCIPLES.md` | user | markdown | Project invariants |
| `VERSION` | release tooling | text | Current version |
| `presets/**` | repo | JSON + scripts | Stack-specific defaults |
| `templates/**` | repo | templates | Bootable scaffolding |

### Properties

- **Fast**: no network, no embedding, no ANN search.
- **Exact**: same path, same bytes, byte-identical reads.
- **Deterministic**: reproducible, diffable, auditable.
- **Offline**: works with zero external dependencies.
- **Bootable**: a fresh clone + `pforge check` is fully functional on L2 alone.

### Costs

- No search — you either know the path or you don't find it.
- No cross-project recall — each repo's `.forge/` is its own island.
- No inference — two JSONL lines describing the same problem look like two separate records.

### Rule

**Every MCP tool writes to L2.** If a tool doesn't produce an L2 artifact, its output is lost when the hub flushes. L2 is the durable floor.

---

## L3 — Semantic (right brain)

**Backing**: [OpenBrain](https://github.com/srnichols/openbrain) — Postgres + pgvector with an HTTP API.  
**Lifetime**: cross-project, cross-session, indefinite (subject to OpenBrain retention policy).  
**Query model**: semantic search via `search_thoughts`. Returns by meaning, not by path.  
**Consumers**: four pipeline prompts (step0/1/3/5) via `buildMemorySearchBlock`; any agent calling `search_thoughts` directly.

### What lives in L3

Not raw events — **distilled thoughts**. Each thought is a short natural-language record with:

- `content`: the insight in prose
- `metadata`: `{ project, phase, tool, severity, tags[], runId? }`
- `embedding`: vector (computed server-side)

### Writers today (10 tools)

Any tool calling `captureMemory()` in `pforge-mcp/server.mjs`:

- `forge_run_plan` (run summaries)
- `forge_drift_report`
- `forge_secret_scan`
- `forge_env_diff`
- `forge_regression_guard`
- `forge_fix_proposal`
- `forge_liveguard_run`
- `forge_incident_capture`
- `forge_incident_triage`
- `forge_deploy_journal`

Plus cost-anomaly thoughts from `forge_cost_report` escalations and run-summary thoughts assembled via `buildRunSummaryThought`.

### Properties

- **Semantic**: "we've seen this kind of failure before" works; filename matching doesn't matter.
- **Cross-project**: a lesson from project A surfaces when editing project B.
- **Cross-time**: survives repo deletes, branch prunes, cache clears.
- **Associative**: related thoughts cluster even when vocabulary differs.

### Costs

- **Network**: every write and read is an HTTP call to OpenBrain.
- **Embedding compute**: not free; not always fast.
- **Non-deterministic**: top-K search is a ranking, not a lookup. Two identical queries may re-rank if the corpus changes.
- **Optional**: OpenBrain is not required. Plan Forge must always degrade to L2-only when `openbrain.endpoint` is unset.

### The bridge — `openbrain-queue.jsonl`

When `captureMemory()` is called but OpenBrain is unreachable, thoughts are written to `.forge/openbrain-queue.jsonl` (L2). A background flush replays the queue when OpenBrain is reachable again. This keeps L3 writes non-blocking and tolerant of network failure — L2 is always the floor.

### Rule

**L3 is opt-in.** A tool should only write to L3 if its output has reusable semantic value (failure patterns, decisions, recurring gotchas). Don't flood L3 with transient state — that's what L2 is for.

---

## The dual-write pattern

Every MCP tool should follow this shape:

```
┌──────────────────────────────────────────┐
│  Tool executes                           │
│    │                                     │
│    ├─► L1 event (if publishes to hub)    │
│    │                                     │
│    ├─► L2 file write  (always)           │
│    │                                     │
│    └─► L3 thought capture                │
│        (when OpenBrain configured AND    │
│         output has semantic value)       │
└──────────────────────────────────────────┘
```

And when reading before acting:

```
┌──────────────────────────────────────────┐
│  Tool prepares                           │
│    │                                     │
│    ├─◄ L2 recent state                   │
│    │   (last N entries, exact lookups)   │
│    │                                     │
│    └─◄ L3 semantic search                │
│        (prior art, cross-project)        │
└──────────────────────────────────────────┘
```

---

## Tool audit — where we are today

As of v2.53, dual-write coverage across 65 MCP tools:

| Bucket | Count | Status |
|--------|-------|--------|
| L2-only | 26 | default; fine for transient state |
| L2 + L3 | 10 | LiveGuard tools + `forge_run_plan` |
| L1 + L2 | many | any tool emitting hub events |
| L1 + L2 + L3 | subset of the 10 above | full stack |

### Candidates for L3 promotion

Left-only today, would benefit from right-brain writes:

| Tool | L3 value | Why |
|------|----------|-----|
| `forge_watch` / `forge_watch_live` | **High** | Only cross-project observer. Anomaly patterns are highly reusable. |
| `forge_cost_report` | **High** | "We keep overspending on this slice shape" is a classic semantic signal. |
| `forge_diagnose` | Medium | Failure modes recur; diagnosis text is reusable. |
| `forge_sweep` | Medium | Stub/TODO patterns recur across repos. |
| `forge_run_skill` | Medium | Skill failure modes are cross-project. |
| `forge_plan_status` | Low | Transient. Stay L2. |
| `forge_ext_search` | Low | Already indexed by the catalog. |
| `forge_generate_image` | None | No semantic value in image paths. |

---

## Design rules

1. **L2 is the floor.** If a tool can't write L2, it doesn't persist. Fix that first.
2. **L3 is the ceiling.** Opt-in, gracefully degrades to L2-only when OpenBrain is absent. No tool ever hard-requires OpenBrain.
3. **L1 is ephemeral.** Never rely on L1 for correctness — it's replay-buffer-grade, not storage-grade.
4. **Queue before cross-tier writes.** L3 writes go through `captureMemory()` which hits `openbrain-queue.jsonl` first (L2) — so L3 failure never blocks a tool.
5. **Read pattern mirrors write pattern.** Recent-state? L2. Associative? L3. Live feed? L1.
6. **One schema per surface.** L2 files have documented shapes. L1 events are in `EVENTS.md`. L3 thought metadata is keyed by `{ project, phase, tool, tags }`.
7. **New tool checklist.** Before merging a new MCP tool, confirm: (a) its L2 artifact is defined; (b) its L1 event is in `EVENTS.md` if it publishes; (c) its L3 value is explicitly declared — even if the answer is "none".

---

## Cognitive-science parallel

The three tiers map roughly to established memory-systems theory:

| Plan Forge | Human memory analogue |
|-----------|----------------------|
| L1 Hub buffer | working memory / short-term store |
| L2 Files + configs | declarative + procedural memory (explicit, rule-following) |
| L3 OpenBrain thoughts | semantic memory (associative, meaning-indexed) |

It's not a literal equivalence — it's just that the same pressures (fast/small vs slow/large, exact vs fuzzy, session-local vs lifetime) produce the same shape of hierarchy whether the substrate is neurons or silicon.

---

## Roadmap implications

Three concrete items drop out of this architecture:

1. **v2.35.1 (patch)** — wire `forge_watch` + `forge_watch_live` through `captureMemory()`. The only cross-project observer currently has no semantic memory.
2. **v2.36 (minor)** — retrofit the medium-value L3 candidates (`forge_diagnose`, `forge_sweep`, `forge_run_skill`). Add an `l3Writes` field to each tool's declaration in `tools.json` so coverage is auditable.
3. **v2.40+ (design)** — consider an L4: a shared OpenBrain tenant across an organisation, so lessons from project A surface to project B without any local OpenBrain. This is a deployment pattern, not new code.

---

## Related files

- [`pforge-mcp/memory.mjs`](../pforge-mcp/memory.mjs) — OpenBrain integration module (`captureMemory`, `buildMemorySearchBlock`, `buildRunSummaryThought`, `loadProjectContext`).
- [`pforge-mcp/server.mjs`](../pforge-mcp/server.mjs) — tool handlers. `captureMemory()` helper at top of file.
- [`pforge-mcp/EVENTS.md`](../pforge-mcp/EVENTS.md) — L1 event schemas.
- [`pforge-mcp/tools.json`](../pforge-mcp/tools.json) — tool manifest.
- [`docs/UNIFIED-SYSTEM-ARCHITECTURE.md`](UNIFIED-SYSTEM-ARCHITECTURE.md) — broader system context.
