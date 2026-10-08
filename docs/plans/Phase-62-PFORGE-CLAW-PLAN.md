---
lockHash: bd608eaa3e69edb9f8b234b16a2a8404c40017d8d1cca492c02079d7753cc1f0
lane: full
source: agent
phaseId: Phase-62
linkedBugs: []
relatedIssues: []
---
# Phase-62: PFORGE-CLAW — A chat-native, always-on front door for Plan Forge, powered by GHCP models

> **Status**: 🔬 **HARDENED 2026-10-07** — Step-2 complete. Required Decisions D1–D26 are resolved (no TBDs); verification evidence is in **Assumptions**. Ready for `pforge run-plan` once the **Execution Hold** is lifted.
> **Tracks**: `pforge-claw/` (new workspace package), `pforge.ps1` / `pforge.sh` (`claw` subcommand), root `package.json` (workspaces), `scripts/audit/dep-boundaries.mjs`, `pforge-mcp/capabilities/schemas.mjs` + `surface.mjs` (metadata only), `.github/workflows/pforge-claw.yml`, `docs/PFORGE-CLAW-GUIDE.md` (new), `docs/PFORGE-CLAW-THREAT-MODEL.md` (new), `docs/manual/forge-claw.html` (new), and the doc sweep set in Slice 29.
> **Pipeline**: Specify ✅ (this doc) → Harden ⏳ → Execute → Review → Ship
> **Depends on**: [Phase-61-FORGE-MASTER-CLAW-AWARE-PLAN.md](./Phase-61-FORGE-MASTER-CLAW-AWARE-PLAN.md), the Forge-Master contract (`caller`, `responseFormat`, `untrustedContext`, `contextBlocks`, `proposeActions` → `proposedActions`, `usage`, observer insights pulled via `forge_master_observe status` per D27). Run it first, or in parallel with Slices 1–5 here. Slice 6 onward requires it complete.
> **Manual steps**: a few tasks need a human (creating the Telegram bot, live runs on real hardware, confirming CI after a push). They are labelled **MANUAL (operator)**: the agent prepares everything, writes a handoff note, and stops; no gate depends on them.
> **Cost estimate** (`forge_estimate_quorum`, 2026-10-07, historical calibration; re-run after hardening): this plan (after hardening): auto **$14.45** (27/29 slices quorum, recommended) · speed $15.49 · power $207.27 · off $0.44. Companion FORGE-MASTER-CLAW-AWARE: auto **$4.30** · speed $5.34 · power $71.47 · off $0.15. The 25 % budget stop condition is measured against the mode actually chosen.
> **Session breaks**: recommended after Slice 10 (tracks A + B merged), Slice 17 (M1 complete), and Slice 25 (all lanes + memory); resume with `pforge run-plan --resume-from <n>`.
> **Session budget**: 29 slices across 4 milestones, executed **continuously M0 → M4 with no hold points** so the result is a complete, testable environment (single host + remote workers + K8s Job lanes) in one pass. Milestones are logical groupings and Re-anchor points, not pauses. Use `pforge run-plan --resume-from <n>` to break across sessions. Slice 27 stands up the full end-to-end test environment (offline harness + a live multi-host topology). The author's macOS host, Windows host and Linux Kubernetes cluster are the **reference validation environment**; nothing in the package is specific to them.

---

## Execution Hold

Lift the hold only when all of these are true:

- [ ] FORGE-MASTER-CLAW-AWARE Slices 1–8 have shipped before claw Slice 6 starts. Slices 6 and 7 fail their own gates otherwise, so this is enforced, not just advised.
- [ ] Work happens on a feature branch off `planning/main`, and `git status` is clean.
- [ ] `npm install` at the repo root succeeds on Node ≥ 22.12 (Slice 1 adds the `pforge-claw` workspace; its gate needs the install).
- [ ] No other in-flight plan edits `pforge.ps1`, `pforge.sh`, `pforge-mcp/capabilities/schemas.mjs` or `scripts/audit/dep-boundaries.mjs`.
- [ ] Prior postmortems: none exist for this plan (`.forge/plans/Phase-62-PFORGE-CLAW-PLAN/` absent): first execution.

## Raw Idea

Build something close to a Grok-style / OpenClaw-style personal assistant, but scoped to software delivery and governed by Plan Forge. You talk to it from Telegram on your phone; it answers questions about your projects, captures ideas into OpenBrain and the Crucible, queues real work (skills, plan runs, ad-hoc agent tasks), asks you to approve anything that mutates a repo, and reports progress back — while you are away from the desk. The "brain" is the operator's own GitHub Copilot (GHCP) subscription via `@github/copilot-sdk` / Copilot CLI, not separately billed API keys. It manages several projects at once (one lane per project), and it can run on a Mac mini, a dev box, and a Kubernetes homelab cluster — the dispatcher in K8s, long-lived workers on the Mac mini / dev box, and ephemeral per-job lanes as Kubernetes Jobs.

**Open-source constraint.** The motivating setup is one operator's machines, but Plan Forge is open source. Every host, lane, channel, agent runtime, project, schedule, cap, hostname, registry and cluster detail is **configuration**, nothing is hardcoded, and every feature degrades gracefully when an optional piece (OpenBrain, Kubernetes, webhook ingress, STT, GHCP) is absent. See **Portability & Configurability Contract**.

Working name: **Forge-Claw** (package `pforge-claw`, CLI `pforge claw`).

## Why this phase exists

**Problem.** Plan Forge today is *desk-bound and pull-only*: every session starts with the operator in VS Code, one window per repo, and nothing happens unless the operator initiates it. Consequences we have observed:

1. Failed or stalled runs sit idle until the operator is back at a keyboard (the bridge can *notify* on Telegram but cannot *receive* an instruction).
2. Approval links exist (`/api/bridge/approve/:runId`) but are plain URLs against a dashboard on the operator's machine — useless away from the LAN and not bound to an authenticated identity.
3. Ideas, bug reports and decisions arrive on the phone (links, screenshots, voice) and are lost before they reach OpenBrain or the Crucible.
4. Overnight capacity is wasted: hardened plans, scheduled audits and low-severity bug backlogs wait for a human to press go.
5. Multi-repo work (same change across three repos, "status everywhere") means juggling multiple VS Code windows.

**Success metric.** Four measurable outcomes:

1. **Away-from-desk loop**: from a Telegram message, an allowlisted operator can (a) get a Forge-Master answer about any registered project, (b) approve an estimated plan run, and (c) receive progress and a PR link — with **zero** interaction on the host machine. Measured by an end-to-end dogfood run on Plan Forge itself.
2. **Proactive value**: the scheduler delivers the morning digest and LiveGuard-driven alerts across a **simulated 7-day window** (fake clock, restarts injected) in the e2e suite with zero missed or duplicated posts, and then on the live environment from Slice 27.
3. **Multi-project concurrency**: three registered projects run jobs concurrently (one per lane), each isolated in its own worktree, with per-project and global budget caps enforced (a job that would exceed the cap is held, not run).
4. **Safety invariants hold under test**: no mutating job runs without a single-use, identity-bound approval; unknown Telegram users receive no response; no secret appears in any log, state file or message (guard tests + `forge_secret_scan`).

Explicit non-metrics: this phase does not aim to be a general life assistant (email, calendar, browser automation), does not open the bot to third parties, and does not change the MCP tool surface.

## Assumptions (verified 2026-10-06)

| Assertion | Verified against | Result |
|---|---|---|
| Telegram support is **outbound-only** today (format + send; no `getUpdates` / webhook receive) | `pforge-mcp/bridge.mjs` (`formatTelegram` `:572`, MarkdownV2 helpers `:189–282`) | true |
| Approval buttons are URL links to `GET/POST /api/bridge/approve/:runId` | `bridge.mjs:585–586`, `server/rest-api.mjs:2290`, `:2324` | true — URL-based, not `callback_query` |
| An `ApprovalGate` class exists in the bridge | `bridge.mjs:1052` (`requestApproval` `:1086`) | true |
| Forge-Master exposes chat over HTTP and as an MCP tool | `pforge-master/src/http-routes.mjs` (`POST /api/forge-master/chat`, `/chat/:sessionId/stream`, `/chat/:sessionId/approve`); `forge_master_ask` in the plan-forge MCP tool list | true |
| Forge-Master already reasons on GHCP by default | `pforge-master/src/config.mjs` (`defaultProvider: "githubCopilot"`) | true: chat Q&A uses the operator's Copilot seat with no extra keys |
| `forge_master_audit` returns top-3 risks + prioritized actions | `pforge-mcp/server/tool-definitions.mjs:1144` | true: used by the digest (Slice 13) |
| `@github/copilot-sdk` (^1.0.16) and `ws` (^8.20.0) are already runtime deps in the monorepo | `pforge-mcp/package.json` | true — no *new third-party* dependency is required |
| `engines.node` is `>=22.12.0` on root, `pforge-mcp`, `pforge-master` | the three `package.json` files | true — Node 22 global `fetch` is available, no HTTP client dep needed |
| Root workspaces are `pforge-mcp`, `pforge-master`, `pforge-sdk` | root `package.json#workspaces` | true — `pforge-claw` must be added |
| Cross-package imports are policed | `scripts/audit/dep-boundaries.mjs`, `scripts/audit/layer-policy.json#crossPackageWhitelist` | true |
| Worktree tooling exists in pforge-mcp | `worktree-manager.mjs`, `orchestrator/parallel-worktrees.mjs`, `orchestrator/worktree-janitor.mjs` | true — but not importable from a new package without a whitelist entry (see D1) |
| Tools the claw needs exist | `pforge-mcp/tools.json`: `forge_master_ask`, `forge_plan_status`, `forge_estimate_quorum`, `forge_run_skill`, `forge_watch_live`, `forge_crucible_submit`, `forge_bug_register`, `forge_cost_report`, `forge_search` | true |
| No `.forge` directory override exists in pforge-mcp | search for `FORGE_DIR` / `PFORGE_FORGE_DIR` / `PFORGE_STATE_DIR` / env-driven `forgeDir` in `pforge-mcp/**/*.mjs` | true: drives D22 (merge-back instead of redirect) |
| OpenBrain delivery from pforge is queued with backoff + dead-letter, and dedupe is configurable | `pforge-mcp/memory.mjs` (`shapeQueueRecord`, `nextBackoffTimestamp`, `drainOpenBrainQueue`, `openbrain.dedupThreshold`); `forge_anvil_*` tools | true: reused by routing writes through the project MCP |
| OpenClaw is already a documented integration target | `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`, `orchestrator/hooks.mjs` (`postOpenClawSnapshot`) | true — Forge-Claw is positioned as the *native* alternative |
| Copilot SDK supports headless token auth | `node_modules/@github/copilot-sdk/dist/types.d.ts` (`CopilotClientOptions.gitHubToken`: "takes priority over other authentication methods"; `useLoggedInUser` defaults to false when a token is given); GitHub docs "Authenticate Copilot CLI": fine-grained PAT with **Copilot Requests: Read**, read from `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` | true: drives D4 |
| Telegram Bot API limits: `callback_data` 1–64 bytes, text ≤ 4096 chars, captions ≤ 1024, ~1 msg/s per chat, 20 msg/min per group, ~30 msg/s global, HTTP 429 + `retry_after`, `getFile` downloads ≤ 20 MB; topics routed by `message_thread_id`; webhook header `X-Telegram-Bot-Api-Secret-Token` | Telegram Bot API docs + limit references (checked 2026-10-07) | true: drives Slices 4, 10, 15 |
| Copilot / GitHub egress hosts: `api.githubcopilot.com`, `*.githubcopilot.com`, `copilot-proxy.githubusercontent.com`, `copilot-telemetry.githubusercontent.com`, `github.com`, `api.github.com`, `*.github.com`, `objects.githubusercontent.com` | GitHub "Copilot allowlist reference" (checked 2026-10-07) | true: D13 defaults. Plain Kubernetes NetworkPolicy matches IP blocks only; hostname rules need Cilium / Calico FQDN policies |
| `pforge drain-memory` POSTs to `http://localhost:3100/api/memory/drain` with the bridge secret from `.forge/bridge-secret` or `PFORGE_BRIDGE_SECRET`; port is fixed | `pforge.ps1` `Invoke-DrainMemory` | true: drives Slice 25 |
| pforge-mcp lists only the **core** tool profile unless `PFORGE_TOOL_PROFILE=full`; Forge-Master's own client sets it and starts the server with `--port 0` | `pforge-master/src/mcp-client.mjs:94–101` | true: the project MCP client (Seed SC-7) must do the same, or `forge_memory_capture` / Crucible tools are missing |
| Copilot SDK session contract: `new CopilotClient({...})`, `client.createSession({ model, workingDirectory, onPermissionRequest, onEvent, mcpServers })`, `session.sendAndWait({ prompt }, timeoutMs)`, `client.stop()`; permission requests `{ kind: "shell", fullCommandText }` / `{ kind: "write", fileName }` answered with `{ kind: "approve-once" }` or `{ kind: "reject", feedback }`; usage arrives as `assistant.usage` events | `pforge-mcp/orchestrator/sdk-worker.mjs` (`_defaultCreateSession`, `buildPermissionHandler`, `_sumUsage`); `types.d.ts` (`mcpServers?: Record<string, MCPServerConfig>`) | true: Seed SC-8 |
| MCP client contract: `Client` + `StdioClientTransport` from `@modelcontextprotocol/sdk/client/{index,stdio}.js`; SSE transport + `x-brain-key` header for OpenBrain | `pforge-master/src/mcp-client.mjs`; `pforge-mcp/openbrain-replay.mjs` `createSseClient` | true: Seeds SC-7, SC-14 |
| pforge-mcp RBAC (`.forge/rbac.json`, bearer / Entra / Okta providers) guards the **HTTP** transport only | `pforge-mcp/auth/*`, `.forge/rbac.example.json` | true: Forge-Claw's stdio MCP calls run inside the local trust boundary; its own allowlist and roles are separate (no change to RBAC) |
| vitest is 4.1.11 at the root and exits 1 when a named test file does not exist | `node_modules/vitest/package.json` | true: gates naming a test file the slice must create can fail (gate failability) |
| On Windows, Node refuses to spawn `.cmd` / `.bat` shims (`npm`, `npx`) without a shell (CVE-2024-27980 fix) | Node security release 2024-04 | true: Seed SC-10 resolves `npm` / `pforge` to real executables instead of using `shell: true` |
| Existing `escapeMdV2` character class | `pforge-mcp/bridge.mjs:198–199` | true: reused in Seed SC-5 (plus backslash, which Telegram also requires escaping) |

## Scope Contract

### In Scope

- **(a) New workspace package `pforge-claw/`** — dispatcher, Telegram adapter, router, project registry, state store, lanes, approvals, budget governor, scheduler, capture, cross-project commands, worker agent, deployment assets.
- **(b) Telegram as the first channel adapter**, behind a channel-agnostic `ChannelAdapter` interface — long-poll by default, webhook optional; forum-topic-per-project routing; inline-keyboard `callback_query` approvals; edit-in-place progress; voice-note capture (STT behind a flag).
- **(c) Copilot (GHCP) as the default agent runtime** via `@github/copilot-sdk`, behind an `AgentRuntime` interface with config-selected BYOK alternatives (`anthropic`, `openai`, `azure`) for operators without GHCP, with each project's plan-forge MCP server attached to the session; plan runs delegate to the existing orchestrator (`pforge run-plan`), never reimplemented.
- **(d) Lane abstraction** `lane.submit(job) → AsyncIterable<LaneEvent>` with three implementations: `LocalLane` (spawn on the dispatcher host), `RemoteLane` (outbound-WebSocket workers on any macOS / Windows / Linux host), `K8sJobLane` (ephemeral Kubernetes Job per task).
- **(e) Governance** — allowlist identity, single-use signed approvals, per-job permission policy (no `approveAll`), per-project + global budget caps, audit log of every inbound command and every mutation.
- **(f) Proactive features** — morning digest, stale-phase nudges, LiveGuard alert relay, scheduled skills.
- **(g) Multi-project** — registry, per-lane queues, `#general` rollups, fan-out jobs, scoped memory with explicit cross-project search, `restricted` projects.
- **(h) Deployment** — service units for macOS (launchd), Linux (systemd), Windows (Task Scheduler); dispatcher container image; worker base images; Kustomize manifests (Deployment, PVC, RBAC, NetworkPolicy, optional Ingress).
- **(i) `pforge claw` CLI subcommand** in **both** `pforge.ps1` and `pforge.sh`, registered in the CLI schema (`pforge-mcp/capabilities/schemas.mjs` → `cli-schema.json`), plus `pforge claw init` config generator, JSON Schema for the config, and example configs.
- **(k) Portability**: everything in the Portability & Configurability Contract; cross-platform CI (ubuntu / windows / macos + kind); a Tested Platforms matrix the community can extend.
- **(l) Memory (L2/L3) integration**: project-scoped captures through each project's MCP with provenance; optional direct OpenBrain client for cross-project reads and a bot namespace; automatic task-outcome capture; untrusted captures confirmed and tagged; restricted projects kept out of shared recall; worktree / remote / pod `.forge` history merged back to each project's canonical L2 home.
- **(j) Docs and capabilities sweep after all code is built**: guide, threat model, architecture doc, README, `docs/capabilities.md` / `.html`, `forge_capabilities` surface, CLI guide, manual chapters, glossary, event catalog, CHANGELOG, ROADMAP (Slice 29).

### Out of Scope

- Channels other than Telegram (Slack/Discord inbound) — the router is channel-agnostic, but only the Telegram adapter ships.
- Any change to MCP **tools** (`tools.json` must stay byte-identical in this phase; the `forge_master_ask` change belongs to FORGE-MASTER-CLAW-AWARE). `cli-schema.json` changes only by the additive `claw` command. A `forge_claw_*` tool family is a follow-up phase.
- Multi-tenant / third-party users on the operator's GHCP seat (see D8).
- General life-assistant capabilities (email, calendar, browser automation, shell-on-request outside a job).
- Replacing the existing outbound bridge — `bridge.mjs` keeps working unchanged; Forge-Claw is additive.
- Postgres or any new database for claw state (see D5).
- Publishing `pforge-claw` to npm (D23 follow-up).
- Helm charts, operators/CRDs, or cloud-managed K8s specifics — plain Kustomize with a base plus an `example` overlay that works on any conformant cluster (homelab or cloud).
- Changes to orchestrator slice execution semantics.

### Forbidden

- **Do not** set `onPermissionRequest` to `approveAll` or any blanket-allow equivalent — permission is decided per job class by the policy in Slice 9.
- **Do not** construct shell commands as strings — every `spawn` / `execFile` uses an args array (security Rule 1). This includes `git`, `pforge`, `copilot`, `kubectl`-equivalents.
- **Do not** log, persist, echo or embed in an error message: the Telegram bot token, GitHub/Copilot token, worker shared secrets, BYOK STT keys, or approval nonces.
- **Do not** respond in any way (including "unauthorised") to a Telegram user not on the allowlist — silent drop + audit line only.
- **Do not** run a mutating job (anything that can write to a repo, push, open a PR, or start `run-plan`) without a recorded, unexpired, single-use approval bound to the approving Telegram user ID.
- **Do not** write to a project's `.forge/runs/` — plan execution goes through `pforge run-plan`; the orchestrator owns that surface.
- **Do not** let a job operate in the operator's checked-out working tree — every job gets its own `git worktree` (or its own clone in K8s).
- **Do not** import from `pforge-mcp/` or `pforge-master/` source except via entries added to `layer-policy.json#crossPackageWhitelist` in the slice that needs them (see D1).
- **Do not** add a third-party dependency not listed in D3.
- **Do not** expose a listening port on a worker host — workers dial **out** to the dispatcher.
- **Do not** hardcode model names in claw logic — models come from the registry config / per-job selection and flow through to the SDK.
- **Do not** introduce a TypeScript build step.
- **Do not** ship a `.ps1` without its `.sh` twin (or vice versa).

