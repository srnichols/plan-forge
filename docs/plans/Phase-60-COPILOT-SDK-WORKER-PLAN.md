---
crucibleId: 6b782ee8-fb8e-48e3-938b-68dce71553e1
lane: full
source: agent
phaseId: Phase-60
linkedBugs: []
relatedIssues: [241, 243, 238]
---
# Phase-60: Route Copilot and direct-API workers through @github/copilot-sdk

> **Lane**: full
> **Source**: agent
> **Status**: in-progress

## Raw Idea

Evaluate replacing the gh-copilot worker path and the DIRECT_API_ONLY HTTP paths in pforge-mcp/orchestrator/worker-spawn.mjs with @github/copilot-sdk, while leaving the claude, codex and grok CLI workers spawn-based. Research (issue #241) established the scope: the SDK is programmatic control of the Copilot CLI runtime via JSON-RPC, and the Claude/Codex adapters live in the VS Code Agent Host process rather than in the SDK, so this is a partial consolidation and not a replacement of multi-harness spawning. The SDK also offers BYOK custom providers (openai/azure/anthropic) that could subsume the direct HTTP paths, typed session events (assistant.message_delta, tool.execution_start, session.idle) that would retire bespoke stream parsing such as parseGrokStreamingJson, a session-hook set close to a superset of Plan Forge's lifecycle hooks, and built-in OpenTelemetry. The main cost is a breaking Node floor bump: the SDK requires ^20.19.0 or >=22.12.0 while Plan Forge's published packages declare >=18.0.0, so adoption raises the floor for every consumer. Decide whether to adopt, and if so where the seam sits relative to the existing COPILOT_SERVABLE / DIRECT_API_ONLY / GROK_CLI_SERVABLE provider registries.

## Problem & Success Metric

**Problem**: Two concrete problems, both operator-facing. First, bespoke stream parsing is fragile: parseGrokStreamingJson has needed two hotfixes against real CLI stdout, and every worker backend needs its own parser because there is no typed event contract. A slice can fail because output shape drifted, not because the work was wrong. Second, Plan Forge maintains its own provider routing, availability probing and retry semantics for the Copilot and direct-API paths, which duplicates what the Copilot runtime now exposes natively; that duplication is why a typo'd model reaches runtime before failing (issue #243). Adopting the SDK for those two paths replaces hand-rolled parsing and probing with a supported contract. It does not solve multi-harness spawning, which stays as-is.

**Success metric**: Three measurable outcomes. (1) parseGrokStreamingJson and any sibling stdout parsers are deleted for the Copilot and direct-API paths, with token/cost extraction driven by typed SDK events instead — measured as net lines removed from worker-spawn.mjs and zero remaining regex-based stdout parsing on those two paths. (2) A full plan executes end-to-end through the SDK-backed worker with cost attribution matching the previous CLI path within 5 percent on the same plan, proving no telemetry regression. (3) The existing worker test suites pass unchanged where they assert behaviour rather than transport, and any test that had to change is justified in the plan. Explicit non-metric: this phase does not aim to reduce wall-clock slice time; if it regresses more than 20 percent, that is a stop condition rather than a success measure.

## Stack Boundary

Node.js ESM (.mjs) only, no TypeScript build step — the no-build promise holds, so @github/copilot-sdk is consumed as a plain runtime dependency and its type declarations are ignored rather than driving a compile. Work is confined to pforge-mcp/. No changes to pforge-master/, pforge-sdk/, extensions/ or the docs site. Any new entry point needs both PowerShell and Bash twins, but this phase should add none. The SDK requires Node ^20.19.0 or >=22.12.0 against a current published floor of >=18.0.0, so the engines bump is inside the boundary and must be declared for plan-forge-mcp; the private root already requires >=20.11.0 and rises to 20.19. Test framework stays vitest with pool=forks. No new transport, no HTTP server, no build tooling.

## Data Model

No database, no persisted schema change. The affected shapes are in-memory and on-disk JSONL contracts that must be preserved byte-compatibly, because run history and the dashboard read them. Specifically: the token/usage object returned by extractTokens (tokens_in, tokens_out, cached, reasoning_tokens, apiDurationMs, sessionDurationMs, model) must keep its exact field names and the v2.96.4 null-versus-zero convention, where null means the worker did not report a value and any non-null number is a real measurement. Cost records written to .forge/cost-history.json and the events in .forge/runs/<id>/events.jsonl keep their current shape. The one addition is an internal worker descriptor distinguishing sdk-backed from spawn-backed routing; it stays in-process and is not serialised. If a field cannot be sourced from SDK events, it is emitted as null rather than zero — inventing a zero is the failure mode that produced bug #190.

## API Surface

No public API surface changes. The MCP tool surface is untouched — no new forge_* tools, no schema or description changes, so tools.json and cli-schema.json must regenerate byte-identical. The changed surface is internal to pforge-mcp/orchestrator: spawnWorker gains an SDK-backed implementation selected by the existing provider registries, and probeQuorumModelAvailability may consult the SDK's listModels() for the Copilot path instead of assuming the gh-copilot catch-all. That probe change must stay permissive — an unknown model is reported, never blocked, because that permissiveness is why claude-opus-5 worked on day one. Exported function signatures in worker-spawn.mjs stay backward compatible since orchestrator.mjs re-exports them and tests import them directly. The only consumer-visible change is engines.node on plan-forge-mcp, which is a breaking change and must be called out in the release notes.

## Security Posture

Four points. (1) Credential handling: the SDK accepts gitHubToken or useLoggedInUser, and BYOK providers take apiKey or bearerToken. Keys must continue to come from process.env or .forge/secrets.json and must never be written to a plan, a run artifact, a log line, or an error message. The existing rule that .forge/secrets.json stays gitignored is unchanged. (2) The SDK spawns a runtime child process via RuntimeConnection.forStdio; that spawn must use an args array, never a constructed shell string, matching security.instructions.md Rule 1. Do not use forInProcess — it is experimental and shares our process. (3) onPermissionRequest must not be set to approveAll. The worker executes shell commands and file writes on the user's repository, so approving everything blindly would delete the dry-run and confirmation contract that Plan Forge's own forbidden-patterns list requires. A deliberate handler that honours the slice's Forbidden Actions is required, and approveAll additionally throws when managed settings are enabled. (4) Telemetry: the SDK's built-in OTel must stay opt-in and off by default, consistent with issue #238 which unbundled OTel; do not enable it implicitly by passing a telemetry config unconditionally.

## Scope Contract

### In Scope

- In scope: (a) add @github/copilot-sdk as a runtime dependency of plan-forge-mcp and raise engines.node to >=20.19.0 on plan-forge-mcp and the private root; (b) implement an SDK-backed worker execution path in pforge-mcp/orchestrator/worker-spawn.mjs behind the existing COPILOT_SERVABLE registry
- so gh-copilot-routed models run through CopilotClient/createSession instead of a spawned CLI; (c) extend the same path to DIRECT_API_ONLY models using the SDK's BYOK provider config for openai
- azure and anthropic; (d) derive token
- cost and duration telemetry from typed session events rather than stdout parsing
- preserving the exact extractTokens field contract; (e) delete the stdout parsers that become unreachable on those two paths; (f) a deliberate onPermissionRequest handler that honours the active slice's Forbidden Actions; (g) tests covering the SDK path with an injected fake client
- plus a real end-to-end plan run compared against the CLI path for cost parity.

### Out of Scope

- Out of scope: the claude
- codex and grok CLI workers stay spawn-based and untouched — those adapters live in the VS Code Agent Host
- not in the SDK
- and they bill against flat subscriptions rather than metered keys
- so replacing them is a different question with different economics. Also out: adopting the Agent Host Protocol directly or shipping a .mcp.json alongside .vscode/mcp.json (VS Code already forwards our servers correctly and shipping both risks double registration); any change to the MCP tool surface; the pforge-master package; quorum default model selection
- which is its own migration; the forge_doctor_quorum work already closed as #243; and any attempt to use the SDK's in-process FFI transport. Explicitly not a performance phase — wall-clock improvements are not pursued and not claimed.

### Forbidden

- Forbidden: do not set onPermissionRequest to approveAll — the worker writes files and runs shell commands in the user's repository
- and blanket approval deletes the dry-run and confirmation contract. Do not use RuntimeConnection.forInProcess (experimental FFI sharing our process). Do not construct any shell command as a string; spawn takes an args array. Do not log
- persist or echo a token or API key
- including inside error messages. Do not emit zero for a telemetry field the SDK did not report — emit null
- per the v2.96.4 convention that produced bug #190 when violated. Do not make probeQuorumModelAvailability strict: an unrecognised model is reported
- never blocked
- because that permissiveness is why claude-opus-5 worked on day one. Do not change the MCP tool surface
- tools.json or cli-schema.json. Do not touch the claude
- codex or grok spawn paths. Do not introduce a TypeScript build step. Do not weaken or delete an existing assertion to make the SDK path pass — if a test must change
- justify it in the slice. Do not enable SDK telemetry by default.

## Slices

_Estimated: 6 slices. (1) Add the dependency, raise engines.node on plan-forge-mcp and the private root, and add the routing.copilotSdk switch defaulting to off — no behaviour change, proving the floor bump alone is green. (2) Introduce the SDK-backed worker for COPILOT_SERVABLE models behind the switch, with an injected fake client in tests. (3) Derive token, cost and duration telemetry from typed session events, asserting the extractTokens field contract byte-for-byte including the null-not-zero convention. (4) Extend the path to DIRECT_API_ONLY models via BYOK provider config. (5) Delete the stdout parsers that are now unreachable on those two paths, and prove no remaining regex stdout parsing there. (6) Flip the default to prefer, run a real end-to-end plan, and compare cost attribution against the CLI baseline within 5 percent. Slices 1 through 5 are independently revertible; slice 6 is the only one that changes default behaviour. slices. Expand each below during Plan Hardener step._

> Slice template:
>
> ```
> ### Slice N — <name>
> Build command: <cmd>
> Test command:  <cmd>
> Tasks:         <list>
> Files:         <manifest>
> ```

## Validation Gates

## Stop Conditions

- Validation gate fails and root cause is not identified within 30 minutes
- A slice drifts past its declared Scope Contract
- A forbidden action (see Scope Contract → Forbidden) is about to be introduced
- Token budget for this phase is exceeded by more than 25%

## Rollback

The SDK path ships behind a routing switch, not as a replacement, so rollback is configuration rather than revert. The provider registries keep the spawn-based implementation intact for the whole phase, and routing.copilotSdk ("prefer" | "off", defaulting to off until slice 6) selects between them. If the SDK path misbehaves in the field, set it off and the previous CLI spawn path runs unchanged with no reinstall. Because engines.node rises, a consumer on Node 18 who cannot upgrade must pin the previous plan-forge-mcp minor — that is the one non-reversible aspect and must be stated in the release notes. Per-slice rollback is git revert of that slice's commit; the phase writes no migrations and changes no persisted schema, so there is no data to undo. If cost attribution diverges from the CLI baseline by more than 5 percent, stop and revert rather than adjusting the baseline to match.

## Change Manifest

- In scope: (a) add @github/copilot-sdk as a runtime dependency of plan-forge-mcp and raise engines.node to >=20.19.0 on plan-forge-mcp and the private root; (b) implement an SDK-backed worker execution path in pforge-mcp/orchestrator/worker-spawn.mjs behind the existing COPILOT_SERVABLE registry
- so gh-copilot-routed models run through CopilotClient/createSession instead of a spawned CLI; (c) extend the same path to DIRECT_API_ONLY models using the SDK's BYOK provider config for openai
- azure and anthropic; (d) derive token
- cost and duration telemetry from typed session events rather than stdout parsing
- preserving the exact extractTokens field contract; (e) delete the stdout parsers that become unreachable on those two paths; (f) a deliberate onPermissionRequest handler that honours the active slice's Forbidden Actions; (g) tests covering the SDK path with an injected fake client
- plus a real end-to-end plan run compared against the CLI path for cost parity.

## Interview Log

1. **feature-name** — Route Copilot and direct-API workers through @github/copilot-sdk
2. **user-problem** — Two concrete problems, both operator-facing. First, bespoke stream parsing is fragile: parseGrokStreamingJson has needed two hotfixes against real CLI stdout, and every worker backend needs its own parser because there is no typed event contract. A slice can fail because output shape drifted, not because the work was wrong. Second, Plan Forge maintains its own provider routing, availability probing and retry semantics for the Copilot and direct-API paths, which duplicates what the Copilot runtime now exposes natively; that duplication is why a typo'd model reaches runtime before failing (issue #243). Adopting the SDK for those two paths replaces hand-rolled parsing and probing with a supported contract. It does not solve multi-harness spawning, which stays as-is.
3. **success-metric** — Three measurable outcomes. (1) parseGrokStreamingJson and any sibling stdout parsers are deleted for the Copilot and direct-API paths, with token/cost extraction driven by typed SDK events instead — measured as net lines removed from worker-spawn.mjs and zero remaining regex-based stdout parsing on those two paths. (2) A full plan executes end-to-end through the SDK-backed worker with cost attribution matching the previous CLI path within 5 percent on the same plan, proving no telemetry regression. (3) The existing worker test suites pass unchanged where they assert behaviour rather than transport, and any test that had to change is justified in the plan. Explicit non-metric: this phase does not aim to reduce wall-clock slice time; if it regresses more than 20 percent, that is a stop condition rather than a success measure.
4. **stack-boundary** — Node.js ESM (.mjs) only, no TypeScript build step — the no-build promise holds, so @github/copilot-sdk is consumed as a plain runtime dependency and its type declarations are ignored rather than driving a compile. Work is confined to pforge-mcp/. No changes to pforge-master/, pforge-sdk/, extensions/ or the docs site. Any new entry point needs both PowerShell and Bash twins, but this phase should add none. The SDK requires Node ^20.19.0 or >=22.12.0 against a current published floor of >=18.0.0, so the engines bump is inside the boundary and must be declared for plan-forge-mcp; the private root already requires >=20.11.0 and rises to 20.19. Test framework stays vitest with pool=forks. No new transport, no HTTP server, no build tooling.
5. **data-model** — No database, no persisted schema change. The affected shapes are in-memory and on-disk JSONL contracts that must be preserved byte-compatibly, because run history and the dashboard read them. Specifically: the token/usage object returned by extractTokens (tokens_in, tokens_out, cached, reasoning_tokens, apiDurationMs, sessionDurationMs, model) must keep its exact field names and the v2.96.4 null-versus-zero convention, where null means the worker did not report a value and any non-null number is a real measurement. Cost records written to .forge/cost-history.json and the events in .forge/runs/<id>/events.jsonl keep their current shape. The one addition is an internal worker descriptor distinguishing sdk-backed from spawn-backed routing; it stays in-process and is not serialised. If a field cannot be sourced from SDK events, it is emitted as null rather than zero — inventing a zero is the failure mode that produced bug #190.
6. **api-surface** — No public API surface changes. The MCP tool surface is untouched — no new forge_* tools, no schema or description changes, so tools.json and cli-schema.json must regenerate byte-identical. The changed surface is internal to pforge-mcp/orchestrator: spawnWorker gains an SDK-backed implementation selected by the existing provider registries, and probeQuorumModelAvailability may consult the SDK's listModels() for the Copilot path instead of assuming the gh-copilot catch-all. That probe change must stay permissive — an unknown model is reported, never blocked, because that permissiveness is why claude-opus-5 worked on day one. Exported function signatures in worker-spawn.mjs stay backward compatible since orchestrator.mjs re-exports them and tests import them directly. The only consumer-visible change is engines.node on plan-forge-mcp, which is a breaking change and must be called out in the release notes.
7. **security-posture** — Four points. (1) Credential handling: the SDK accepts gitHubToken or useLoggedInUser, and BYOK providers take apiKey or bearerToken. Keys must continue to come from process.env or .forge/secrets.json and must never be written to a plan, a run artifact, a log line, or an error message. The existing rule that .forge/secrets.json stays gitignored is unchanged. (2) The SDK spawns a runtime child process via RuntimeConnection.forStdio; that spawn must use an args array, never a constructed shell string, matching security.instructions.md Rule 1. Do not use forInProcess — it is experimental and shares our process. (3) onPermissionRequest must not be set to approveAll. The worker executes shell commands and file writes on the user's repository, so approving everything blindly would delete the dry-run and confirmation contract that Plan Forge's own forbidden-patterns list requires. A deliberate handler that honours the slice's Forbidden Actions is required, and approveAll additionally throws when managed settings are enabled. (4) Telemetry: the SDK's built-in OTel must stay opt-in and off by default, consistent with issue #238 which unbundled OTel; do not enable it implicitly by passing a telemetry config unconditionally.
8. **scope-in** — In scope: (a) add @github/copilot-sdk as a runtime dependency of plan-forge-mcp and raise engines.node to >=20.19.0 on plan-forge-mcp and the private root; (b) implement an SDK-backed worker execution path in pforge-mcp/orchestrator/worker-spawn.mjs behind the existing COPILOT_SERVABLE registry, so gh-copilot-routed models run through CopilotClient/createSession instead of a spawned CLI; (c) extend the same path to DIRECT_API_ONLY models using the SDK's BYOK provider config for openai, azure and anthropic; (d) derive token, cost and duration telemetry from typed session events rather than stdout parsing, preserving the exact extractTokens field contract; (e) delete the stdout parsers that become unreachable on those two paths; (f) a deliberate onPermissionRequest handler that honours the active slice's Forbidden Actions; (g) tests covering the SDK path with an injected fake client, plus a real end-to-end plan run compared against the CLI path for cost parity.
9. **scope-out** — Out of scope: the claude, codex and grok CLI workers stay spawn-based and untouched — those adapters live in the VS Code Agent Host, not in the SDK, and they bill against flat subscriptions rather than metered keys, so replacing them is a different question with different economics. Also out: adopting the Agent Host Protocol directly or shipping a .mcp.json alongside .vscode/mcp.json (VS Code already forwards our servers correctly and shipping both risks double registration); any change to the MCP tool surface; the pforge-master package; quorum default model selection, which is its own migration; the forge_doctor_quorum work already closed as #243; and any attempt to use the SDK's in-process FFI transport. Explicitly not a performance phase — wall-clock improvements are not pursued and not claimed.
10. **forbidden-actions** — Forbidden: do not set onPermissionRequest to approveAll — the worker writes files and runs shell commands in the user's repository, and blanket approval deletes the dry-run and confirmation contract. Do not use RuntimeConnection.forInProcess (experimental FFI sharing our process). Do not construct any shell command as a string; spawn takes an args array. Do not log, persist or echo a token or API key, including inside error messages. Do not emit zero for a telemetry field the SDK did not report — emit null, per the v2.96.4 convention that produced bug #190 when violated. Do not make probeQuorumModelAvailability strict: an unrecognised model is reported, never blocked, because that permissiveness is why claude-opus-5 worked on day one. Do not change the MCP tool surface, tools.json or cli-schema.json. Do not touch the claude, codex or grok spawn paths. Do not introduce a TypeScript build step. Do not weaken or delete an existing assertion to make the SDK path pass — if a test must change, justify it in the slice. Do not enable SDK telemetry by default.
11. **slice-count** — 6 slices. (1) Add the dependency, raise engines.node on plan-forge-mcp and the private root, and add the routing.copilotSdk switch defaulting to off — no behaviour change, proving the floor bump alone is green. (2) Introduce the SDK-backed worker for COPILOT_SERVABLE models behind the switch, with an injected fake client in tests. (3) Derive token, cost and duration telemetry from typed session events, asserting the extractTokens field contract byte-for-byte including the null-not-zero convention. (4) Extend the path to DIRECT_API_ONLY models via BYOK provider config. (5) Delete the stdout parsers that are now unreachable on those two paths, and prove no remaining regex stdout parsing there. (6) Flip the default to prefer, run a real end-to-end plan, and compare cost attribution against the CLI baseline within 5 percent. Slices 1 through 5 are independently revertible; slice 6 is the only one that changes default behaviour.
12. **rollback-plan** — The SDK path ships behind a routing switch, not as a replacement, so rollback is configuration rather than revert. The provider registries keep the spawn-based implementation intact for the whole phase, and routing.copilotSdk ("prefer" | "off", defaulting to off until slice 6) selects between them. If the SDK path misbehaves in the field, set it off and the previous CLI spawn path runs unchanged with no reinstall. Because engines.node rises, a consumer on Node 18 who cannot upgrade must pin the previous plan-forge-mcp minor — that is the one non-reversible aspect and must be stated in the release notes. Per-slice rollback is git revert of that slice's commit; the phase writes no migrations and changes no persisted schema, so there is no data to undo. If cost attribution diverges from the CLI baseline by more than 5 percent, stop and revert rather than adjusting the baseline to match.
13. **linked-bugs** — No tempering bug IDs are linked — this phase originates from research, not from a defect in the bug registry. Related GitHub issues for context: #241 is the parent evaluation this smelt was created from and should be closed when the phase lands; #243 (forge_doctor_quorum could not assess configured models) is already fixed and is referenced only because it shares the root cause of duplicated availability logic; #238 (OpenTelemetry unbundled) is referenced because the SDK ships built-in OTel that must stay opt-in to avoid re-introducing what that issue removed.
