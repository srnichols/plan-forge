---
crucibleId: e28f213e-37e5-4680-9506-d29976a6a53b
lane: full
source: human
---

# Phase-29 — Forge-Master Studio: Standalone Server, Web UI, Write Surface

> **Target release**: v2.62.0
> **Status**: Draft
> **Depends on**: v2.61.0 shipped (Phase-28 Forge-Master MVP). The reasoning loop, intent router, retrieval layer, tool bridge, system prompt, allowlist, persistence, provider adapters, and `forge_master_ask` MCP tool must all be in place and stable.
> **Branch strategy**: Direct to `master`. Primarily **extraction** (move code, do not rewrite) + **additive** (new package for reasoning, new dashboard tab in the existing `:3100` server, new write allowlist, approval gates, M365-Copilot-style prompt gallery). No behavioral changes to v2.61 `forge_master_ask` MCP tool except underlying process boundary.
> **Source**: Product decision 2026-04-20 — two-phase rollout agreed, no wasted work. Phase-28 proves the concept as an IDE-first MVP inside `pforge-mcp`; Phase-29 graduates it into a standalone reasoning package that continues to expose the IDE tool via stdio MCP **and** surfaces a browser chat experience as a new **top-level tab in the main Plan Forge dashboard** (same `:3100` process that already serves the dashboard today). Follow-up audit finding 2026-04-20 eliminated the previously-planned separate `:3102` HTTP server — the main dashboard already runs in the same Node process as the MCP server, so a second process was duplicated infrastructure.
> **Session budget**: 11 slices across **2 sessions** (Session 1: extraction + stdio proxy, 6 slices; Session 2: dashboard tab + prompt gallery + writes + ship, 5 slices)
> **Design posture**: **Zero rewrite.** Phase-28's `pforge-mcp/forge-master/*` modules move to `pforge-master/src/` and are consumed by the new package. `pforge-mcp/forge-master/` becomes a 5-line shim re-exporting from `pforge-master` (workspace-local dependency) so existing imports keep working. The only behavioral delta inside `pforge-mcp` is (a) the `forge_master_ask` MCP tool dispatcher proxies to a new stdio MCP server in `pforge-master` instead of calling in-process, and (b) the existing HTTP dashboard server grows a new tab "Forge-Master" plus `/api/forge-master/*` routes. Write allowlist + approval cards + M365-Copilot-style prompt gallery are net-new.

---

## Specification Source

- **Field input**: Owner explicitly endorsed two-phase rollout: "Phase 1 the Crucible-Conversationalizer, Phase 2 full Forge-Master power." Explicit criterion: "no wasted work" — every line written in Phase-28 is reused verbatim in Phase-29. Follow-up direction 2026-04-20: "Forge-Master should have its own top-level tab in the dashboard, beside a nice large text window to work with; we should have lots of pre-baked helper prompts and tools in the Forge-Master screen — a lot like M365 Copilot has."
- **Diagnostic anchor — why the separate `:3102` server was removed**: An audit of the existing dashboard revealed that `mcp/dashboard/index.html` is already served by `pforge-mcp/server.mjs` on `http://localhost:3100/dashboard`, in the **same Node process** that hosts the MCP stdio server. A second HTTP process on `:3102` would duplicate the server plumbing (routing, SSE, static assets) for zero architectural gain and would force the owner to juggle two browser tabs. Adding a top-level tab to the existing dashboard is strictly simpler, gives the owner the single-pane experience they asked for, unifies session state and notifications, and deletes an entire process lifecycle concern from the plan.
- **Diagnostic anchor — why a separate package still exists**: Even with the UI folded into the main dashboard, the reasoning engine graduates into `pforge-master/` for four reasons:
  1. **Separation of concerns**: Reasoning + tool-use loop + provider adapters + prompt gallery are a distinct product surface from the MCP tool dispatcher. Keeping them in a sibling workspace package prevents `pforge-mcp` bloat and makes the reasoning engine independently testable.
  2. **Stdio MCP boundary for IDE**: IDE agents still call `forge_master_ask` over stdio MCP; the natural home for that server is inside the package that owns the reasoning loop. `pforge-master/server.mjs` exposes exactly one tool via stdio MCP.
  3. **Downstream MCP composition**: `pforge-master` is an MCP **client** of `pforge-mcp` via `mcp-client.mjs` — tool calls route through the protocol rather than via tightly-coupled imports. This is the cleanest separation of reasoning from execution.
  4. **Dependency hygiene**: Prompt gallery, approval state machine, and provider adapters pull in dev/runtime code that `pforge-mcp` does not need. A sibling package keeps `pforge-mcp` lean.
- **Architecture anchor**: Phase-28 artifacts under `pforge-mcp/forge-master/` move to `pforge-master/src/`. New files are `pforge-master/server.mjs` (stdio MCP only — no HTTP), `pforge-master/src/mcp-client.mjs` (spawns `pforge-mcp/server.mjs` as downstream MCP), `pforge-master/src/approvals.mjs` (write gate + batch preview), `pforge-master/src/hub-subscriber.mjs` (live run overlay), `pforge-master/src/prompts.mjs` (M365-style prompt gallery catalog). The browser UI is added to the existing dashboard at `mcp/dashboard/forge-master-tab.html` (HTML fragment loaded by the SPA) plus `mcp/dashboard/forge-master.js` (tab controller). HTTP/SSE routes for chat, approval, and prompt-gallery are added to the existing `pforge-mcp/server.mjs` HTTP server under `/api/forge-master/*`.
- **Explicit non-goal reaffirmed**: No code generation. Ever. Forge-Master Studio can approve-and-run an existing plan, but it never writes application code. That line is forever.

---

## Feature Specification

### Problem Statement
Phase-28 gave the owner a smart in-IDE assistant. It cannot be used from a browser, cannot ideate while watching a live run, cannot approve-and-run a plan, and cannot surface approval cards when the model proposes a write action. The IDE is not the only place the owner wants to think — sometimes ideation happens in a browser tab alongside the dashboard, sometimes at the end of a run while reviewing slice output. The MVP also deliberately withholds write tools behind allowlist rejection; in practice the owner frequently needs to say "ok, go run Phase-X" or "finalize this Crucible smelt" from inside the conversation. Phase-29 delivers: (a) a standalone `pforge-master/` reasoning package that owns the tool-use loop, providers, approvals, and prompt gallery; (b) a stdio MCP server in that package that IDE agents continue to call via `forge_master_ask` (now proxied, same schema); (c) a new **"Forge-Master" top-level tab in the existing Plan Forge dashboard** on `http://localhost:3100/dashboard`, rendered alongside Progress / Runs / Cost / Actions / Replay / Extensions / Config, with a large chat pane as the centerpiece and an **M365-Copilot-style prompt gallery** of curated one-click starter prompts organized by domain; (d) a write-capable tool allowlist gated by **batch-preview approval cards** shown in the dashboard and as MCP prompts; (e) live hub event overlay so slice-started / slice-completed / cost-accrued events stream into the chat while the model reasons about them; (f) dynamic extension-tool discovery so new capabilities installed via `pforge ext add` surface to Forge-Master automatically. All while reusing 100% of Phase-28's reasoning/router/retrieval/bridge/persistence code — zero rewrite. Deliberate scope deletion from the prior draft: the separate `:3102` HTTP server, the standalone UI at `pforge-master/ui/`, and the `pforge forge-master start|stop` process lifecycle CLI. The main dashboard already runs in the same process as the MCP server; folding the UI in is the simpler and UX-superior path.

