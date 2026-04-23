---
lane: full
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-36 — Forge-Master Runtime Observability + Real Dispatcher

> **Target release**: v2.70.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-35 shipped (v2.69.0) — new lanes + prefs in place
> **Addresses**: Findings 2, 3, 4 from `.forge/validation/FINDINGS-2026-04-23.md`

## Core Problem

The probe harness at `scripts/probe-forge-master.mjs` surfaced three gaps in the HTTP `/stream` route at [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs):

1. **The route uses a stub dispatcher** — `dispatcher: async () => ({})` unconditionally. Tool calls the model requests execute as no-ops. The dashboard chat today cannot actually run forge tools; it can only *request* them on paper. This is the single largest defect uncovered in the hammer session.
2. **`result.error` is swallowed.** When the reasoning provider is unavailable (no API key, no Copilot login), `runTurn` returns `{ reply: "", error, suggestion: NO_PROVIDER_SUGGESTION }`. The `/stream` handler unconditionally emits `sse.send("reply", { content: result.reply })` and drops `error` + `suggestion`. Clients see a silent empty reply with no guidance — 13/24 probes exhibited this.
3. **`classification.lane` never surfaces to the client.** `runTurn` computes it internally but the route emits only `reply`, `tool-call`, `done`. The dashboard can't show the chosen lane, and validation harnesses can't verify routing end-to-end.

Together, these defects mean the dashboard Forge-Master tab is currently a display-only facade. Users can type questions, see empty replies, and never know why. The fix is a single slice of wiring plus two observability slices.

## Design Constraints

- **Real dispatcher must respect the write allowlist.** `runTurn` has a tool allowlist; the HTTP route must thread the same allowlist through the dispatcher so dashboard turns cannot escalate into destructive-class tool calls without the existing typed-confirmation gate.
- **No leaking API keys or provider-internal errors into SSE `error` events.** Sanitize to `{ code, message, suggestion }`. The suggestion string is safe to display.
- **Emit `classification` event before `reply`.** UI depends on this ordering to show the lane badge while the reply renders.
- **Backwards-compatible event set.** Do not rename `start` / `reply` / `tool-call` / `done` / `error`. Only add new event types.
- **Validated end-to-end by the probe harness.** This phase is done when `node scripts/probe-forge-master.mjs` shows ≥22/24 OK replies (errors acceptable only for genuinely unreachable provider state).

## Candidate Slices

### Slice 1 — Emit `classification` and `error` events

**Scope**: [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs) (both express and built-in node handlers), new tests in `pforge-master/tests/http-routes.sse.test.mjs` (new).

- In the `/stream` handler, wrap `runTurn` so that:
  - After classification (either via an exposed callback from `runTurn` or by calling `classify()` separately and passing the result in), emit `sse.send("classification", { lane, confidence })`.
  - If `result.error` is set, emit `sse.send("error", { code: result.error, message: result.reply || null, suggestion: result.suggestion || null })` **instead of** `reply`. Still emit `done` with zero tokens.
- Add `classification` to the documented event list in the handler's JSDoc.
- Tests: mock `runTurn` to return `{ error: "no provider available", suggestion: "set GITHUB_COPILOT_TOKEN" }` and assert the SSE stream emits an `error` event with the suggestion. Second test: mock `runTurn` to succeed and assert ordering `start → classification → reply → done`.
- **Gate**: `npx vitest run pforge-master/tests/http-routes.sse.test.mjs` reports `Tests  2 passed` AND `grep -q 'sse.send("classification"' pforge-master/src/http-routes.mjs`.

### Slice 2 — Expose `classification` from `runTurn` via callback or return field

**Scope**: [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), tests in `pforge-master/src/__tests__/reasoning-classification-surface.test.mjs` (new).

