---
description: Agent-Computer Interface (ACI) rules — how every forge_* MCP tool must shape its inputs and outputs so the calling agent can use it reliably. Auto-loads when editing tool definitions or capabilities.
applyTo: 'pforge-mcp/server.mjs,pforge-mcp/capabilities.mjs,pforge-mcp/forge-master-routes.mjs,pforge-master/server.mjs'
priority: HIGH
---

# ACI Design Instructions

> **ACI = Agent-Computer Interface.** Empirically validated against the SWE-agent ACI principle: the agent only performs as well as the surface lets it. Plan Forge ships 100+ `forge_*` tools — a single sloppy tool can degrade every agent that calls it.

---

## The reference standard

When you add a new tool, pattern-match against `forge_search` — it is the gold-standard ACI surface in this repo. Read its handler in `pforge-mcp/server.mjs`, its description in `pforge-mcp/capabilities.mjs`, and its tests in `pforge-mcp/tests/`. If your new tool diverges from `forge_search`'s shape, you need a reason.

What `forge_search` gets right:
- **Bounded snippets** — 80 chars each, never raw file contents
- **Sparse fields** — `{ source, recordRef, snippet, score, timestamp }` (5 fields, no `_internal` leakage)
- **Pagination metadata** — `total` + `truncated` + `hasMore` + `cursor`
- **Friendly empty path** — `{ hits: [], total: 0, message: "Searched plans for 'X'; no matches. Try …" }`
- **Documented contract** — every response field appears in `description`, `inputSchema`, and `TOOL_METADATA.example.output`

---

## The 5 Rules

### Rule 1 — Bound the happy-path payload to ~10 KB

Unbounded payloads (30 KB+ snapshots, 10K-event captures, full activity logs) blow the calling agent's context budget. The agent then skips later tool calls or hallucinates to fit. Both failure modes are silent.

**Fix**: return summary counts/status by default; offer a `drill` / `verbose` opt-in for details.

```js
// ✅ default response under 1 KB; verbose opt-in for the rest
{
  ok: true,
  count: 47,
  recent: ['slice-3', 'slice-4', 'slice-5'],
  message: 'Pass verbose: true to drill into each event'
}

// ❌ unbounded
{ events: [/* 4,712 entries × ~80 fields */] }
```

If the default response would still exceed ~10 KB without losing essential context, paginate (Rule 3).

### Rule 2 — Describe empty states explicitly

A bare `{ hits: [], total: 0 }` reads as "the tool failed" to most agents. The agent then retries, re-formulates the query, or gives up.

**Fix**: include a `message` field describing what was searched, what filters were active, and how to broaden the query.

```js
// ✅ self-describing empty result
{
  hits: [],
  total: 0,
  truncated: false,
  message: "Searched plans for 'foo bar' (last 30 days). No matches. Try a single-word query or extend the window with daysBack."
}

// ❌ ambiguous
{ hits: [] }
```

### Rule 3 — Paginate anything that can grow

Tools that return list-shaped data must support pagination from day one. Adding it later requires every existing caller to be updated.

**Required fields** on any paginated response:

| Field | Type | Meaning |
|-------|------|---------|
| `limit` | number | Page size (default 10–25) |
| `cursor` | string\|null | Opaque continuation token (or null for first page) |
| `nextCursor` | string\|null | Pass to next call; null when no more |
| `hasMore` | boolean | True if `nextCursor` is non-null |
| `total` | number\|null | Total count if cheap to compute; null otherwise |
| `truncated` | boolean | True if the underlying query was capped before pagination |

Default `limit` should be small (10–25). The agent can ask for more if needed; the agent cannot recover from a default that blows its context.

### Rule 4 — Document every response field

Undocumented response fields force the calling agent to guess. Guessing produces wrong reads, wrong follow-up calls, and unrecoverable trajectories.

**Every new payload field must appear in three places**:

1. The tool's `description` string in `pforge-mcp/server.mjs` (one-line summary)
2. The `inputSchema.properties` for input fields, or a separate `outputSchema` if you're adding one
3. The `TOOL_METADATA[toolName].example.output` in `pforge-mcp/capabilities.mjs`