### User Scenarios
1. **Dashboard-based ideation with live context** — Owner opens `http://localhost:3100/dashboard` and clicks the new top-level **Forge-Master** tab (rightmost in the tab bar, alongside Progress / Runs / Cost / Actions / Replay / Extensions / Config). The tab shows a three-pane layout: (left) M365-Copilot-style prompt gallery with 7 categorized tiles, (center) a large multi-line text composer plus chat stream with token-level streaming, (right) tool-call trace. Owner clicks the **"Troubleshooting"** category, picks *"Phase-NN Slice X failed — what's the root cause?"* from the gallery, the prompt populates the composer with `Phase-` and `Slice ` placeholders highlighted; owner fills them and submits. Forge-Master calls `forge_watch_live`, reads `brain.recall("project.incidents.open")`, and `forge_bug_list`, then answers with a grounded evidence trail. Session history persists in L1.
2. **IDE-to-Studio proxying (backward-compatible)** — Owner is in VS Code, invokes `forge_master_ask({message: "status of my plan"})` exactly as in Phase-28. The IDE-side dispatcher in `pforge-mcp/server.mjs` now forwards to the `pforge-master` package's stdio MCP server via a persistent child process (spawned on first demand, kept warm). Response schema is byte-identical to v2.61. If the stdio MCP child cannot be started (e.g. package not installed), the dispatcher falls back to **in-process reasoning** using the shim-re-exported modules. Owner never sees a breakage — only a slight first-turn latency difference while the child warms.
3. **Batch-preview approval for chained writes** — Owner types "run Phase-28 from slice 4, then re-run cost report" into the dashboard composer. Model proposes a sequence of 2 tool calls. An approval card appears inline in the chat stream showing **both** calls as a preview: `1. forge_run_plan(..., resumeFrom: 4) 2. forge_cost_report()`. Owner clicks a single **Approve** button, both execute in sequence, first-failure aborts the rest. This is the single-approval-for-a-plan pattern, not per-call approvals.
4. **Live run overlay in the tab** — Owner is chatting with Forge-Master in the dashboard tab while `pforge run-plan` is running in another terminal. As the run emits `slice-started`, `slice-completed`, `slice-failed` events on port 3101, the existing dashboard hub connection already surfaces those events on the Progress tab — and the Forge-Master tab subscribes to the same stream to render lightweight event cards inline in the chat. Owner can ask "why did slice 3 just fail?" and Forge-Master already has the event context — retrieval layer injects the freshest hub events into the prompt.
5. **Prompt gallery discovery of an untapped capability** — Owner has never used the tempering coverage scanner. On the Forge-Master tab, the **"Testing & Quality"** category exposes a tile *"What's my test coverage gap?"*. Owner clicks it, gets a grounded answer from `forge_tempering_scan` + `forge_tempering_status`, and discovers a capability they had not explored. The gallery is the discovery surface for the 64-tool system that the owner explicitly wanted.

### Acceptance Criteria

**Extraction (zero-rewrite constraint)**
- **MUST**: New package `pforge-master/` exists at the repo root as a workspace member. `package.json` declares `"type": "module"`, `dependencies: { "@modelcontextprotocol/sdk": "^1.0.0", "@pforge/pforge-mcp": "workspace:*" }`. No rewriting of Phase-28 modules — they move, they do not get retyped.
- **MUST**: All Phase-28 artifacts move verbatim: `pforge-mcp/forge-master/reasoning.mjs` → `pforge-master/src/reasoning.mjs`, plus `intent-router.mjs`, `retrieval.mjs`, `tool-bridge.mjs`, `persistence.mjs`, `allowlist.mjs`, `system-prompt.md`, `providers/*`, `__fixtures__/*`. Git `mv` is used so blame history is preserved.
- **MUST**: `pforge-mcp/forge-master/index.mjs` becomes a shim re-exporting every public symbol from `pforge-master/src/index.mjs` (workspace dep). This guarantees existing `pforge-mcp/server.mjs` imports of the reasoning module keep compiling and tests keep passing without import-path churn in Phase-28 test files.
- **MUST**: All Phase-28 test files (`pforge-mcp/tests/forge-master.test.mjs`, `pforge-mcp/tests/forge-master.integration.test.mjs`) continue to pass **unmodified**. If a test needs to change, that is a rewrite and violates the zero-rewrite constraint — either the extraction is wrong, or the test is obsolete. Document the exception in the slice commit message.

**Second MCP server (stdio transport only)**
- **MUST**: `pforge-master/server.mjs` starts a stdio-only MCP server (no HTTP mode in Phase-29) exposing exactly one tool `forge_master_ask` with schema byte-identical to the Phase-28 registration. Internally it runs the same `reasoning.runTurn` loop. Invocation: `node pforge-master/server.mjs` with optional `--self-test` flag.
- **MUST**: Second MCP server spawns `pforge-mcp/server.mjs` as a **downstream MCP client** via `pforge-master/src/mcp-client.mjs` and uses the discovered tool list to satisfy allowlisted tool calls. No direct imports of `pforge-mcp` internal tool handlers — all tool invocations go through the MCP protocol. This is what makes `pforge-master` a proper MCP composition rather than a tightly-coupled consumer.
- **MUST**: On startup, `mcp-client.mjs` calls `tools/list` on the downstream server, asserts the count is ≥ base-allowlist size (plus any dynamically registered extensions), and logs `forge-master: downstream MCP ready (N tools, M allowlisted)`.
- **MUST**: Proxy path in `pforge-mcp/server.mjs` — when the dispatcher receives `forge_master_ask`, it spawns (or reuses a warm) `pforge-master/server.mjs` child process over stdio MCP on first call and routes subsequent calls to the warm child. Child process lifecycle is managed by `pforge-mcp/server.mjs` (not by the owner). When the child cannot be started (spawn error, package missing), the dispatcher falls back to **in-process** reasoning via the shim re-exports. One boolean branch, two code paths that share the same reasoning loop module.
- **MUST**: The warm child process is terminated when `pforge-mcp/server.mjs` itself shuts down (SIGTERM propagation via `child.kill()`). No stale children left behind. Child stderr is tee'd to `.forge/forge-master-stdio.log` for debugging.

