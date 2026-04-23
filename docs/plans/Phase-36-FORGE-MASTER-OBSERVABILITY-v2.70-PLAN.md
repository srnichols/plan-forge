---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session rebuild plan)
hardened_at: 2026-04-23
---

# Phase-36 — Forge-Master Runtime Observability + Real Dispatcher

> **Target release**: v2.70.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-35 shipped (v2.69.0) — new lanes + prefs endpoints in place
> **Addresses**: Findings 2, 3, 4 from `.forge/validation/FINDINGS-2026-04-23.md`

---

## Specification Source

- **Field input**: Probe harness `scripts/probe-forge-master.mjs` against v2.68.1 produced a 24-probe report (see `.forge/validation/results-2026-04-23T02-01-29-488Z.md`). Three HTTP-route defects in [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs) `/stream` handler surfaced:
  1. **Stub dispatcher wired unconditionally**: `dispatcher: async () => ({})` at the call-site to `runTurn`. The dashboard chat requests tool calls but they execute as no-ops.
  2. **`result.error` swallowed**: when `runTurn` returns `{ reply: "", error, suggestion }` (no-provider path), the handler emits `sse.send("reply", { content: "" })` and discards `error` / `suggestion`. 13 of 24 probes hit this path — silent empty reply, no guidance.
  3. **`classification.lane` never emitted**: the handler surfaces `start → reply → tool-call → done`. The lane computed by `runTurn` is not streamed to the client, so no dashboard UI or harness can validate routing end-to-end.
- **Root cause**: Phase-28/29 shipped the HTTP wrapper as a UI facade; the real dispatcher and trace plumbing were deferred and never re-visited.
- **Architecture anchor**: Principle 7 (Evidence Over Assumption) — if the chat tab can't dispatch tools, it's a display-only wart, not a working feature. Principle 10 (Keep Gates Boring) — observability must be in place before keyword calibration (Phase-37) can be validated.
- **Probe harness contract**: this phase is done when `node scripts/probe-forge-master.mjs` against a local server shows ≥22/24 non-empty replies (errors acceptable only when `error` event carries a `suggestion`).

---

## Scope Contract

### In scope

- [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs) — `/stream` handler: emit `classification` event, emit `error` event on `result.error`, wire real dispatcher.
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) — `runTurn` accepts optional `deps.onClassification({lane,confidence})` callback; return object gains `classification: {lane, confidence}`.
- New `pforge-master/src/http-dispatcher.mjs` — factors the HTTP-request dispatcher (allowlist-gated in-process tool calls).
- [pforge-mcp/server.mjs](pforge-mcp/server.mjs) — export or expose the in-process MCP dispatcher so `http-routes.mjs` can use it.
- New `pforge-master/tests/http-routes-sse.test.mjs` — SSE ordering + error surfacing.
- New `pforge-master/src/__tests__/reasoning-classification-surface.test.mjs` — callback + return-field coverage.
- New `pforge-master/tests/http-dispatcher.test.mjs` — allowlist + destructive-class rejection + read-only pass-through.
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs) — parse new `classification` event into the lane-match summary.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.70.0 release metadata.
- Committed probe run: `.forge/validation/results-<ISO>.md` (requires `.forge/validation/` to be gitignored OR force-committed — confirm at Slice 4).

### Out of scope

- **Do NOT rename existing SSE events** (`start`, `reply`, `tool-call`, `done`, `error`). Only ADD new event types.
- **Do NOT expand classifier keyword coverage.** Phase-37's work.
- **Do NOT** add approval-required flow over HTTP for destructive tools. Destructive-class tools return a structured `{error: "destructive tool requires in-IDE confirmation", tool}` — HTTP approval is a future phase.
- **Do NOT** change in-IDE `forge_master_ask` tool behavior. The in-process MCP client stays the same; the HTTP route simply re-uses it.
- **Do NOT** change `pforge-master/src/intent-router.mjs` or `reasoning-tier.mjs`. This phase only touches the HTTP wrapper and reasoning-loop wiring.
- **Do NOT** add `--classification` to CLI tools.

### Forbidden actions