If you forget #3, an agent calling `forge_capabilities` to learn the tool surface will not see your field exists.

### Rule 5 — Post-process raw CLI output

Silent success or empty stdout is ambiguous. The agent cannot tell "no findings" from "command failed quietly".

**Fix**: post-process to inject an explicit positive message or structured result.

```js
// ✅ unambiguous success path
const { code, stdout } = await spawnAsync('grep', ['-r', 'TODO', srcDir]);
if (code === 0 && stdout.trim() === '') {
  return { ok: true, count: 0, message: 'No TODO markers found. Code is complete!' };
}
if (code === 1) {
  return { ok: true, count: 0, message: 'No matches.' };  // grep exit 1 = no match
}
return { ok: true, count: parseCount(stdout), matches: parseMatches(stdout) };

// ❌ raw passthrough
return { stdout, stderr, code };
```

---

## Temper guards

When designing or modifying any MCP tool surface, watch for these shortcuts. Each has shipped in this repo and had to be cleaned up.

| Shortcut | Why It Breaks |
|----------|--------------|
| "Return the full object to be safe" | Unbounded payloads blow agent context budgets. See Rule 1. |
| "Raw CLI output is good enough" | Silent success vs silent failure is indistinguishable. See Rule 5. |
| "Pagination is too hard; return all" | Tools like `forge_run_plan`, `forge_diagnose`, `forge_home_snapshot` can return arbitrarily large activity logs. See Rule 3. |
| "Empty response means nothing happened" | Bare `{ hits: [] }` reads as failure. See Rule 2. |
| "I'll add the field, agent will figure it out" | Undocumented fields force the agent to guess. See Rule 4. |
| "This tool is read-only, schema validation is overkill" | Schema is the agent's contract with you. Without it the agent can't know what arguments to send. Always declare `inputSchema`. |
| "I'll just return `{ error: 'X' }` on failure" | The success path returns `{ ok: true, ... }`. Failures must use the same envelope: `{ ok: false, error: 'X' }`. Otherwise the agent has to type-sniff the response. |

---

## Warning signs

These are observable patterns that mean an ACI rule has been violated:

- A new MCP tool returns >10 KB of JSON in its happy path with no opt-in flag (Rule 1)
- A new MCP tool returns `{ hits: [] }` or `{ results: [] }` with no `message` field (Rule 2)
- A list-shaped tool has no `limit` / `cursor` / `hasMore` (Rule 3)
- A response field exists in code but not in `TOOL_METADATA.example.output` (Rule 4)
- A handler returns raw `stdout`/`stderr` strings (Rule 5)
- Two tools return the same logical concept (e.g. "list of slices") in two different shapes — inconsistency is its own bug

---

## Test contract

Every new `forge_*` tool requires four tests in `pforge-mcp/tests/`:

1. **Happy path** — typical input → expected envelope shape
2. **Empty-state path** — input that matches no data → confirms `message` field present
3. **Pagination path** — input that exceeds `limit` → confirms `nextCursor` and `hasMore`
4. **Error path** — invalid input → confirms `{ ok: false, error: '...' }` envelope

If your new tool has no pagination (it's a scalar tool like `forge_status`), the pagination test is replaced with a **schema test**: serialize the response, parse it back, assert the field set matches `TOOL_METADATA.example.output`.

---

## See also

- [architecture-principles.instructions.md](architecture-principles.instructions.md) — the broader principles ACI sits inside (Separation of Concerns, Dependency Rule)
- [security.instructions.md](security.instructions.md) — the *system* safety rules; ACI is the *agent* safety rules
- [testing.instructions.md](testing.instructions.md) — the four-test contract above
- `pforge-mcp/server.mjs` — `forge_search` handler (reference standard)
- `pforge-mcp/capabilities.mjs` — `TOOL_METADATA` (where all tools are documented)
- `scripts/audit/surface-diff.mjs` — catches breaking changes to the ACI surface (wired into `/code-review` Step 2)