**Dashboard tab integration (main `:3100` dashboard)**
- **MUST**: `mcp/dashboard/index.html` gains a new top-level tab **"Forge-Master"** alongside the existing tabs (Progress, Runs, Cost, Actions, Replay, Extensions, Config). Tab label text: "Forge-Master". Positioned rightmost in the tab bar. Follows the existing `.tab-btn` / `.tab-active` pattern and uses a `data-tab="forge-master"` attribute.
- **MUST**: Tab content loaded from `mcp/dashboard/forge-master-tab.html` (an HTML fragment appended to the dashboard DOM) + `mcp/dashboard/forge-master.js` (tab controller, ES module). Both files live in the existing `mcp/dashboard/` directory — no separate UI package. Style consistent with other tabs: Tailwind CDN, vanilla JS, no build step.
- **MUST**: Three-pane layout within the tab:
  - **Left pane (prompt gallery, ~280px wide)** — collapsible sidebar showing the M365-Copilot-style prompt catalog. 7 category tabs (Plan Status / Troubleshooting / Ideation / Cost / Testing / Memory / Extensions) with ~5 one-click prompt tiles each. Clicking a tile populates the center composer; placeholders inside a tile (e.g. `Phase-NN`, `Slice X`) are highlighted for the owner to fill in. Includes a text-search filter across tile titles + descriptions.
  - **Center pane (chat, flex-grow)** — large multi-line composer (min 120px tall, auto-grow to 400px) at the bottom with `Ctrl+Enter` submit; above it, a chat stream rendering token-level streaming from SSE, inline tool-call trace collapsibles, inline approval cards, and inline hub-event cards during active runs. Session picker dropdown at the top of the pane. New-chat button.
  - **Right pane (tool-call trace, ~320px wide, collapsible)** — real-time list of each tool invocation in the active turn, each entry showing `tool name · args preview · duration · cost · status`. Click to expand full result JSON.
- **MUST**: HTTP/SSE routes added to the existing `pforge-mcp/server.mjs` HTTP server (the one already serving `/dashboard` on `:3100`). Routes, all under `/api/forge-master/`:
  - `GET /api/forge-master/prompts` → returns the prompt gallery catalog (JSON).
  - `GET /api/forge-master/sessions` → returns list of recent session IDs with first-message previews and timestamps (for the session picker).
  - `POST /api/forge-master/chat` `{message, sessionId?, promptId?}` → returns `{sessionId, streamUrl}`; if `promptId` provided, server records the source for analytics.
  - `GET /api/forge-master/chat/:sessionId/stream` → SSE stream of reply tokens + tool-call events + approval-card events + hub-event cards.
  - `POST /api/forge-master/chat/:sessionId/approve` `{approvalId, decision: "approve"|"deny"|"edit", editedArgs?}` → resumes a paused turn.
  - `GET /api/forge-master/capabilities` → returns `{reasoningModel, routerModel, allowlistedTools: [...], writeAllowlist: [...], promptCategories: [...]}` for the UI to render correctly.
- **MUST**: Server-side request handler module `pforge-mcp/forge-master-routes.mjs` — thin adapter that imports from `@pforge/pforge-master` and registers the routes on the existing HTTP server. Registration is conditional on `forgeMaster.dashboardTab` config (default `true`). When disabled, the tab hides and the routes 404.
- **MUST**: No new port opened. No new process spawned for the UI. No separate `:3102` server. No CLI lifecycle commands for a UI process. The dashboard lifecycle IS the UI lifecycle.
- **MUST**: Loopback-only safety inherited from the existing dashboard server — if the operator already exposed `:3100` to non-loopback, the warning is the operator's problem (same as today). No new bind-address surface introduced in Phase-29.
- **MUST**: UI auth is **out of scope**. Personal-use loopback tool. Document explicitly in `docs/COPILOT-VSCODE-GUIDE.md` and `README.md`.

**Prompt gallery (M365 Copilot style)**
- **MUST**: Prompt catalog lives at `pforge-master/src/prompts.mjs` and exports `getPromptCatalog() → {version, categories: [...]}`. Catalog is plain data — no code — so it can be extended without touching reasoning logic. Each prompt object: `{id, title, description, template, placeholders: [{name, hint, example}], suggestedTools: [tool names], category}`.
- **MUST**: Seven categories with a minimum of 30 prompts total across them. Each prompt is grounded in one or more allowlisted tools (enforced by a unit test that verifies every `suggestedTools[i]` is present in the resolved allowlist).
  1. **Plan Status & Operations** (≥ 5 prompts) — e.g. "Show my last 3 plan runs and which slices failed", "Total Plan Forge spend this month", "In-progress Crucible smelts", "Health trend + anomalies this week", "Triage open incidents by impact". Grounded in `forge_plan_status`, `forge_cost_report`, `forge_crucible_list`, `forge_health_trend`, `forge_alert_triage`.
  2. **Troubleshooting & Diagnosis** (≥ 5 prompts) — "Phase-NN Slice X failed — root cause?", "Check setup health", "Outdated dependencies", "All deferred work (TODOs) in my plans", "Worst failure-rate slices last month". Grounded in `forge_watch_live`, `forge_smith`, `forge_dep_watch`, `forge_search`, `forge_timeline`, `forge_bug_list`.
  3. **New Feature Ideation (→ Crucible)** (≥ 5 prompts) — "I want to add <FEATURE> — scope and phase it", "Design <PATTERN> — trade-offs and phases", "Migrate <X> to <Y> — scope it out", "Error-handling architecture for <DOMAIN>", "Real-time notifications — trade-offs". Grounded in `forge_crucible_submit`, `forge_crucible_ask`, `forge_crucible_preview`, `brain_recall`.
  4. **Cost & Quorum Analysis** (≥ 4 prompts) — "4-model quorum cost for Phase-NN", "Best cost-to-accuracy models", "Cost trends last 3 months", "Multi-model cost for all my plans". Grounded in `forge_cost_report`, `forge_estimate_quorum`, `forge_quorum_analyze`.
  5. **Testing & Quality** (≥ 4 prompts) — "Test coverage gap", "Slowest tests / runtime budget", "Visual-diff anomalies", "Approve tempering baseline for future runs" (write — surfaces an approval card). Grounded in `forge_tempering_scan`, `forge_tempering_status`, `forge_tempering_approve_baseline`.
  6. **Memory & Knowledge** (≥ 4 prompts) — "Similar phases I've built", "Database migration decisions from past projects", "Mistakes I made in Phase-NN", "Recent decision digests — themes". Grounded in `brain_recall`, `forge_memory_report`, `forge_search`.
  7. **Extensions & Integrations** (≥ 3 prompts) — "Available extensions", "Multi-tenancy extension", "Installed extensions + capabilities". Grounded in `forge_ext_search`, `forge_ext_info`, `forge_capabilities`.
