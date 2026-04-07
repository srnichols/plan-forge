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
