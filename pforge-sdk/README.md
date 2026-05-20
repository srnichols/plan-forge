# pforge-sdk

**Version**: `0.5.0` · **License**: MIT · **Engines**: Node ≥ 20

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
| `pforge-sdk/tools` | `src/tools.mjs` | Tool registry helpers (load + filter MCP tools) |
| `pforge-sdk/hallmark` | `src/hallmark.mjs` | `buildProvenance` / `validateProvenance` / `mergeProvenance` + `hallmark/v1` schema |
| `pforge-sdk/chunker` | `src/chunker.mjs` | `validateChunk` + `CHUNK_KINDS` for Lattice code-graph records |
| `pforge-sdk/client` | `src/client.mjs` | `PForgeClient` — typed REST client for the Plan Forge MCP server |
| `pforge-sdk/anvil` | `src/anvil.mjs` | Anvil cache-key helpers — `computeAnvilKey`, path helpers |
| `pforge-sdk/lattice-query` | `src/lattice-query.mjs` | Lattice query builder — `LatticeQueryBuilder`, `tokenizeForSearch`, `scoreChunk` |
| `pforge-sdk/notifications/adapter-contract` | `src/notifications/adapter-contract.mjs` | Notification adapter contract — `validateAdapterShape`, `ERR_NOT_IMPLEMENTED` |

> **Note**: `pforge-sdk/client` is new in `0.4.0`. It requires a running Plan Forge MCP server (`pforge-mcp/server.mjs`) to be useful. Zero runtime dependencies — uses the global `fetch` (Node ≥ 18).
> **Note**: `pforge-sdk/anvil` and `pforge-sdk/lattice-query` are new in `0.5.0`. Both are pure and dependency-free.
> **Note**: `pforge-sdk/notifications/adapter-contract` is new in `0.5.0`. Defines the shape every notification adapter must implement — pure validation, no runtime base class.

---

## `pforge-sdk/tools` — Tool registry

The tools module loads `pforge-mcp/tools.json` (the canonical registry of all MCP tools) and exposes helpers for filtering by risk, intent, or name.

```js
import {
  tools,
  getTool,
  getToolsByRisk,
  getToolsByIntent,
} from 'pforge-sdk/tools';

// All tools
console.log(tools.length); // → count depends on installed version

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

## `pforge-sdk/notifications/adapter-contract` — Notification adapter contract

Defines the shape every Plan Forge notification adapter must implement. No runtime base class — pure validation via `validateAdapterShape`. Import this when writing a custom adapter or host that dispatches notifications.

```js
import {
  validateAdapterShape,
  ERR_NOT_IMPLEMENTED,
} from 'pforge-sdk/notifications/adapter-contract';

// Validate a custom adapter before registering it
const myAdapter = {
  name: 'slack',
  send: async ({ formattedMessage, config }) => {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      body: JSON.stringify({ text: formattedMessage }),
    });
    return { ok: res.ok, statusCode: res.status };
  },
  validate: (config) => {
    if (!config.webhookUrl) return { ok: false, reason: 'webhookUrl required' };
    return { ok: true };
  },
};

const check = validateAdapterShape(myAdapter);
if (!check.valid) {
  throw new Error(`Adapter missing: ${check.missing.join(', ')}`);
}
```

### `AdapterSendArgs` shape

| Field | Type | Description |
|---|---|---|
| `event` | `object` | Hub event (`type`, `data`, `timestamp`, …) |
| `route` | `string` | Adapter name that matched the route |
| `formattedMessage` | `string` | Human-readable message text |
| `correlationId` | `string` | Trace ID for this delivery |
| `config` | `object` | Resolved adapter config (env vars expanded) |

### `AdapterSendResult` shape

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` if delivery succeeded |
| `statusCode` | `number?` | HTTP status code (for HTTP-based adapters) |
| `deliveryMs` | `number?` | Round-trip time in ms |
| `errorCode` | `string?` | Machine-readable error (`TIMEOUT`, `HTTP_500`, `NETWORK_ERROR`, …) |
| `error` | `string?` | Human-readable error message |

### `validateAdapterShape(adapter)`