## Shared Contract

### Package layout (target)

```
pforge-claw/
  package.json                 # @pforge/pforge-claw, type: module, engines >=22.12.0
  vitest.config.mjs            # mirrors pforge-master (Seed SC-16)
  cli.mjs                      # thin dispatcher → src/cli/<sub>.mjs
  config.schema.json           # normative config schema
  examples/                    # single-host / multi-host / k8s (placeholders only)
  src/
    errors.mjs                 # ClawError(code, details): message is the code, never a secret
    events.mjs                 # in-process bus: job.transition, job.finished, lane.event
    enums.mjs                  # frozen arrays: JOB_TYPES, JOB_STATES, LANE_KINDS, ROLES, VISIBILITY, LANE_EVENT_TYPES, CALLBACK_PREFIXES
    config.mjs  secrets.mjs  registry.mjs  init.mjs  snapshot.mjs  app.mjs  http.mjs
    cli/                       # init doctor status start worker service dev commands (one module each)
    features/                  # index.mjs + chat approvals budget progress scheduler alerts capture crossproject workers webhook memory
    commands/                  # index.mjs + one module per chat command (Shared Contract → Chat command registry rule)
    callbacks/                 # index.mjs + one module per callback prefix
    state/store.mjs
    channels/channel-adapter.mjs
    channels/telegram/         # client format poller webhook rate-limiter
    router.mjs
    mcp/project-client.mjs
    jobs/                      # model permission-policy worktree bootstrap runners
    lanes/                     # lane local-lane remote-lane k8s-job-lane
    runtime/                   # agent-runtime copilot-session byok
    approvals.mjs budget.mjs progress.mjs scheduler.mjs digest.mjs alerts.mjs capture.mjs stt.mjs crossproject.mjs placement.mjs
    protocol/                  # messages ws-server worker-agent
    k8s/api.mjs
    memory/                    # memory-client openbrain-direct l2-sync
  service/                     # launchd plist, systemd unit, install-service.ps1 / .sh
  scripts/                     # build-images.ps1 / .sh, e2e-k8s.ps1 / .sh
  deploy/                      # Dockerfile.dispatcher, Dockerfile.worker-base, worker-variants/, k8s/base, k8s/overlays/{example,dev}
  tests/                       # *.test.mjs, commands/*.test.mjs, e2e/*.test.mjs, helpers/*
```

### Module seams for parallel work (stub-first)

Several slices run at the same time (see **Parallelism map**). To stop them colliding in shared files, the shared extension points are created **as stubs up front**, and each later slice edits only its own module:

| Seam | Created by | Rule for later slices |
|---|---|---|
| `src/cli/<sub>.mjs` (one per subcommand) | Slice 1 | Edit only your subcommand module; `cli.mjs` itself never changes after Slice 1. `pforge.ps1` / `pforge.sh` pass `claw` arguments through unchanged after Slice 1. |
| `src/features/<name>.mjs` + static `features/index.mjs` | Slice 1 | A feature is `{ name, available, start(ctx), stop(), snapshot?(ctx), taskContext?(job, ctx), doctorChecks?(ctx) }`. Implement your feature module and flip `available: true`. `app.mjs` starts every available feature; `snapshot.mjs` merges every `snapshot()`; `src/doctor-checks.mjs` `runFeatureDoctorChecks` runs every available feature's `doctorChecks(ctx)` (returns `Array<{ name, status: "ok"|"warn"|"error"|"skip", detail, code? }>`; throws and hangs become warnings). `pforge claw doctor` calls it offline with `ctx.live === false` (config only, no project clients: return `skip` for live-only checks); the running dispatcher calls it via `app.doctor()` with `ctx.live === true` (started features, `ctx.mcp` live) and logs warn/fail items at startup. **Feature-specific doctor checks live in the feature's `doctorChecks()`; later slices never edit `src/cli/doctor.mjs`.** (Seam added at the S10–S25 merge checkpoint; `features/memory.mjs` is the reference implementation.) |
| `src/commands/<name>.mjs` + static `commands/index.mjs` | Slice 5 | See **Chat command registry rule**. |
| `src/callbacks/<prefix>.mjs` + static `callbacks/index.mjs` | Slice 5 | Prefixes: `a` approve (10), `b` budget (11), `f` failure (12), `x` alert (14), `t` triage (15), `m` memory type (7), `c` memory confirm (24), `p` proposed action (6), `s` select plan (9). The router answers every callback first, then dispatches by prefix. |
| `src/events.mjs` bus | Slice 1 | Runners emit `job.transition`, `job.finished`, `lane.event`; features subscribe instead of editing runners. |
| `config.schema.json` | Slice 2 (complete) | Add a key only if the Complete config reference lacks it, and update the examples in the same slice. |


### Host state directory

`PFORGE_CLAW_HOME` (default `~/.pforge-claw/`) — host-level, **not** inside any repo:

```
config.json        # registry, allowlist, schedules, caps (no secrets)
secrets.json       # optional; env vars take precedence; chmod 600 / ACL-restricted
state/
  offsets.json     # Telegram update offset
  jobs.jsonl       # job lifecycle events (append-only)
  approvals.jsonl  # issued / consumed / expired nonces (hash only, never the nonce)
  budget.jsonl     # spend ledger
  sessions.jsonl   # chat/topic ↔ Forge-Master session map
  audit.jsonl      # every inbound command + every mutation
worktrees/<project>/<jobId>/
logs/              # rotating structured logs (stdout in containers)
```

Additional state files: `state/updates.jsonl` (processed channel update ids, bounded window), `state/lanes.json` (`/lane` on/off), `state/schedules.json` (`lastRunAt`), `state/cursors.json` (alert / watch cursors), `state/memory-queue.jsonl` (direct OpenBrain client queue + dead letters), `state/enrollment.jsonl` (hashed worker enrollment codes). Every state record carries `v` for future migrations.

### Project registry entry (`config.json#projects[]`)

```json
{
  "id": "plan-forge",
  "displayName": "Plan Forge",
  "repo": { "path": "/path/to/plan-forge", "remote": "git@github.com:<owner>/<repo>.git", "baseBranch": "main" },
  "channel": { "adapter": "telegram", "chatId": "<chat-id>", "topicId": "<topic-id>" },
  "placement": { "prefer": ["k8s-jobs", "mac-1", "local"], "requires": [] },
  "models": { "chat": "<from registry>", "work": "<from registry>" },
  "homeLane": "mac-1",
  "keepAlive": false,
  "budget": { "dailyUSD": 5, "dailyPremiumRequests": 150 },
  "visibility": "normal",
  "image": "<registry>/<namespace>/pforge-claw-worker-node:<tag>"
}
```

### Lane registry entry (`config.json#lanes[]`)

Lanes are operator-defined; ids and labels are free-form. Nothing in code knows about specific machines.

```json
[
  { "id": "local",    "kind": "local",  "labels": ["linux"],          "enabled": true },
  { "id": "mac-1",    "kind": "remote", "labels": ["macos", "arm64"], "enabled": true },
  { "id": "ws-1",     "kind": "remote", "labels": ["windows"],        "enabled": true, "optIn": true },
  { "id": "k8s-jobs", "kind": "k8s",    "labels": ["linux", "ephemeral"], "enabled": true,
    "k8s": { "namespace": "pforge-claw", "defaultImage": "<registry>/<namespace>/pforge-claw-worker-node:<tag>" } }
]
```

Projects reference lanes by id in `placement.prefer` and by label in `placement.requires`. `optIn` lanes only take work while switched on (`/lane <id> on`).

### Memory config (`config.json#memory`, per-project `projects[].memory`)

```json
{
  "memory": {
    "openbrain": { "endpoint": "<optional https endpoint>", "tokenSecret": "OPENBRAIN_TOKEN" },
    "botNamespace": "pforge-claw:<instanceId>",
    "captureTaskOutcomes": true,
    "captureApprovals": false,
    "captureInsights": false
  },
  "projects": [ { "id": "client-x", "visibility": "restricted", "memory": { "l3": "off" }, "repo": { "forgeHome": "<lane-id>:<path>" } } ]
}
```

Everything is optional. With no `memory.openbrain`, all memory flows through each project's own Plan Forge configuration; with OpenBrain absent entirely, recall is L2-only (`forge_search`).

### Install & home model (D23, D24)

- **Forge-Claw is a host-level tool, not a per-project file set.** It runs from a Plan Forge framework clone. `pforge claw` in any project resolves `pforge-claw/cli.mjs` from, in order: `PFORGE_CLAW_PATH`; the Plan Forge source that `pforge update` / `self-update` already uses (sibling clone or configured path); the current repo if it is Plan Forge itself. If none is found it prints install instructions and exits 1.
- **Each project has a home lane** (`homeLane`) that holds its checkout (`repo.path` on that lane) and canonical L2 (`forgeHome` = `<homeLane>:<repo.path>/.forge`). Every project MCP call (asks, captures, recall, status, digest data, alerts) runs on the home lane as a **read job**: no worktree, no approval, low-latency lease. The dispatcher never needs repo checkouts. In single-host mode `homeLane` is `local`.

### Complete config reference (`config.json`)

```json
{
  "v": 1,
  "instanceId": "<generated by init; stable random id>",
  "timezone": "<IANA tz, e.g. Etc/UTC>",
  "channels": {
    "telegram": { "enabled": true, "botTokenSecret": "PFORGE_CLAW_TELEGRAM_TOKEN", "mode": "poll",
                  "generalChat": { "chatId": "<chat-id>", "topicId": "<topic-id>" },
                  "webhook": { "url": "<https url>", "secretTokenSecret": "PFORGE_CLAW_TELEGRAM_WEBHOOK_SECRET" } }
  },
  "allowlist": [ { "channel": "telegram", "userId": "<user-id>", "role": "owner", "alias": "<display alias>" } ],
  "policy": { "ghcpRoles": ["owner"], "nonOwnerRuntime": "byok-only" },
  "runtimes": {
    "default": "copilot-sdk",
    "byok": { "anthropic": { "keySecret": "ANTHROPIC_API_KEY" }, "openai": { "keySecret": "OPENAI_API_KEY" }, "azure": { "keySecret": "AZURE_OPENAI_API_KEY", "endpoint": "<url>" } },
    "pforgeCommand": "auto"
  },
  "lanes": [ "… see Lane registry entry …" ],
  "projects": [ "… see Project registry entry …" ],
  "budget": { "dailyUSD": 20, "dailyPremiumRequests": 300, "maxUnknownPerDay": 10 },
  "jobs": { "keepFailedWorktreeHours": 24, "pushOnFailure": false },
  "bootstrap": { "copy": [".forge.json", ".forge/fm-prefs.json"], "env": ["XAI_API_KEY"], "install": "link" },
  "mcp": { "serverName": "plan-forge", "idleMinutes": 10, "toolProfile": "full" },
  "schedules": [ { "id": "digest", "kind": "digest", "at": "daily 07:30" },
                 { "id": "weekly-audit", "kind": "skill", "project": "<project-id>", "skill": "security-audit", "at": "weekly Mon 06:00", "preApproved": false } ],
  "capture": { "voice": { "enabled": false, "provider": "openai", "keySecret": "OPENAI_API_KEY" } },
  "memory": { "… see Memory config …": true },
  "worker": { "dispatcherUrl": "wss://<host>/claw/workers", "laneId": "<lane-id>", "secretName": "PFORGE_CLAW_WORKER_SECRET", "allowInsecureLan": false },
  "http": { "bind": "127.0.0.1", "port": 3190 },
  "k8s": { "egress": { "allow": ["github.com", "api.github.com"] } }
}
```

`runtimes.pforgeCommand: "auto"` means `["pwsh", "-NoProfile", "-File", "pforge.ps1"]` on Windows and `["bash", "pforge.sh"]` elsewhere, run with `cwd` at the worktree root (Seed SC-10). An explicit array overrides it (tests use this to substitute a fake).

`config.schema.json` (Slice 2) is the normative form of this example; any key a later slice needs is added to the schema and the examples in that slice.

### Secret names

