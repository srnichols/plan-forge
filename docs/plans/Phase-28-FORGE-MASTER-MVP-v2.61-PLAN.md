---
crucibleId: 7b41b27e-18cc-44e3-909f-3829c8c39f0e
lane: full
source: human
---

# Phase-28 — Forge-Master MVP: Guardrailed Reasoning Agent over Plan Forge

> **Target release**: v2.61.0
> **Status**: Draft
> **Depends on**: v2.60.0 shipped (Phase-27 `forge_estimate_quorum` + `cost-service.mjs` consolidation)
> **Branch strategy**: Direct to `master`. Additive — one new subsystem under `pforge-mcp/forge-master/`, one new MCP tool `forge_master_ask`, curated system prompt + intent router + retrieval layer. No second process, no web UI, no write tool access. Those are Phase-29.
> **Source**: Product discussion 2026-04-20 — owner wants a smarter, domain-curated Plan Forge assistant that uses the existing L1/L2/L3 memory tiers, watcher/health data, and Crucible interview as retrieval and orchestration primitives. Raw Copilot-with-MCP gets things wrong because it is generic; a Forge-Master with a frozen system prompt, a curated tool allowlist, and memory-backed retrieval gives more accurate, consistent answers.
> **Session budget**: 9 slices in **1 session**
> **Design posture**: MVP, IDE-first, read-only. Forge-Master is a single MCP tool invoked from the IDE agent (Copilot / Claude in VS Code / Cursor). It runs a tool-use loop against a frontier reasoning model, calls only a frozen allowlist of read-only Forge tools, funnels "I want to build X" into `forge_crucible_submit`, and never writes or executes plans. Phase-29 adds web UI, second MCP server, and write/approval surface.

---

## Specification Source

- **Field input**: Owner stated "this tool is really for me" and "I like power and capabilities and well architected non-buggy code." Complexity is not a blocker; sequencing is. Phase-28 must be useful on its own even if Phase-29 is deferred indefinitely.
- **Diagnostic finding — why this is not raw Copilot**: Three concrete deltas over generic IDE-chat-with-MCP:
  1. **Curated system prompt** encoding Plan Forge philosophy (architecture-first, Crucible-funneling, temper guards, 5-question framework, anti-Lovable stance) — consistent across every session, no copy-paste needed.
  2. **Curated tool allowlist** (read + Crucible-write only) so the model cannot wander into destructive ops and cannot hand-compute numbers the tools own.
  3. **Memory-backed retrieval** on every turn — reads L1 session, L2 project (`.forge/liveguard-memories.jsonl`), and optional L3 OpenBrain. Raw IDE chat does not persist operational context across sessions.
- **Architecture anchor**: `pforge-mcp/brain.mjs` (3-tier memory), `pforge-mcp/orchestrator.mjs` lines 506–530 (provider registry / `callApiWorker`), `pforge-mcp/crucible-interview.mjs` (interview engine), `pforge-mcp/capabilities.mjs` (tool registration pattern), `pforge-mcp/server.mjs` (dispatcher pattern).
- **Explicit non-goal**: Forge-Master does not generate application code, does not run plans, does not approve deploys. Those are Phase-29 (run-plan with approval cards) and forever-out-of-scope (code generation — the anti-Lovable commitment).

---

## Feature Specification

### Problem Statement
Plan Forge exposes 64+ MCP tools, 3 memory tiers, a watcher/health subsystem, a Crucible interview engine, quorum cost modes, phase plans, tempering scanners, and a bug registry. A developer or owner sitting in front of VS Code with Copilot can call any one tool, but cannot easily ask questions that span them: "what's my plan status, which slices failed most this month, and how much did quorum cost on Phase-27?" — three tools, three manual calls, no synthesis. Worse, the generic IDE agent will sometimes hallucinate answers (cf. the $146.57 quorum-picker fabrication that motivated Phase-27) because it has no forcing function to consult tools. The existing ecosystem needs one entry point that (a) has a curated domain system prompt, (b) is constrained to a read-only Forge tool allowlist so it cannot drift, (c) reads the 3-tier memory on every turn as grounding context, and (d) funnels build intents into Crucible rather than improvising.

