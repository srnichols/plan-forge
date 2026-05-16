# pforge-sdk

Programmatic SDK for Plan Forge — access MCP tools, orchestration primitives, and tool metadata from Node.js code.

## Status

> **Scaffold** — API surface is defined; implementation in progress.

## Installation

```bash
npm install pforge-sdk
```

## Usage

```js
import { tools, getToolsByRisk } from 'pforge-sdk/tools';

// Get all read-only tools safe to auto-approve
const readOnly = getToolsByRisk('read-only');
```

## Risk Levels

| Level | Description |
|-------|-------------|
| `read-only` | Safe to auto-approve — no file writes, no external calls |
| `write` | Creates/modifies files or calls external AI APIs |
| `execute` | Spawns agents, runs plan slices, consumes tokens |

See [`../pforge-mcp/tools.json`](../pforge-mcp/tools.json) for the full tool registry.

## Hallmark provenance

The `pforge-sdk/hallmark` sub-path exports a lightweight, dependency-free provenance contract for attaching structured audit metadata to any tool output.

```js
import { buildProvenance, validateProvenance, mergeProvenance } from 'pforge-sdk/hallmark';

// Build a provenance envelope for a tool invocation
const prov = buildProvenance({
  toolName: 'forge_sweep',
  sourceFile: 'src/index.mjs',
  byteRange: [0, 512],
});

// Validate an incoming envelope (pure — no I/O, no throws)
const result = validateProvenance(prov);
// → { ok: true }

// Attach provenance to an existing metadata object (non-mutating)
const enriched = mergeProvenance({ topics: ['security'] }, prov);
// → { topics: ['security'], provenance: { schemaVersion: 'hallmark/v1', ... } }
```

### Schema: `hallmark/v1`

Every provenance envelope must satisfy the `hallmark/v1` schema (`schemas/hallmark-provenance.v1.json`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `string` | ✅ | Always `"hallmark/v1"` |
| `toolName` | `string` | ✅ | Name of the tool that produced the artifact |
| `capturedAt` | `string` | ✅ | ISO 8601 UTC timestamp ending in `Z` |
| `sourceFile` | `string` | — | Relative path of the source file |
| `byteRange` | `[number, number]` | — | `[startInclusive, endExclusive]` byte offsets |
| `contentHash` | `string` | — | `sha256:<64 hex chars>` hash of the content |
| `codeHash` | `string` | — | `sha256:<64 hex chars>` hash of the producing code |
| `toolVersion` | `string` | — | Version string of the tool |

`additionalProperties` is `false` — unknown keys are rejected by `validateProvenance`.

`buildProvenance` always fills `schemaVersion` and `capturedAt` automatically; any values the caller passes for those fields are silently ignored.