- **No stub dispatchers.** `async () => ({})` must not appear at the `runTurn` call-site in `http-routes.mjs`. Gate verifies via grep absence.
- **No leaked raw provider errors.** SSE `error` payloads sanitize to `{ code, message, suggestion }`. `apiKey`, full stack traces, provider internals are NOT acceptable in the payload.
- **No allowlist bypass.** The new `http-dispatcher.mjs` MUST check the tool name against `BASE_ALLOWLIST` (already defined in `http-routes.mjs`) before dispatching. Non-allowlisted calls return `{error: "tool not allowlisted", tool}`.
- **No skip in probe validation.** Slice 4 must run the harness live (server up, probes executed, results committed). No "tested locally, trust me" — that's the pattern meta-bug #96 fixed.
- **No grep-only gates on test files.** Every gate that references a `.test.mjs` file invokes `npx vitest run <file>`.

---

## Acceptance Criteria

### Criteria for Slice 1 — Emit `classification` + `error` SSE events

- **MUST**: `/stream` handler (both express and built-in-node paths in [pforge-master/src/http-routes.mjs](pforge-master/src/http-routes.mjs)) emits an SSE `classification` event with payload `{ lane: string, confidence: number }` AFTER `start` and BEFORE `reply` (or before `error` on the error path).
- **MUST**: When `result.error` is truthy from `runTurn`, the handler emits `sse.send("error", { code: <result.error>, message: <result.reply|null>, suggestion: <result.suggestion|null> })` INSTEAD OF `reply`. `done` still emits with `tokensIn: 0, tokensOut: 0`.
- **MUST**: On success, ordering is `start → classification → reply → tool-call* → done` (zero or more `tool-call` events).
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` contains at least 2 tests: (a) mock `runTurn` returns error-shape; assert `error` event with `suggestion` field is emitted and `reply` event is NOT. (b) Mock `runTurn` returns success-shape with classification; assert event ordering `start → classification → reply → done`.
- **MUST**: Existing tests in `pforge-master/tests/` continue to pass.
- **MUST**: Sanitization: SSE `error` payload does not include `apiKey`, stack traces, or provider-internal fields. Gate uses grep against the source file.

### Criteria for Slice 2 — Surface `classification` from `runTurn`

- **MUST**: `runTurn` in [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) accepts optional `deps.onClassification({lane, confidence})` callback. It fires exactly once per turn, immediately after `classify()` completes (before tool loop, before provider call, before OFFTOPIC short-circuit).
- **MUST**: `runTurn` return object includes `classification: { lane, confidence }` on ALL return paths: OFFTOPIC short-circuit, no-provider error, success, tool-loop truncation, rate-limit fallback.
- **MUST**: `pforge-master/src/__tests__/reasoning-classification-surface.test.mjs` contains at least 3 tests: (a) callback fires exactly once on successful turn, (b) return.classification populated on OFFTOPIC short-circuit, (c) return.classification populated on no-provider error path.
- **MUST**: `runTurn`'s existing return shape is preserved — new fields added, none removed or renamed.
- **MUST**: Phase-34 Slice 1 (`reasoning-tier.test.mjs`) and Phase-35 Slice 2 (`intent-auto-escalation.test.mjs`) tests remain green.

### Criteria for Slice 3 — Wire real dispatcher into `/stream`

- **MUST**: New file `pforge-master/src/http-dispatcher.mjs` exports `createHttpDispatcher({ allowlist, mcpCall })` returning `async (toolName, args) => result`.
- **MUST**: `createHttpDispatcher` returns `{ error: "tool not allowlisted", tool: toolName }` when `toolName` is not in `allowlist`.
- **MUST**: `createHttpDispatcher` returns `{ error: "destructive tool requires in-IDE confirmation", tool: toolName }` for any tool whose name matches the destructive-class pattern already defined in `http-routes.mjs` (`WRITE_ALLOWLIST` or equivalent — reuse the existing constant). Destructive tools are routed to approval in-IDE only; HTTP route does not handle approval in this phase.
- **MUST**: For read-only allowlisted tools, `createHttpDispatcher` invokes `mcpCall(toolName, args)` and returns the result.
- **MUST**: `/stream` handler imports `createHttpDispatcher`, instantiates it with `allowlist: BASE_ALLOWLIST` + `mcpCall: <in-process MCP invoker>`, and passes it as `dispatcher` to `runTurn`. The stub `async () => ({})` is removed.
- **MUST**: `pforge-master/tests/http-dispatcher.test.mjs` contains at least 3 tests: (a) non-allowlisted tool rejected, (b) destructive tool rejected, (c) read-only allowlisted tool dispatches via injected mcpCall and returns its result.
- **MUST**: The in-process MCP invoker is exposed from [pforge-mcp/server.mjs](pforge-mcp/server.mjs) (or a sibling module) as an importable function. This phase may factor out the `forge_master_ask` internal dispatcher into a small module if needed.
- **MUST**: Non-HTTP call-sites (in-IDE `forge_master_ask` tool) continue to use the same MCP dispatcher with no behavior change.

### Criteria for Slice 4 — Probe validation + release v2.70.0

- **MUST**: `scripts/probe-forge-master.mjs` updated to parse the new `classification` SSE event and restore the lane-match summary in the output Markdown. The harness caveats section is updated to reflect that `classification.lane` IS now emitted.
- **MUST**: A probe run against a live server (v2.70.0 candidate build) produces `.forge/validation/results-<ISO>.md` showing ≥22/24 probes with either a non-empty `reply` OR an `error` SSE event whose payload includes a `suggestion` string. Silent empty replies count as FAIL.
- **MUST**: Of the 18 non-`any`-lane probes, ≥12 lane-match (baseline 3/18). Full target lane-match ≥16/18 is the Phase-37 goal; Phase-36 only validates the observability wiring.
- **MUST**: `.forge/validation/results-<ISO>.md` is committed. If `.forge/validation/` is gitignored, override with `git add -f`.
- **MUST**: `VERSION` contains exactly `2.70.0`.
- **MUST**: `CHANGELOG.md` has a `[2.70.0] — 2026-04-23` section under `[Unreleased]` that includes the phrases: `classification` + `dispatcher` + `probe harness`.
- **MUST**: `ROADMAP.md` reflects Phase-36 / v2.70.0 as shipped.
- **MUST**: Git tag `v2.70.0` exists on the Slice 4 release commit.

### Quality bar

- **SHOULD**: Release commit message format `chore(release): v2.70.0 — Forge-Master runtime observability`.
- **SHOULD**: The probe harness output Markdown includes a "Classification match by lane" table sortable by accuracy.
- **SHOULD**: Dashboard UI updated to show the classified lane as a small badge next to replies (visual polish, not gate-enforced).

---

## Execution Slices

### Slice 1 — Emit `classification` + `error` SSE events

**Complexity**: 3 (modify two handlers in one file, write two tests).

**Files to modify**:
- `pforge-master/src/http-routes.mjs`

**Files to create**:
- `pforge-master/tests/http-routes-sse.test.mjs`

**Steps**:
1. Read `http-routes.mjs` — identify the `/stream` handler body in both `createHttpRoutes` (express path, ~line 85) and `_buildNodeHandler` (built-in path, ~line 180).
2. In both paths, before calling `runTurn`, set up a local capture: `let classificationData = null;`
3. Pass `deps.onClassification = (data) => { classificationData = data; sse.send("classification", data); }` to `runTurn`.
4. After `runTurn` resolves, branch:
   ```js
   if (result.error) {
     sse.send("error", {
       code: result.error,
       message: result.reply || null,
       suggestion: result.suggestion || null,
     });
     sse.send("done", { sessionId, tokensIn: 0, tokensOut: 0 });
   } else {
     // (If onClassification wasn't triggered — e.g., future path — fall back to result.classification)
     if (!classificationData && result.classification) {
       sse.send("classification", result.classification);
     }
     sse.send("reply", { content: result.reply, sessionId });
     for (const tc of result.toolCalls || []) sse.send("tool-call", tc);
     sse.send("done", { sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut });
   }
   ```
5. Delete or update the existing unconditional `sse.send("reply", ...)` path.
6. Write `pforge-master/tests/http-routes-sse.test.mjs`. Use a minimal mock express `app` + mock `res` that captures `write()` calls; parse SSE frames; assert ordering and payload shapes. Mock `runTurn` via vitest `vi.mock("../src/reasoning.mjs", ...)`.
7. Run the new test and full `pforge-master` suite to confirm no regressions.

**Validation gate**:
```bash
npx vitest run pforge-master/tests/http-routes-sse.test.mjs --reporter=default
```
AND
```bash
grep -q 'sse.send("classification"' pforge-master/src/http-routes.mjs
```
AND
```bash
grep -q 'apiKey\|stack' pforge-master/src/http-routes.mjs ; [ $? -ne 0 ]
```

**Commit**: `feat(http): emit classification + error SSE events`

---

### Slice 2 — Surface `classification` from `runTurn`

**Complexity**: 2 (one callback wiring, return-field propagation).

**Files to modify**:
- `pforge-master/src/reasoning.mjs`

**Files to create**:
- `pforge-master/src/__tests__/reasoning-classification-surface.test.mjs`

**Steps**:
1. Read `reasoning.mjs` around `runTurn` — identify classification point (post-`classify()` call).
2. Immediately after `classify()` returns, fire `deps.onClassification?.(classification)` (optional chaining — harmless when not provided).
3. Every `return { ... }` statement in `runTurn` gains `classification: classification` (or `null` if `classify()` was skipped — it shouldn't be, but guard).
4. Write `reasoning-classification-surface.test.mjs` with the 3 required tests:
   - (a) Mock provider + dispatcher stubs; assert `onClassification` called exactly once.
   - (b) Message is offtopic; assert `return.classification.lane === "offtopic"`.
   - (c) No provider available (deps.provider returns null); assert `return.classification` populated and `return.error` also populated.

**Validation gate**:
```bash
npx vitest run pforge-master/src/__tests__/reasoning-classification-surface.test.mjs --reporter=default
```
AND
```bash
npx vitest run pforge-master/src/__tests__/reasoning-tier.test.mjs pforge-master/src/__tests__/intent-auto-escalation.test.mjs --reporter=default
```

**Commit**: `feat(reasoning): surface classification via callback + return field`

---

### Slice 3 — Wire real dispatcher into `/stream`

**Complexity**: 4 (new module, allowlist plumbing, server.mjs export, integration).

**Files to create**:
- `pforge-master/src/http-dispatcher.mjs`
- `pforge-master/tests/http-dispatcher.test.mjs`

**Files to modify**:
- `pforge-master/src/http-routes.mjs` — remove stub `dispatcher: async () => ({})`; use `createHttpDispatcher`
- `pforge-mcp/server.mjs` — export the in-process MCP invoker used by `forge_master_ask` (factor to importable function if needed)

**Steps**:
1. Read `pforge-mcp/server.mjs` — locate how `forge_master_ask` currently invokes forge tools. Factor the in-process dispatch into a named export, e.g., `export async function invokeForgeTool(toolName, args) { ... }`.
2. Create `pforge-master/src/http-dispatcher.mjs`:
   ```js
   export function createHttpDispatcher({ allowlist, writeAllowlist, mcpCall }) {
     const allowSet = new Set(allowlist);
     const writeSet = new Set(writeAllowlist || []);
     return async function dispatch(toolName, args) {
       if (!allowSet.has(toolName)) {
         return { error: "tool not allowlisted", tool: toolName };
       }
       if (writeSet.has(toolName)) {
         return { error: "destructive tool requires in-IDE confirmation", tool: toolName };
       }
       return await mcpCall(toolName, args);
     };
   }
   ```
3. In `http-routes.mjs`, import `createHttpDispatcher` and `invokeForgeTool`. In both `/stream` paths, replace `dispatcher: async () => ({})` with a dispatcher instance created at module load:
   ```js
   const httpDispatcher = createHttpDispatcher({
     allowlist: BASE_ALLOWLIST,
     writeAllowlist: WRITE_ALLOWLIST,
     mcpCall: invokeForgeTool,
   });
   // ...
   const result = await runTurn({ message, sessionId }, { dispatcher: httpDispatcher, onClassification: ... });
   ```
4. Write `pforge-master/tests/http-dispatcher.test.mjs`:
   - (a) Dispatch with a non-allowlisted name returns `{error, tool}`.
   - (b) Dispatch with a `WRITE_ALLOWLIST` name returns destructive error.
   - (c) Dispatch with a read-only allowlisted name calls injected `mcpCall(name, args)` and returns its result.
5. Run all new and existing `pforge-master/tests/` tests.

**Validation gate**:
```bash
npx vitest run pforge-master/tests/http-dispatcher.test.mjs --reporter=default
```
AND
```bash
grep -E 'dispatcher:\s*async\s*\(\s*\)\s*=>\s*\(\s*\{\s*\}\s*\)' pforge-master/src/http-routes.mjs ; [ $? -ne 0 ]
```

**Commit**: `feat(http-dispatcher): real in-process tool dispatch for /stream`

---

### Slice 4 — Probe validation + release v2.70.0

**Complexity**: 3 (harness edits, live run, release metadata).

**Files to modify**:
- `scripts/probe-forge-master.mjs` — parse `classification` event, add lane-match summary
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`, package.json files (via version-bump)