| Name | Used by | Notes |
|---|---|---|
| `PFORGE_CLAW_TELEGRAM_TOKEN` | Telegram adapter | BotFather token |
| `PFORGE_CLAW_TELEGRAM_WEBHOOK_SECRET` | webhook mode | random; checked against `X-Telegram-Bot-Api-Secret-Token` |
| `PFORGE_CLAW_WORKER_SECRET` | each worker | generated by enrollment (D11); never typed by hand |
| `PFORGE_CLAW_GH_TOKEN` | pods / workers without `gh auth` | clone, push, PR; scoped to the registered repos |
| `PFORGE_CLAW_COPILOT_TOKEN` | pods and login-less hosts | fine-grained PAT with Copilot Requests: Read; passed as `gitHubToken` and exported as `COPILOT_GITHUB_TOKEN` (D4) |
| `PFORGE_BRIDGE_SECRET` | K8s pods | lets `pforge drain-memory` call the pod's own MCP REST endpoint (Slice 25) |
| `OPENBRAIN_URL`, `OPENBRAIN_KEY` | direct OpenBrain client | same names as `.vscode/mcp.json`; sent as the `x-brain-key` header by default (`memory.openbrain.header` overrides) |
| BYOK keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`) | BYOK runtimes, STT | standard names |

Resolution order: process env → `$PFORGE_CLAW_HOME/secrets.json` → K8s Secret env. Names are configurable; values never appear in config.

### Schedule grammar

`daily HH:MM` · `weekly <Mon|Tue|…> HH:MM` · `monthly <1-28> HH:MM` · `every <N>m` (N ≥ 5). Times are in `timezone`. Anything else fails config validation with a hint. No cron syntax, no cron library.

### Job model

`JOB_TYPES`: `ask` (read-only Q&A), `capture` (memory/crucible/bug write via MCP — non-repo), `skill` (`forge_run_skill`), `plan` (`pforge run-plan`), `task` (ad-hoc agent work in a worktree → branch/PR), `fanout` (parent of N child jobs).

`JOB_STATES`: `queued`, `awaiting-approval`, `approved`, `rejected`, `expired`, `held-budget`, `leased`, `running`, `needs-input`, `succeeded`, `failed`, `cancelled`. Flow: `queued → awaiting-approval → (approved | rejected | expired)`; `approved → [held-budget ⇄ approved] → leased → running ⇄ needs-input → (succeeded | failed | cancelled)`. **Terminal**: `succeeded`, `failed`, `cancelled`, `rejected`, `expired`. `held-budget` and `needs-input` are not terminal. Read jobs (`ask`, `capture`) skip approval: `queued → leased → running → …`. Transitions are append-only events in `jobs.jsonl`; current state is a fold.

Mutating = `skill` (unless its `SKILL.md` frontmatter declares `readOnly: true`; anything else is mutating), `plan`, `task`, `fanout`. Mutating jobs **must** pass through `awaiting-approval`. `capture` jobs write only memory / Crucible / bugs (no repo) and need no approval, but untrusted-origin captures need a confirm card (D21).

**`/run <plan>` resolution**: an exact repo-relative path wins; otherwise a unique case-insensitive match of `docs/plans/*<name>*-PLAN.md`; several matches → reply with buttons to choose; none → explicit message.

**After a job finishes in a worktree**: `plan` and `task` jobs that succeed push `claw/<jobId>` and open a PR against `baseBranch` with `gh` (args array), title `[claw] <plan or task summary>`, body = run summary + job id. Forge-Claw never merges. Failed jobs push only if `jobs.pushOnFailure`; the worktree is kept for `jobs.keepFailedWorktreeHours`.

### LaneEvent

`{ v: 1, jobId, seq, ts, type: "started"|"progress"|"log"|"slice"|"cost"|"artifact"|"needs-input"|"finished", data }` — `seq` is monotonic per job so a reconnecting worker can resume without duplicates.

### Chat command registry rule

Every chat command is one module `src/commands/<name>.mjs`, listed in the static `src/commands/index.mjs`; Slice 5 creates all of them as stubs (`available: false`). A slice that implements a command edits **only** that module and its test `tests/commands/<name>.test.mjs`: implement `handle`, set `available: true`, and keep `summary` / `details` / `examples` / `roles` / `scope` / `mutating` accurate. `tests/help.test.mjs` is generic over the registry, so no slice edits it after Slice 5. The drift guard fails if a handler is missing for an available command, or a command has no module. Owning slices: `/ask` `/new` 6 · `/remember` `/recall` `/idea` `/bug` 7 · `/run` `/skill` `/task` `/jobs` `/abort` `/retry` 9–12 · `/budget` 11 · `/status` `/fanout` 16 · `/lane` `/lanes` 23 · `/forget` 24.

## Portability & Configurability Contract

Plan Forge is open source. Forge-Claw ships as a **generic, configurable** capability; the author's environment (macOS host, Windows host, Linux Kubernetes cluster) is only the reference validation environment. Every slice must satisfy:

| Concern | Rule |
|---|---|
| **No operator specifics** | No hostnames, chat ids, user ids, repo paths, GitHub owners, registries, cluster names, IPs or time zones in code, defaults, tests (outside `tests/fixtures`) or examples. Examples use placeholders (`<owner>`, `<registry>`, `<chat-id>`, `example.com`). Enforced by the Slice 1 portability guard. |
| **Hosts are lanes, lanes are config** | Machines are `lanes[]` entries with free-form `id` and `labels`. Placement matches labels; no code branches on a machine name. `optIn` lanes (e.g. a personal workstation) take work only while switched on. |
| **Platforms** | Dispatcher and workers run on macOS, Windows and Linux (x64 + arm64). Paths via `path.join`/`path.resolve`; spawn via args arrays; no shell-specific syntax. Service install for launchd, systemd and Windows Task Scheduler with `.ps1`/`.sh` twins. |
| **Kubernetes** | Any conformant cluster (homelab, k3s, kind, AKS/EKS/GKE). Kustomize `base` holds no environment values; operators copy `overlays/example`. Namespace, images, registry, storage class, ingress host, egress allowlist and resource limits are all overlay/config values. NetworkPolicy enforcement depends on the CNI, and `doctor` reports it. Multi-arch images (amd64 + arm64). |
| **Channels** | `ChannelAdapter` interface (receive updates, send/edit messages, buttons/callbacks, menus, file download, limits). Telegram is the first adapter; router, commands, approvals, progress and help are channel-agnostic. Adapter-specific limits (message length, button payload size) come from the adapter, not hardcoded in core. |
| **Agent runtime** | `AgentRuntime` interface. Default `copilot-sdk` (GHCP). Configurable BYOK runtimes (`anthropic`, `openai`, `azure`) per lane or project for operators without GHCP, with keys from env / secrets only. Model names come from config, never code. |
| **Optional pieces degrade gracefully** | OpenBrain absent → `/recall` uses local `forge_search` only. No K8s → M3 lanes are simply not configured. No public URL → long-poll. STT off → voice notes get a "not enabled" reply. Observer off → raw-event alerts. GHCP absent → BYOK or `ask`-only. Each case is visible in `doctor` and covered by a test. |
| **Safe defaults for strangers** | Empty allowlist means the bot refuses to start. Approvals are always on for mutating jobs. Webhook off. HTTP binds `127.0.0.1`. STT off. Every feature flag defaults to the conservative choice. |
| **Discoverable configuration** | `config.schema.json` is published; `pforge claw init` generates config from `examples/`; `doctor` explains every misconfiguration with a fix hint. |
| **Community validation** | The guide carries a **Tested Platforms** matrix (OS / arch / K8s distro / CNI / runtime / channel) with how-to-contribute instructions. CI covers ubuntu, windows and macos plus kind; the reference environment adds real macOS, Windows and Linux K8s. |

## Required Decisions

| # | Decision | Proposed resolution |
|---|---|---|
| D1 | Where does the code live and how does it reach Plan Forge internals? | New workspace `pforge-claw/`. It talks to Plan Forge **only** through (a) each project's plan-forge MCP server over stdio (`@modelcontextprotocol/sdk` client) and (b) the `pforge` CLI via args-array spawn. **Zero** source imports from `pforge-mcp/` or `pforge-master/`. Add a `pforge-claw` rule to `dep-boundaries.mjs` (`PACKAGE_RULES`: may not import other Plan Forge packages) and a source-read guard test. |
| D2 | Telegram transport | Long-poll (`getUpdates`, `timeout=50`, persisted offset) by default — no inbound port. Webhook mode (behind the operator's existing public URL / ingress) is opt-in in M2 and **must** verify `X-Telegram-Bot-Api-Secret-Token`. Raw `fetch`, no Telegram library. |
| D3 | Dependencies | `@github/copilot-sdk`, `@modelcontextprotocol/sdk`, `ws` — all already used in the monorepo, same major versions. Dev: `vitest`. **No** other third-party deps (no telegraf, no node-cron, no k8s client, no pg). |
| D4 | Headless Copilot auth (verified) | Long-lived lanes on any OS: `useLoggedInUser: true` (the operator signs in once with `copilot` / `gh auth login`). Containers and any host without a login: a fine-grained PAT with **Copilot Requests: Read**, stored as the secret `PFORGE_CLAW_COPILOT_TOKEN`, passed to `new CopilotClient({ gitHubToken })` and exported to child processes as `COPILOT_GITHUB_TOKEN`. The token must belong to the seat holder (D8). If no token is configured for a K8s lane, that lane runs BYOK-only and `doctor` says so. |
| D5 | State store | Append-only JSONL + periodic atomic snapshot under `PFORGE_CLAW_HOME/state/` (a PVC in K8s). Single dispatcher writer. No database. Revisit only if job volume exceeds ~10k/day. |
| D6 | Approval mechanism | Inline keyboard `callback_query` with `callback_data = "a:<jobIdShort>:<nonceShort>"` (≤ 64 bytes). Nonce is 128-bit random, stored as SHA-256 hash, single-use, TTL 15 min, bound to the requesting chat **and** the approving `from.id` (must be on the allowlist with `approve` role). The existing URL-based `/api/bridge/approve` path is untouched. |
| D7 | Forge-Master integration | Call `forge_master_ask` through the project's MCP client (no extra HTTP process) using the FORGE-MASTER-CLAW-AWARE contract. Always send `caller` (role, `channel:"chat"`, `surface:"<adapter id>"`, project, topic) and `responseFormat:{style:"brief",maxChars:3500}`, plus `proposeActions:true`. Send forwarded or captured content **only** as `untrustedContext`, never inside `message`. Send a compact Forge-Claw state snapshot (queue, held jobs, workers, today's spend; ≤ 4 KB) as a `contextBlocks` entry. `proposedActions` render as inline buttons; tapping one creates a job that still goes through Forge-Claw role checks and approval. `untrusted`-origin proposals are labelled ⚠️ in the card. Map `(chatId, topicId)` → `sessionId` in `sessions.jsonl`; `/new` drops the mapping. Simulate streaming with `sendChatAction: typing` plus a single edit on completion. |
| D8 | Seat / runtime policy | Configurable, with a safe default: GHCP-backed jobs may be triggered only by `owner` identities (an individual Copilot seat is for its holder; operators are responsible for their own license terms, and the guide says so). Allowlist roles: `owner` (all), `approver`, `viewer` (read-only `ask`). Non-`owner` identities may only trigger jobs whose runtime is a configured **BYOK** provider; otherwise `ask`-only. Enforced in `router.mjs`; policy keys in `config.json#policy`. |
| D9 | Budget source of truth | Dispatcher-owned `budget.jsonl` with two independent units, `costUSD` and `premiumRequests`. Caps `budget.dailyUSD` and `budget.dailyPremiumRequests`, global and per project; each cap is enforced only against **reported** values. Unreported usage is `null` (never 0) and increments an `unknownUsageJobs` counter; past `budget.maxUnknownPerDay` further mutating jobs are held. `task` / `ask` usage comes from runtime and Forge-Master `usage`; `plan` actuals from `forge_cost_report`. Pre-flight `plan` estimates come **only** from `forge_estimate_quorum`, never hand-computed. Exceeding a cap → `held-budget` with an owner-only "approve over budget" button. |
| D10 | Plan execution path | `plan` jobs run `pforge run-plan <plan> [--quorum=…]` in the job worktree (args array). Progress comes from the worktree's hub (`forge_watch_live` / events JSONL tail), not from parsing stdout. Abort → `forge_abort`. Resume → `--resume-from`. |
| D11 | Worker protocol | WebSocket (`ws`), worker dials **out** to `wss://<dispatcher>/claw/workers`. Auth: per-worker ID + shared secret → HMAC-SHA256 challenge on connect (secret never sent). Messages JSON with `v` field; job lease with ack + heartbeat (15 s) + lease expiry (60 s) → requeue. Event resume by `seq`. Two lease kinds: `job` (mutating, worktree) and `read` (home-lane MCP calls, D24). **Enrollment**: `pforge claw worker enroll --lane <id>` on the dispatcher prints a single-use code valid 15 min (hash stored); the worker runs `pforge claw worker join --code <code>` once to receive a generated 256-bit secret saved in its own secret store; `pforge claw worker revoke <id>` removes it. **Transport**: `wss://` is required unless the dispatcher URL is loopback. TLS comes from the operator's ingress / reverse proxy or a private overlay network (Tailscale, WireGuard), both documented. Plain `ws://` to a non-loopback address is refused unless `worker.allowInsecureLan: true` (off by default, warned on every connect). |
| D12 | K8s integration | Dispatcher creates Jobs through the in-cluster REST API using `fetch` + the mounted ServiceAccount token/CA. RBAC: `create/get/list/watch/delete` on `jobs` and `get/list/watch` on `pods`, `pods/log` in the claw namespace **only**. The Job pod runs `pforge claw worker --one-shot --job <id>` and streams LaneEvents back over the worker protocol. |
| D13 | Network egress for job pods | Default-deny NetworkPolicy; allow DNS, the dispatcher Service, the OpenBrain endpoint, and the GitHub / Copilot defaults from Assumptions (`api.githubcopilot.com`, `*.githubcopilot.com`, `copilot-proxy.githubusercontent.com`, `copilot-telemetry.githubusercontent.com`, `github.com`, `api.github.com`, `*.github.com`, `objects.githubusercontent.com`) plus the npm registry for `npm ci`. The allowlist of hostnames/CIDRs is **configuration** (`k8s.egress.allow[]`), with GitHub/Copilot defaults. The cluster's CNI must enforce NetworkPolicy (e.g. Calico, Cilium); `doctor` detects and warns otherwise, and the guide documents the risk of running without it. |
| D14 | STT for voice notes | Off by default (`capture.voice.enabled=false`). When on, BYOK provider (`openai` Whisper or `azure` Speech) with the key from env / secrets. Audio is deleted after transcription; transcript is shown back for confirmation before any write. |
| D15 | Ship surface / branch | Package lives in the monorepo and ships on `master` as **experimental, opt-in** (not installed or started by `setup.ps1/.sh`). This plan file stays on `planning/main` only. Package version tracks the monorepo version. |
| D16 | Scheduler | In-process scheduler with explicit IANA timezone in config, minute resolution, persisted `lastRunAt` per schedule to avoid duplicates across restarts. No cron library. |
| D17 | Generic-by-default rule | All machine, channel, runtime and cluster specifics are configuration (Portability & Configurability Contract). Enforced by the portability guard test (Slice 1), schema-validated examples (Slice 2), and a reviewer checklist item. |
| D18 | Channel abstraction | `src/channels/channel-adapter.mjs` defines the interface; `src/channels/telegram/` implements it. Core modules import only the interface. Other adapters (Slack, Discord, Teams, Matrix) are community follow-ups and need no core changes. |
| D19 | Agent runtime abstraction | `src/runtime/agent-runtime.mjs` interface; `copilot-sdk` default; BYOK runtimes via the SDK's provider config (the same mechanism Phase-60 uses), selected per lane or project in config. |
| D20 | Cross-platform CI | New `.github/workflows/pforge-claw.yml`: unit + offline e2e on `ubuntu-latest`, `windows-latest` and `macos-latest` (Node 22.12 + 24), plus a kind-based K8s e2e job on ubuntu (amd64). Path-filtered to `pforge-claw/**` and the shared CLI files. arm64 coverage comes from the reference environment and community reports. |
| D23 | Install & home model | Host-level tool run from a Plan Forge framework clone; `pforge claw` resolves it via `PFORGE_CLAW_PATH` → the `update` / `self-update` source → the current repo (Shared Contract → Install & home model). Projects need nothing beyond a normal Plan Forge setup. npm publishing is a follow-up. |
| D24 | Home lane & read path | Each project's `homeLane` owns its checkout and canonical `.forge`. All project MCP calls run there as `read` leases; the dispatcher holds no repos. Single-host: `homeLane = local`. |
| D25 | Job bootstrap | Worktrees and clones lack gitignored state (`.forge.json`, `.forge/`, `node_modules`). Before a mutating job: (1) worktree / clone from `baseBranch`; (2) copy the `bootstrap.copy` allow-list from forgeHome (default `.forge.json`, `.forge/fm-prefs.json`; **never** `.forge/secrets.json`); (3) secrets only as environment variables from the executing lane's own store (`bootstrap.env` names), never as files in the worktree; (4) dependencies by `bootstrap.install`: `link` (default for worktrees; reuse the home checkout's `node_modules` via a directory junction on Windows or a symlink elsewhere), `ci` (`npm ci`; default for pods) or `none`; (5) run `pforge smith`, and a non-zero exit fails the job with `reason: bootstrap`. Pods receive the copy set from the home lane over the worker protocol. |
| D26 | Long-lived project processes | Projects with `keepAlive: true` (needed for observer-based alerts) keep their project MCP server running on the home lane with the hub on and `forge_master_observe start` issued. Other projects start on demand and stop after `mcp.idleMinutes` (default 10). `doctor` verifies keepAlive projects have a live hub and observer. |
| D27 | Observer-insight transport (pull) | **Decided 2026-10-07 (operator):** the Forge-Master observer runs in the pforge-master studio child of each project's pforge-mcp, and the pforge-mcp hub does not accept events from other processes, so `forge-master-insight` hub events are not visible to `forge_watch_live`. Forge-Claw **pulls** insights with `forge_master_observe { action:"status", limit, cursor }` through the project's MCP client (pforge-mcp proxies the call to the same studio child that owns the insight ring; added as a Phase-61 follow-up). Insights are de-duplicated by insight `id`; the paging cursor is persisted per project. No hub/WebSocket security-boundary change. |
| D21 | Memory integration | Project-scoped writes only through the project's MCP (`forge_memory_capture`), inheriting Plan Forge's queue, dedupe, dead-letter and Hallmark behaviour. Optional direct OpenBrain client only for cross-project reads and the bot namespace. No channel user ids or names in shared memory. `/remember` asks for the type with buttons (`decision` · `lesson` · `convention` · `pattern` · `gotcha`). Content from forwards, links or transcripts is written only after an explicit confirm card, with `origin: "untrusted"`. Per-project `memory.l3` and `visibility` decide what reaches shared L3. |
| D22 | L2 consolidation | **Verified:** pforge-mcp has no `.forge` directory override, so jobs in worktrees, remote workers and pods produce L2 history outside the operator's checkout. Forge-Claw merges each job's `.forge` delta back into the project's canonical L2 home (`repo.forgeHome`): verbatim copies of orchestrator-produced artifacts, append-only, idempotent. Pods drain the OpenBrain queue and ship leftovers before exit. Upstreaming a `.forge` override or a `pforge import-runs` command is a follow-up. |

_All decisions were resolved at hardening on 2026-10-07; verification evidence is in Assumptions._

## Acceptance Criteria

- **MUST**: An unknown Telegram user receives no reply of any kind; an audit line is written (Slice 5 test).
- **MUST**: `/help` (aliases `/start`, `help`, `-help`, `--help`) lists exactly the commands the caller may run in that topic, generated from the single registry in `src/commands.mjs`; the Telegram `/` menu is synced from the same registry, and a drift guard test fails if router, registry and help disagree.
- **MUST**: Every mutating job transitions through `awaiting-approval` and runs only after a valid, unexpired, single-use, identity-bound approval (Slice 10 tests: replay, expiry, wrong user, wrong chat).
- **MUST**: `approveAll` and string-built shell commands appear nowhere in `pforge-claw/` (guard tests).
- **MUST**: No secret value appears in `state/*.jsonl`, logs, or Telegram output (redaction guard test with planted canary values).
- **MUST**: Jobs never touch the operator's working tree — each runs in its own worktree/clone (Slice 9 test).
- **MUST**: `pforge-claw/` imports nothing from `pforge-mcp/` or `pforge-master/` source (guard test + `dep-boundaries` rule).
- **MUST**: `node pforge-mcp/server.mjs --check` passes; `tools.json` is byte-identical to the phase start, and the locally regenerated (gitignored) `cli-schema.json` differs only by the additive `claw` command.
- **MUST**: No operator-specific value (host, chat id, path, owner, registry, hostname) exists in `pforge-claw/` code, defaults or examples (portability guard test); every example config validates against `config.schema.json`.
- **MUST**: Unit + offline e2e suites pass on ubuntu, windows and macos CI runners, and the kind-based K8s e2e job passes on ubuntu (Slice 28).
- **MUST**: Every optional dependency (OpenBrain, K8s, webhook ingress, STT, GHCP) can be absent: `doctor` reports it and the related features are disabled with an explanatory message, never a crash.
- **MUST**: Forwarded / untrusted content is never written to memory without an explicit confirm, and is always stored with `origin: "untrusted"`; restricted projects never appear in cross-project recall (Slices 7, 15, 24 tests + e2e).
- **MUST**: Every job's `.forge` history ends up in the project's canonical L2 home, including from K8s pods with OpenBrain unreachable (Slice 25 tests + e2e).
- **MUST**: After the doc sweep, `node scripts/generate-capabilities-doc.mjs --check` and `node docs/manual/maintain.mjs --audit` pass, and `forge_capabilities` describes Forge-Claw.
- **MUST**: `pforge claw` exists in both `pforge.ps1` and `pforge.sh` with the same subcommands.
- **MUST**: Budget caps hold jobs that would exceed them; `plan` estimates come from `forge_estimate_quorum`.
- **MUST**: Worker hosts open no listening port; workers authenticate with HMAC challenge, never sending the secret.
- **MUST**: K8s RBAC is namespace-scoped and limited to the verbs in D12; NetworkPolicy is default-deny egress.
- **MUST**: The offline e2e suite (`pforge-claw` `test:e2e`, fake Telegram + scripted Copilot session) passes every scenario in Slice 27, including the simulated 7-day digest (success metric 2).
- **SHOULD**: The live environment (reference topology: dispatcher in a Linux K8s cluster, a macOS worker, a Windows worker, and a K8s Job lane) runs the Slice 27 live scenarios with real Telegram and GHCP.
- **SHOULD**: Three projects run concurrent jobs end-to-end (success metric 3).
- **SHOULD**: No file in `pforge-claw/src/` exceeds 1,000 LOC; no function exceeds the clean-code thresholds.

## Stack Boundary

Node.js ESM (`.mjs`), no build step, Node `>=22.12.0`, vitest with the repo's existing config conventions. Deployment assets are YAML (Kustomize), Dockerfiles, a launchd plist, a systemd unit, and paired `install-service.ps1` / `install-service.sh`. No changes to `pforge-mcp/` runtime code or `pforge-master/` runtime code in this phase; the only edits outside `pforge-claw/` are the root `package.json` workspaces entry, `pforge.ps1` / `pforge.sh` dispatch, `scripts/audit/dep-boundaries.mjs` / `layer-policy.json`, CLI-schema registration (`pforge-mcp/capabilities/schemas.mjs` + regenerated `cli-schema.json`), the Forge-Claw entry in the capabilities surface (`pforge-mcp/capabilities/surface.mjs`, Slice 29, metadata only), a new CI workflow (`.github/workflows/pforge-claw.yml`), `CHANGELOG.md`, `ROADMAP.md`, `README.md`, and docs (incl. `docs/manual/`). Supported platforms: macOS, Windows and Linux (x64 + arm64) for dispatcher and workers; any conformant Kubernetes cluster for M2/M3.

## Security Posture

1. **Identity**: allowlist of Telegram user IDs with roles (D8). Group/topic messages are accepted only from configured chat IDs. Free-text asks in topics require the bot to receive all group messages: either disable BotFather privacy mode or make the bot a group admin. `doctor` checks `getMe.can_read_all_group_messages` and, if false, warns that only `/commands`, replies and mentions will arrive. The allowlist (not privacy mode) is the security boundary.
2. **Prompt injection**: forwarded messages, links, photos, voice transcripts and file contents are *data*. They can only produce `capture` or `ask` jobs directly; anything mutating requires an approval the model cannot issue. The permission policy (Slice 9) denies writes and shell for `ask`, restricts writes to the job worktree for `task` / `skill`, and allows network access only through allowlisted commands (`git`, `gh`, `npm`/`npx`, `pforge`) and MCP. Agent-initiated fetch/browse tools are denied for every job type.
3. **Secrets**: env → `secrets.json` resolution at call time; redaction helper wraps every log/audit/Telegram write; canary-based guard tests.
4. **Approvals**: D6 — hashed, single-use, TTL, user- and chat-bound; replay and forgery tests.
5. **Transport**: worker protocol over TLS (`wss`) with HMAC challenge; webhook mode verifies Telegram secret header; dispatcher HTTP binds `127.0.0.1` unless explicitly configured behind ingress.
6. **Blast radius**: worktree-per-job; K8s Job pods with resource limits, `activeDeadlineSeconds`, non-root, read-only root FS where possible, default-deny egress (D13); namespace-scoped RBAC (D12).
7. **Audit**: `audit.jsonl` records every inbound command (user ID, chat, topic, parsed intent — not raw message bodies of forwarded content), every approval decision, and every job mutation summary (branch, PR URL, commit SHAs).
8. **Memory poisoning**: untrusted content reaches memory only after an explicit confirm, always tagged `origin: "untrusted"`, and is fenced again on every recall (companion D11). Restricted projects never leave their own scope.
9. **Repo mutation contract**: approvals are the dry-run/confirm step — the approval card shows the intended effect (plan + estimate, or task description + target branch) before anything runs.

## Seed Code (reference implementations)

Verified starting points for the slices that need them. Each slice's orientation task names its seeds. They are **reference skeletons**: adapt names to the Shared Contract, keep them small, and let the slice's tests be the authority. Every snippet uses only Node 22 built-ins plus the dependencies allowed by D3.

### SC-1 — Module seams, errors, events (Slices 1, 5, 6, 7, 9)

```js
// src/errors.mjs: the message is always the code; details never carry secrets.
export class ClawError extends Error {
  constructor(code, details = {}) { super(code); this.name = "ClawError"; this.code = code; this.details = details; }
}

// src/events.mjs
import { EventEmitter } from "node:events";
export const bus = new EventEmitter(); // "job.transition" | "job.finished" | "lane.event"

// src/features/scheduler.mjs (every feature has this shape; stubs ship with available: false)
export default {
  name: "scheduler",
  available: false,
  async start(ctx) {},
  async stop() {},
  snapshot(ctx) { return null; },          // merged into the Forge-Master context block
  // taskContext: async (job, ctx) => [],  // optional: extra context before a task job
};

// src/features/index.mjs: static list, complete from Slice 1 onward
import chat from "./chat.mjs"; import approvals from "./approvals.mjs"; /* … one import per feature … */
export const FEATURES = Object.freeze([chat, approvals /* , budget, progress, scheduler, alerts, capture, crossproject, workers, webhook, memory */]);