### User Scenarios
1. **Ideation funnel to Crucible** — Owner opens the IDE agent and invokes `forge_master_ask` with "I want to add multi-tenant billing to my plan hardening pipeline." Forge-Master classifies intent as `build`, calls `forge_crucible_submit({rawIdea, lane: "feature"})` to start a smelt, then conversationally walks the 6 FEATURE questions by calling `forge_crucible_ask` per answer. Each model reply is grounded by fresh `brain.recall("project.forgemaster.recent_digests")`. On interview completion, Forge-Master calls `forge_crucible_preview` and returns the draft phase plan summary. The owner never has to remember the six tool names.
2. **Operational Q&A over memory + watcher** — Owner asks "which of my last 5 plan runs had the worst slice failure rate, and what was the average cost per slice?". Forge-Master classifies intent as `operational`, fans out parallel calls to `forge_plan_status`, `forge_cost_report`, `forge_health_trend`, and `brain.recall("project.runs.recent")`. Model synthesizes a grounded answer citing the tool outputs verbatim. No hand-math — cost numbers come from `forge_cost_report` only.
3. **Troubleshooting with guardrails** — Owner asks "why did Phase-27 Slice 4 fail last run, and what's the likely root cause?". Forge-Master calls `forge_watch_live`, reads `brain.recall("project.incidents.open")`, and if a bug registry entry exists, calls `forge_bug_list`. Model presents the evidence trail and suggests next diagnostic steps. It does **not** call `forge_diagnose` with write side-effects; it recommends the owner run it explicitly.
4. **Off-topic redirect** — Owner asks "what's the weather in Boise?". System prompt forces redirect: "I'm scoped to Plan Forge topics — plans, runs, costs, memory, crucible, tempering, watchers, and bug registry. Ask me something in that lane." No model drift, no apologetic paragraph, no fabricated tool call.