**Files created during slice**:
- `.forge/validation/results-<ISO>.md` + `.json` (committed with `git add -f` since `.forge/` is gitignored)

**Steps**:
1. Update `scripts/probe-forge-master.mjs`: in the SSE parser, capture `event === "classification"` → store `{ lane, confidence }`. In the console output, replace `tokens=X/Y tools=Z` with `lane=<lane> conf=<conf> tokens=X/Y tools=Z`. Add a "Classification match" section to the Markdown report with a per-expected-lane accuracy table.
2. Update the harness caveats section — remove the "classification.lane not emitted" warning (now resolved); keep the stub-dispatcher caveat only if Slice 3's dispatcher fails some tools (unlikely).
3. Start the server: `node pforge-mcp/server.mjs` with `PLAN_FORGE_HTTP_PORT=3100`. Wait for "Plan Forge Dashboard at http://127.0.0.1:3100/dashboard".
4. Run: `node scripts/probe-forge-master.mjs --timeout=90`.
5. Inspect `.forge/validation/results-<ISO>.md`. Acceptance: ≥22/24 non-empty or carrying `suggestion`; ≥12/18 lane-match. If below, diagnose: stub still in place? classification event not firing? Fix before proceeding.
6. `git add -f .forge/validation/results-<ISO>.md .forge/validation/results-<ISO>.json`.
7. `.\pforge.ps1 version-bump 2.70.0 --strict`. Require `Updated 5/5`.
8. CHANGELOG `[2.70.0] — 2026-04-23` section must mention `classification`, `dispatcher`, `probe harness`. Include a link to the committed results file.
9. ROADMAP update. Commit with message `chore(release): v2.70.0 — Forge-Master runtime observability`. Tag `v2.70.0` and push.