- **MUST**: Prompt gallery UI rendering requirements — category tabs with counts; each prompt tile shows `title` prominently (≤ 60 chars) and `description` muted (≤ 120 chars); placeholder fields in `template` wrapped as `<PLACEHOLDER_NAME>` and syntax-highlighted in the composer; tile click inserts `template` into the composer, moves caret to the first placeholder, and persists "last-used" ordering per category in `localStorage`.
- **MUST**: Text search across prompt titles + descriptions + categories with debounce 150ms; results highlight match substrings; empty-state copy when no matches.
- **MUST**: `GET /api/forge-master/prompts` returns the full catalog as JSON. Cache for 60s server-side (the catalog is static).
- **MUST**: Unit test `pforge-master/tests/prompts.test.mjs` asserts: (a) ≥ 30 prompts total, (b) ≥ minimum-per-category, (c) every `suggestedTools[i]` is in the Phase-29 resolved allowlist (read + write), (d) no prompt references a write tool without flagging `requiresApproval: true` in the prompt object, (e) no duplicate `id` values, (f) every `placeholders[i].name` appears in the corresponding `template`.
- **SHOULD**: Owner-defined custom prompts via `.forge/forge-master-prompts.json` — loaded at startup, merged under a `"Custom"` category if the file exists. Optional; the catalog works without it.
- **MAY**: Analytics — track prompt-tile click counts in `.forge/forge-master-prompt-stats.jsonl` for future "most-used" surface. No external telemetry.

**Write allowlist + approval cards**
- **MUST**: Phase-29 introduces a **second, larger allowlist** in `pforge-master/src/allowlist.mjs`: the Phase-28 base read-allowlist (~38 tools) **plus** the Phase-29 write-additions — `forge_run_plan`, `forge_crucible_finalize`, `forge_bug_register`, `forge_bug_update_status`, `forge_tempering_approve_baseline`, `forge_new_phase`, `forge_incident_capture`, `forge_fix_proposal`, `forge_run_skill`, `forge_review_add`, `forge_review_resolve`, `forge_notify_send`, `forge_notify_test`, `forge_memory_capture`. Every tool in the write-additions list is tagged `requiresApproval: true` and `severity: "write"|"destructive"`. Write tools explicitly still excluded from Phase-29: `forge_delegate_to_agent` (needs a separate delegation contract phase), `forge_testbed_run` (experimental infrastructure), `forge_generate_image` (low-value for the target use case). These may graduate in a future phase.
- **MUST**: When the reasoning loop proposes a tool call on an approval-tagged tool, `tool-bridge.mjs` **pauses** the turn and emits an `approval-required` event with a UUID. The event is broadcast on the SSE stream (dashboard tab renders an approval card) AND on the MCP response when proxied to IDE (as a `sampling/promptUser`-style notification — IDE surfaces prompt to user, user answers, IDE sends `POST /api/forge-master/chat/:sessionId/approve`).
- **MUST**: **Batch preview.** When the model proposes multiple sequential tool calls in the same reasoning step and ≥ 1 is approval-tagged, the approval card shows the **entire proposed sequence** and asks for a single approval. On approve, the full sequence executes; first-failure aborts remainder with a structured error. On deny, none execute. On edit, the user can edit arguments for any step before approving. Read-only tools interleaved in a batch with writes do NOT require their own approval but ARE shown in the preview for transparency.
- **MUST**: Approval timeout is 300 seconds (5 minutes). On timeout the turn ends with `{error: "approval_timeout"}` and session history records the timed-out approval. Configurable via `forgeMaster.approvalTimeoutSec`.
- **MUST**: Destructive-class approvals (any tool tagged `severity: "destructive"` — currently `forge_run_plan`, `forge_crucible_finalize`, `forge_new_phase`) render with a red-tinted card and require a **typed confirmation** (the owner must type the tool name or a specific confirm phrase into an input field on the card) before the Approve button activates. Other write tools are one-click approve.
- **MUST**: Approval events are written to `.forge/forge-master-approvals.jsonl` for audit. Schema: `{timestamp, sessionId, approvalId, tools: [{name, args, severity}], decision, editedArgs?, decidedBy: "user-ui"|"user-ide"|"timeout", confirmationInput?}`.

**Live hub overlay**
- **MUST**: `pforge-master/hub-subscriber.mjs` connects to `ws://localhost:3101` on startup (hub port from `pforge-mcp/hub.mjs`), subscribes to the event stream, and re-broadcasts relevant events (slice-started, slice-completed, slice-failed, run-started, run-completed, run-aborted, cost-accrued) onto the Studio's SSE stream. UI renders these as event cards inline with the active chat stream (if any). If no chat is active, events accumulate in the active-runs panel.
- **MUST**: Hub events are also injected into `retrieval.mjs` context as an L1.5 tier: the most recent 10 events are appended to the `## Current Context` block under a `### Recent Operational Events` subsection. This is what lets the owner say "why did slice 3 fail?" and have the model already know about the failure.
- **MUST**: If the hub is not reachable, Studio logs `hub unreachable (port 3101) — live overlay disabled` once and proceeds without. Not a startup error.

**CLI surface (trimmed — no separate process lifecycle)**
- **MUST**: No `pforge forge-master start|stop` process-lifecycle CLI. The dashboard tab IS the UI lifecycle; the stdio MCP server is spawned on demand by `pforge-mcp/server.mjs`. There is nothing for the owner to start or stop manually.
- **MUST**: One new read-only CLI subcommand `pforge forge-master status` dispatched in `pforge.ps1`, `pforge.sh`, and `cli-schema.json`. Reports: whether the dashboard tab is enabled (`forgeMaster.dashboardTab` config), warm-child PID if running, reasoning model name, router model name, allowlist size, prompt-gallery version, last approval timestamp. Human-readable output plus `--json`.
- **MUST**: One new CLI subcommand `pforge forge-master logs [-n 50]` to tail `.forge/forge-master-stdio.log` (the warm-child stderr capture).
- **MUST**: Dashboard tab can be disabled via `.forge.json` → `forgeMaster.dashboardTab: false` without uninstalling the package. When disabled, `/api/forge-master/*` routes 404 and the tab is hidden from the dashboard DOM.

**Config**
- **MUST**: `forgeMaster` `.forge.json` block gains new keys: `dashboardTab` (default `true`), `approvalTimeoutSec` (default `300`), `writeAllowlist` (array, defaults to the Phase-29 superset), `liveOverlay` (default `true`), `discoverExtensionTools` (inherited from Phase-28, default `true`), `customPromptsFile` (default `.forge/forge-master-prompts.json`). Phase-28 keys carry forward unchanged. Removed from Phase-29 (were in the prior draft): `bindAddress` (no new server), `port` (no new port).
- **MUST**: All Phase-28 config tests (config-loader fallback chain) pass unchanged.