### Acceptance Criteria
- **MUST**: New subsystem directory `pforge-mcp/forge-master/` exists, containing `reasoning.mjs`, `intent-router.mjs`, `retrieval.mjs`, `tool-bridge.mjs`, `system-prompt.md`, and `allowlist.mjs`. No files placed elsewhere — Forge-Master is a self-contained subsystem.
- **MUST**: New MCP tool `forge_master_ask` registered in `capabilities.mjs`, `tools.json`, and dispatched in `server.mjs`. Input schema: `{message: string, sessionId?: string, maxToolCalls?: number}` (default `maxToolCalls: 5`). Output schema: `{sessionId: string, reply: string, toolCalls: Array<{name, args, resultSummary, costUSD}>, tokensIn: number, tokensOut: number, totalCostUSD: number, truncated: boolean}`.
- **MUST**: `forge-master/system-prompt.md` is a versioned artifact checked into the repo. It encodes: Plan Forge philosophy (architecture-first, anti-Lovable, Crucible-funneling), the frozen tool allowlist with usage hints, the off-topic redirect rule, the no-hand-math rule (tie-in to Phase-27 lesson), the five-question framework from `architecture-principles.instructions.md`, and explicit temper guards. Loaded fresh on every `forge_master_ask` call — no caching across calls, so a repo edit takes effect immediately.
- **MUST**: `forge-master/allowlist.mjs` exports a frozen base array and a dynamic-discovery helper. **Phase-28 base allowlist (≈38 tools, all read-only except Crucible-interview writes — which are scoped to a single in-progress smelt, not a phase plan)**: Planning/status (`forge_plan_status`, `forge_phase_status`, `forge_status`, `forge_diff`, `forge_capabilities`); Cost (`forge_cost_report`, `forge_estimate_quorum`, `forge_quorum_analyze`, `forge_doctor_quorum`); Health & watchers (`forge_health_trend`, `forge_watch`, `forge_watch_live`, `forge_alert_triage`, `forge_dep_watch`, `forge_drift_report`, `forge_hotspot`, `forge_regression_guard`); Diagnostics (`forge_smith`, `forge_sweep`, `forge_validate`, `forge_analyze`, `forge_diagnose`); Crucible (`forge_crucible_list`, `forge_crucible_submit`, `forge_crucible_ask`, `forge_crucible_preview`); Memory & retrieval (`brain_recall`, `forge_memory_report`, `forge_search`, `forge_timeline`); Tempering reads (`forge_tempering_scan`, `forge_tempering_status`); Bug/review/skill reads (`forge_bug_list`, `forge_review_list`, `forge_skill_status`); Extensions reads (`forge_ext_search`, `forge_ext_info`); Ops reads (`forge_runbook`, `forge_deploy_journal`). Any tool not in the resolved allowlist (base + dynamically discovered — see next bullet) is rejected by `tool-bridge.mjs` with `{error: "tool_not_allowlisted", tool}` before the model's tool-call ever reaches the main dispatcher. **Deliberately excluded from Phase-28** — these graduate to Phase-29 with approval cards: every write tool, specifically `forge_run_plan`, `forge_crucible_finalize`, `forge_bug_register`, `forge_bug_update_status`, `forge_tempering_approve_baseline`, `forge_new_phase`, `forge_incident_capture`, `forge_fix_proposal`, `forge_run_skill`, `forge_review_add`, `forge_review_resolve`, `forge_delegate_to_agent`, `forge_notify_send`, `forge_notify_test`, `forge_memory_capture`, `forge_testbed_run`, `forge_generate_image`.
- **MUST**: Dynamic extension-tool discovery. On server startup and on `forge_master_ask` cold-start, `allowlist.mjs` enumerates MCP tools whose `capabilities.mjs` metadata records `source: "extension"` (installed via `pforge ext add`). Extension tools carrying `readOnly: true` in their capabilities registration are auto-added to the resolved allowlist; untagged extension tools are excluded by default. Gated by `forgeMaster.discoverExtensionTools` (default `true`); when disabled, only the base array is available. Rejection error format unchanged. The resolved allowlist is snapshotted per-session so a mid-conversation extension install does not shift behavior within an active turn.
- **MUST**: `forge-master/retrieval.mjs` on every turn reads `brain.recall` for three keys — `session.forgemaster.<sessionId>.history` (L1), `project.forgemaster.digests.latest` (L2), and `cross.forgemaster.topics.<lane>` (L3, best-effort / skipped if OpenBrain not configured). Retrieved context is injected as a `## Current Context` block in the system message, capped at 4000 tokens (truncate oldest first). Missing L3 is not an error.
- **MUST**: `forge-master/intent-router.mjs` exports `classify(message) → {lane, confidence, suggestedTools}` with four lanes: `build` (feature/tweak/full → funnel to Crucible), `operational` (status/cost/health/watcher/memory), `troubleshoot` (bug/incident/failure), `offtopic` (everything else). Classification uses a lightweight two-stage filter: (1) keyword regex table (fast path), (2) single small-model call (`forgeMaster.routerModel`, default `grok-3-mini` or equivalent cheap model) only when keyword match is ambiguous. Off-topic messages short-circuit the reasoning loop and return the canned redirect — no reasoning-model call, no tool calls, cost near zero.
- **MUST**: `forge-master/reasoning.mjs` implements a tool-use loop over the frontier model. Each iteration: (1) send message + system + context + available tools, (2) receive either a final reply or one-or-more tool calls, (3) execute allowlisted tools via `tool-bridge.mjs` in parallel, (4) append results to context, (5) repeat until final reply or `maxToolCalls` exceeded. Per-turn budget: hard-capped at 5 tool calls by default, configurable via input arg, absolute ceiling of 10. On budget overflow the loop terminates and `truncated: true` is returned with whatever reply the model produced so far.
- **MUST**: Provider support — reuse `callApiWorker` + provider registry from `pforge-mcp/orchestrator.mjs` (lines 506–530). Phase-28 must support Anthropic (Claude Sonnet/Opus) and OpenAI (GPT-5.x) tool-use at minimum. XAI Grok tool-use is supported if available in the provider SDK; gracefully degraded (no tool-use, reply-only) if not.
- **MUST**: Config via new `.forge.json` block `forgeMaster`: `{reasoningModel: string, reasoningProvider?: "anthropic"|"openai"|"xai", routerModel: string, maxToolCalls: number (default 5), ceilingToolCalls: number (default 10), sessionRetentionDays: number (default 14), l3Enabled: boolean (default false)}`. Fallback chain: `forgeMaster.reasoningModel` → orchestrator's default model (`.forge.json` → `model.default`) → env-detected (`ANTHROPIC_API_KEY` → `claude-sonnet-4.5`, else `OPENAI_API_KEY` → `gpt-5.3-codex`, else `XAI_API_KEY` → `grok-4-fast`).
- **MUST**: Conversation persistence in `brain.mjs`. On every `forge_master_ask` invocation with a `sessionId`: append `{role, content, toolCalls, timestamp}` to `session.forgemaster.<sessionId>.history` (L1). At end of turn, if session exceeds 20 turns, auto-summarize oldest 10 into `project.forgemaster.digests.<YYYY-MM-DD>` (L2) and drop from L1. New sessions (`sessionId` omitted) generate a UUID and return it.
- **MUST**: Cost attribution — every tool call Forge-Master emits is tagged `source: "forge-master"` in the hub event and written to `.forge/cost-history.json` via the existing cost-service pathway. `forge_cost_report` aggregates chat cost alongside worker cost (no schema change — the `source` tag is additive). Router-model calls and reasoning-model calls are both tracked as `worker: "forge-master-router"` and `worker: "forge-master-reasoning"` respectively.
- **MUST**: Failure modes return structured errors, never throw to the MCP transport. `{error: "reasoning_model_unavailable" | "tool_budget_exceeded" | "tool_not_allowlisted" | "offtopic_redirect" | "classification_failed", message, partialReply?}`.
- **MUST**: New test file `pforge-mcp/tests/forge-master.test.mjs` with ≥ 18 unit tests covering: (a) intent router — 4 lanes × 2 examples each, (b) allowlist rejection for every Phase-29 write tool (`forge_run_plan`, `forge_crucible_finalize`, `forge_bug_register`, `forge_run_skill`, `forge_new_phase`) — at least 5 separate rejection cases, (c) tool budget ceiling enforcement (model requests 15 calls, loop stops at 10), (d) off-topic canned redirect (no model call emitted — mock reasoning client records zero invocations), (e) memory retrieval injection (mocked `brain.recall` returns 3 keys, system prompt contains them), (f) session persistence append + summarization trigger at turn 21, (g) cost tagging in emitted hub event, (h) graceful degradation when `XAI_API_KEY` absent and Grok selected, (i) dynamic extension-tool discovery — extension tool tagged `readOnly: true` is allowed, untagged extension tool is rejected, (j) `forgeMaster.discoverExtensionTools: false` disables discovery entirely, (k) snapshot stability — mid-turn extension install does not alter the active turn's allowlist.
- **MUST**: Integration test `pforge-mcp/tests/forge-master.integration.test.mjs` — one full happy-path: mocked reasoning model returns a `forge_crucible_submit` tool call, then a `forge_crucible_ask` call, then a final reply. Asserts (i) Crucible smelt created in `.forge/crucible/<id>.json`, (ii) `forge_master_ask` output contains the expected reply text, (iii) session history persisted with 3 turns recorded.
- **MUST**: Full vitest suite (2893+/2893+ baseline from v2.60.0) stays green.
- **MUST**: `forge_capabilities` output surfaces `forgeMaster` subsystem with `tools: ["forge_master_ask"]`, `allowlistedTools: [...]`, `reasoningModel`, `routerModel`.
- **MUST**: `.github/copilot-instructions.md` gains a "## Talking to Forge-Master" section (≤ 15 lines) explaining when to use `forge_master_ask` vs. calling tools directly. Same section added to `templates/copilot-instructions.md.template` so new projects inherit.
- **MUST**: `CHANGELOG.md` v2.61.0 section explains the new subsystem, the guardrails, and flags Phase-29 as the follow-on for web UI + writes.
- **MUST**: `VERSION` → `2.61.0`, `pforge-mcp/package.json` → `2.61.0`, tag `v2.61.0` pushed, GitHub release marked `--latest`, post-release bump to `2.61.1-dev`.
- **SHOULD**: `docs/COPILOT-VSCODE-GUIDE.md` gains a short "Forge-Master" subsection with one example prompt.
- **SHOULD**: Router falls back to keyword-only classification if router-model provider is unavailable (avoids hard-dep on a second model).
- **MAY**: `docs/CLI-GUIDE.md` mentions the new tool.
- **MAY**: `cross.forgemaster.topics.*` L3 pattern is seeded with 2–3 starter keys (`build`, `operational`, `troubleshoot`) so OpenBrain users get immediate value.

### Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| User invokes `forge_master_ask` with no API keys configured | Return `{error: "reasoning_model_unavailable", message: "No reasoning provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY, or configure forgeMaster.reasoningModel in .forge.json."}` |
| User asks off-topic question | Short-circuit, return canned redirect text, zero model cost, zero tool calls |
| Model requests a non-allowlisted tool (e.g., `forge_run_plan`) | `tool-bridge.mjs` returns `{error: "tool_not_allowlisted"}` to the model, model retries with allowlisted alternative or finalizes with apology. Does NOT bubble to MCP caller as an error. |
| Model exceeds `maxToolCalls` | Loop terminates, returns `{truncated: true, reply: "<whatever so far>"}`, logs `truncated_tool_budget` event to hub |
| `brain.recall` returns empty for all three memory keys (fresh project) | Inject `## Current Context\n(no prior context)` block and proceed — not an error |
| Reasoning model times out or throws mid-loop | Catch, return `{error: "reasoning_model_failed", partialReply: "<collected so far>"}`, preserve session history |
| User sends a `sessionId` that doesn't exist | Treat as new session with that ID, create fresh L1 history — do not error |
| Router-model cost exceeds reasoning-model cost for a turn | Not an error. Log a warning if router cost > 10% of reasoning cost (tuning signal for future). |
| L3 OpenBrain is configured but unreachable | Skip L3 silently, log `l3_unavailable` once per session, do not fail the turn |
| Concurrent `forge_master_ask` calls with same `sessionId` | L1 history uses append-only writes via `brain.remember`; race is tolerated (last-writer-wins on the digest summary but not on per-turn append). Document this in JSDoc on `reasoning.mjs`. |
| Model requests an extension tool that is not tagged `readOnly: true` | Rejected with `{error: "tool_not_allowlisted", tool, reason: "extension_tool_not_readOnly"}`. Model sees the rejection and should reroute or apologize. |
| `forgeMaster.discoverExtensionTools: false` and model requests an extension tool | Same rejection, reason `"extension_discovery_disabled"`. Owner is in control of whether extensions surface. |
| Extension installed mid-session (owner runs `pforge ext add X` in another terminal) | Active turn uses the snapshotted allowlist from turn-start; new tool becomes available only on the next turn. No mid-turn capability drift. |

