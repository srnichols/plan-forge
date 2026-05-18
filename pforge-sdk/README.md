# pforge-sdk

**Version**: `0.3.0` · **License**: MIT · **Engines**: Node ≥ 20

Programmatic SDK for Plan Forge — load MCP tool metadata, build Hallmark provenance envelopes, and validate Lattice code-chunk records from your own Node.js code. Zero runtime dependencies.

> **Companion to the MCP server.** The SDK does NOT spawn or host the MCP server itself — for that, see `pforge-mcp/server.mjs`. The SDK is for code that wants to *read* Plan Forge metadata or *produce* Plan Forge-compatible artifacts (provenance stamps, chunk records, etc.).

---

## Installation

```bash
npm install pforge-sdk
```

Or, working inside the Plan Forge monorepo:

```bash
npm install file:./pforge-sdk
```

---

## What ships

| Sub-path | Module | What it gives you |
|---|---|---|
| `pforge-sdk` | `src/index.mjs` | Re-exports everything below |
| `pforge-sdk/tools` | `src/tools.mjs` | Tool registry helpers (load + filter the 88 MCP tools) |
| `pforge-sdk/hallmark` | `src/hallmark.mjs` | `buildProvenance` / `validateProvenance` / `mergeProvenance` + `hallmark/v1` schema |
| `pforge-sdk/chunker` | `src/chunker.mjs` | `validateChunk` + `CHUNK_KINDS` for Lattice code-graph records |

> **Note**: There is no `pforge-sdk/client` sub-path yet. To call REST endpoints from code, see [docs/REST-API.md](../docs/REST-API.md) — `fetch` is sufficient. A typed client is planned for `0.4.0`.

---

## `pforge-sdk/tools` — Tool registry

The tools module loads `pforge-mcp/tools.json` (the canonical registry of all 88 MCP tools) and exposes helpers for filtering by risk, intent, or name.

```js
import {
  tools,
  getTool,
  getToolsByRisk,
  getToolsByIntent,
} from 'pforge-sdk/tools';

// All 88 tools
console.log(tools.length); // → 88

// Find a single tool
const runPlan = getTool('forge_run_plan');

// Safe-to-auto-approve tools (no writes, no external calls)
const readOnly = getToolsByRisk('read-only');

// All tools whose intent includes "memory"
const memTools = getToolsByIntent('memory');
```

### Tool record shape

Each entry in `tools` is a JSON object with at least:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Stable tool name (e.g. `forge_run_plan`) |
| `description` | `string` | One-paragraph description used by the MCP host |
| `intent` | `string \| string[]` | Discovery keywords (`execute`, `read`, `crucible`, `memory`, …) |
| `riskLevel` | `'read-only' \| 'write' \| 'execute'` | Auto-approve hint |
| `cost` | `'low' \| 'medium' \| 'high'` | Rough token cost |
| `inputSchema` | `object` | JSON Schema for the tool's input |

The full registry is regenerated from `pforge-mcp/capabilities.mjs` every time the MCP server boots — `tools.json` is the source of truth the SDK reads from.

---

## `pforge-sdk/hallmark` — Provenance envelopes

The Hallmark contract attaches structured audit metadata to any tool output, decision, memory capture, or plan artifact. It is the cross-layer provenance stamp used throughout the v3.x memory architecture (L1/L2/L3) and is what makes Anvil's dedup-by-hash work.

```js
import {
  buildProvenance,
  validateProvenance,
  mergeProvenance,
} from 'pforge-sdk/hallmark';

const prov = buildProvenance({
  toolName: 'forge_sweep',
  sourceFile: 'src/index.mjs',
  byteRange: [0, 512],
  contentHash: 'sha256:abc…',
});

const result = validateProvenance(prov);
// → { ok: true } | { ok: false, errors: [...] }

const enriched = mergeProvenance({ topics: ['security'] }, prov);
// → { topics: [...], provenance: { schemaVersion: 'hallmark/v1', ... } }
```

### Schema: `hallmark/v1`