**Capabilities + docs**
- **MUST**: `forge_capabilities` output surfaces `forgeMaster.studio: {dashboardTabEnabled: boolean, reasoningModel, routerModel, resolvedAllowlistCount, writeAllowlistCount, promptCatalogVersion, promptCount}` so IDE agents can tell what is available.
- **MUST**: `setup.ps1` + `setup.sh` register a second MCP server entry `forge-master` in `.vscode/mcp.json` (and Cursor / Codex equivalents) following the existing extension-merge pattern. Entry points to `node pforge-master/server.mjs` (stdio). Optional — enabled when `forgeMaster.autoRegisterMcp` is true (default true).
- **MUST**: `docs/COPILOT-VSCODE-GUIDE.md` gains a "Forge-Master Studio" section covering: finding the tab on `:3100/dashboard`, the prompt gallery, approval UX, the typed-confirmation pattern for destructive ops, how IDE and dashboard surfaces share sessions.
- **MUST**: `README.md` Quick Commands block gains `# Forge-Master dashboard tab: http://localhost:3100/dashboard#forge-master` line and notes the tab is on by default.
- **MUST**: `CHANGELOG.md` v2.62.0 section explains extraction + dashboard tab + prompt gallery + write surface + proxy path + live overlay + the deliberate removal of the `:3102` server.
- **MUST**: Version bumps — `VERSION` → `2.62.0`, both `pforge-mcp/package.json` and new `pforge-master/package.json` → `2.62.0`. Tag `v2.62.0` pushed, GitHub release `--latest`, post-release bump to `2.62.1-dev`.

**Test surface**
- **MUST**: New test file `pforge-master/tests/routes.test.mjs` with ≥ 10 tests: all `/api/forge-master/*` routes, approval flow (pause → approve → resume), approval timeout, batch preview with mixed read/write calls, destructive typed-confirmation gate, prompts endpoint payload shape, sessions endpoint.
- **MUST**: New test file `pforge-master/tests/mcp-proxy.test.mjs` with ≥ 6 tests: proxy path with warm child, in-process fallback when child spawn fails, response schema byte-identical in both modes, stdio MCP handshake with downstream `pforge-mcp`, warm-child SIGTERM propagation, stderr tee to `.forge/forge-master-stdio.log`.
- **MUST**: New test file `pforge-master/tests/hub-subscriber.test.mjs` with ≥ 4 tests: subscribe on startup, receive and re-broadcast events, graceful degrade when hub absent, event injection into retrieval context.
- **MUST**: New test file `pforge-master/tests/prompts.test.mjs` with ≥ 8 tests: catalog loads, ≥ 30 prompts, ≥ minimum-per-category, no duplicate IDs, all `suggestedTools` in resolved allowlist, placeholder names appear in template, custom-prompts merge when file present, write-tool prompts flagged `requiresApproval: true`.
- **MUST**: New test file `pforge-mcp/tests/forge-master-tab.test.mjs` with ≥ 4 tests: dashboard HTML includes Forge-Master tab button when config enabled, tab hidden when `dashboardTab: false`, tab fragment loads without errors, `/api/forge-master/capabilities` returns expected payload shape.
- **MUST**: Full vitest suite across both packages stays green. Baseline is v2.61 + whatever Phase-28 added. New minimum: Phase-28 baseline + 32 Phase-29 tests.

**Agent guidance**
- **MUST**: `.github/copilot-instructions.md` "Talking to Forge-Master" section expanded with: (a) how to tell if the dashboard tab is enabled (`forge_capabilities.forgeMaster.studio.dashboardTabEnabled`), (b) write actions require approval — agents must not retry on approval denial, (c) batch-preview pattern: propose the full sequence in one reasoning step rather than drip-feeding calls, (d) destructive ops (`forge_run_plan`, `forge_crucible_finalize`, `forge_new_phase`) require typed confirmation in the UI — IDE fallback path should surface this as a second prompt. Same expansion in `templates/copilot-instructions.md.template`.

### Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| Owner invokes `forge_master_ask` in IDE while Studio is down | Dispatcher logs `studio unavailable, running in-process`, proceeds with in-process reasoning (Phase-28 behavior). Response schema unchanged. |
| Owner starts Studio but port 3102 is in use | Startup fails with `port 3102 in use (PID X holds it). Override with forgeMaster.port or stop the other process.` Non-zero exit. PID file not written. |
| Studio crashes mid-turn | SSE stream closes with `event: error\ndata: {"error":"studio_crashed"}`. UI shows reconnect banner. Owner restarts via CLI. No data loss — L1 history was persisted per-turn. |
| Approval card served to UI but owner answers in IDE instead | First decision wins (either UI POST or IDE `POST /chat/:sessionId/approve`). Second attempt returns `{error: "approval_already_decided"}`. |
| Batch preview contains 5 writes + 2 reads. Approval denied. | None execute. Session history records full proposed batch + deny decision. Model sees "user denied the proposed batch" and must re-plan. |
| Batch preview step 2 fails during execution | Abort step 3+. Steps 1 (success) and 2 (failure) result reported back to model. Session + approval log record partial execution. |
| Reasoning model proposes same approval-required tool call twice in a row (loop) | Approval cache is per-turn only — second call gets a second approval card. Agents should batch, not loop. Document this in agent guidance. |
| Owner runs `pforge forge-master start` but no `forgeMaster.reasoningModel` configured and no API key env var set | Studio starts anyway — the HTTP server works, but any chat attempt returns `{error: "reasoning_model_unavailable"}` until config is fixed. This matches Phase-28 behavior. |
| Hub on 3101 is unreachable | Live overlay disabled; logged once. Chat still works. Retrieval context omits the "Recent Operational Events" subsection. |
| UI opened from a second browser tab | Two SSE streams, both get the same broadcast. Session is shared if same `sessionId` cookie/storage. No multi-user isolation (out of scope — personal tool). |
| Proxy MCP call exceeds MCP transport max message size | Response truncated at transport layer. Studio must keep final reply bodies under 64KB. Long tool outputs are already summarized to 2000 chars in Phase-28's tool-bridge. |

### Out of Scope
- Code generation in any form. Permanent non-goal.
- Multi-user auth, session sharing, SSO, OAuth. Personal loopback tool only.
- Mobile app, native desktop app, Electron shell.
- Voice input / TTS output.
- Fine-tuning a bespoke model.
- Extending memory tiers or modifying `brain.mjs` — Phase-28 consumer pattern continues.
- Extending `pforge-mcp` tool surface (no new `forge_*` tools added in Phase-29). All new behavior lives in the Studio.
- Extending Crucible question banks or changing Crucible state machine.
- Production deployment recipes (Docker image, k8s manifest, Azure App Service) — that is a separate future phase if ever.
- Rebranding, renaming, or changing Plan Forge's package names or CLI names.
- Replacing the dashboard (`mcp/dashboard/`) with Forge-Master. They are distinct surfaces.