### Out of Scope
- Web chat UI on any port. Phase-29.
- Second standalone MCP server (`pforge-master/` package). Phase-29.
- Write-capable tool allowlist (`forge_run_plan`, `forge_bug_register`, `forge_crucible_finalize`, tempering baseline approval). Phase-29 with approval cards.
- Any form of code generation. Permanent non-goal.
- Voice input, multi-user auth, browser cookies, shareable conversation URLs.
- Fine-tuning a bespoke model or RAG against arbitrary source files (retrieval is memory-only).
- Changing `brain.mjs` schema, adding new memory tiers, or modifying OpenBrain client code.
- Changing `pforge-mcp/crucible*.mjs` — provenance frozen; Forge-Master only calls existing Crucible MCP tools.
- Changing dashboard, cost-service, or quorum modules introduced in Phase-27.

### Forbidden Actions
- `git push --force`, `git reset --hard origin/master`, deletion of `refs/heads/master`.
- Editing `pforge-mcp/crucible*.mjs` — Forge-Master is a consumer, not an author.
- Editing `pforge-mcp/brain.mjs` — Forge-Master is a consumer of the existing 3-tier API.
- Editing `pforge-mcp/cost-service.mjs` beyond adding the `source: "forge-master"` tag to cost event payloads if that tag doesn't already exist as a pass-through field.
- Editing `pforge-mcp/orchestrator.mjs` beyond re-exporting existing provider registry helpers. No new provider entries.
- Adding a new top-level directory. All Phase-28 code lives under `pforge-mcp/forge-master/`.
- Adding a write-capable tool to the Phase-28 allowlist (including `forge_crucible_finalize`, which writes a phase file).
- Calling any LLM provider directly from `reasoning.mjs`. All provider calls route through `orchestrator.callApiWorker` so cost tracking and retry policy are consistent.
- Running Slice 9 (ship) before all earlier slices pass gates and tests stay ≥ 2893/2893.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1 | Single subsystem directory vs top-level package | ✅ Resolved | **Subsystem directory** `pforge-mcp/forge-master/`. Phase-28 must not introduce a second process or package; that is Phase-29's line in the sand. |
| D2 | Allowlist — include `forge_crucible_finalize`? | ✅ Resolved | **No.** Finalize writes a phase file. Forge-Master in Phase-28 is read-only + Crucible-interview only (submit/ask/preview touch an in-progress smelt, not a phase plan). Finalize graduates to Phase-29 with an approval card. |
| D2a | Allowlist scope — 16 tools (initial draft) vs ≈38 tools (audited) | ✅ Resolved | **≈38 tools.** The audit confirmed 22 additional read-only Forge tools are safe — the curated system prompt plus automatic memory retrieval provide the reasoning context the audit's "could mislead" concern was about. Under-scoping the allowlist cripples the ops Q&A use case. Every excluded tool is explicitly a write. |
| D2b | Extension-tool handling | ✅ Resolved | **Discover dynamically, allow only `readOnly: true` extension tools, per-session snapshot.** Extension ecosystem is Plan Forge's growth surface; Forge-Master must see new tools without a code release. Snapshot prevents mid-turn capability drift. |
| D3 | Router model — mandatory or optional? | ✅ Resolved | **Optional with graceful degradation.** If `routerModel` provider unreachable, fall back to keyword-only classification. Keyword table must classify ≥ 80% of the acceptance-criteria scenarios correctly without the router call. |
| D4 | Memory retrieval on every turn vs. on-demand via tool call | ✅ Resolved | **Every turn, automatic.** The whole point of Forge-Master over raw IDE chat is that operational context is *already there*. Requiring a tool call defeats the purpose. Cap at 4000 tokens to bound cost. |
| D5 | System prompt — in-file constant vs separate `.md` artifact | ✅ Resolved | **Separate `.md` artifact** (`forge-master/system-prompt.md`). Enables iteration without code changes and keeps prompt diffs reviewable. Loaded with `fs.readFileSync` on every call — the file is small. |
| D6 | Tool-use loop max iterations | ✅ Resolved | **Default 5, configurable up to 10.** Five is enough for any realistic Q&A; ten is an absolute ceiling for runaway loops. Phase-29 may revisit for multi-step write flows. |
| D7 | Session ID generation | ✅ Resolved | **UUID v4 generated by the server** when omitted. Returned to caller in the first response. Caller re-submits on subsequent turns to continue the conversation. |
| D8 | Off-topic handling — redirect text vs. model-generated decline | ✅ Resolved | **Canned redirect.** Deterministic, zero-cost, zero-drift. The text lives in `system-prompt.md` for easy editing. |
| D9 | L3 OpenBrain — required or optional? | ✅ Resolved | **Optional.** Many users won't have OpenBrain configured. L1 + L2 are the hard dependency. |
| D10 | Config surface — new `.forge.json` block vs reusing existing `model.default` | ✅ Resolved | **New `forgeMaster` block** with fallback to `model.default`. Owner wants the ability to pick a premium reasoning model distinct from the default worker model. |
| D11 | Test strategy — integration test with real provider or mocked? | ✅ Resolved | **Mocked.** CI has no API keys. Provide a `MockReasoningClient` that returns scripted responses. A smoke script (not in CI) at `pforge-mcp/forge-master/smoke.mjs` can exercise a real provider locally. |