**Validation gate**:
```bash
grep -q "^2.70.0$" VERSION
grep -q "\[2.70.0\]" CHANGELOG.md
grep -q "classification" CHANGELOG.md
grep -q "dispatcher" CHANGELOG.md
grep -q "probe harness" CHANGELOG.md
ls .forge/validation/results-*.md | head -1 | xargs -I{} grep -c "✅\|OK" {} | awk '{ if ($1 < 22) exit 1 }'
```

**Commit**: `chore(release): v2.70.0 — Forge-Master runtime observability`

---

## Execution Order

1 → 2 → 3 → 4. Slice 2's `onClassification` callback is consumed by Slice 1's handler — building Slice 1 first and mocking `runTurn` is simpler than reversing the order. Slice 3 is independent of 1/2. Slice 4 is release.

## Risks and Mitigations

- **Risk**: `invokeForgeTool` export from `server.mjs` creates an import cycle. *Mitigation*: the tool invoker is already in-process, no circular dependency expected. If a cycle surfaces, factor invoker into `pforge-mcp/tool-dispatcher.mjs` and import from both.
- **Risk**: The HTTP route has two code paths (express + built-in node handler) that drift. *Mitigation*: Slice 1 explicitly patches BOTH. Test coverage uses the express path; spot-check the node path manually.
- **Risk**: Probe count ≥22 target fails because reasoning provider rate-limits. *Mitigation*: use `gpt-4o-mini` (Phase-33 default via Copilot subscription). Full 24-probe run against Copilot has been shown to stay under per-minute limits in prior sessions.
- **Risk**: `results-*.md` file in `.forge/validation/` won't be visible on GitHub because `.forge/` is gitignored. *Mitigation*: `git add -f`. Note in CHANGELOG that the file is force-committed as an audit trail; future probe runs are transient by default.

## Session Break Points

- After Slice 3 if context is thin. Slice 4 requires a live server + probe run; safer in a fresh session where you can tail the server logs and diagnose any surprise failure without juggling prior context.