// src/commands/run.mjs (every command has this shape; Slice 5 creates them all as stubs)
export default {
  name: "run", aliases: [], args: "<plan> [auto|speed|power|false]",
  summary: "Run a hardened plan in a worktree (needs approval)",
  details: "Resolves the plan, shows a forge_estimate_quorum card, waits for approval, then runs it.",
  examples: ["/run Phase-31", "/run docs/plans/Phase-31-FOO-PLAN.md speed"],
  roles: ["owner", "approver"], scope: "project", mutating: true, available: false,
  async handle(ctx, { args, project, caller }) { /* returns { reply, keyboard? } */ },
};

// src/callbacks/a.mjs (every callback module has this shape)
export default { prefix: "a", available: false, async handle(ctx, { payload, caller, chatId }) {} };

// ctx is built once in app.mjs and passed everywhere:
// { config, secrets, store, log, bus, channel, mcp(projectId), jobs, lanes, approvals, budget }
```

### SC-2 — Secrets and redaction (Slices 2, 26)

```js
import { existsSync, readFileSync } from "node:fs";
const TOKEN_SHAPES = /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|\d{6,12}:[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9_-]{20,})\b/g;

export function createSecrets({ env = process.env, file } = {}) {
  const fromFile = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const seen = new Map();                       // name -> value, only for values actually read
  return {
    get(name) {
      const v = env[name] ?? fromFile[name] ?? null;
      if (typeof v === "string" && v.length >= 6) seen.set(name, v);
      return v;
    },
    has(name) { return Boolean(env[name] ?? fromFile[name]); },  // doctor: presence only
    redact(text) {
      let out = String(text);
      for (const [name, v] of seen) out = out.split(v).join(`«redacted:${name}»`);
      return out.replace(TOKEN_SHAPES, "«redacted»");
    },
  };
}
```

### SC-3 — Append-only state store (Slice 3)

```js
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createStore(dir, { redact = (t) => t } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = (stream) => join(dir, `${stream}.jsonl`);
  return {
    append(stream, record) {
      const line = redact(JSON.stringify({ v: 1, ts: new Date().toISOString(), ...record }));
      appendFileSync(file(stream), line + "\n");
    },
    *read(stream) {
      if (!existsSync(file(stream))) return;
      for (const line of readFileSync(file(stream), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { yield JSON.parse(line); } catch { /* torn last line after a crash: skip it */ }
      }
    },
    fold(stream, reducer, initial) { let acc = initial; for (const r of this.read(stream)) acc = reducer(acc, r); return acc; },
    writeJsonAtomic(name, value) {
      const target = join(dir, name), tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(value, null, 2));
      renameSync(tmp, target);                    // atomic on the same volume, all OSes
    },
    lock() {                                      // single dispatcher writer (D5)
      const path = join(dir, "dispatcher.lock");
      try { closeSync(openSync(path, "wx")); writeFileSync(path, String(process.pid)); }
      catch {
        const pid = Number(readFileSync(path, "utf8"));
        try { process.kill(pid, 0); throw new Error("LOCKED"); } catch (e) { if (e.message === "LOCKED") throw e; unlinkSync(path); return this.lock(); }
      }
      return () => { try { unlinkSync(path); } catch {} };
    },
  };
}
```

### SC-4 — Telegram Bot API client (Slice 4)

```js
import { ClawError } from "../../errors.mjs";

export function createTelegramClient({ token, apiBase = "https://api.telegram.org", fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token) throw new ClawError("TELEGRAM_TOKEN_MISSING");
  async function call(method, body = {}, { retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
      } catch (err) {
        // never forward err.message: network errors can echo the URL, which contains the token
        throw new ClawError("TELEGRAM_NETWORK", { method, cause: err.code ?? err.name });
      }
      const data = await res.json().catch(() => ({ ok: false, description: "non-JSON response" }));
      if (data.ok) return data.result;
      if (res.status === 429 && attempt < retries) { await sleep((data.parameters?.retry_after ?? 1) * 1000); continue; }
      throw new ClawError("TELEGRAM_API", { method, status: res.status, description: data.description });
    }
  }
  const markup = (keyboard) => (keyboard ? { inline_keyboard: keyboard } : undefined);
  return {
    getMe: () => call("getMe"),
    getUpdates: (offset, timeout = 50) => call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }),
    sendMessage: (chatId, text, { threadId, keyboard } = {}) =>
      call("sendMessage", { chat_id: chatId, message_thread_id: threadId, text, parse_mode: "MarkdownV2", reply_markup: markup(keyboard) }),
    editMessageText: (chatId, messageId, text, { keyboard } = {}) =>
      call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "MarkdownV2", reply_markup: markup(keyboard) }),
    answerCallbackQuery: (id, text) => call("answerCallbackQuery", { callback_query_id: id, text }),
    sendChatAction: (chatId, threadId) => call("sendChatAction", { chat_id: chatId, message_thread_id: threadId, action: "typing" }),
    setMyCommands: (commands, scope) => call("setMyCommands", { commands, scope }),
    getFile: (fileId) => call("getFile", { file_id: fileId }),           // download ≤ 20 MB
    fileUrl: (filePath) => `${apiBase}/file/bot${token}/${filePath}`,   // never log this URL
  };
}
```

### SC-5 — MarkdownV2, chunking, keyboards (Slice 4)

```js
// Same class as pforge-mcp/bridge.mjs escapeMdV2, plus backslash (Telegram requires it too).
const MDV2 = /[_*[\]()~`>#+=|{}.!\\-]/g;
export const escapeMdV2 = (text) => String(text).replace(MDV2, "\\$&");

// Chunk BEFORE escaping, so a split never lands inside an escape sequence.
export function chunkText(text, limit = 3800) {      // headroom: escaping grows the text
  const out = []; let rest = String(text);
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\n+/, "");
  }
  return rest ? [...out, rest] : out;
}

export function button(text, callbackData) {
  if (Buffer.byteLength(callbackData, "utf8") > 64) throw new Error(`callback_data over 64 bytes: ${callbackData.length}`);
  return { text, callback_data: callbackData };
}
```

### SC-6 — Per-chat rate limiter with coalescing (Slices 4, 12)

```js
// One queue per chat. Items with the same key (e.g. "edit:<messageId>") coalesce to the latest.
export function createChatLimiter({ perChatMs = 1000, perGroupPerMinute = 20, now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const chats = new Map();
  async function drain(chatId, q) {
    q.running = true;
    while (q.items.length) {
      q.sent = q.sent.filter((t) => now() - t < 60_000);
      const waitChat = q.last + perChatMs - now();
      const waitGroup = q.sent.length >= perGroupPerMinute ? q.sent[0] + 60_000 - now() : 0;
      const wait = Math.max(waitChat, waitGroup, 0);
      if (wait) await sleep(wait);
      const item = q.items.shift();
      q.last = now(); q.sent.push(q.last);
      try { item.resolve(await item.fn()); } catch (e) { item.reject(e); }
    }
    q.running = false;
  }
  return {
    enqueue(chatId, key, fn) {
      const q = chats.get(chatId) ?? { items: [], sent: [], last: 0, running: false };
      chats.set(chatId, q);
      return new Promise((resolve, reject) => {
        const existing = key && q.items.find((i) => i.key === key);
        if (existing) { existing.fn = fn; existing.waiters.push({ resolve, reject }); return; }
        const item = { key, fn, waiters: [], resolve: (v) => { resolve(v); item.waiters.forEach((w) => w.resolve(v)); },
          reject: (e) => { reject(e); item.waiters.forEach((w) => w.reject(e)); } };
        q.items.push(item);
        if (!q.running) drain(chatId, q);
      });
    },
  };
}
```

### SC-7 — Project MCP client over stdio (Slices 6, 14, 24)

```js
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ClawError } from "../errors.mjs";

export function resolveMcpLaunch(projectPath, serverName = "plan-forge") {
  const cfg = JSON.parse(readFileSync(join(projectPath, ".vscode", "mcp.json"), "utf8"));
  const entry = cfg.servers?.[serverName] ?? cfg.mcpServers?.[serverName];
  if (!entry?.command) throw new ClawError("MCP_ENTRY_MISSING", { serverName });
  const expand = (v) => String(v)
    .replace(/\$\{workspaceFolder\}/g, projectPath)
    .replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => process.env[n] ?? "");
  return {
    command: expand(entry.command) === "node" ? process.execPath : expand(entry.command),
    args: (entry.args ?? []).map(expand),
    cwd: entry.cwd ? resolve(projectPath, expand(entry.cwd)) : projectPath,
    env: Object.fromEntries(Object.entries(entry.env ?? {}).map(([k, v]) => [k, expand(v)])),
  };
}

export async function connectProject({ repoPath, serverName, toolProfile = "full", port = "0" }) {
  const l = resolveMcpLaunch(repoPath, serverName);
  const transport = new StdioClientTransport({
    command: l.command, args: [...l.args, "--port", port], cwd: l.cwd,
    env: { ...process.env, ...l.env, PFORGE_TOOL_PROFILE: toolProfile },  // default profile is "core" only
    stderr: "pipe",
  });
  const client = new Client({ name: "pforge-claw", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return {
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = r.content?.find((c) => c.type === "text")?.text ?? "";
      if (r.isError) throw new ClawError("MCP_TOOL_ERROR", { tool: name, text: text.slice(0, 500) });
      try { return JSON.parse(text); } catch { return { text }; }
    },
    close: () => client.close(),
  };
}
```

### SC-8 — Agent runtime over `@github/copilot-sdk` (Slices 8, 9)

```js
// Mirrors pforge-mcp/orchestrator/sdk-worker.mjs. The SDK is injected for tests.
export async function runAgentTurn({ prompt, model, cwd, mcpServers, policy, token, timeoutMs = 30 * 60_000, sdk }) {
  const { CopilotClient } = sdk ?? (await import("@github/copilot-sdk"));
  const client = new CopilotClient({ workingDirectory: cwd, ...(token ? { gitHubToken: token } : { useLoggedInUser: true }) });
  const events = [];
  try {
    const session = await client.createSession({
      model, workingDirectory: cwd, mcpServers,                // { "plan-forge": { type: "stdio", command, args, env, workingDirectory } }
      onEvent: (ev) => events.push(ev),
      onPermissionRequest: (req) => policy(req),               // returns { kind: "approve-once" } | { kind: "reject", feedback }
    });
    await session.sendAndWait({ prompt }, timeoutMs);
  } finally {
    await client.stop().catch(() => client.forceStop?.());
  }
  return { events, usage: sumUsage(events) };
}

function sumUsage(events) {                                    // null-not-zero (bug #190)
  const u = events.filter((e) => e?.type === "assistant.usage" && e.data);
  if (!u.length) return { tokensIn: null, tokensOut: null, model: null };
  return {
    tokensIn: u.reduce((n, e) => n + (e.data.inputTokens ?? 0), 0),
    tokensOut: u.reduce((n, e) => n + (e.data.outputTokens ?? 0), 0),
    model: u.at(-1).data.model ?? null,
  };
}

// Permission policy for a task job (Slice 9). Never approve everything.
// (import { isAbsolute, relative, resolve } from "node:path" at module top)
const SHELL_META = /[;&|`$<>(){}\n\r]/;            // no chaining, substitution or redirection
export function taskPolicy({ worktree, allowCommands = ["git", "gh", "node", "npm", "npx"] }) {
  const inside = (p) => { const rel = relative(worktree, resolve(worktree, p)); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel); };
  return (req) => {
    if (req.kind === "write") return inside(req.fileName) ? { kind: "approve-once" } : { kind: "reject", feedback: "writes are limited to the job worktree" };
    if (req.kind === "shell") {
      const cmd = String(req.fullCommandText ?? "").trim();
      if (SHELL_META.test(cmd)) return { kind: "reject", feedback: "shell operators are not allowed; run one command at a time" };
      const bin = cmd.split(/\s+/)[0];
      return allowCommands.includes(bin) ? { kind: "approve-once" } : { kind: "reject", feedback: `command not allowed: ${bin}` };
    }
    return { kind: "reject", feedback: `permission kind not allowed: ${req.kind}` };
  };
}
```

### SC-9 — Approval nonces (Slice 10)

```js
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function issueApproval({ jobId, chatId, requesterId, ttlMs = 15 * 60_000, now = Date.now }) {
  const nonce = randomBytes(16).toString("base64url");              // 22 chars
  const shortId = jobId.slice(0, 8);
  const record = { jobId, shortId, chatId: String(chatId), requesterId, nonceHash: sha256(nonce), expiresAt: now() + ttlMs, usedAt: null };
  return { record, approve: `a:${shortId}:${nonce}`, reject: `a:${shortId}:${nonce}:x` };   // ≤ 36 bytes
}