---

## Execution Slices

### Session 1 — Forge-Master MVP (9 slices)

#### Slice 1: Subsystem scaffold + config schema [sequential] {#slice-1}

**Goal**: Create the empty subsystem directory, the config loader, and config tests. Pure additive — no MCP surface yet.

**Files**:
- `pforge-mcp/forge-master/index.mjs` — package entry (re-exports).
- `pforge-mcp/forge-master/config.mjs` — loads `forgeMaster` block from `.forge.json`, applies fallback chain, exports `getForgeMasterConfig({cwd})`.
- `pforge-mcp/forge-master/allowlist.mjs` — frozen array of allowlisted tool names, plus per-tool `usageHint` map consumed by the system prompt.
- `pforge-mcp/forge-master/system-prompt.md` — initial draft covering all guardrails enumerated in acceptance criteria.
- `pforge-mcp/tests/forge-master.test.mjs` — config loader + fallback tests only (≥ 5 assertions).

**Depends on**: none.

**Branch**: `master`.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `pforge-mcp/crucible-config.mjs` (reference pattern for `.forge.json` loaders)

**Traces to**: MUST (subsystem directory exists; config loader applies fallback chain).

**Validation Gate**:
```bash
bash -c "test -d pforge-mcp/forge-master && test -f pforge-mcp/forge-master/system-prompt.md && test -f pforge-mcp/forge-master/allowlist.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs"
```

---

#### Slice 2: Intent router (keyword + optional model) [sequential] {#slice-2}

**Goal**: Implement `intent-router.mjs` with keyword-first classification and optional router-model fallback for ambiguous inputs. Keyword table must classify all 8 acceptance-criteria scenario examples correctly without the router call.

**Files**:
- `pforge-mcp/forge-master/intent-router.mjs` — exports `classify(message, {cwd, providerRegistry}) → {lane, confidence, reason, suggestedTools}`.
- `pforge-mcp/tests/forge-master.test.mjs` — add router tests: 4 lanes × 2 examples, plus an "ambiguous" case that exercises the router-model path (mocked).

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/forge-master/allowlist.mjs` (to populate `suggestedTools` per lane)

**Traces to**: MUST (4-lane classifier; graceful degradation when router model unavailable).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs -t 'intent'"
```

---

#### Slice 3: Memory retrieval layer [sequential] {#slice-3}

**Goal**: Implement `retrieval.mjs` — reads L1 session history, L2 project digests, L3 cross-project topics; formats into a `## Current Context` markdown block capped at 4000 tokens; truncates oldest first.

**Files**:
- `pforge-mcp/forge-master/retrieval.mjs` — exports `fetchContext({sessionId, lane, cwd}) → {contextBlock: string, sources: {l1, l2, l3}}`.
- `pforge-mcp/tests/forge-master.test.mjs` — add retrieval tests: all-three-tiers populated, L3 missing, token truncation at cap, empty project (no history).

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/brain.mjs` (existing `recall` API)

**Traces to**: MUST (retrieval on every turn with 4000-token cap).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs -t 'retrieval'"
```

---

#### Slice 4: Tool bridge + allowlist enforcement [sequential] {#slice-4}