### Forbidden Actions
- `git push --force`, `git reset --hard origin/master`, deletion of `refs/heads/master`.
- Editing Phase-28 test files (`pforge-mcp/tests/forge-master.test.mjs`, `pforge-mcp/tests/forge-master.integration.test.mjs`) in a way that changes test intent. Path updates after `git mv` are permitted only when strictly required — annotate in commit message. If you find yourself changing test bodies, stop: the extraction is wrong, not the test.
- Rewriting any Phase-28 module in `pforge-master/src/*`. Moves only. Bugfixes permitted with explicit justification per-slice; refactors forbidden.
- Editing `pforge-mcp/crucible*.mjs`, `pforge-mcp/brain.mjs`, `pforge-mcp/cost-service.mjs`, `pforge-mcp/orchestrator.mjs` provider registry. All dependencies remain consumer-only.
- Adding a new provider to the orchestrator registry.
- Adding authentication of any kind to the HTTP server in v2.62.0. (Deliberate — loopback-only is the v2.62 safety model.)
- Exposing `forge_run_plan` or other write tools via the IDE-side `forge_master_ask` without the approval-card flow. If an IDE agent calls `forge_master_ask` and the model proposes a write, the approval card MUST be surfaced to the IDE (via MCP sampling prompt or equivalent), not silently approved.
- Launching Studio on a non-loopback bind address without the startup warning log. Silent LAN exposure is forbidden.
- Skipping the approval audit log write. Every approval decision (approve/deny/timeout) MUST be appended to `.forge/forge-master-approvals.jsonl`.
- Running Slice 12 (ship) before all earlier slices pass gates, all Phase-28 tests still pass, and new test count is ≥ 20.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1 | Extraction target — monorepo workspace vs git submodule vs separate repo | ✅ Resolved | **Monorepo workspace** — `pforge-master/` is a sibling of `pforge-mcp/` and a workspace member. Shared tooling, shared CI, shared version. |
| D2 | Shim strategy for Phase-28 imports | ✅ Resolved | **Re-export shim.** `pforge-mcp/forge-master/*` becomes one-line re-exports. Phase-28 tests and any other consumers keep working without import-path churn. |
| D3 | Proxy vs duplicated handler for `forge_master_ask` in `pforge-mcp/server.mjs` | ✅ Resolved | **Proxy when Studio up, in-process when down.** Single source of truth (Studio's reasoning loop) when both sides agree; graceful fallback when Studio is not running. Detection via `.forge/forge-master.pid` + liveness check. |
| D4 | Approval UX — per-call vs batch preview | ✅ Resolved | **Batch preview.** Encourages the model to plan full sequences and cuts owner friction. Per-call approvals proved annoying in prior design discussion. |
| D5 | Approval surface in IDE — MCP sampling prompt vs async HTTP callback | ✅ Resolved | **MCP sampling prompt** (`prompts/sampling` or equivalent notification). IDE-native, no browser required. Falls back to UI approval if sampling not supported by the IDE. |
| D6 | Bind address default | ✅ Resolved | **127.0.0.1.** Any change emits a red-tinted startup warning. No auth in v2.62. |
| D7 | UI build stack | ✅ Resolved | **Vanilla JS + Tailwind CDN**, matching `pforge-mcp/ui/app.js` style. No bundler, no build step, no framework. |
| D8 | Hub integration — push (subscribe) vs pull (on-demand fetch) | ✅ Resolved | **Push subscribe.** Live overlay requires low-latency delivery; pulling on reasoning turns misses between-turn events. |
| D9 | CLI lifecycle PID file location | ✅ Resolved | `.forge/forge-master.pid` + `.forge/forge-master.log`. Matches existing `.forge/` convention. |
| D10 | Write allowlist membership | ✅ Resolved | Phase-29 adds exactly: `forge_run_plan`, `forge_crucible_finalize`, `forge_bug_register`, `forge_bug_update_status`, `forge_tempering_approve_baseline`, `forge_new_phase`. Not in: `forge_bug_delete` (reserved for a future destructive-actions phase), `forge_crucible_abandon` (already safe — no writes), anything touching git push or file deletion. |
| D11 | Approval timeout | ✅ Resolved | **300 seconds.** Enough for owner to read a card and think; short enough that a walked-away session doesn't hold the reasoning loop open for hours. |
| D12 | Cross-package test orchestration | ✅ Resolved | Root `package.json` adds `test: "npm test --workspaces"`. Both packages run vitest independently; root command aggregates. Phase-28 test count + Phase-29 test count = reported baseline in CHANGELOG. |
| D13 | Release tagging strategy | ✅ Resolved | Single tag `v2.62.0` covers both packages. Both `package.json` files bump to `2.62.0`. Bump-back to `2.62.1-dev` after release. Follows `/memories/repo/release-procedure.md`. |

---

## Execution Slices

### Session 1 — Extraction + Wiring (6 slices)

#### Slice 1: Scaffold `pforge-master/` workspace package [sequential] {#slice-1}

**Goal**: Create the empty workspace package. Register it in root `package.json` workspaces. No code moves yet — just the package shell and the workspace wiring.

**Files**:
- `pforge-master/package.json` — workspace member, deps: `@modelcontextprotocol/sdk`, `@pforge/pforge-mcp: workspace:*`.
- `pforge-master/README.md` — one-paragraph stub.
- `pforge-master/src/index.mjs` — empty re-exports (placeholder).
- `pforge-master/vitest.config.mjs` — mirrors `pforge-mcp/vitest.config.mjs`.
- root `package.json` — add `pforge-master` to `workspaces`; add `test:master` script.

**Depends on**: none.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/package.json` (reference pattern)

**Traces to**: MUST (package exists as workspace member).

**Validation Gate**:
```bash
bash -c "test -f pforge-master/package.json && test -d pforge-master/src"
bash -c "npm ls --workspaces | grep -q pforge-master"
```

---

#### Slice 2: Move Phase-28 modules — `git mv` only [sequential] {#slice-2}

**Goal**: Move every Phase-28 `pforge-mcp/forge-master/*` file to `pforge-master/src/*` using `git mv` (preserves blame). No code changes inside files except `import` path updates required by the new location.

**Files moved** (git mv, exhaustive):
- `pforge-mcp/forge-master/reasoning.mjs` → `pforge-master/src/reasoning.mjs`
- `pforge-mcp/forge-master/intent-router.mjs` → `pforge-master/src/intent-router.mjs`
- `pforge-mcp/forge-master/retrieval.mjs` → `pforge-master/src/retrieval.mjs`
- `pforge-mcp/forge-master/tool-bridge.mjs` → `pforge-master/src/tool-bridge.mjs`
- `pforge-mcp/forge-master/persistence.mjs` → `pforge-master/src/persistence.mjs`
- `pforge-mcp/forge-master/allowlist.mjs` → `pforge-master/src/allowlist.mjs`
- `pforge-mcp/forge-master/config.mjs` → `pforge-master/src/config.mjs`
- `pforge-mcp/forge-master/system-prompt.md` → `pforge-master/src/system-prompt.md`
- `pforge-mcp/forge-master/providers/*.mjs` → `pforge-master/src/providers/*.mjs`
- `pforge-mcp/forge-master/__fixtures__/*.mjs` → `pforge-master/src/__fixtures__/*.mjs`

**Files modified**:
- `pforge-mcp/forge-master/index.mjs` — replace with re-export shim: `export * from "@pforge/pforge-master";` (and any named-export variants required by existing consumers).
- Moved files only: update internal relative imports where required. No other edits.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- Phase-28 codebase.

**Traces to**: MUST (zero-rewrite extraction; blame preserved; shim re-exports).

**Validation Gate**:
```bash
bash -c "test -f pforge-master/src/reasoning.mjs && test -f pforge-master/src/system-prompt.md"
bash -c "! test -f pforge-mcp/forge-master/reasoning.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs tests/forge-master.integration.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 3: Downstream MCP client [sequential] {#slice-3}

**Goal**: Implement `pforge-master/src/mcp-client.mjs` — spawns `pforge-mcp/server.mjs` as a child process over stdio, performs MCP handshake, calls `tools/list`, exposes `invoke(name, args)` that routes through MCP protocol instead of in-process imports. Retrofit `tool-bridge.mjs` to use the MCP client when available, fall back to in-process invocation when operating in shim mode (for Phase-28 consumers still running in-process).

**Files**:
- `pforge-master/src/mcp-client.mjs` — new.
- `pforge-master/src/tool-bridge.mjs` — extended with `{transport: "mcp"|"inprocess"}` branch; no rewrite of invocation semantics.
- `pforge-master/tests/mcp-proxy.test.mjs` — tests for handshake, tools/list, invoke round-trip, stdio error handling.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs` (for understanding the server boot contract)
- MCP SDK docs in node_modules for client API.

**Traces to**: MUST (downstream MCP client; handshake + tools/list).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/mcp-proxy.test.mjs"
```

---

#### Slice 4: Studio server — stdio MCP mode [sequential] {#slice-4}

**Goal**: Implement the stdio-MCP half of `pforge-master/server.mjs`. When invoked with no args or `--mcp-stdio`, boots an MCP server exposing one tool `forge_master_ask` with Phase-28-identical schema, running the same `runTurn` loop. This is the "second MCP server" surface for IDE agents.

**Files**:
- `pforge-master/server.mjs` — new, stdio MCP mode only (HTTP mode in Slice 7).
- `pforge-master/tests/mcp-proxy.test.mjs` — extend with stdio-mode integration test spawning the studio and calling `forge_master_ask` via stdio MCP.

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs` (reference pattern for stdio MCP boot).

**Traces to**: MUST (stdio MCP server with forge_master_ask).

**Validation Gate**:
```bash
bash -c "cd pforge-master && node server.mjs --mcp-stdio --self-test"
bash -c "cd pforge-master && npx vitest run tests/mcp-proxy.test.mjs"
```

---

#### Slice 5: Proxy path + in-process fallback in `pforge-mcp/server.mjs` [sequential] {#slice-5}

**Goal**: Update the `forge_master_ask` dispatcher in the main MCP server to detect the Studio (via `.forge/forge-master.pid` + liveness check), proxy the call over stdio MCP if alive, or fall back to in-process shim re-exports if not. Response schema MUST be byte-identical in both modes.

**Files**:
- `pforge-mcp/server.mjs` — update dispatcher branch for `forge_master_ask`.
- `pforge-mcp/forge-master/index.mjs` — ensure shim still exports `runTurn` for in-process path.
- `pforge-master/tests/mcp-proxy.test.mjs` — add byte-identical-response test (proxy vs in-process).

**Depends on**: Slice 4.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs` dispatcher pattern.

**Traces to**: MUST (proxy path; in-process fallback; schema identity).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/mcp-proxy.test.mjs -t 'byte-identical'"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 6: Hub subscriber + retrieval augmentation [sequential] {#slice-6}

**Goal**: Implement `pforge-master/src/hub-subscriber.mjs` — WebSocket client to `ws://localhost:3101`, receives hub events, maintains a 50-event ring buffer, exposes `getRecentEvents(n)`. `retrieval.mjs` extended to append the newest 10 as a `### Recent Operational Events` subsection in the context block. Degrades silently when hub unreachable.

**Files**:
- `pforge-master/src/hub-subscriber.mjs` — new.
- `pforge-master/src/retrieval.mjs` — augment with hub-event injection (non-breaking: still passes Phase-28 retrieval tests).
- `pforge-master/tests/hub-subscriber.test.mjs` — new: subscribe, re-broadcast, graceful degrade, retrieval injection.
- `pforge-mcp/tests/forge-master.test.mjs` — verify Phase-28 retrieval tests still pass unchanged.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/hub.mjs` (event schema, WS protocol).

**Traces to**: MUST (hub subscribe; retrieval augmentation; graceful degrade).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/hub-subscriber.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs"
```

---

### Session 2 — UI + Writes + Ship (6 slices)

#### Slice 7: HTTP+SSE server mode [sequential] {#slice-7}

**Goal**: Add the HTTP+SSE half of `pforge-master/server.mjs`. Routes: `GET /`, `GET /ui/*`, `POST /chat`, `GET /chat/:id/stream`, `POST /chat/:id/approve`. Bind-address resolution with loopback default and warning on non-loopback.

**Files**:
- `pforge-master/server.mjs` — add HTTP mode behind `--http` flag (mutually exclusive with `--mcp-stdio`).
- `pforge-master/src/http-routes.mjs` — new, route handlers.
- `pforge-master/src/sse.mjs` — new, tiny SSE helper.
- `pforge-master/tests/server.test.mjs` — new: HTTP route tests, bind-address warning.

**Depends on**: Slice 5.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/hub.mjs` (SSE pattern if reusable; otherwise minimal local SSE).

**Traces to**: MUST (HTTP+SSE server on 3102; bind warning).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/server.test.mjs -t 'http|sse|bind'"
```

---

#### Slice 8: Approvals subsystem [sequential] {#slice-8}

**Goal**: Implement `pforge-master/src/approvals.mjs` — pauses reasoning loop on approval-tagged tool calls, emits approval-required event, awaits decision via SSE or MCP sampling prompt, applies edit if provided, resumes loop. Batch preview built in. Audit log write to `.forge/forge-master-approvals.jsonl`.

**Files**:
- `pforge-master/src/approvals.mjs` — new.
- `pforge-master/src/tool-bridge.mjs` — integrate approval check before invocation for any tool with `requiresApproval: true`.
- `pforge-master/src/allowlist.mjs` — add Phase-29 write-allowlist with `requiresApproval` tags.
- `pforge-master/tests/server.test.mjs` — extend with approval flow tests (approve, deny, edit, timeout, batch preview, audit log).
- `pforge-master/tests/approvals.test.mjs` — focused unit tests.

**Depends on**: Slice 7.

**Branch**: `master`.

**Context files**:
- Phase-28 `tool-bridge.mjs` (the pre-approval invocation path).

**Traces to**: MUST (approval cards; batch preview; audit log; timeout).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/approvals.test.mjs tests/server.test.mjs -t 'approval'"
```

---

#### Slice 9: Web UI [sequential] {#slice-9}

**Goal**: Build `pforge-master/ui/` — `index.html`, `app.js`, `styles.css`. Three panels: chat stream, tool-call trace, active-runs overlay. Approval cards render inline. Vanilla JS, Tailwind CDN, matches `pforge-mcp/ui/app.js` style.

**Files**:
- `pforge-master/ui/index.html` — new.
- `pforge-master/ui/app.js` — new, ~400–600 lines.
- `pforge-master/ui/styles.css` — minimal overrides on top of Tailwind.
- `pforge-master/tests/server.test.mjs` — extend with UI asset serving test + SSE-consumption smoke test.

**Depends on**: Slice 8.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/ui/app.js` (style reference, pattern reuse).

**Traces to**: MUST (vanilla JS + Tailwind CDN; three panels; inline approval cards).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/server.test.mjs"
bash -c "test -f pforge-master/ui/index.html && test -f pforge-master/ui/app.js"
```

---

#### Slice 10: CLI lifecycle [sequential] {#slice-10}

**Goal**: Add `pforge forge-master {start|stop|status|logs}` to both `pforge.ps1` and `pforge.sh`; register in `cli-schema.json`. PID file + log file under `.forge/`. Idempotent start, graceful stop with SIGKILL fallback, crash detection in status.

**Files**:
- `pforge.ps1` — add subcommand dispatch.
- `pforge.sh` — add subcommand dispatch.
- `pforge-mcp/cli-schema.json` — register subcommand.
- `pforge-master/src/lifecycle.mjs` — new: start/stop/status/logs helpers (called by the shell scripts via `node pforge-master/src/lifecycle.mjs <cmd>`).
- `pforge-master/tests/server.test.mjs` — extend with PID file lifecycle test.

**Depends on**: Slice 9.

**Branch**: `master`.

**Context files**:
- `pforge.ps1`, `pforge.sh` (existing subcommand dispatch pattern).

**Traces to**: MUST (CLI subcommand; PID/log management; idempotent start).

**Validation Gate**:
```bash
bash -c "cd pforge-master && npx vitest run tests/server.test.mjs -t 'lifecycle|pid'"
bash -c ".\\pforge.ps1 forge-master status 2>&1 | grep -Ei 'stopped|running|crashed'"
```

---

#### Slice 11: Setup registration + capabilities + docs [sequential] {#slice-11}

**Goal**: Make the Studio discoverable. Setup scripts register the second MCP server. `forge_capabilities` surfaces studio status. Docs + guidance updated.

**Files**:
- `setup.ps1` — add conditional MCP entry for `forge-master-chat` (reuse extension-merge pattern).
- `setup.sh` — same.
- `pforge-mcp/capabilities.mjs` — add `forgeMaster.studio: {running, port, pid, bindAddress, writeAllowlistCount}` block.
- `.github/copilot-instructions.md` — expand "Talking to Forge-Master" section.
- `templates/copilot-instructions.md.template` — mirror.
- `docs/COPILOT-VSCODE-GUIDE.md` — "Forge-Master Studio" section.
- `README.md` — Quick Commands entry.
- `docs/CLI-GUIDE.md` — one-line entry.

**Depends on**: Slice 10.

**Branch**: `master`.

**Context files**:
- setup.ps1 extension-merge pattern (~line 1336–1350).

**Traces to**: MUST (setup registration; capabilities surface; agent guidance).

**Validation Gate**:
```bash
bash -c "grep -q 'forge-master-chat' setup.ps1 setup.sh"
bash -c "cd pforge-mcp && node -e \"import('./capabilities.mjs').then(m => { const caps = m.buildCapabilities ? m.buildCapabilities() : null; const j = JSON.stringify(caps || {}); if (!j.includes('forgeMaster')) process.exit(1); if (!j.includes('studio')) process.exit(1); console.log('ok'); })\""
```

---

#### Slice 12: Ship v2.62.0 [sequential] {#slice-12}

**Goal**: CHANGELOG, version bumps (both packages), tag, GitHub release, post-release bump. Follow `/memories/repo/release-procedure.md`.

**Files**:
- `CHANGELOG.md` — new `[2.62.0]` section.
- `VERSION` — `2.62.0`.
- `pforge-mcp/package.json` — `2.62.0`.
- `pforge-master/package.json` — `2.62.0`.
- `.git/COMMIT_MSG_v2.62.0.txt` — prepared commit message.

**Depends on**: Slice 11 + all Phase-28 tests still pass + ≥ 20 new Phase-29 tests pass.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`.

**Traces to**: MUST (v2.62.0 tag; both packages bumped; bump-back to 2.62.1-dev).

**Validation Gate**:
```bash
bash -c "git show v2.62.0:VERSION | grep -q '^2.62.0$'"
bash -c "git show v2.62.0:pforge-master/package.json | grep -q '\"version\": \"2.62.0\"'"
bash -c "cd pforge-mcp && npx vitest run && cd ../pforge-master && npx vitest run"
```

---

## Teardown Safety Guard

Baseline branch `pre-phase-29` created before Slice 1; verify at end of Slice 12 via `git rev-parse pre-phase-29` returns a valid SHA. No branch deletions permitted. Because Slice 2 uses `git mv`, reverting the phase preserves file blame history — `git reset --hard pre-phase-29` cleanly restores Phase-28 state.

## Cost Estimate

Pre-ship heuristic (12 slices × 2500 in + 6000 out tokens, auto mode with Claude Sonnet 4.5 default): **~$8–12 base, ~$18–28 with auto-quorum overhead.** Max-mode (power quorum on all slices) would run ~$60–100. `auto` recommended. Authoritative number: `forge_estimate_quorum docs/plans/Phase-29-FORGE-MASTER-STUDIO-v2.62-PLAN.md` post-v2.60.0.

## Rollback

`git reset --hard pre-phase-29` on master (with force-push explicitly authorized) undoes the entire phase. Because Phase-28 remains fully functional (proxy path is the *new* code; in-process fallback is the *preserved* code), rolling back Phase-29 leaves users on a working v2.61 Forge-Master MVP — no regression in functionality, only loss of the studio surface.

Individual slice rollback via `git revert <slice-commit>` is preferred. Slices 7–12 are independently reversible. Slices 2, 3, 4, 5 form an extraction chain and should be reverted as a group if any one fails post-release.

## Post-Phase-29 Roadmap (Not In Scope Here)

Deliberate future work, called out so it does not creep into Phase-29:
- **Phase-30 candidate**: Authentication + multi-user for Studio (if anyone beyond the owner starts using it).
- **Phase-30+ candidate**: Destructive-actions tier (bug delete, history rewrite, forge reset) behind 2-of-N approval.
- **Phase-30+ candidate**: Production deployment recipe (Docker image, loopback-in-container, VPN-only).
- **Phase-30+ candidate**: Extending the write allowlist to tempering baseline writes, memory L2 writes, schedule mutations.
- **Never**: Code generation, voice, mobile app, fine-tuned bespoke model.