export function verifyApproval(record, { nonce, chatId, approverRole, now = Date.now }) {
  if (!record) return { ok: false, reason: "unknown" };
  if (record.usedAt) return { ok: false, reason: "replay" };
  if (now() > record.expiresAt) return { ok: false, reason: "expired" };
  if (String(chatId) !== record.chatId) return { ok: false, reason: "wrong-chat" };
  if (!["owner", "approver"].includes(approverRole)) return { ok: false, reason: "wrong-user" };
  const a = Buffer.from(sha256(nonce), "hex"), b = Buffer.from(record.nonceHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}
```

### SC-10 — Safe spawn, command resolution, worktree, junction (Slices 9, 17, 25)

```js
import { spawn } from "node:child_process";
import { symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Windows refuses to spawn .cmd/.bat shims without a shell (CVE-2024-27980), so map them to real executables.
export function resolveCommand(name, { cwd } = {}) {
  const win = process.platform === "win32";
  if (name === "npm" || name === "npx") {
    return win ? [process.execPath, join(dirname(process.execPath), "node_modules", "npm", "bin", `${name}-cli.js`)] : [name];
  }
  if (name === "pforge") return win ? ["pwsh", "-NoProfile", "-File", join(cwd, "pforge.ps1")] : ["bash", join(cwd, "pforge.sh")];
  return [name];                                                 // git, gh, node, pwsh, bash are real executables
}

export function run(cmd, args, { cwd, env, timeoutMs = 120_000, maxBytes = 1_000_000 } = {}) {
  const [bin, ...pre] = resolveCommand(cmd, { cwd });
  return new Promise((resolvePromise) => {
    const child = spawn(bin, [...pre, ...args], { cwd, env, shell: false, windowsHide: true });
    let stdout = "", stderr = "";
    const cap = (buf, add) => (buf.length < maxBytes ? buf + add : buf);
    child.stdout.on("data", (d) => (stdout = cap(stdout, d)));
    child.stderr.on("data", (d) => (stderr = cap(stderr, d)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(timer); resolvePromise({ code: -1, stdout, stderr: String(err.code ?? err) }); });
  });
}

export function assertInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes ${root}`);
}

export async function addWorktree({ repoPath, worktreesRoot, jobId, baseBranch }) {
  const path = join(worktreesRoot, jobId);
  assertInside(worktreesRoot, path);
  const r = await run("git", ["worktree", "add", "-b", `claw/${jobId}`, path, baseBranch], { cwd: repoPath });
  if (r.code !== 0) throw new Error(`git worktree add failed (${r.code})`);
  return path;
}

// D25 bootstrap.install = "link": reuse the home checkout's node_modules.
export function linkNodeModules(homeRepo, worktree) {
  symlinkSync(join(homeRepo, "node_modules"), join(worktree, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}
```

### SC-11 — Schedule grammar and timezone ticks (Slice 13)

```js
const RE = /^(?:daily (\d\d):(\d\d)|weekly (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d\d):(\d\d)|monthly ([1-9]|1\d|2[0-8]) (\d\d):(\d\d)|every (\d+)m)$/;

export function parseSchedule(at) {
  const m = RE.exec(String(at).trim());
  if (!m) throw new Error(`invalid schedule "${at}" — use daily HH:MM | weekly Mon HH:MM | monthly D HH:MM | every Nm`);
  if (m[1]) return { kind: "daily", hm: `${m[1]}:${m[2]}` };
  if (m[3]) return { kind: "weekly", day: m[3], hm: `${m[4]}:${m[5]}` };
  if (m[6]) return { kind: "monthly", dom: m[6].padStart(2, "0"), hm: `${m[7]}:${m[8]}` };
  const n = Number(m[9]); if (n < 5) throw new Error("every Nm requires N >= 5");
  return { kind: "every", n };
}

function local(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// Returns a run key when the schedule is due in this minute, else null.
// The scheduler ticks every 20 s and runs a schedule only if dueKey !== lastKey[id] (persisted),
// so restarts never double-run and missed minutes are skipped (catch-up policy: skip).
export function dueKey(spec, date, timeZone) {
  const p = local(date, timeZone), hm = `${p.hour}:${p.minute}`, day = `${p.year}-${p.month}-${p.day}`;
  switch (spec.kind) {
    case "daily": return hm === spec.hm ? day : null;
    case "weekly": return p.weekday === spec.day && hm === spec.hm ? day : null;
    case "monthly": return p.day === spec.dom && hm === spec.hm ? day : null;
    case "every": { const minute = Math.floor(date.getTime() / 60_000); return minute % spec.n === 0 ? String(minute) : null; }
  }
}
```

### SC-12 — Worker authentication and reconnect (Slices 18, 25)

```js
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket } from "ws";

export const challenge = () => randomBytes(32).toString("hex");
export const mac = (secret, nonce, workerId) => createHmac("sha256", secret).update(`${nonce}:${workerId}`).digest("hex");
export function verifyMac(secret, nonce, workerId, given) {
  const a = Buffer.from(mac(secret, nonce, workerId), "hex"), b = Buffer.from(String(given), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
// Wire: dispatcher → { v:1, t:"challenge", nonce } ; worker → { v:1, t:"auth", workerId, mac } ; dispatcher → { v:1, t:"ready" }

const isLoopback = (u) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname);
export function assertTransport(url, { allowInsecureLan = false } = {}) {
  if (url.startsWith("wss://") || isLoopback(url) || allowInsecureLan) return;
  throw new Error("INSECURE_TRANSPORT: use wss:// (ingress TLS or a private overlay network)");
}

export function connectForever(url, onOpen, { attempt = 0 } = {}) {
  const ws = new WebSocket(url);
  ws.on("open", () => { attempt = 0; onOpen(ws); });
  ws.on("close", () => {
    const delay = Math.min(30_000, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
    setTimeout(() => connectForever(url, onOpen, { attempt: attempt + 1 }), delay);
  });
  ws.on("error", () => {});                        // "close" follows; never log the URL with credentials
  return ws;
}
```

### SC-13 — Kubernetes API with the ServiceAccount, and a Job spec (Slice 22)

```js
import https from "node:https";
import { readFileSync } from "node:fs";
const SA = "/var/run/secrets/kubernetes.io/serviceaccount";

export function k8s(method, path, body) {
  const token = readFileSync(`${SA}/token`, "utf8");     // re-read every call: projected tokens rotate
  const ca = readFileSync(`${SA}/ca.crt`);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: process.env.KUBERNETES_SERVICE_HOST, port: process.env.KUBERNETES_SERVICE_PORT ?? 443,
      path, method, ca, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } }, (res) => {
      let data = ""; res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode < 300 ? resolve(data ? JSON.parse(data) : null)
        : reject(Object.assign(new Error("K8S_API"), { status: res.statusCode, body: data.slice(0, 300) }))));
    });
    req.on("error", (e) => reject(Object.assign(new Error("K8S_NETWORK"), { code: e.code })));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
export const createJob = (ns, spec) => k8s("POST", `/apis/batch/v1/namespaces/${ns}/jobs`, spec);
export const getJob = (ns, name) => k8s("GET", `/apis/batch/v1/namespaces/${ns}/jobs/${name}`);
export const deleteJob = (ns, name) => k8s("DELETE", `/apis/batch/v1/namespaces/${ns}/jobs/${name}?propagationPolicy=Background`);

export function jobSpec({ name, image, jobId, dispatcherUrl, deadlineSeconds = 3600 }) {
  return {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name, labels: { "app.kubernetes.io/part-of": "pforge-claw", "pforge-claw/job-id": jobId } },
    spec: {
      backoffLimit: 0, activeDeadlineSeconds: deadlineSeconds, ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels: { "pforge-claw/role": "job" } },
        spec: {
          restartPolicy: "Never", automountServiceAccountToken: false,
          securityContext: { runAsNonRoot: true, runAsUser: 10001, fsGroup: 10001, seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "worker", image, args: ["claw", "worker", "--one-shot", "--job", jobId],
            env: [
              { name: "PFORGE_CLAW_DISPATCHER_URL", value: dispatcherUrl },
              { name: "PFORGE_CLAW_WORKER_SECRET", valueFrom: { secretKeyRef: { name: "pforge-claw-worker", key: "secret" } } },
              { name: "PFORGE_CLAW_GH_TOKEN", valueFrom: { secretKeyRef: { name: "pforge-claw-github", key: "token" } } },
              { name: "COPILOT_GITHUB_TOKEN", valueFrom: { secretKeyRef: { name: "pforge-claw-copilot", key: "token", optional: true } } },
            ],
            resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "4Gi" } },
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
            volumeMounts: [{ name: "work", mountPath: "/work" }],
          }],
          volumes: [{ name: "work", emptyDir: {} }],
        },
      },
    },
  };
}
```

### SC-14 — Direct OpenBrain client (Slice 24)

```js
// Same transport and header as pforge-mcp/openbrain-replay.mjs createSseClient.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export async function connectOpenBrain({ url, key, header = "x-brain-key" }) {
  const headers = key ? { [header]: key } : {};
  const transport = new SSEClientTransport(new URL(url), {
    requestInit: { headers },
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...(init ?? {}), headers: { ...(init?.headers ?? {}), ...headers } }) },
  });
  const client = new Client({ name: "pforge-claw-brain", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const deleteTool = tools.find((t) => /delete|forget/i.test(t.name))?.name ?? null;   // /forget ships only if present
  return {
    capabilities: { canDelete: Boolean(deleteTool) },
    capture: (thought) => client.callTool({ name: "capture_thought", arguments: thought }),   // { content, project, source, created_by, metadata }
    search: (args) => client.callTool({ name: "search_thoughts", arguments: args }),         // { query, project, limit }
    remove: deleteTool ? (id) => client.callTool({ name: deleteTool, arguments: { id } }) : null,
    close: () => client.close(),
  };
}
```

### SC-15 — Fake Telegram server for tests (Slices 4, 17, 27)

```js
import http from "node:http";

export async function startFakeTelegram() {
  const calls = []; const pending = []; let nextId = 1; const waiting = [];
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const method = req.url.split("/").pop();
      const args = body ? JSON.parse(body) : {};
      calls.push({ method, args });
      const reply = (result) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, result })); };
      if (method === "getUpdates") {
        const ready = pending.filter((u) => u.update_id >= (args.offset ?? 0));
        if (ready.length) return reply(ready);
        return waiting.push(() => reply(pending.filter((u) => u.update_id >= (args.offset ?? 0))));
      }
      if (method === "getMe") return reply({ id: 1, is_bot: true, username: "fake_bot", can_read_all_group_messages: true });
      if (method === "sendMessage") return reply({ message_id: calls.length, chat: { id: args.chat_id }, text: args.text });
      return reply(true);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    apiBase: `http://127.0.0.1:${server.address().port}`,
    calls,
    push(update) { pending.push({ update_id: nextId++, ...update }); waiting.splice(0).forEach((f) => f()); },
    close: () => new Promise((r) => server.close(r)),
  };
}
```

### SC-16 — Package and test config (Slice 1)

```js
// pforge-claw/vitest.config.mjs (mirrors pforge-master)
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.mjs"], exclude: ["tests/e2e/**"] } });

// pforge-claw/package.json (scripts excerpt):
// "scripts": { "test": "vitest run", "test:e2e": "vitest run --config vitest.e2e.config.mjs" }
// The e2e config includes only tests/e2e/** so the root `npm test` stays fast and offline-safe.
```

## Execution Slices

### Parallelism map

```
S1 → S2 → S3 ─┬─ A: S4 → S5 → S6 → S7 ─┐
              └─ B: S8 → S9 ───────────┴─▶ S10 ─▶ { S11 ∥ S12 } ─┬─ D: S13 ∥ S14 ∥ S15 ∥ S16 ─▶ S17 ─────────────────┐
S2 ─▶ S20 (YAML only, any time after S2)                          ├─ D: S18 ─▶ { S19 ∥ S21 };  S9 + S20 + S21 ─▶ S22 ─▶ S23 ┼─▶ S26 ─▶ S27 ─▶ S28 ─▶ S29
                                                                  └─ D: S24 ──────────── S18 + S22 + S24 ─▶ S25 ────────┘
```

- Up to six slices can be in flight at once (after S12: S13–S16, S18, S24; S20 floats from S2 onward).
- **Merge checkpoints** (coherence slices whose gate runs the whole `pforge-claw` suite): **S10** (tracks A + B), **S17** (group D, M1 complete), **S22** (images + manifests + lanes), **S25** (memory + all lane kinds), **S26** (everything).
- Parallel slices never edit the same file: shared extension points are stub modules created in Slices 1 and 5 (Shared Contract → Module seams). If a parallel slice finds it must edit another slice's file, that is a scope violation: stop.
- The companion phase can run alongside Slices 1–5; Slice 6 waits for it (Execution Hold).


### Milestone M0 — Foundation

#### Slice 1 — Package scaffold, boundaries, and `pforge claw` CLI twins [sequential]

**Depends On**: none
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/clean-code.instructions.md`, `.github/instructions/release-checklist.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D3, D23, the **Seed Code** sections SC-1, SC-16 (start from them), then this slice's Context Files (`.github/instructions/architecture-principles.instructions.md`, `.github/instructions/clean-code.instructions.md`, `.github/instructions/release-checklist.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. Create `pforge-claw/package.json` (`@pforge/pforge-claw`, `type: module`, `engines.node >=22.12.0`, deps per D3, `vitest` dev dep) and add `pforge-claw` to root `package.json#workspaces`; run `npm install` so the lockfile updates.
3. Create `pforge-claw/cli.mjs` with `init`, `doctor`, `status`, `start`, `worker`, `service`, `dev`, `commands` subcommands. Every subcommand supports `--help` (exit 0). Until its owning slice lands, invoking a subcommand prints "not yet implemented (Slice N)" and exits 2. Add a `vitest.config.mjs` mirroring `pforge-master`'s, and a `test` script so root `npm test` (workspaces) picks the package up.
4. Create `pforge-claw/src/enums.mjs` with frozen `JOB_TYPES`, `JOB_STATES`, `LANE_KINDS`, `VISIBILITY`, `ROLES`, `LANE_EVENT_TYPES`.
5. Add `claw` dispatch to **both** `pforge.ps1` and `pforge.sh` → `node pforge-claw/cli.mjs <args>` (args passed as array).
6. Add `pforge-claw` to `dep-boundaries.mjs` `PACKAGE_RULES` (may not import `pforge-mcp`/`pforge-master`/`pforge-sdk` source).
7. Add `tests/boundaries.test.mjs` — Guard: "pforge-claw imports no Plan Forge package source"; Guard: "no approveAll"; Guard: "no exec( / execSync( with template strings"; Guard: "no operator-specific values" (scans `pforge-claw/` except `tests/fixtures` for real-looking Telegram chat ids, absolute user paths such as drive letters or home directories, personal GitHub owners, private IPs and hostnames that aren't documented placeholders such as `<owner>`, `<registry>`, `example.com`).
8. Register `claw` (with `init`, `doctor`, `status`, `start`, `worker`, `service`, `dev`, `commands` subcommands) in the CLI schema in `pforge-mcp/capabilities/schemas.mjs`; regenerate locally with `node pforge-mcp/server.mjs --validate`. Note: `pforge-mcp/cli-schema.json` is **gitignored** (generated at startup), so it is not committed; the gate checks the regenerated file. `tools.json` is tracked and must not change.
9. `pforge.ps1` and `pforge.sh` resolve the claw home per D23 (`PFORGE_CLAW_PATH` → the `update` / `self-update` source → current repo) and pass arguments as an array; with none found they print install instructions and exit 1. Both shells behave identically.
10. Create the module seams from Shared Contract → Module seams as stubs: `src/errors.mjs`, `src/events.mjs`, one `src/cli/<sub>.mjs` per subcommand (`cli.mjs` only dispatches), and `src/features/index.mjs` listing one stub module per feature (`chat`, `approvals`, `budget`, `progress`, `scheduler`, `alerts`, `capture`, `crossproject`, `workers`, `webhook`, `memory`), each `available: false`. Shapes are in Seed SC-1.

**Files**: `pforge-claw/package.json`, `pforge-claw/cli.mjs`, `pforge-claw/src/enums.mjs`, `pforge-claw/tests/boundaries.test.mjs`, `package.json`, `package-lock.json`, `pforge.ps1`, `pforge.sh`, `scripts/audit/dep-boundaries.mjs`, `pforge-mcp/capabilities/schemas.mjs`, `pforge-mcp/cli-schema.json`, `pforge-claw/vitest.config.mjs`, `pforge-claw/src/errors.mjs`, `pforge-claw/src/events.mjs`, `pforge-claw/src/cli/*.mjs`, `pforge-claw/src/features/*.mjs`

**Validation Gate**:
```bash
node -e 'const fs=require("fs");for(const f of ["pforge.ps1","pforge.sh"])if(!fs.readFileSync(f,"utf8").includes("PFORGE_CLAW_PATH"))throw new Error("D23 claw home resolution missing in "+f)'
node -e 'const r=require("./package.json");if(!r.workspaces.includes("pforge-claw"))throw new Error("pforge-claw not in workspaces")'
node -e 'const fs=require("fs");for(const f of ["pforge.ps1","pforge.sh"]){if(!fs.readFileSync(f,"utf8").includes("pforge-claw/cli.mjs"))throw new Error("claw dispatch missing in "+f)}'
node pforge-claw/cli.mjs doctor --help
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/boundaries.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const c=require("./pforge-mcp/cli-schema.json");if(!c.commands||!c.commands.claw)throw new Error("claw missing from cli-schema.json")'
node -e 'require("child_process").execSync("git diff --quiet -- pforge-mcp/tools.json")'
node pforge-mcp/server.mjs --check
```

#### Slice 2 — Config, secrets, project registry, `doctor` [sequential]

**Depends On**: Slice 1
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, the **Seed Code** sections SC-2 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/config.mjs`: resolve `PFORGE_CLAW_HOME` (default `path.join(os.homedir(), ".pforge-claw")` on every OS), load + validate `config.json` against the published `pforge-claw/config.schema.json` (projects, lanes with labels, channel adapters, runtimes, allowlist with roles, policy, schedules, caps, timezone, feature flags). Validation returns structured errors; unknown keys warn. `start` refuses to run with an empty `owner` list.
3. `src/secrets.mjs`: `getSecret(name)` env-first then `secrets.json`; `redact(text)` replaces every loaded secret value and known token shapes with `«redacted:<name>»`; warn if `secrets.json` is world-readable (POSIX) / inherits broad ACL (Windows).
4. `src/registry.mjs`: project lookup by id / `(chatId, topicId)`; path normalisation via `path.resolve` with case-insensitive compare on Windows; reject projects whose path is not a git repo.
5. `doctor`: checks Node version, config validity, each project path, presence (not value) of required secrets, `git`/`pforge`/`copilot` availability, and that each project has a resolvable plan-forge MCP launch command (from its `.vscode/mcp.json`).
6. `pforge claw init`: interactive by default, plus non-interactive `--example single-host|multi-host|k8s --out <dir>`. It writes `config.json` from `pforge-claw/examples/*.json` (placeholders only), lists the secret names to set without ever asking for their values in argv, and runs `doctor`.
7. `config.schema.json` covers every key in Shared Contract → Complete config reference, Secret names and Schedule grammar; `init` generates a stable random `instanceId`. Each example config validates.
8. Tests: valid/invalid config against the schema, every example validates, env-over-file precedence, redaction with canary secrets, Windows/POSIX path compare, doctor JSON output, `init --example` round-trip, refusal with no owner.

**Files**: `pforge-claw/src/config.mjs`, `pforge-claw/src/secrets.mjs`, `pforge-claw/src/registry.mjs`, `pforge-claw/src/init.mjs`, `pforge-claw/config.schema.json`, `pforge-claw/examples/single-host.json`, `pforge-claw/examples/multi-host.json`, `pforge-claw/examples/k8s.json`, `pforge-claw/src/cli/init.mjs`, `pforge-claw/src/cli/doctor.mjs`, `pforge-claw/tests/config.test.mjs`, `pforge-claw/tests/secrets.test.mjs`, `pforge-claw/tests/registry.test.mjs`, `pforge-claw/tests/init.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/config.test.mjs tests/secrets.test.mjs tests/registry.test.mjs tests/init.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const fs=require("fs");for(const f of ["pforge-claw/config.schema.json","pforge-claw/examples/single-host.json","pforge-claw/examples/multi-host.json","pforge-claw/examples/k8s.json"])if(!fs.existsSync(f))throw new Error("missing: "+f)'
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/secrets.test.mjs","utf8");if(!s.includes("canary"))throw new Error("redaction canary test missing")'
```

#### Slice 3 — State store (append-only JSONL + snapshots) [sequential]

**Depends On**: Slice 2
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/clean-code.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, the **Seed Code** sections SC-3 (start from them), then this slice's Context Files (`.github/instructions/testing.instructions.md`, `.github/instructions/clean-code.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/state/store.mjs`: `append(stream, record)` (adds `ts`, runs `redact`), `fold(stream, reducer)`, `snapshot(stream)` with write-to-temp + rename; single-writer lock file with stale-lock detection.
3. `src/jobs/model.mjs`: job shape, legal transitions table, `transition(job, to, meta)` that throws on illegal moves; `currentJobs()` fold.
4. Tests: crash-safety (partial last line tolerated), illegal transitions rejected, snapshot+tail equals full fold, redaction applied on append.

**Files**: `pforge-claw/src/state/store.mjs`, `pforge-claw/src/jobs/model.mjs`, `pforge-claw/tests/store.test.mjs`, `pforge-claw/tests/job-model.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/store.test.mjs tests/job-model.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M1 — Chat MVP on a single host (any macOS / Windows / Linux machine)

> No execution hold: M1 flows straight into M2. Every slice from Slice 4 on tests against the shared fake Telegram Bot API helper so the end-to-end harness grows with the build.

#### Slice 4 — Telegram client, formatter, long-poll receiver [parallel-safe] (group A)
**Depends On**: Slice 3
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D1, D18, the **Seed Code** sections SC-4, SC-5, SC-6, SC-15 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/channels/channel-adapter.mjs`: the `ChannelAdapter` interface per D18 (`start(onUpdate)`, `send`, `edit`, `answerCallback`, `setMenu`, `download`, `typing`, `limits`), with a contract test any adapter must pass. Telegram modules below live under `src/channels/telegram/` and implement it.
3. `src/channels/telegram/client.mjs`: `getUpdates`, `sendMessage`, `editMessageText`, `answerCallbackQuery`, `sendChatAction`, `getFile`/download; `fetch` injected for tests; token from `getSecret`; 429 handling honouring `retry_after`; never include the token in thrown errors.
4. `src/channels/telegram/format.mjs`: MarkdownV2 escape, 4096-char chunking on paragraph boundaries, inline keyboard builder enforcing the 64-byte `callback_data` limit. (Behaviour mirrors `bridge.mjs` helpers; duplication is accepted under D1 and recorded for a follow-up extraction to `pforge-sdk`.)
5. `src/channels/telegram/poller.mjs`: long-poll loop with persisted offset (`state/offsets.json`), exponential backoff, graceful stop on SIGINT/SIGTERM.
6. Inbound dedupe: record processed `update_id`s (bounded window) in `state/updates.jsonl`; commit the offset only after handling; a replayed update is dropped without side effects.
7. Outbound per-chat rate limiter inside the adapter (Telegram defaults: at most 20 messages / minute per group, 1 / second per chat; honour `retry_after`), shared by every sender (replies, progress edits, alerts, digests). Queued edits to the same message coalesce to the latest text.
8. Tests: escaping table, chunking, callback_data limit, offset persistence across restart, 429 backoff with fake timers, token-never-in-error guard, replayed `update_id` ignored, per-chat limiter ordering and coalescing.
9. Configurable `telegram.apiBase` (default `https://api.telegram.org`) and `tests/helpers/fake-telegram.mjs`: an in-process HTTP server implementing `getUpdates` (scripted inbound queue, incl. `callback_query` and forum `message_thread_id`), `sendMessage`, `editMessageText`, `answerCallbackQuery`, `sendChatAction`, `getFile`, `setWebhook`/`deleteWebhook`, recording every outbound call. Every later slice and the Slice 27 e2e suite reuse it.

**Files**: `pforge-claw/src/channels/channel-adapter.mjs`, `pforge-claw/tests/channel-adapter-contract.test.mjs`, `pforge-claw/src/channels/telegram/client.mjs`, `pforge-claw/src/channels/telegram/format.mjs`, `pforge-claw/src/channels/telegram/poller.mjs`, `pforge-claw/tests/helpers/fake-telegram.mjs`, `pforge-claw/tests/telegram-*.test.mjs`, `pforge-claw/src/channels/telegram/rate-limiter.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/telegram-client.test.mjs tests/telegram-format.test.mjs tests/telegram-poller.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 5 — Identity, routing, and command parsing [parallel-safe] (group A)
**Depends On**: Slice 4
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D8, the **Seed Code** sections SC-1 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/router.mjs`: drop (no reply) any update whose `from.id` is not allowlisted or whose chat is not configured — write an audit line only. Resolve project from `(chat.id, message_thread_id)`; the configured "general" topic routes to the dispatcher.
3. `src/commands/index.mjs` plus one module per command `src/commands/<name>.mjs` (shape in Seed SC-1): the **single command registry** (source of truth for router, `/help`, and the Telegram menu). Also create `src/callbacks/index.mjs` plus one stub module per callback prefix from Shared Contract → Module seams; the router answers each `callback_query` first, then dispatches by prefix. Each entry: `{ name, aliases, args, summary, details, examples[], roles[], scope: "project"|"general"|"both", mutating, sinceSlice }`. Initial set: `/help`, `/start` (alias of `/help`), `/ask`, `/run <plan> [quorum]`, `/skill <name>`, `/task <description>`, `/status`, `/jobs`, `/budget`, `/remember`, `/recall`, `/idea`, `/bug`, `/abort <job>`, `/retry <job>`, `/lane <id> on|off` (pause/resume an opt-in lane such as a workstation), `/lanes`, `/fanout`, `/new` (start a fresh Forge-Master session for this topic). Commands whose handler lands in a later slice are registered now with `available: false` and are hidden from `/help` until that slice flips them on. Free text in a project topic = `ask`. `node pforge-claw/cli.mjs commands [--markdown|--json]` prints the registry (used by docs in Slice 29).
4. Router dispatches **only** through the registry. An unregistered `/command` from an allowlisted user gets "Unknown command `/x` — try /help" (with a closest-match suggestion); unknown users still get nothing.
5. `/help` (and `/start`, and `-help` / `--help` / `help` typed as plain text): context-aware output — shows only the commands the caller's role may run **and** that apply where they typed it (project topic → project commands with that project's name in the header; `#general` → dispatcher and cross-project commands). Mutating commands are marked 🔒 "needs approval". Grouped as *Ask & memory*, *Work*, *Status & budget*, *Admin*. Fits one message; chunked if it ever exceeds 4096 chars.
6. `/help <command>`: details, argument syntax, 2–3 examples, required role, whether it needs approval, and where it can be used.
7. Telegram `/` autocomplete menu: on `start`, call `setMyCommands` per configured chat (and per-member scope for non-owner roles) from the same registry so the in-app menu always matches `/help`. Re-sync when the config changes.
8. Role enforcement per D8 (`viewer` → `ask`/`help`/`status` only; non-owner mutating → BYOK-only or refused with a message to an *allowlisted* user).
9. Tests: unknown user silent drop (including `/help`), unknown chat silent drop, topic routing, role matrix, command parsing table, help filtered by role and by topic, `/help <cmd>` details, unknown-command suggestion, `setMyCommands` payload built from the registry, and a drift guard: every command the router handles is in the registry and every `available` registry entry has a handler.

**Files**: `pforge-claw/src/router.mjs`, `pforge-claw/src/commands/*.mjs`, `pforge-claw/src/callbacks/*.mjs`, `pforge-claw/src/handlers/help.mjs`, `pforge-claw/src/cli/commands.mjs`, `pforge-claw/tests/commands/*.test.mjs`, `pforge-claw/tests/router.test.mjs`, `pforge-claw/tests/help.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/router.test.mjs tests/help.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/router.test.mjs","utf8");if(!s.includes("silent"))throw new Error("silent-drop test missing")'
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/help.test.mjs","utf8");for(const n of ["role","topic","setMyCommands","drift"])if(!s.includes(n))throw new Error("help test missing: "+n)'
```

#### Slice 6 — Project MCP client + read-only Q&A via Forge-Master [parallel-safe] (group A)
**Depends On**: Slice 5
**Context Files**: `.github/instructions/aci-design.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D7, D24, the **Seed Code** sections SC-1, SC-7 (start from them), then this slice's Context Files (`.github/instructions/aci-design.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/mcp/project-client.mjs`: start/stop a stdio MCP client for a project **on its home lane** (D24; in this slice the home lane is always `local`, and Slice 18 routes the same calls as `read` leases). Read the `.vscode/mcp.json` server named by `mcp.serverName` (default `plan-forge`), expand `${workspaceFolder}` and `${env:NAME}`, and resolve relative args against `repo.path`. Idle shutdown after `mcp.idleMinutes`; one client per project. `doctor` reports when `forge_master_ask` answers with the pforge-master-not-installed stub.
3. `ask` handler per D7: `sendChatAction typing` → `forge_master_ask({ message, sessionId, caller, responseFormat, proposeActions: true, contextBlocks: [clawSnapshot] })` → reply (chunked). `proposedActions` render as inline buttons; tapping one creates a job through the normal role check and approval path (never executed directly). Use `proposedActionsMessage` when there are none. Append each `usage` record to `state/budget.jsonl` through the state store (the Slice 11 governor consumes it). Build `clawSnapshot` in `src/snapshot.mjs` from whatever state exists so far (sessions, queue, approvals); later slices extend it. Persist `(chatId, topicId) → sessionId` in `sessions.jsonl`; `/new` clears it. Empty or error results produce an explicit, friendly message (no silent failure).
4. `src/cli/start.mjs` builds `ctx` and calls `src/app.mjs`, which starts every `available` feature from `src/features/index.mjs`. This slice implements `features/chat.mjs` (poller + router + ask) and the `ask`, `new` and `p` (proposed action) modules. The project MCP client launches the server with `--port 0` and `PFORGE_TOOL_PROFILE=full` (`mcp.toolProfile`), as in Seed SC-7.
5. Tests with an injected fake MCP client: happy path, session reuse, tool error surfaced, client idle shutdown.

**Files**: `pforge-claw/src/mcp/project-client.mjs`, `pforge-claw/src/handlers/ask.mjs`, `pforge-claw/src/cli/start.mjs`, `pforge-claw/src/app.mjs`, `pforge-claw/src/features/chat.mjs`, `pforge-claw/src/commands/ask.mjs`, `pforge-claw/src/commands/new.mjs`, `pforge-claw/src/callbacks/p.mjs`, `pforge-claw/tests/ask.test.mjs`, `pforge-claw/tests/project-client.test.mjs`, `pforge-claw/src/snapshot.mjs`

**Validation Gate**:
```bash
node -e 'const t=require("./pforge-mcp/tools.json");const a=Array.isArray(t)?t:t.tools;const x=a.find(y=>y.name==="forge_master_ask");if(!x||!x.inputSchema.properties.proposeActions)throw new Error("FORGE-MASTER-CLAW-AWARE not complete: forge_master_ask lacks proposeActions")'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/ask.test.mjs tests/project-client.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 7 — Memory and idea capture commands [parallel-safe] (group A)
**Depends On**: Slice 6
**Context Files**: `.github/instructions/aci-design.instructions.md`, `.github/instructions/security.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D21, the **Seed Code** sections SC-1 (start from them), then this slice's Context Files (`.github/instructions/aci-design.instructions.md`, `.github/instructions/security.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `/remember <text>` → type buttons (Decision · Lesson · Convention · Pattern · Gotcha) → `forge_memory_capture` with `origin: "trusted"`, the D21 `source` / `created_by` format and the project's `visibility`; `/recall <query>` → `forge_search` (project scope) with sources + dates; `/idea <text>` → `forge_crucible_submit`; `/bug <text>` → `forge_bug_register`. All are `capture`/`ask` jobs — no repo mutation, no approval needed.
3. Results echo what was written (id/link) so the operator can verify.
4. Tests per command with fake MCP client, including empty-recall message and tool-error paths.

**Files**: `pforge-claw/src/handlers/capture-commands.mjs`, `pforge-claw/tests/capture-commands.test.mjs`, `pforge-claw/src/commands/remember.mjs`, `pforge-claw/src/commands/recall.mjs`, `pforge-claw/src/commands/idea.mjs`, `pforge-claw/src/commands/bug.mjs`, `pforge-claw/src/callbacks/m.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e 'const t=require("./pforge-mcp/tools.json");const a=Array.isArray(t)?t:t.tools;const x=a.find(y=>y.name==="forge_memory_capture");if(!x||!x.inputSchema.properties.origin)throw new Error("FORGE-MASTER-CLAW-AWARE Slice 8 not complete: forge_memory_capture lacks origin")'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/capture-commands.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 8 — Lane interface, LocalLane, Copilot session runtime, queues [parallel-safe] (group B)
**Depends On**: Slice 3
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D19, the **Seed Code** sections SC-8 (start from them), then this slice's Context Files (`.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/lanes/lane.mjs`: `Lane` contract `{ kind, id, capabilities, submit(job) → AsyncIterable<LaneEvent>, cancel(jobId), health() }`.
3. `src/runtime/agent-runtime.mjs` interface per D19 plus `src/runtime/byok.mjs` (BYOK provider config; key from env/secrets; key-missing → structured `BYOK_KEY_MISSING`, never the key in errors). Runtime chosen per lane or project from config.
4. `src/runtime/copilot-session.mjs`: default runtime, a wrapper over `@github/copilot-sdk` (`createSession` injected; lazy import), attaches the project's plan-forge MCP server to the session, maps typed session events to `LaneEvent` + usage (null-not-zero), passes `onPermissionRequest` from the policy (Slice 9 provides the real policy; this slice uses deny-all default).
5. `src/lanes/local-lane.mjs`: runs jobs on the dispatcher host; per-project FIFO queue (concurrency 1) + global heavy-job semaphore (`lanes.local.maxHeavy`, default 2).
6. Tests with fake SDK: event mapping, null-not-zero usage, per-project serialisation, global semaphore, cancel.

**Files**: `pforge-claw/src/lanes/lane.mjs`, `pforge-claw/src/lanes/local-lane.mjs`, `pforge-claw/src/runtime/agent-runtime.mjs`, `pforge-claw/src/runtime/byok.mjs`, `pforge-claw/tests/byok-runtime.test.mjs`, `pforge-claw/src/runtime/copilot-session.mjs`, `pforge-claw/tests/local-lane.test.mjs`, `pforge-claw/tests/copilot-session.test.mjs`

**Validation Gate**:
```bash
node -e 'const s=require("fs").readFileSync("pforge-claw/src/runtime/copilot-session.mjs","utf8");for(const n of ["approveAll","forInProcess"])if(s.includes(n))throw new Error("forbidden token: "+n)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/local-lane.test.mjs tests/copilot-session.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 9 — Job types, worktrees, and the permission policy [parallel-safe] (group B)
**Depends On**: Slice 8
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D10, D25, the **Seed Code** sections SC-8, SC-10 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/jobs/worktree.mjs`: `git worktree add` on a new branch `claw/<jobId>` from `baseBranch` under `PFORGE_CLAW_HOME/worktrees/<project>/<jobId>`; remove on completion (keep on failure for N hours, janitor sweep). Args-array spawn only. Refuse if target path resolves inside the operator's working tree.
3. `src/jobs/permission-policy.mjs`: per `JOB_TYPE` policy — `ask`: deny all writes/shell; `skill`/`task`: writes allowed only under the job worktree, shell allowed only for an allowlist (`git`, `node`, `npm`, `npx`, `pforge`, project test commands from registry), deny network tools except MCP; `plan`: delegated to `pforge run-plan` (D10).
4. Job runners: `task` (Copilot session in worktree → commit → push branch → open PR via `gh` args array), `skill` (`forge_run_skill` via MCP in worktree), `plan` (`pforge run-plan` args array in worktree; progress via `forge_watch_live`; abort via `forge_abort`).
5. `src/jobs/bootstrap.mjs` per D25: copy the `bootstrap.copy` allow-list from forgeHome, inject `bootstrap.env` secrets as environment variables only, set up dependencies per `bootstrap.install` (directory junction on Windows, symlink elsewhere, or `npm ci`), then run `pforge smith`; failure marks the job `failed` with `reason: bootstrap`. Guard: `.forge/secrets.json` is never copied.
6. Runners follow Shared Contract → Job model for `/run` plan resolution and post-job push + PR. Every `pforge` invocation uses `runtimes.pforgeCommand` (`"auto"` by default; see the Complete config reference and Seed SC-10) so tests can substitute a fake. Never spawn `.cmd` shims or use `shell: true`.
7. Emit job lifecycle events on `src/events.mjs` (`job.transition`, `job.finished`, `lane.event`), and before a `task` job starts, call every available feature's optional `taskContext(job, ctx)` and pass the merged result to the runtime as context. Later slices (memory in Slice 24) extend behaviour through these hooks instead of editing runners.
8. Tests: worktree path containment, operator-tree refusal, policy matrix (allowed/denied cases incl. `../` escape and symlink), runner wiring with fakes.

**Files**: `pforge-claw/src/jobs/worktree.mjs`, `pforge-claw/src/jobs/permission-policy.mjs`, `pforge-claw/src/jobs/runners.mjs`, `pforge-claw/tests/worktree.test.mjs`, `pforge-claw/tests/permission-policy.test.mjs`, `pforge-claw/tests/runners.test.mjs`, `pforge-claw/src/jobs/bootstrap.mjs`, `pforge-claw/tests/bootstrap.test.mjs`, `pforge-claw/src/commands/run.mjs`, `pforge-claw/src/commands/skill.mjs`, `pforge-claw/src/commands/task.mjs`, `pforge-claw/src/commands/jobs.mjs`, `pforge-claw/src/callbacks/s.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/worktree.test.mjs tests/permission-policy.test.mjs tests/runners.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 10 — Approvals via `callback_query` [sequential]
**Depends On**: Slice 7, Slice 9
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D6, the **Seed Code** sections SC-9 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/approvals.mjs` per D6: issue (random nonce, store hash + jobId + chatId + requester + expiry), verify (hash match, unexpired, unused, approver role, same chat), consume (mark used), expire sweep.
3. Approval card: for `plan` jobs include `forge_estimate_quorum` output (mode, projected cost, slice count); for `task`/`skill` include description, target branch, and lane. Buttons: ✅ Approve / ❌ Reject (+ quorum-mode choices for `plan`).
4. `src/callbacks/a.mjs` handles approve / reject (prefix `a`); the router has already answered the callback. `features/approvals.mjs` runs the expiry sweep. Nonce mechanics follow Seed SC-9.
5. Tests: happy path, replay rejected, expired rejected, wrong user, wrong chat, viewer cannot approve, tampered callback_data, estimate sourced from the tool (fake) not computed.

**Files**: `pforge-claw/src/approvals.mjs`, `pforge-claw/src/callbacks/a.mjs`, `pforge-claw/src/features/approvals.mjs`, `pforge-claw/tests/approvals.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/approvals.test.mjs tests/router.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/approvals.test.mjs","utf8");for(const n of ["replay","expired","wrong user","wrong chat"])if(!s.includes(n))throw new Error("approval test missing: "+n)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
```

#### Slice 11 — Budget governor [parallel-safe] (group C)
**Depends On**: Slice 10
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D9, then this slice's Context Files (`.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/budget.mjs` per D9 (two units, `costUSD` and `premiumRequests`, null-not-zero, `maxUnknownPerDay`): ledger append from session usage, Forge-Master turn `usage` (every `ask`), and post-run `forge_cost_report`; per-project + global daily caps (timezone from config); `check(job)` before lease → `held-budget` with owner-only "approve over budget" button; `/budget` command renders today's spend per project vs caps.
3. Tests: cap boundaries, timezone rollover with fake timers, held job released by owner override, null usage not counted as zero.

**Files**: `pforge-claw/src/budget.mjs`, `pforge-claw/tests/budget.test.mjs`, `pforge-claw/src/commands/budget.mjs`, `pforge-claw/src/callbacks/b.mjs`, `pforge-claw/src/features/budget.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/budget.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 12 — Progress, results, and failure recovery UX [parallel-safe] (group C)
**Depends On**: Slice 10
**Context Files**: `.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, the **Seed Code** sections SC-6 (start from them), then this slice's Context Files (`.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/progress.mjs`: one Telegram message per job, edited in place (rate-limited ≤ 1 edit / 3 s): state, lane, slice n/m, elapsed, spend. Templates follow `status-reporting.instructions.md` (Progress Update, Slice Complete, Failure / Recovery, Run Summary).
3. On finish: summary + PR link / artifact list. On failure: reason + buttons 🔁 Retry · ⏭ Resume-from-next · 🛑 Abort · 🤔 Why? (each mutating → re-enters approval). 🤔 Why? asks Forge-Master with the failure summary as a `contextBlocks` entry and `proposeActions:true`, and its suggested fixes come back as further buttons.
4. Tests: edit throttling with fake timers, template rendering, failure buttons create new approval-gated jobs.

**Files**: `pforge-claw/src/progress.mjs`, `pforge-claw/tests/progress.test.mjs`, `pforge-claw/src/commands/abort.mjs`, `pforge-claw/src/commands/retry.mjs`, `pforge-claw/src/callbacks/f.mjs`, `pforge-claw/src/features/progress.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/progress.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 13 — Scheduler and morning digest [parallel-safe] (group D)
**Depends On**: Slice 11, Slice 12
**Context Files**: `.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D16, the **Seed Code** sections SC-11 (start from them), then this slice's Context Files (`.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/scheduler.mjs` per D16 (tz-aware, persisted `lastRunAt`, no duplicate on restart, catch-up policy = skip missed runs older than 1 h).
3. `src/digest.mjs`: per-project `forge_plan_status`, overnight job outcomes from `jobs.jsonl`, spend from `budget.jsonl`, open bugs, drift summary, plus a "Look at first" section from `forge_master_audit` (top risks + P0 actions as buttons) → one `#general` message with per-project lines.
4. Scheduled skills: config `schedules[] = { id, kind, project, skill, at, preApproved }` using the Shared Contract schedule grammar (no cron syntax) — scheduled mutating skills still create approval cards unless the owner set `preApproved: true` for that schedule (recorded in audit).
5. Tests: tz rollover, restart no-duplicate, digest rendering with fakes.

**Files**: `pforge-claw/src/scheduler.mjs`, `pforge-claw/src/digest.mjs`, `pforge-claw/tests/scheduler.test.mjs`, `pforge-claw/tests/digest.test.mjs`, `pforge-claw/src/features/scheduler.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/scheduler.test.mjs tests/digest.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 14 — Alerts relay and stale-work nudges [parallel-safe] (group D)
**Depends On**: Slice 11, Slice 12
**Context Files**: `.github/instructions/status-reporting.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D24, D26, the **Seed Code** sections SC-7 (start from them), then this slice's Context Files (`.github/instructions/status-reporting.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/alerts.mjs` (per D27, **pull**): for each registered project, poll `forge_master_observe { action: "status", limit, cursor }` through the project's MCP client for observer insights (preferred: severity, evidence and suggested action already structured; de-duplicate by insight `id`; persist the cursor per project in the store). As a fallback when the observer isn't running (status reports `running: false` or the call returns `FORGE_MASTER_UNAVAILABLE`), poll raw LiveGuard / secret-scan / drift / run-failed events with `forge_watch_live` (cursor persisted too). Either source → topic message with action buttons (📝 File bug · 🛠 Draft fix → approval-gated `task`; or the insight's `suggestedAction`). Do **not** subscribe to the hub WebSocket for `forge-master-insight`: those events never reach other processes. `features/alerts.mjs` implements the `doctorChecks(ctx)` seam hook: when `ctx.live`, per registered project report whether the observer is running (`forge_master_observe status`) and advise `forge_master_observe start` (or `keepAlive: true`) when it isn't; offline (`ctx.live === false`), report from config only (which projects have `keepAlive`, so insights vs `forge_watch_live` fallback) and `skip` the live probe.
3. Nudges: phases hardened but not run for > N days, held-budget jobs older than 24 h, failed worktrees awaiting cleanup.
4. De-duplicate alerts by `(project, eventType, fingerprint)` within a window.
5. Alerts read from each project's home lane per D24, and require `keepAlive: true` per D26 for observer insights; the lane keeps that project's MCP server and observer running. For projects without keepAlive, alerts fall back to periodic `forge_watch_live` polling while the project MCP is up, and the `doctorChecks()` hook says so.
6. Tests: insight paging (`limit`/`cursor` forwarded, `hasMore` followed, cursor persisted across restart), dedupe by insight `id` and by `(project, eventType, fingerprint)` window, fallback to `forge_watch_live` when the observer is not running or unavailable, button → job creation, `doctorChecks()` output live (running / not running / unavailable) and offline (`skip` + keepAlive summary).

**Files**: `pforge-claw/src/alerts.mjs`, `pforge-claw/tests/alerts.test.mjs`, `pforge-claw/src/features/alerts.mjs`, `pforge-claw/src/callbacks/x.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/alerts.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 15 — Capture: forwards, links, photos, voice [parallel-safe] (group D)
**Depends On**: Slice 11, Slice 12
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D14, then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/capture.mjs`: forwarded message / link / photo in a project topic → triage keyboard (🐞 Bug · 💡 Idea · 🧠 Remember · ❓ Ask about it). 🧠 Remember shows a confirm card with the exact text to be stored and writes it with `origin: "untrusted"` only after confirmation. Content is treated as data (Security Posture §2) and reaches Forge-Master **only** via `untrustedContext`. It never becomes a mutating job without approval.
3. `src/stt.mjs` per D14: off by default; BYOK provider adapters (`openai`, `azure`) with injected `fetch`; transcript echoed for confirmation before triage; audio file deleted after.
4. Tests: triage mapping, injection attempt in forwarded text cannot create a mutating job, STT disabled path, key-missing path returns structured error without the key.

**Files**: `pforge-claw/src/capture.mjs`, `pforge-claw/src/stt.mjs`, `pforge-claw/tests/capture.test.mjs`, `pforge-claw/tests/stt.test.mjs`, `pforge-claw/src/features/capture.mjs`, `pforge-claw/src/callbacks/t.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/capture.test.mjs tests/stt.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/capture.test.mjs","utf8");if(!s.includes("injection"))throw new Error("prompt-injection test missing")'
```

#### Slice 16 — Cross-project `#general`: rollups, fan-out, scoped memory [parallel-safe] (group D)
**Depends On**: Slice 11, Slice 12
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, then this slice's Context Files (`.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/crossproject.mjs`: `/status` rollup (per-project state, active job, today's spend vs caps); `/fanout <task> [projects…]` → parent `fanout` job with one child `task` per project, single approval card listing all targets, combined final report; `/recall --all <q>` searches every project scope **except** `visibility: restricted`.
3. Restricted projects: their content never appears in `#general` output or other topics.
4. Tests: rollup rendering, fan-out approval covers all children, one child failure doesn't cancel siblings, restricted exclusion.

**Files**: `pforge-claw/src/crossproject.mjs`, `pforge-claw/tests/crossproject.test.mjs`, `pforge-claw/src/commands/status.mjs`, `pforge-claw/src/commands/fanout.mjs`, `pforge-claw/src/features/crossproject.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/crossproject.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 17 — Service packaging (macOS / Linux / Windows) and single-host smoke [sequential]
**Depends On**: Slice 13, Slice 14, Slice 15, Slice 16
**Context Files**: `.github/instructions/release-checklist.instructions.md`, `.github/instructions/security.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, the **Seed Code** sections SC-10, SC-15 (start from them), then this slice's Context Files (`.github/instructions/release-checklist.instructions.md`, `.github/instructions/security.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `service/com.pforge.claw.plist` (launchd), `service/pforge-claw.service` (systemd user unit), `service/install-service.ps1` (Windows Task Scheduler, at-logon, restart-on-failure) **and** `service/install-service.sh` (macOS/Linux) — both support `install | uninstall | status`.
3. `pforge claw service install|uninstall|status` implemented in `src/cli/service.mjs` (the `pforge` shells already pass `claw` arguments through unchanged).
4. Health: `status` reports poller lag, queue depth per project, last digest, lane health.
5. Single-host smoke: `tests/single-host-smoke.test.mjs` boots `start` against the fake Telegram helper with three fixture repos and drives the success-metric-1 loop (ask → approve → progress → PR link). Offline fakes introduced here and reused by Slice 27: `tests/helpers/fake-project-mcp.mjs` (a scripted MCP server answering the `forge_*` tools the bot calls, including `forge_master_ask` with `proposedActions`), `tests/helpers/fake-pforge.mjs` (substituted via `runtimes.pforgeCommand`; writes a scripted `.forge/runs/<id>/events.jsonl` and commits in the worktree), `tests/helpers/scripted-copilot.mjs`, and a fake `gh` that records PR creation. Live dogfood moves to Slice 27.

**Files**: `pforge-claw/service/*`, `pforge-claw/src/cli/service.mjs`, `pforge-claw/src/cli/status.mjs`, `pforge-claw/tests/service.test.mjs`, `pforge-claw/tests/single-host-smoke.test.mjs`, `pforge-claw/tests/helpers/fixture-repos.mjs`, `pforge-claw/tests/helpers/scripted-copilot.mjs`, `pforge-claw/tests/helpers/fake-project-mcp.mjs`, `pforge-claw/tests/helpers/fake-pforge.mjs`

**Validation Gate**:
```bash
node -e 'const fs=require("fs");for(const f of ["pforge-claw/service/install-service.ps1","pforge-claw/service/install-service.sh"])if(!fs.existsSync(f))throw new Error("missing twin: "+f)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
node pforge-mcp/server.mjs --check
```

### Milestone M2 — Distributed: dispatcher in K8s, remote workers

#### Slice 18 — Worker protocol, RemoteLane, `pforge claw worker` [parallel-safe] (group D)
**Depends On**: Slice 12
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D11, D24, the **Seed Code** sections SC-12 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/protocol/messages.mjs`: versioned schemas (`hello`, `challenge`, `auth`, `ready`, `lease`, `ack`, `event`, `cancel`, `heartbeat`, `bye`) with validation.
3. `src/protocol/ws-server.mjs` (dispatcher): `/claw/workers` endpoint, HMAC challenge per D11, worker presence registry, lease/ack/expiry/requeue, event resume by `seq`.
4. `src/protocol/worker-agent.mjs` + `cli.mjs worker`: dials out, authenticates, advertises capabilities (`os`, toolchains, projects it can serve, `macos: true`), runs leased jobs through a local `LocalLane`, reconnects with jittered backoff.
5. `src/lanes/remote-lane.mjs`: `Lane` implementation over the server registry.
6. Enrollment and transport per D11: `worker enroll` / `worker join` / `worker revoke`; refuse non-loopback `ws://` unless `worker.allowInsecureLan`; `read` leases (low latency, no worktree) for home-lane MCP calls per D24 alongside `job` leases.
7. Tests: enrollment code single-use and expiring, revoked worker rejected, insecure non-loopback URL refused, `read` lease round-trip latency bounded, secret never on the wire, bad HMAC rejected, lease expiry requeues, duplicate events suppressed on resume, version mismatch handled.

**Files**: `pforge-claw/src/protocol/*`, `pforge-claw/src/lanes/remote-lane.mjs`, `pforge-claw/src/cli/worker.mjs`, `pforge-claw/src/features/workers.mjs`, `pforge-claw/src/http.mjs`, `pforge-claw/tests/protocol.test.mjs`, `pforge-claw/tests/remote-lane.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/protocol.test.mjs tests/remote-lane.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 19 — Dispatcher container + webhook mode [parallel-safe] (group E)
**Depends On**: Slice 18
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `deploy/Dockerfile.dispatcher`: multi-stage, Node 22/24 slim, non-root UID, `PFORGE_CLAW_HOME=/data`, `HEALTHCHECK` → `/healthz`.
3. `src/channels/telegram/webhook.mjs`: optional receiver; rejects requests without the matching `X-Telegram-Bot-Api-Secret-Token`; `setWebhook`/`deleteWebhook` managed by `cli.mjs`; switching modes is idempotent.
4. `/healthz` (liveness) and `/readyz` (state store writable, Telegram reachable) on the dispatcher HTTP server (binds `127.0.0.1` unless `http.bind` configured).
5. Tests: missing/wrong secret header → 401 with no processing, mode switch, health endpoints.

**Files**: `pforge-claw/deploy/Dockerfile.dispatcher`, `pforge-claw/src/channels/telegram/webhook.mjs`, `pforge-claw/src/http.mjs`, `pforge-claw/tests/webhook.test.mjs`, `pforge-claw/src/features/webhook.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/webhook.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/deploy/Dockerfile.dispatcher","utf8");if(!/\nUSER\s+(?!root)/.test(s))throw new Error("dispatcher image must run as non-root")'
```

#### Slice 20 — Kustomize manifests for the dispatcher [parallel-safe] (group K8S-EARLY)
**Depends On**: Slice 2
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D5, D12, then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `deploy/k8s/base/`: Namespace, Deployment (1 replica, `Recreate` strategy — single writer per D5), PVC for `/data`, Service, ServiceAccount, Role + RoleBinding per D12, Secret **references** only (no values; document sealed-secrets / external-secrets), NetworkPolicy for the dispatcher, optional Ingress for webhook + worker WS.
3. `deploy/k8s/overlays/example/` example overlay.
4. Tests: YAML parse + invariants (no `ClusterRole`, Role verbs ⊆ D12, no Secret `data`/`stringData` committed, `runAsNonRoot: true`, `Recreate` strategy).

**Files**: `pforge-claw/deploy/k8s/**`, `pforge-claw/tests/k8s-manifests.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/k8s-manifests.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M3 — Ephemeral Kubernetes Job lanes

#### Slice 21 — Worker base images [parallel-safe] (group E)
**Depends On**: Slice 18
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D4, then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `deploy/Dockerfile.worker-base`: Node 22/24, `git`, `bash`, `pwsh` (dual-shell parity checks must run), `gh`, Copilot CLI, non-root; entrypoint `pforge claw worker --one-shot`.
3. Stack variants as build args or thin derived Dockerfiles (`node`, `dotnet`, `python`); the registry `image` field selects per project. Images build **multi-arch** (amd64 + arm64) via `docker buildx`, with registry/namespace/tag as build parameters. `pforge-claw/scripts/build-images.ps1` **and** `build-images.sh` twins; nothing pushes to a hardcoded registry.
4. Record D4 outcome: if container Copilot auth is unsupported, worker image defaults to BYOK provider config and the `doctorChecks(ctx)` hook in `features/workers.mjs` (feature seam) reports "K8s lanes: BYOK-only".
5. Tests: Dockerfile invariants (non-root, no secrets in `ENV`/`ARG` defaults, both shells installed).

**Files**: `pforge-claw/deploy/Dockerfile.worker-base`, `pforge-claw/deploy/worker-variants/*`, `pforge-claw/scripts/build-images.ps1`, `pforge-claw/scripts/build-images.sh`, `pforge-claw/tests/worker-image.test.mjs`, `pforge-claw/src/features/workers.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/worker-image.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 22 — K8sJobLane [sequential]
**Depends On**: Slice 9, Slice 20, Slice 21
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D4, D25, the **Seed Code** sections SC-13 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/lanes/k8s-job-lane.mjs`: build Job spec (project image, `activeDeadlineSeconds`, CPU/memory requests+limits, `ttlSecondsAfterFinished`, `backoffLimit: 0`, non-root, emptyDir workspace or PVC repo cache, per-job Secret projection), create via in-cluster REST (`fetch` + SA token + CA), watch status, cancel = delete with propagation.
3. Pod runs `pforge claw worker --one-shot --job <id>` which connects back over the worker protocol for events (no log scraping).
4. Shallow clone of `repo.remote` at `baseBranch` into the workspace; push branch / open PR as in Slice 9.
5. Pod bootstrap per D25: before work starts, the pod requests the `bootstrap.copy` set from the project's home lane over the worker protocol, receives secrets only as K8s Secret environment variables (`PFORGE_CLAW_GH_TOKEN`, and `PFORGE_CLAW_COPILOT_TOKEN` only if D4 allows), installs dependencies with `npm ci`, and runs `pforge smith`.
6. Tests with fake K8s API: spec invariants, create/watch/cancel, deadline exceeded → `failed` with reason, API 403 → structured error.

**Files**: `pforge-claw/src/lanes/k8s-job-lane.mjs`, `pforge-claw/src/k8s/api.mjs`, `pforge-claw/tests/k8s-job-lane.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/k8s-job-lane.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 23 — Egress NetworkPolicy and placement routing [sequential]
**Depends On**: Slice 22
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D13, then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `deploy/k8s/base/networkpolicy-jobs.yaml`: default-deny egress for job pods; allow DNS, dispatcher Service, GitHub/Copilot hostnames (D13, via CIDR/FQDN policy per CNI — document Calico vs Cilium), OpenBrain endpoint.
3. `src/placement.mjs`: choose lane per job from registry `placement.prefer` + `requires` matched against each lane's configured `labels` (e.g. a project requiring `macos` → any enabled lane labelled `macos`), `restricted` projects → their dedicated lanes only, `optIn` lanes only while switched on via `/lane <id> on`; fallback order with explanation in the approval card ("will run on: k8s-jobs (mac-1 offline)"). `/lanes` lists lanes with labels, status and queue depth.
4. Tests: placement table incl. offline fallbacks, restricted pinning, `/lane` opt-in toggle, label matching; manifest invariants for the egress policy.

**Files**: `pforge-claw/deploy/k8s/base/networkpolicy-jobs.yaml`, `pforge-claw/src/placement.mjs`, `pforge-claw/tests/placement.test.mjs`, `pforge-claw/tests/k8s-manifests.test.mjs`, `pforge-claw/src/commands/lane.mjs`, `pforge-claw/src/commands/lanes.mjs`, `pforge-claw/tests/commands/*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/placement.test.mjs tests/k8s-manifests.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M4 — Hardening, docs, ship

#### Slice 24 — Memory integration: capture, provenance, recall [parallel-safe] (group D)
**Depends On**: Slice 7, Slice 12
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/aci-design.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D10, D21, the **Seed Code** sections SC-7, SC-14 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/aci-design.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/memory/memory-client.mjs` per D21: every project-scoped write goes through that project's MCP `forge_memory_capture` with `source: pforge-claw/<instanceId>/<lane>/<jobId|command>`, `created_by: pforge-claw:<role or configured alias>` (never raw channel user ids or names), and `origin` / `tags` / `visibility` per the FORGE-MASTER-CLAW-AWARE contract. Redaction + PII patterns run before every write. Per-project `memory.l3: "inherit" | "off"` is honoured; `off` keeps records in claw state only.
3. Optional direct L3 client `src/memory/openbrain-direct.mjs` (config `memory.openbrain { endpoint, tokenSecret }`, MCP client over the endpoint's transport): used only for cross-project reads and bot-level writes under `project: "pforge-claw:<instanceId>"`. It has its own durable queue in claw state with the same backoff and dead-letter semantics as pforge's queue. Restricted projects are excluded from query filters, and any restricted hit returned is dropped. With no endpoint configured, cross-project recall fans out per project through `forge_search`.
4. Automatic captures, implemented in `src/features/memory.mjs` by subscribing to `job.finished` on the event bus (do not edit `runners.mjs`), each behind a config flag with conservative defaults: completed `task` jobs (request, change summary, PR link, outcome; on by default); approve/reject decisions with reason (`memory.captureApprovals`, off); acted-on critical insights (`memory.captureInsights`, off). Never capture `plan` / `skill` jobs: the orchestrator already does, and a guard test asserts it.
5. Pre-task memory through the memory feature's `taskContext(job)` hook: fetch the top related memories via `forge_search` and return them as context. Untrusted-origin memories go in as untrusted context, never as instructions.
6. `/forget <id>` only when the D10 VERIFY outcome says OpenBrain supports delete; otherwise the command stays registered with `available: false`. the `doctorChecks(ctx)` hook in `features/memory.mjs` (feature seam) checks OpenBrain reachability per project and for the direct client; `/status` shows pending memory records per project.
7. Tests: source / created_by format, no channel user ids in any record, redaction canaries, `l3: off` honoured, plan jobs not double-captured, direct-client queue / backoff / dead-letter, restricted exclusion in cross-project recall, pre-task memories fenced when untrusted, `/forget` availability tied to the capability flag.

**Files**: `pforge-claw/src/memory/memory-client.mjs`, `pforge-claw/src/memory/openbrain-direct.mjs`, `pforge-claw/src/features/memory.mjs`, `pforge-claw/src/commands/forget.mjs`, `pforge-claw/src/callbacks/c.mjs`, `pforge-claw/tests/memory-client.test.mjs`, `pforge-claw/tests/openbrain-direct.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/memory-client.test.mjs tests/openbrain-direct.test.mjs tests/help.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/memory-client.test.mjs","utf8");for(const n of ["double-capture","restricted","canary","created_by"])if(!s.includes(n))throw new Error("memory test missing: "+n)'
```

#### Slice 25 — L2 consolidation for worktree, remote and K8s lanes [sequential]
**Depends On**: Slice 18, Slice 22, Slice 24
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D22, the **Seed Code** sections SC-10, SC-12 (start from them), then this slice's Context Files (`.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `src/memory/l2-sync.mjs` per D22: after each job, compute the delta between the job's `.forge/` and its starting snapshot (run folders, append-only JSONL streams, cost-history entries, trajectories, pending auto-skills, bugs, OpenBrain queue). The exact file inventory is fixed at hardening from the current `.forge/` layout and listed in the slice notes.
3. Apply the delta to the project's canonical L2 home (`repo.forgeHome`, default `<repo.path>/.forge` on the lane that owns it): copy orchestrator-produced run folders **verbatim** (Hallmark records must still verify), append JSONL records idempotently by record id / content hash, merge JSON maps by id, never overwrite or synthesise a record.
4. Remote lanes: the worker sends the delta back as chunked, checksummed `artifact` LaneEvents. The dispatcher forwards it to whichever lane owns the canonical home, and that lane applies it.
5. K8s Job pods: start the project MCP server with `--port 3100` for the job's duration, because `pforge drain-memory` POSTs to `http://localhost:3100/api/memory/drain` (port fixed in `pforge.ps1` / `pforge.sh`) using the bridge secret from `.forge/bridge-secret` or `PFORGE_BRIDGE_SECRET`; before exit, run `pforge drain-memory` to flush the OpenBrain queue, then ship any still-undelivered queue records plus the `.forge` delta back over the worker protocol. The pod exits only after the dispatcher acks, bounded by the Job deadline; on timeout the job is marked `failed` with `reason: l2-sync-incomplete` and `doctor` lists it.
6. Tests: idempotent re-apply (no duplicates), never-overwrite, run-folder copy passes Hallmark verification, checksum mismatch rejected, OpenBrain-down pod path where queued records arrive in the canonical queue, delta forwarding to a non-dispatcher canonical lane.

**Files**: `pforge-claw/src/memory/l2-sync.mjs`, `pforge-claw/src/protocol/worker-agent.mjs`, `pforge-claw/src/lanes/k8s-job-lane.mjs`, `pforge-claw/tests/l2-sync.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/l2-sync.test.mjs tests/k8s-job-lane.test.mjs tests/remote-lane.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/l2-sync.test.mjs","utf8");for(const n of ["idempotent","hallmark","checksum","drain"])if(!s.toLowerCase().includes(n))throw new Error("l2-sync test missing: "+n)'
```

#### Slice 26 — Security hardening pass [sequential]
**Depends On**: Slice 17, Slice 19, Slice 23, Slice 25
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, the **Seed Code** sections SC-2 (start from them), then this slice's Context Files (`.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `docs/PFORGE-CLAW-THREAT-MODEL.md`: assets, trust boundaries (Telegram ↔ dispatcher ↔ workers ↔ repos ↔ GHCP), STRIDE table, mitigations mapped to slices.
3. End-to-end guard suite: planted canary secrets across config/env → assert absent from every state file, log, and outbound message; injection corpus (forwarded text instructing "run plan X", "approve", "push to master") → no mutating job created; memory-poisoning corpus (a confirmed untrusted memory containing instructions, recalled in a later `ask` and before a `task`) → reaches Forge-Master and the agent runtime only as fenced untrusted context and yields only `origin: untrusted` proposals; per-user rate limit (messages/min) with silent throttle for abusive bursts.
4. Run `forge_secret_scan` over `pforge-claw/` and record the result.

**Files**: `docs/PFORGE-CLAW-THREAT-MODEL.md`, `pforge-claw/tests/security-e2e.test.mjs`, `pforge-claw/src/router.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/security-e2e.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const fs=require("fs");if(!fs.existsSync("docs/PFORGE-CLAW-THREAT-MODEL.md"))throw new Error("threat model missing")'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
```

#### Slice 27 — Full test environment and end-to-end validation [sequential]

**Depends On**: Slice 26
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D4, the **Seed Code** sections SC-15 (start from them), then this slice's Context Files (`.github/instructions/testing.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. Offline e2e suite `pforge-claw/tests/e2e/*.test.mjs` + `test:e2e` script, built on `fake-telegram.mjs`, `fixture-repos.mjs` (three throwaway git repos with a minimal plan-forge setup and a tiny plan, created in a temp dir per run) and `scripted-copilot.mjs` (deterministic Copilot session events). Runs fully offline, no GHCP spend.
3. `pforge claw dev up|down|status` in `src/cli/dev.mjs`: boots a local multi-process topology — dispatcher + LocalLane + two RemoteLane workers (fixture lane ids `worker-a` labelled `macos` and `worker-b` labelled `windows`, both opt-in) with separate `PFORGE_CLAW_HOME`s on localhost — pointed at either the fake Telegram server (`--fake`) or the real bot (`--live`).
4. Scenarios (each a named test): (a) away-from-desk loop — ask → `/run` → estimate card → approve → slice progress edits → PR link (success metric 1); (b) three projects concurrent, one held by budget cap then owner-released (metric 3); (c) safety — unknown user silent, approval replay/expiry/wrong-user, forwarded-text injection, canary secrets absent everywhere (metric 4); (d) simulated 7-day digest + alerts with fake clock and two injected dispatcher restarts — no miss/duplicate (metric 2); (e) worker disconnect mid-job → lease expiry → requeue → resume by `seq` with no duplicate Telegram edits; (f) placement — `macos`-labelled job pinned to `worker-a`, `restricted` project never on a shared lane, `/lane worker-b off` respected; (g) help — `/help` in a project topic vs `#general` vs as a `viewer` shows the right command sets, every listed command is runnable by that caller, and the `setMyCommands` menu captured by the fake server matches `/help`; (h) memory — OpenBrain offline (fake) → captures queue then drain on recovery, a forwarded message is never stored without confirm, a restricted project never appears in `/recall --all`, and a K8s-style one-shot worker's `.forge` history and undelivered queue records reach the canonical L2 home after it exits.
5. K8s dev overlay `deploy/k8s/overlays/dev/` (k3d/kind) plus `scripts/e2e-k8s.ps1` **and** `scripts/e2e-k8s.sh` twins: build dispatcher + worker images, load into the local cluster, apply, run scenario (a) through a `K8sJobLane`, assert Job cleanup and NetworkPolicy denial of a non-allowlisted egress host, then tear down. Skipped (not failed) when no cluster is reachable; `doctor` explains why.
6. **MANUAL (operator)** for the live part. The agent writes the generic live-environment runbook (`docs/PFORGE-CLAW-GUIDE.md` §Live test environment, drafted here and finalised in Slice 29), written for any topology. Then execute it on the **reference validation environment**: dispatcher on the Linux K8s cluster, macOS worker, Windows worker (opt-in), K8s Job lane, three real projects registered; run scenarios (a) and (b) with real Telegram + GHCP; capture evidence (message screenshots, job ids, PR links, `budget.jsonl` excerpt) in the slice artifact. Record the D4 outcome observed live.
7. **MANUAL (operator)**: create the Telegram bot with BotFather (token into `PFORGE_CLAW_TELEGRAM_TOKEN`, privacy mode off or bot as admin, forum group with topics), enroll the workers, then run the live scenarios. The agent prepares a checklist and an evidence template in the slice notes and stops here.

**Files**: `pforge-claw/tests/e2e/*`, `pforge-claw/tests/helpers/*`, `pforge-claw/package.json`, `pforge-claw/src/cli/dev.mjs`, `pforge-claw/deploy/k8s/overlays/dev/*`, `pforge-claw/scripts/e2e-k8s.ps1`, `pforge-claw/scripts/e2e-k8s.sh`, `pforge-claw/vitest.e2e.config.mjs`

**Validation Gate**:
```bash
node -e 'const p=require("./pforge-claw/package.json");if(!p.scripts||!p.scripts["test:e2e"])throw new Error("test:e2e script missing")'
node -e 'const fs=require("fs");for(const f of ["pforge-claw/scripts/e2e-k8s.ps1","pforge-claw/scripts/e2e-k8s.sh","pforge-claw/deploy/k8s/overlays/dev/kustomization.yaml"])if(!fs.existsSync(f))throw new Error("missing: "+f)'
node -e 'const fs=require("fs");const d="pforge-claw/tests/e2e";const all=fs.readdirSync(d).map(f=>fs.readFileSync(d+"/"+f,"utf8")).join("\n");for(const n of ["away-from-desk","concurrent","safety","7-day","requeue","placement","help","memory"])if(!all.includes(n))throw new Error("e2e scenario missing: "+n)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npm run test:e2e', {stdio:'inherit',shell:true});"
```

#### Slice 28 — Cross-platform CI and Tested Platforms matrix [sequential]

**Depends On**: Slice 27
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/release-checklist.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D20, then this slice's Context Files (`.github/instructions/testing.instructions.md`, `.github/instructions/release-checklist.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. Add `.github/workflows/pforge-claw.yml` per D20: matrix `os: [ubuntu-latest, windows-latest, macos-latest]` × `node: [22.12, 24]` running `pforge-claw` unit tests, `test:e2e` (offline), the boundaries/portability guards, and `pforge claw doctor --json` against `examples/single-host.json`. A separate ubuntu job creates a kind cluster and runs `pforge-claw/scripts/e2e-k8s.sh`. Path filters: `pforge-claw/**`, `pforge.ps1`, `pforge.sh`, the workflow itself.
3. Both shells exercised: the windows job runs `pforge.ps1 claw doctor`; ubuntu and macos run `pforge.sh claw doctor`.
4. `docs/PFORGE-CLAW-GUIDE.md` §Tested Platforms: matrix (OS, arch, Node, K8s distro/version, CNI, runtime, channel, result, date, reporter) seeded from CI plus the Slice 27 reference-environment runs (macOS host, Windows host, Linux K8s cluster), with instructions for community submissions (issue template field list).
5. Fix any platform-specific defect the matrix exposes in the slice that owns the code (path, line-ending, spawn or service bugs); record each in the slice notes for the post-mortem.
6. **MANUAL (operator)**: push the branch, confirm the `pforge-claw` workflow is green on all three OSes and the kind job, and paste the run URL into the slice notes. The agent does not push without the operator.

**Files**: `.github/workflows/pforge-claw.yml`, `docs/PFORGE-CLAW-GUIDE.md`

**Validation Gate**:
```bash
node -e 'const s=require("fs").readFileSync(".github/workflows/pforge-claw.yml","utf8");for(const n of ["ubuntu-latest","windows-latest","macos-latest","kind","test:e2e"])if(!s.includes(n))throw new Error("CI matrix missing: "+n)'
node -e 'const s=require("fs").readFileSync("docs/PFORGE-CLAW-GUIDE.md","utf8");if(!s.includes("Tested Platforms"))throw new Error("Tested Platforms matrix missing")'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/boundaries.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 29 — Full documentation and capabilities sweep (after all code is built) [sequential]

**Depends On**: Slice 28
**Context Files**: `.github/instructions/release-checklist.instructions.md`, `.github/instructions/aci-design.instructions.md`, `.github/instructions/git-workflow.instructions.md`

Tasks:
1. **Orient first (no edits yet):** read `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md` sections **Shared Contract** (incl. Module seams), **Portability & Configurability Contract**, **Scope Contract → Forbidden** and **Security Posture**, Required Decisions D3, D4, D6, D8, D11, D12, D13, D21, D22, then this slice's Context Files (`.github/instructions/release-checklist.instructions.md`, `.github/instructions/aci-design.instructions.md`, `.github/instructions/git-workflow.instructions.md`). The worker prompt contains only this slice, so treat those sections as binding. If anything conflicts with them, stop and report a blocker instead of guessing.
2. `docs/PFORGE-CLAW-GUIDE.md` (generic, for any operator): what Forge-Claw is, architecture, a quick start per OS (macOS / Windows / Linux), `pforge claw init` + config reference generated from `config.schema.json`, lanes and labels, channel adapter setup (Telegram: BotFather, privacy mode, forum topics), agent runtimes (GHCP default, BYOK), seat/runtime policy (D8), service install per OS, remote workers, Kubernetes deploy from `overlays/example`, budget/approval model, security model summary linking the threat model, live test environment runbook, Tested Platforms, troubleshooting, and the **Chat command reference** generated from `src/commands.mjs` (`node pforge-claw/cli.mjs commands --markdown`).
3. Capabilities surface: add a Forge-Claw entry (companion package, CLI subcommands, chat command list, config file, related hub events) in `pforge-mcp/capabilities/surface.mjs` so `forge_capabilities` reports it; update the Forge-Master description to mention `proposedActions` and observer insights. Regenerate the MCP Tools table with `node scripts/generate-capabilities-doc.mjs`, and hand-update the narrative sections of `docs/capabilities.md` and `docs/capabilities.html`, which the generator does not touch, to describe Forge-Claw and the new Forge-Master contract.
4. Manual: new chapter `docs/manual/forge-claw.html`; update `cli-reference.html` (`pforge claw`), `forge-master.html` and `dashboard-forge-master.html` (new contract fields, proposals, insights), `event-catalog.html` (`forge-master-insight`), `integrating-from-outside.html`, `multi-agent.html`, `how-do-i.html`, `troubleshooting.html`, `glossary.html` (Forge-Claw, dispatcher, lane, worker, channel adapter, agent runtime, proposed action), `book-index.html` / `reader-paths.html`; run `node docs/manual/maintain.mjs` to refresh counts and glossary terms.
5. Top-level docs: `README.md` (feature list + link to the guide), `docs/CLI-GUIDE.md` (`pforge claw`), `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` (Forge-Claw as the native front door; OpenClaw remains an alternative integration), `ROADMAP.md`, `CHANGELOG.md` `[Unreleased]` (experimental `pforge-claw` package, `pforge claw` CLI, cross-platform support, link to the guide), `docs/plans/DEPLOYMENT-ROADMAP.md` status for both phases.
6. Sweep for stale or operator-specific text across all touched docs: no personal hosts, chat ids or paths; every example uses placeholders; every cross-link resolves.
7. Update `docs/manual/remote-bridge.html` (Forge-Claw as the inbound side of the bridge; OpenClaw section cross-links the guide).
8. Retro (last task, after everything else): append `## What actually shipped` to this plan and rewrite the status line at the top of the plan so it reads "✅ Complete. All 29 slices shipped. See [What actually shipped](#what-actually-shipped)." (keep the existing bold Status label); do not touch `lockHash`.

**Files**: `docs/PFORGE-CLAW-GUIDE.md`, `pforge-mcp/capabilities/surface.mjs`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/manual/*`, `README.md`, `docs/CLI-GUIDE.md`, `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/plans/DEPLOYMENT-ROADMAP.md`, `docs/plans/Phase-62-PFORGE-CLAW-PLAN.md`

**Validation Gate**:
```bash
node -e 'const s=require("fs").readFileSync("CHANGELOG.md","utf8");const u=s.slice(0,s.indexOf("\n## [",s.indexOf("## [Unreleased]")+5));if(!u.includes("pforge-claw"))throw new Error("CHANGELOG [Unreleased] missing pforge-claw")'
node -e 'const fs=require("fs");const need={"docs/PFORGE-CLAW-GUIDE.md":["Chat command reference","Tested Platforms","overlays/example"],"docs/UNIFIED-SYSTEM-ARCHITECTURE.md":["Forge-Claw"],"README.md":["Forge-Claw"],"docs/CLI-GUIDE.md":["pforge claw"],"docs/manual/forge-claw.html":["Forge-Claw"],"pforge-mcp/capabilities/surface.mjs":["Forge-Claw"]};for(const [f,ns] of Object.entries(need)){const s=fs.readFileSync(f,"utf8");for(const n of ns)if(!s.includes(n))throw new Error(f+" missing "+n)}'
node scripts/generate-capabilities-doc.mjs --check
node docs/manual/maintain.mjs --audit
node pforge-mcp/server.mjs --check
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
node -e 'const c=require("fs").readFileSync("docs/plans/Phase-62-PFORGE-CLAW-PLAN.md","utf8");if(!/^## What actually shipped\s*$/m.test(c))throw new Error("retro section missing");if(!/^>\s*\*\*Status\*\*:\s*(✅|Complete)/m.test(c))throw new Error("status header not rewritten")'
```

## Re-anchor Checkpoints

- **After Slice 1**: re-read Forbidden. Confirm no source import from `pforge-mcp/` / `pforge-master/`, both shells dispatch `claw`, tool surface unchanged.
- **After Slice 5**: re-read Security Posture §1. Confirm silent-drop for unknown users/chats.
- **After Slice 10**: re-read D6 and the mutating-job MUST. Confirm no code path leases a mutating job without a consumed approval.
- **After Slice 12 (end of M1 core)**: re-read Success Metric 1 and run it against the fake Telegram helper before starting P1.
- **After Slice 17 (end of M1)**: re-read D4, D11, D12. Confirm single-host smoke is green, then continue straight into M2 — no pause.
- **After Slice 20**: re-read D12/D13. Confirm RBAC verbs and namespace scope.
- **After Slice 23**: re-read placement rules and `restricted` semantics. Re-read the Portability & Configurability Contract: no lane or label names in code.
- **After Slice 25**: re-read D21/D22 and Security Posture §8. Confirm no channel user ids in memory, untrusted captures need a confirm, and every lane kind merges `.forge` history back.
- **After Slice 28**: the CI matrix is green on all three OSes plus kind; the Tested Platforms matrix is seeded.
- **Before Slice 29**: all code is frozen; the doc sweep documents what actually shipped, not what was planned.

## Validation Gates (phase-level)

```bash
node pforge-mcp/server.mjs --check
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npm run test:e2e', {stdio:'inherit',shell:true});"
node scripts/audit/dep-boundaries.mjs
node scripts/generate-capabilities-doc.mjs --check
node docs/manual/maintain.mjs --audit
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/bridge.test.mjs', {stdio:'inherit',shell:true});"
```

The last gate proves the existing outbound bridge is untouched.

## Stop Conditions

- D4 verification shows GHCP cannot be used headless **and** no BYOK provider is configured → stop M3; ship M1–M2 only.
- Any approval-bypass path is discovered that the Slice 10 tests did not cover → stop, add the test, fix, re-run the whole M1 suite.
- A slice needs a third-party dependency outside D3 → stop and raise a Required Decision.
- A slice needs to modify `pforge-mcp/` or `pforge-master/` runtime code beyond what FORGE-MASTER-CLAW-AWARE delivered → stop; extend that companion phase instead.
- Build or test failure: a validation gate fails and the root cause isn't found within 30 minutes.
- Scope violation: the slice needs to change a file outside its **Files** list → stop, revert that change, and report.
- Security breach: a guard test, log line, message or state file shows a secret, token or approval bypass → stop immediately, rotate the exposed credential, and file via `forge_meta_bug_file` if Plan Forge itself is at fault.
- Budget for the phase exceeds estimate by more than 25 % (`forge_cost_report`).
- A **MANUAL (operator)** task is reached: finish the preparation it describes, write a handoff note (what is ready, exact commands, what evidence to capture), and stop. This is an expected pause, not a failure.

## Rollback

The package is additive and opt-in: nothing starts it unless the operator runs `pforge claw start` / installs the service. Rollback per environment: `pforge claw service uninstall` (hosts), `kubectl delete -k deploy/k8s/overlays/example` (cluster), and `deleteWebhook` if webhook mode was used. Per-slice rollback is `git revert` of the slice commit. Host state lives in `PFORGE_CLAW_HOME` and can be archived/deleted without touching any project repo. Claw worktrees and `claw/*` branches are the only repo-side artefacts; the janitor (Slice 9) and a documented `git worktree prune` + branch cleanup command remove them.

## Definition of Done

- [ ] All 29 slices complete with gates passing (or M3 formally descoped per Stop Conditions with the D4 outcome recorded)
- [ ] Every **MUST** acceptance criterion traceable to a passing test or gate
- [ ] Offline e2e suite green (all six scenarios); K8s e2e run green on the dev overlay
- [ ] Reference validation environment up (Linux K8s dispatcher + macOS worker + Windows worker + K8s Job lane) with scenarios (a) and (b) evidenced, and results recorded in the Tested Platforms matrix
- [ ] Cross-platform CI (Slice 28) green on ubuntu, windows and macos, plus the kind job
- [ ] Portability guard green: no operator-specific values anywhere in `pforge-claw/`
- [ ] `node pforge-mcp/server.mjs --check` passes without regeneration
- [ ] `forge_secret_scan` clean over `pforge-claw/`
- [ ] Threat model and guide published; doc and capabilities sweep complete (`generate-capabilities-doc.mjs --check` and `maintain.mjs --audit` green; `forge_capabilities` lists Forge-Claw)
- [ ] Reviewer Gate passed (zero 🔴 Critical) by a fresh session
- [ ] Plan status header rewritten to ✅ Complete and `## What actually shipped` appended (Slice 29)
- [ ] `CHANGELOG.md` updated; `DEPLOYMENT-ROADMAP.md` row moved to Completed

## Post-Mortem (to fill at completion)

- What shipped vs. planned (per milestone)
- D4 outcome (GHCP headless in containers: yes / BYOK-only)
- Approval/permission incidents found in e2e and live runs
- Budget accuracy: estimates vs actuals per job type
- Follow-ups: `forge_claw_*` MCP tool family; extract shared Telegram MarkdownV2 helpers to `pforge-sdk`; Slack/Discord inbound adapters; dashboard tab for claw state

## Future (explicitly not this phase)

- `forge_claw_status` / `forge_claw_enqueue` MCP tools so Copilot in VS Code can hand work to the claw.
- Slack / Discord / Teams inbound adapters behind the same router.
- "Second opinion" multi-model answers in chat (quorum for `ask`).
- Mobile-friendly dashboard view of claw queues.