| Returns | Type | Description |
|---|---|---|
| `valid` | `boolean` | `true` if adapter has `name` (string), `send` (function), `validate` (function) |
| `missing` | `string[]` | Names of missing or wrong-typed members |

### `ERR_NOT_IMPLEMENTED`

String constant `"ERR_NOT_IMPLEMENTED"` — use as the `errorCode` value in `AdapterSendResult` when a send path is a stub.

---

## `pforge-sdk/client` — REST Client

`PForgeClient` is a zero-dependency typed REST client for the Plan Forge MCP server. It wraps every major `/api/*` endpoint family and exposes a generic `tool()` dispatcher for calling any `forge_*` tool over HTTP.

```js
import { PForgeClient, createClient } from 'pforge-sdk/client';

// Connect to the default server (http://localhost:3100)
const client = new PForgeClient();

// Or pass options
const client = createClient({
  baseUrl:   'http://my-server:3100',
  timeoutMs: 10_000,
  apiKey:    process.env.PFORGE_API_KEY,   // → Authorization: Bearer <key>
});
```

### Discovery

```js
const { version }  = await client.version();       // GET /api/version
const status       = await client.status();         // GET /api/status
const capabilities = await client.capabilities();   // GET /api/capabilities
const manifest     = await client.discover();       // GET /.well-known/plan-forge.json
```

### Plan Runs

```js
const runs    = await client.runs.list();
const latest  = await client.runs.latest();
const run3    = await client.runs.get(3);
const started = await client.runs.trigger({ plan: 'docs/plans/Phase-55-PLAN.md', mode: 'auto' });
const aborted = await client.runs.abort();
const events  = await client.runs.replay(3, 'slice-2');
```

### Cost & Search

```js
const cost     = await client.cost();                               // GET /api/cost
const results  = await client.search('drift');                      // GET /api/search?q=drift
const paged    = await client.search({ q: 'gate', limit: 10 });
const timeline = await client.timeline({ cursor: 'abc', limit: 25 });
```

### Memory

```js
const report = await client.memory.report();
const hits   = await client.memory.search({ q: 'OTEL', limit: 5 });
await client.memory.capture({ content: 'orchestrator now exports slice-gate helpers' });
```

### LiveGuard

```js
const drift    = await client.liveguard.drift();
const history  = await client.liveguard.driftHistory();
const incidents = await client.liveguard.incidents();
const health   = await client.liveguard.healthTrend();
```

### Crucible (Idea Smelting)

```js
const smelts  = await client.crucible.list();
const smelt   = await client.crucible.submit({ idea: 'Add typed client to pforge-sdk' });
const preview = await client.crucible.preview();
```

### Generic MCP Tool Dispatcher

Call any `forge_*` tool by name. The input must match that tool's `inputSchema`.

```js
// Equivalent to calling the forge_run_plan MCP tool
const result = await client.tool('forge_run_plan', {
  plan: 'docs/plans/Phase-55-PLAN.md',
  mode: 'auto',
});

// Read-only tools work too
const caps = await client.tool('forge_capabilities');
```

### Error handling

Non-2xx responses and network failures both throw `PForgeClientError`:

```js
import { PForgeClientError } from 'pforge-sdk/client';

try {
  await client.runs.trigger({ plan: 'missing.md' });
} catch (err) {
  if (err instanceof PForgeClientError) {
    console.error(err.statusCode); // e.g. 404
    console.error(err.body);       // parsed response body
  }
}
```

| Property | Type | Description |
|---|---|---|
| `statusCode` | `number` | HTTP status code (0 = network-level failure) |
| `body` | `unknown` | Parsed JSON body, or raw text if not JSON |
| `message` | `string` | Human-readable summary |

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

## `pforge-sdk/anvil` — Anvil cache-key helpers

Exposes the canonical Anvil cache-key algorithm and path helpers so external code can predict, inspect, and audit Anvil entries without depending on the full MCP server package.