- `runTurn` accepts optional `deps.onClassification({ lane, confidence })` callback fired immediately after `classify()` completes. HTTP route uses this to stream the event before the reasoning call finishes.
- `runTurn`'s return value gains `classification: { lane, confidence }` (non-null after classifier runs, even on OFFTOPIC short-circuit).
- Tests: callback fires exactly once per turn; return field is populated on OFFTOPIC short-circuit; return field is populated on no-provider error path.
- **Gate**: `npx vitest run pforge-master/src/__tests__/reasoning-classification-surface.test.mjs` green AND full `pforge-master` test suite still green.

### Slice 3 — Wire real dispatcher into `/stream`

**Scope**: [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs), new `pforge-master/src/http-dispatcher.mjs`, tests in `pforge-master/tests/http-dispatcher.test.mjs` (new).

- New module `http-dispatcher.mjs` exports `createHttpDispatcher({ allowlist, mcpClient, pendingApprovals })` returning an `async (toolName, args) => result` dispatcher.
  - Non-allowlisted tool name → structured error `{ error: "tool not allowlisted", tool }`.
  - Destructive-class tool name → push onto `pendingApprovals`, emit approval-required event (out of scope here — Phase-32 already does this path through the in-process tool). For now, error out with `{ error: "destructive tool requires in-IDE confirmation", tool }`.
  - Read-only tool name → invoke via the in-process MCP client that `forge_master_ask` uses today (import from `pforge-mcp/server.mjs` or factor the dispatcher out of that module).
- `/stream` handler imports `createHttpDispatcher` and passes it to `runTurn({ dispatcher: httpDispatcher })` instead of the stub.
- Tests: dispatcher rejects non-allowlisted tool; dispatcher forwards read-only tool to mock MCP client; dispatcher rejects destructive tool with clear error.
- **Gate**: `npx vitest run pforge-master/tests/http-dispatcher.test.mjs` green AND `NOT grep -E 'dispatcher:\s*async\s*\(\)\s*=>\s*\({}\)' pforge-master/src/http-routes.mjs` (stub is gone).

### Slice 4 — End-to-end probe validation + release v2.70.0

**Scope**: [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs) (may need tweaks to parse new `classification` event), `.forge/validation/probes.json` (refresh expected lanes after Phase-35 added new lanes), [CHANGELOG.md](CHANGELOG.md), [VERSION](VERSION).

- Update probe runner to capture `classification.lane` + `classification.confidence` from the new SSE event, restore the lane-match summary table that was lost in the v1 harness.
- Run the harness against a local server with a real provider key. Commit `.forge/validation/results-<ISO>.md` from the green run.
- Acceptance: ≥22/24 probes return non-empty `reply` (or an `error` event with `suggestion` populated — not a silent empty). Lane match ≥80% on probes with `lane != "any"`.
- Bump VERSION to 2.70.0. CHANGELOG entry: `[2.70.0] — Forge-Master runtime observability. Dispatcher wired, classification + error events emitted. Validated via probe harness (attached).`
- **Gate**: `grep -q "2.70.0" VERSION` AND `grep -q "probe harness" CHANGELOG.md` AND `test -f .forge/validation/results-*.md` (at least one results file committed).

## Required Decisions

1. Where the in-process MCP client used by `forge_master_ask` lives — needs extracting into a module the HTTP route can import. Step2 should locate and name it.
2. Whether destructive-tool approval flows through HTTP at all in this phase, or stays in-IDE only (outline says in-IDE only; defer HTTP approval to a later phase).
3. Whether the probe harness becomes a CI check (probably yes, but out of scope for this phase).

## Forbidden Actions

- **Do not rename existing SSE events** (`start`, `reply`, `tool-call`, `done`, `error`). Only add new ones.
- **Do not leak raw provider errors** into SSE `error` events. Sanitize to `{ code, message, suggestion }`.
- **Do not bypass the tool allowlist** in the new dispatcher. The stub's "allow everything" posture was a bug, not a feature.
- **Do not skip the probe run** in Slice 4. This phase exists because we didn't validate runtime behavior before.