**Goal**: Implement `tool-bridge.mjs` — the single choke point between the reasoning loop and the main MCP dispatcher. Looks up tool handler from `capabilities.mjs` registry, rejects if not in allowlist, invokes in parallel for multi-tool turns, returns a summarized result to the model (raw output truncated to 2000 chars for context efficiency; full output stored in `toolCalls[].resultFull` for the final `forge_master_ask` return payload).

**Files**:
- `pforge-mcp/forge-master/tool-bridge.mjs` — exports `invokeAllowlisted({tool, args, cwd}) → {ok, result, summary, error?, costUSD}`.
- `pforge-mcp/tests/forge-master.test.mjs` — add bridge tests: allowlist rejection for `forge_run_plan`, parallel invocation of 3 allowlisted tools, result summarization truncation, cost tagging on emitted event.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/capabilities.mjs` (how tools are looked up)
- `pforge-mcp/hub.mjs` (event emission pattern)

**Traces to**: MUST (allowlist enforcement; cost tagging with `source: "forge-master"`).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs -t 'bridge'"
bash -c "cd pforge-mcp && grep -q 'source.*forge-master' forge-master/tool-bridge.mjs || (echo 'source tag missing' && exit 1)"
```

---

#### Slice 5: Reasoning loop + provider adapters [sequential] {#slice-5}

**Goal**: Implement `reasoning.mjs` — the tool-use loop. Receives message, runs intent router, fetches context, loads system prompt, invokes frontier model via `orchestrator.callApiWorker` with tool schemas derived from allowlist, executes tool calls through `tool-bridge`, iterates until final reply or budget. Supports Anthropic tool-use and OpenAI function-calling at minimum; XAI if provider SDK supports tool-use, reply-only degradation otherwise.

**Files**:
- `pforge-mcp/forge-master/reasoning.mjs` — exports `runTurn({message, sessionId, maxToolCalls, cwd}) → {reply, toolCalls, tokensIn, tokensOut, totalCostUSD, truncated, error?}`.
- `pforge-mcp/forge-master/providers/anthropic-tools.mjs` — tool-use adapter (message format translation, stream collection).
- `pforge-mcp/forge-master/providers/openai-tools.mjs` — function-calling adapter.
- `pforge-mcp/forge-master/providers/xai-tools.mjs` — Grok adapter with reply-only fallback if tool-use unsupported.
- `pforge-mcp/tests/forge-master.test.mjs` — add reasoning tests with `MockReasoningClient`: happy path (3 tool calls → final reply), budget overflow (model requests 15, loop stops at 10, `truncated: true`), off-topic short-circuit (zero model calls), graceful error when provider throws.
- `pforge-mcp/forge-master/__fixtures__/MockReasoningClient.mjs` — scripted response fixture helper.

**Depends on**: Slices 2, 3, 4.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs` (lines 506–530 for provider registry + `callApiWorker`)

**Traces to**: MUST (tool-use loop; budget ceiling; provider support).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs -t 'reasoning'"
```

---

#### Slice 6: Session persistence + auto-summarization [sequential] {#slice-6}

**Goal**: Wire `brain.mjs` into `reasoning.mjs`: append per-turn to L1 history, trigger summarization to L2 digest at turn 21+, generate UUID for missing `sessionId`, handle existing vs. new session paths.

**Files**:
- `pforge-mcp/forge-master/persistence.mjs` — exports `appendTurn({sessionId, turn})`, `summarizeIfNeeded({sessionId})`, `ensureSessionId(sessionId?)`.
- `pforge-mcp/forge-master/reasoning.mjs` — integrate calls to persistence helpers before and after the model turn.
- `pforge-mcp/tests/forge-master.test.mjs` — add tests: new session generates UUID, existing session appends, 21st turn triggers summarization (mocked brain), concurrent append tolerance.

**Depends on**: Slice 5.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/brain.mjs` (remember/recall/parseKey)

**Traces to**: MUST (session persistence; summarization at turn 21+).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.test.mjs -t 'persistence|session'"
```

---

#### Slice 7: Register `forge_master_ask` MCP tool [sequential] {#slice-7}

**Goal**: Expose the MVP to the IDE agent. Register in `capabilities.mjs` (with `agentGuidance`), `tools.json` (input/output schema), and `server.mjs` (dispatcher branch invoking `reasoning.runTurn`). Ensure `forge_capabilities` output surfaces the `forgeMaster` subsystem block.