```js
import {
  computeAnvilKey,
  anvilEntryPath,
  anvilCacheDir,
  anvilStatsPath,
  ANVIL_STATS_RELATIVE,
} from 'pforge-sdk/anvil';

// Compute the same cache key that withAnvil() would compute on the server
const key = computeAnvilKey('forge_search', { q: 'drift' }, 'v1.2.3');
// → '3f8a…' (64-char hex)

// Resolve the absolute path to the entry on disk
const entryFile = anvilEntryPath({ toolName: 'forge_search', key });
// → '/workspace/.forge/anvil/forge_search/3f8a….json'

// Resolve the tool-scoped cache directory
const cacheDir = anvilCacheDir({ toolName: 'forge_search' });
// → '/workspace/.forge/anvil/forge_search'

// Resolve the stats file
const stats = anvilStatsPath();
// → '/workspace/.forge/anvil/stats.json'
```

All functions accept an optional `cwd` parameter (defaults to `process.cwd()`).

| Export | Description |
|---|---|
| `computeAnvilKey(toolName, inputs, codeHashSeed)` | Returns a 64-char hex cache key matching the server's algorithm |
| `anvilEntryPath({ toolName, key, cwd? })` | Absolute path to `<cwd>/.forge/anvil/<toolName>/<key>.json` |
| `anvilCacheDir({ toolName, cwd? })` | Absolute path to `<cwd>/.forge/anvil/<toolName>/` |
| `anvilStatsPath({ cwd? })` | Absolute path to `<cwd>/.forge/anvil/stats.json` |
| `ANVIL_STATS_RELATIVE` | Relative path constant `.forge/anvil/stats.json` (platform-native separator) |

---

## `pforge-sdk/lattice-query` — Lattice query builder

Fluent builder for `latticeQuery` parameters plus pure scoring utilities extracted from `pforge-mcp/lattice.mjs`. Zero dependencies.

```js
import {
  LatticeQueryBuilder,
  tokenizeForSearch,
  scoreChunk,
} from 'pforge-sdk/lattice-query';

// Build query params for forge_lattice_query / latticeQuery
const params = new LatticeQueryBuilder()
  .query('getUserById')
  .language('javascript')
  .kind('function')
  .limit(10)
  .build();
// → { query: 'getUserById', language: 'javascript', kind: 'function', limit: 10 }

// Tokenise text with camelCase splitting
const tokens = tokenizeForSearch('getUserById');
// Map { 'get' => 1, 'user' => 1, 'by' => 1, 'id' => 1 }

// Score a chunk [0, 1] — name tokens weighted 2× over path tokens
const score = scoreChunk('user', { name: 'getUserById', filePath: 'src/user.mjs' });
// → 1
```

### `LatticeQueryBuilder` API

| Method | Description |
|---|---|
| `.query(text)` | Token + substring match against chunk name and filePath |
| `.language(lang)` | Exact match against `chunk.language` (e.g. `'javascript'`) |
| `.kind(k)` | Exact match against `chunk.kind` (e.g. `'function'`) |
| `.filePath(path)` | Substring match against `chunk.filePath` (case-insensitive) |
| `.limit(n)` | Max results to return (default 25; must be a positive integer) |
| `.build()` | Returns params object — spread into `latticeQuery(...)` or `client.tool(...)` |
| `.describe()` | Human-readable description of current filters (for logging) |

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
| **0.3.0** | `chunker` sub-path; dropped broken `client` declaration; bumped to match v3.x memory architecture |
| **0.4.0** | `client` sub-path — `PForgeClient` typed REST client, `createClient` factory, `PForgeClientError`, method groups for runs/memory/crucible/liveguard, generic `tool()` dispatcher |
| **0.5.0** (current) | `anvil` sub-path — `computeAnvilKey`, path helpers; `lattice-query` sub-path — `LatticeQueryBuilder`, `tokenizeForSearch`, `scoreChunk`; `notifications/adapter-contract` sub-path — `validateAdapterShape`, `ERR_NOT_IMPLEMENTED` |

Track progress in [docs/V3-CAPABILITY-AUDIT.md](../docs/V3-CAPABILITY-AUDIT.md).

---

## See also

- [docs/REST-API.md](../docs/REST-API.md) — all REST endpoints
- [docs/capabilities.md](../docs/capabilities.md) — all MCP tools
- [pforge-mcp/tools.json](../pforge-mcp/tools.json) — canonical tool registry (what `pforge-sdk/tools` reads)
- [pforge-sdk/schemas/](schemas/) — JSON Schemas (`hallmark-provenance.v1.json`, etc.)