Every envelope must satisfy `schemas/hallmark-provenance.v1.json`:

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `schemaVersion` | `string` | ✅ | Always `"hallmark/v1"` |
| `toolName` | `string` | ✅ | Producer tool |
| `capturedAt` | `string` | ✅ | ISO 8601 UTC, ends in `Z` |
| `sourceFile` | `string` | — | Relative path |
| `byteRange` | `[number, number]` | — | `[start, end)` byte offsets |
| `contentHash` | `string` | — | `sha256:<64 hex>` of the content |
| `codeHash` | `string` | — | `sha256:<64 hex>` of the producing code |
| `toolVersion` | `string` | — | Tool version |

`additionalProperties: false` — unknown keys are rejected. `buildProvenance` always fills `schemaVersion` and `capturedAt`; caller-supplied values for those keys are ignored.

---

## `pforge-sdk/chunker` — Lattice chunk records

The chunker module defines the contract that both the pure-JS chunker (`chunker-pureJs.mjs`) and the optional tree-sitter chunker (`pforge-mcp/lattice-chunker-treesitter.mjs`) must satisfy. Use it when you want to *produce* Lattice-compatible chunk records from your own indexer.

```js
import { validateChunk, CHUNK_KINDS } from 'pforge-sdk/chunker';

const record = {
  filePath: 'src/foo.mjs',
  language: 'javascript',
  kind: 'function',
  name: 'computeScore',
  startByte: 0,
  endByte: 256,
  startLine: 1,
  endLine: 8,
  contentHash: 'sha256:…',
  declares: ['computeScore'],
  references: ['Math.max'],
};

const result = validateChunk(record);
// → { ok: true } | { ok: false, errors: [{ code, message }, ...] }
```

`CHUNK_KINDS` is the frozen tuple `['file', 'module', 'class', 'function', 'method', 'block']`.

---

## Risk levels (auto-approve guidance)

When you write a host that lets agents call Plan Forge tools, use the tool's `riskLevel` to decide what to gate on:

| Level | Description | Safe to auto-approve? |
|---|---|:-:|
| `read-only` | No writes, no external calls (e.g. `forge_capabilities`, `forge_search`, `forge_drift_report`) | ✅ |
| `write` | Creates or modifies files (e.g. `forge_export_plan`, `forge_sync_memories`, `forge_runbook`) | ⚠️ Project-dependent |
| `execute` | Spawns agents / runs plans / consumes tokens (e.g. `forge_run_plan`, `forge_analyze`, `forge_master_ask`) | ❌ Always confirm |

---

## Relationship to other Plan Forge surfaces

| Surface | When to use |
|---|---|
| **`pforge-sdk` (this package)** | You want to read tool metadata, stamp provenance, or validate chunk records from Node.js |
| **MCP tools** (`pforge-mcp/server.mjs`) | You want an AI agent to call Plan Forge from chat |
| **REST API** ([docs/REST-API.md](../docs/REST-API.md)) | You want to call Plan Forge from a non-Node language, a UI, or a CI job |
| **CLI** (`pforge`) | You want a human or shell script to drive Plan Forge |

The SDK is intentionally narrow — it covers the artifact contracts (`tools.json`, `hallmark/v1`, `CodeChunker`) that other tooling needs to interoperate. For everything else, use the REST API or the MCP tool surface.

---

## Roadmap

| Version | Adds |
|---|---|
| **0.3.0** (current) | `chunker` sub-path; dropped broken `client` declaration; bumped to match v3.x memory architecture |
| **0.4.0** (planned) | Typed REST `client` sub-path; convenience wrappers for `/api/tool/:name` dispatch |
| **0.5.0** (planned) | Anvil cache-key helpers; Lattice query builder |

Track progress in [docs/V3-CAPABILITY-AUDIT.md](../docs/V3-CAPABILITY-AUDIT.md).

---

## See also

- [docs/REST-API.md](../docs/REST-API.md) — all 103 REST endpoints
- [docs/capabilities.md](../docs/capabilities.md) — all 88 MCP tools
- [pforge-mcp/tools.json](../pforge-mcp/tools.json) — canonical tool registry (what `pforge-sdk/tools` reads)
- [pforge-sdk/schemas/](schemas/) — JSON Schemas (`hallmark-provenance.v1.json`, etc.)