**Files**:
- `pforge-mcp/capabilities.mjs` — add `forge_master_ask` entry with intent, aliases (`ask_forge`, `forge_ask`), cost profile, prerequisites (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` or `XAI_API_KEY`), agentGuidance text, example invocations.
- `pforge-mcp/tools.json` — schema entry.
- `pforge-mcp/server.mjs` — dispatcher branch.
- `pforge-mcp/tests/forge-master.integration.test.mjs` — one end-to-end happy-path asserting smelt creation, reply text, session history persisted.

**Depends on**: Slice 6.

**Branch**: `master`.

**Context files**:
- Existing tool registration pattern (e.g., `forge_cost_report`, `forge_estimate_quorum` from Phase-27)

**Traces to**: MUST (tool registered; integration happy-path passes).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && grep -q 'forge_master_ask' capabilities.mjs && grep -q 'forgeMaster' capabilities.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.integration.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 8: Agent guidance + docs [sequential] {#slice-8}

**Goal**: Make Forge-Master discoverable to humans and IDE agents.

**Files**:
- `.github/copilot-instructions.md` — add "## Talking to Forge-Master" section (≤ 15 lines).
- `templates/copilot-instructions.md.template` — same section so new projects inherit.
- `docs/COPILOT-VSCODE-GUIDE.md` — short subsection with one example prompt.
- `docs/CLI-GUIDE.md` — one-line mention in the tool directory.

**Depends on**: Slice 7.

**Branch**: `master`.

**Context files**:
- Phase-27's cost-estimates section (reference for tone/length).

**Traces to**: MUST (agent guidance in both copilot-instructions files); SHOULD (VSCode guide); MAY (CLI guide).

**Validation Gate**:
```bash
bash -c "grep -c 'forge_master_ask' .github/copilot-instructions.md templates/copilot-instructions.md.template | grep -v ':0'"
bash -c "grep -q 'Forge-Master' docs/COPILOT-VSCODE-GUIDE.md"
```

---

#### Slice 9: Ship v2.61.0 [sequential] {#slice-9}

**Goal**: CHANGELOG entry, VERSION bump, package.json bump, tag, GitHub release, post-release bump to 2.61.1-dev. Follow `/memories/repo/release-procedure.md`.

**Files**:
- `CHANGELOG.md` — new `[2.61.0]` section.
- `VERSION` — `2.61.0`.
- `pforge-mcp/package.json` — version `2.61.0`.
- `.git/COMMIT_MSG_v2.61.0.txt` — prepared commit message.

**Depends on**: Slice 8 + tests ≥ 2893/2893 passing.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` existing entries

**Traces to**: MUST (VERSION=2.61.0 after tag; bump-back to 2.61.1-dev).

**Validation Gate**:
```bash
bash -c "git show v2.61.0:VERSION | grep -q '^2.61.0$'"
bash -c "cd pforge-mcp && npx vitest run"
```

---

## Teardown Safety Guard

Baseline branch `pre-phase-28` created before Slice 1; verify at end of Slice 9 via `git rev-parse pre-phase-28` returns a valid SHA. No branch deletions permitted in any slice. `git reset --hard pre-phase-28` on master (with force-push explicitly authorized) undoes the entire phase if needed.

## Cost Estimate

Pre-ship heuristic (9 slices × 2000 in + 5000 out tokens, auto mode with Claude Sonnet 4.5 default): **~$4–6 base, ~$8–12 with auto-quorum overhead.** Max-mode (power quorum on all slices) would run ~$24–40. `auto` recommended. Authoritative number: `forge_estimate_quorum docs/plans/Phase-28-FORGE-MASTER-MVP-v2.61-PLAN.md` after v2.60.0 ships.

## Rollback

`git reset --hard pre-phase-28` on master (with force-push explicitly authorized) undoes the entire phase. Individual slice rollback via `git revert <slice-commit>` is preferred. Forge-Master is additive — no existing behavior is modified, so rollback risk is low.

## Phase-29 Preview (Not In Scope Here)

Phase-29 graduates the MVP into Forge-Master Studio:
- Extract `pforge-mcp/forge-master/` reasoning loop into a standalone `pforge-master/` package (second MCP server, own process, own stdio transport, own port 3102 for HTTP/SSE web UI).
- Add web chat UI styled after `pforge-mcp/ui/app.js` (vanilla JS, Tailwind CDN).
- Add write-capable tool allowlist with batch-preview approval cards (`forge_run_plan`, `forge_crucible_finalize`, `forge_bug_*`, tempering baseline approval).
- Subscribe to `hub.mjs` for live run event overlay in chat.
- Add `pforge forge-master {start|stop|status}` CLI subcommand.
- Register second MCP server in `.vscode/mcp.json` via setup.ps1 / setup.sh.

Phase-29 depends on Phase-28 shipping and Phase-28's reasoning loop being stable enough to extract. Zero code from Phase-28 is throwaway — the extraction is a move, not a rewrite.
