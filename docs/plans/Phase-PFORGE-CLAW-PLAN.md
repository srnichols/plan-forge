---
lane: full
source: agent
phaseId: Phase-PFORGE-CLAW
linkedBugs: []
relatedIssues: []
---
# Phase PFORGE-CLAW — A chat-native, always-on front door for Plan Forge, powered by GHCP models

> **Status**: 📋 **DRAFT 2026-10-06** — Step-2 hardening required before execution. Required Decisions D1–D16 carry proposed resolutions; three are flagged **VERIFY** and must be confirmed during hardening.
> **Tracks**: `pforge-claw/` (new workspace package), `pforge.ps1` / `pforge.sh` (`claw` subcommand), root `package.json` (workspaces), `scripts/audit/layer-policy.json`, `docs/PFORGE-CLAW-GUIDE.md` (new), `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`.
> **Pipeline**: Specify ✅ (this doc) → Harden ⏳ → Execute → Review → Ship
> **Depends on**: [Phase-FORGE-MASTER-CLAW-AWARE-PLAN.md](./Phase-FORGE-MASTER-CLAW-AWARE-PLAN.md), the Forge-Master contract (`caller`, `responseFormat`, `untrustedContext`, `contextBlocks`, `proposeActions` → `proposedActions`, `usage`, `forge-master-insight` hub events). Run it first, or in parallel with Slices 1–5 here. Slice 6 onward requires it complete.
> **Session budget**: 29 slices across 4 milestones, executed **continuously M0 → M4 with no hold points** so the result is a complete, testable environment (single host + remote workers + K8s Job lanes) in one pass. Milestones are logical groupings and Re-anchor points, not pauses. Use `pforge run-plan --resume-from <n>` to break across sessions. Slice 27 stands up the full end-to-end test environment (offline harness + a live multi-host topology). The author's macOS host, Windows host and Linux Kubernetes cluster are the **reference validation environment**; nothing in the package is specific to them.

---

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
| OpenClaw is already a documented integration target | `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`, `orchestrator/hooks.mjs` (`postOpenClawSnapshot`) | true — Forge-Claw is positioned as the *native* alternative |
| **VERIFY**: Copilot SDK / Copilot CLI support a headless, token-based auth suitable for a container (no browser login) | Copilot SDK docs (`gitHubToken` option per Phase-60 notes) | **unverified for container use** — see D4 |
| **VERIFY**: Telegram Bot API forum topics route via `message_thread_id`; `callback_data` ≤ 64 bytes; text ≤ 4096 chars; webhook `secret_token` header `X-Telegram-Bot-Api-Secret-Token` | Telegram Bot API reference | believed true — confirm at hardening |

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
- **(j) Docs and capabilities sweep after all code is built**: guide, threat model, architecture doc, README, `docs/capabilities.md` / `.html`, `forge_capabilities` surface, CLI guide, manual chapters, glossary, event catalog, CHANGELOG, ROADMAP (Slice 29).

### Out of Scope

- Channels other than Telegram (Slack/Discord inbound) — the router is channel-agnostic, but only the Telegram adapter ships.
- Any change to MCP **tools** (`tools.json` must stay byte-identical in this phase; the `forge_master_ask` change belongs to FORGE-MASTER-CLAW-AWARE). `cli-schema.json` changes only by the additive `claw` command. A `forge_claw_*` tool family is a follow-up phase.
- Multi-tenant / third-party users on the operator's GHCP seat (see D8).
- General life-assistant capabilities (email, calendar, browser automation, shell-on-request outside a job).
- Replacing the existing outbound bridge — `bridge.mjs` keeps working unchanged; Forge-Claw is additive.
- Postgres or any new database for claw state (see D5).
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
  cli.mjs                      # start | worker | doctor | status | service
  src/
    enums.mjs                  # frozen arrays: JOB_TYPES, JOB_STATES, LANE_KINDS, VISIBILITY, EVENT_TYPES
    config.mjs                 # PFORGE_CLAW_HOME, config.json load + validate
    secrets.mjs                # env → $PFORGE_CLAW_HOME/secrets.json resolution, redaction helper
    registry.mjs               # project registry + placement rules
    state/store.mjs            # append-only JSONL + atomic snapshot
    channels/channel-adapter.mjs # ChannelAdapter interface (core depends only on this)
    channels/telegram/client.mjs        # raw fetch Bot API client
    channels/telegram/format.mjs        # MarkdownV2 escape, chunking, keyboards
    channels/telegram/poller.mjs        # getUpdates long-poll with persisted offset
    channels/telegram/webhook.mjs       # optional webhook receiver (secret_token verified)
    router.mjs                 # identity, topic→project, dispatch via commands registry
    commands.mjs               # single command registry → router, /help, Telegram setMyCommands
    handlers/help.mjs          # role- and topic-aware /help, /help <command>
    mcp/project-client.mjs     # MCP stdio client to a project's plan-forge server
    jobs/model.mjs             # Job shape + state machine
    jobs/permission-policy.mjs # per-job-type tool/path policy for onPermissionRequest
    jobs/worktree.mjs          # git worktree create/remove via args-array spawn
    lanes/lane.mjs             # Lane interface + LaneEvent shape
    lanes/local-lane.mjs
    lanes/remote-lane.mjs
    lanes/k8s-job-lane.mjs
    runtime/agent-runtime.mjs  # AgentRuntime interface
    runtime/copilot-session.mjs# default runtime: @github/copilot-sdk (injected for tests)
    runtime/byok.mjs           # BYOK runtimes (anthropic/openai/azure) via SDK provider config
    approvals.mjs              # signed single-use nonces, TTL
    budget.mjs                 # ledger + caps + hold
    progress.mjs               # LaneEvent → edit-in-place Telegram message
    scheduler.mjs              # interval/tz scheduler, no cron dep
    digest.mjs, alerts.mjs     # proactive messages
    capture.mjs, stt.mjs       # forwards, links, photos, voice
    crossproject.mjs           # #general rollups + fan-out
    protocol/messages.mjs      # versioned worker protocol schema
    protocol/ws-server.mjs     # dispatcher side
    protocol/worker-agent.mjs  # worker side (outbound)
    placement.mjs              # project → lane selection
  config.schema.json           # published JSON Schema for config.json
  examples/                    # single-host / multi-host / k8s configs (placeholders only)
  service/                     # launchd plist, systemd unit, install-service.ps1/.sh
  deploy/
    Dockerfile.dispatcher
    Dockerfile.worker-base     # node + git + bash + pwsh + gh + copilot CLI
    k8s/base/*.yaml + kustomization.yaml
    k8s/overlays/example/
  tests/
```

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
```

### Project registry entry (`config.json#projects[]`)

```json
{
  "id": "plan-forge",
  "displayName": "Plan Forge",
  "repo": { "path": "/path/to/plan-forge", "remote": "git@github.com:<owner>/<repo>.git", "baseBranch": "main" },
  "channel": { "adapter": "telegram", "chatId": "<chat-id>", "topicId": "<topic-id>" },
  "placement": { "prefer": ["k8s-jobs", "mac-1", "local"], "requires": [] },
  "models": { "chat": "<from registry>", "work": "<from registry>" },
  "budget": { "dailyPremiumRequests": 150 },
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

### Job model

`JOB_TYPES`: `ask` (read-only Q&A), `capture` (memory/crucible/bug write via MCP — non-repo), `skill` (`forge_run_skill`), `plan` (`pforge run-plan`), `task` (ad-hoc agent work in a worktree → branch/PR), `fanout` (parent of N child jobs).

`JOB_STATES`: `queued → awaiting-approval → approved → leased → running → (succeeded | failed | cancelled | expired | held-budget)`. Transitions are append-only events in `jobs.jsonl`; current state is a fold.

Mutating = `skill` (unless the skill is declared read-only), `plan`, `task`, `fanout`. Mutating jobs **must** pass through `awaiting-approval`.

### LaneEvent

`{ v: 1, jobId, seq, ts, type: "started"|"progress"|"log"|"slice"|"cost"|"artifact"|"needs-input"|"finished", data }` — `seq` is monotonic per job so a reconnecting worker can resume without duplicates.

### Chat command registry rule

Every chat command lives in `src/commands.mjs` (Slice 5). A slice that adds or changes a command handler **must** in the same slice: set the entry's `available: true`, fill `summary` / `details` / `examples` / `roles` / `scope` / `mutating`, and extend `tests/help.test.mjs` if the role or topic filtering changes. The drift guard test enforces this; a handler without a registry entry (or vice versa) fails the slice gate. Owning slices: `/ask` `/new` 6 · `/remember` `/recall` `/idea` `/bug` 7 · `/run` `/skill` `/task` `/jobs` `/abort` `/retry` 9–12 · `/budget` 11 · `/status` `/fanout` 16 · `/lane` `/lanes` 23.

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
| D4 | **VERIFY** — headless Copilot auth | Long-lived lanes on any OS (macOS / Windows / Linux): `useLoggedInUser` (operator signs in once interactively). Containers (M3): SDK `gitHubToken` from a K8s Secret, if the SDK accepts a token type that can be scoped for Copilot requests. **If verification fails, M3 K8s Job lanes run BYOK-only (D8) and GHCP stays on long-lived host lanes.** Hardening must record which outcome holds. |
| D5 | State store | Append-only JSONL + periodic atomic snapshot under `PFORGE_CLAW_HOME/state/` (a PVC in K8s). Single dispatcher writer. No database. Revisit only if job volume exceeds ~10k/day. |
| D6 | Approval mechanism | Inline keyboard `callback_query` with `callback_data = "a:<jobIdShort>:<nonceShort>"` (≤ 64 bytes). Nonce is 128-bit random, stored as SHA-256 hash, single-use, TTL 15 min, bound to the requesting chat **and** the approving `from.id` (must be on the allowlist with `approve` role). The existing URL-based `/api/bridge/approve` path is untouched. |
| D7 | Forge-Master integration | Call `forge_master_ask` through the project's MCP client (no extra HTTP process) using the FORGE-MASTER-CLAW-AWARE contract. Always send `caller` (role, `channel:"chat"`, `surface:"<adapter id>"`, project, topic) and `responseFormat:{style:"brief",maxChars:3500}`, plus `proposeActions:true`. Send forwarded or captured content **only** as `untrustedContext`, never inside `message`. Send a compact Forge-Claw state snapshot (queue, held jobs, workers, today's spend; ≤ 4 KB) as a `contextBlocks` entry. `proposedActions` render as inline buttons; tapping one creates a job that still goes through Forge-Claw role checks and approval. `untrusted`-origin proposals are labelled ⚠️ in the card. Map `(chatId, topicId)` → `sessionId` in `sessions.jsonl`; `/new` drops the mapping. Simulate streaming with `sendChatAction: typing` plus a single edit on completion. |
| D8 | Seat / runtime policy | Configurable, with a safe default: GHCP-backed jobs may be triggered only by `owner` identities (an individual Copilot seat is for its holder; operators are responsible for their own license terms, and the guide says so). Allowlist roles: `owner` (all), `approver`, `viewer` (read-only `ask`). Non-`owner` identities may only trigger jobs whose runtime is a configured **BYOK** provider; otherwise `ask`-only. Enforced in `router.mjs`; policy keys in `config.json#policy`. |
| D9 | Budget source of truth | Dispatcher-owned `budget.jsonl`. `task`/`ask` jobs record usage from Copilot SDK session events (premium-request / token counts, null-not-zero). `plan` jobs record actuals from `forge_cost_report` after completion. Pre-flight estimates for `plan` jobs come **only** from `forge_estimate_quorum` — never hand-computed. Caps: per-project daily + global daily; exceeding → `held-budget` with an "approve over-budget" button for `owner`. |
| D10 | Plan execution path | `plan` jobs run `pforge run-plan <plan> [--quorum=…]` in the job worktree (args array). Progress comes from the worktree's hub (`forge_watch_live` / events JSONL tail), not from parsing stdout. Abort → `forge_abort`. Resume → `--resume-from`. |
| D11 | Worker protocol | WebSocket (`ws`), worker dials **out** to `wss://<dispatcher>/claw/workers`. Auth: per-worker ID + shared secret → HMAC-SHA256 challenge on connect (secret never sent). Messages JSON with `v` field; job lease with ack + heartbeat (15 s) + lease expiry (60 s) → requeue. Event resume by `seq`. |
| D12 | K8s integration | Dispatcher creates Jobs through the in-cluster REST API using `fetch` + the mounted ServiceAccount token/CA. RBAC: `create/get/list/watch/delete` on `jobs` and `get/list/watch` on `pods`, `pods/log` in the claw namespace **only**. The Job pod runs `pforge claw worker --one-shot --job <id>` and streams LaneEvents back over the worker protocol. |
| D13 | Network egress for job pods | Default-deny NetworkPolicy; allow DNS, GitHub (`github.com`, `api.github.com`, Copilot API endpoints — exact hostnames confirmed at hardening), the dispatcher Service, and the OpenBrain endpoint. The allowlist of hostnames/CIDRs is **configuration** (`k8s.egress.allow[]`), with GitHub/Copilot defaults. The cluster's CNI must enforce NetworkPolicy (e.g. Calico, Cilium); `doctor` detects and warns otherwise, and the guide documents the risk of running without it. |
| D14 | STT for voice notes | Off by default (`capture.voice.enabled=false`). When on, BYOK provider (`openai` Whisper or `azure` Speech) with the key from env / secrets. Audio is deleted after transcription; transcript is shown back for confirmation before any write. |
| D15 | Ship surface / branch | Package lives in the monorepo and ships on `master` as **experimental, opt-in** (not installed or started by `setup.ps1/.sh`). This plan file stays on `planning/main` only. Package version tracks the monorepo version. |
| D16 | Scheduler | In-process scheduler with explicit IANA timezone in config, minute resolution, persisted `lastRunAt` per schedule to avoid duplicates across restarts. No cron library. |
| D17 | Generic-by-default rule | All machine, channel, runtime and cluster specifics are configuration (Portability & Configurability Contract). Enforced by the portability guard test (Slice 1), schema-validated examples (Slice 2), and a reviewer checklist item. |
| D18 | Channel abstraction | `src/channels/channel-adapter.mjs` defines the interface; `src/channels/telegram/` implements it. Core modules import only the interface. Other adapters (Slack, Discord, Teams, Matrix) are community follow-ups and need no core changes. |
| D19 | Agent runtime abstraction | `src/runtime/agent-runtime.mjs` interface; `copilot-sdk` default; BYOK runtimes via the SDK's provider config (the same mechanism Phase-60 uses), selected per lane or project in config. |
| D20 | Cross-platform CI | New `.github/workflows/pforge-claw.yml`: unit + offline e2e on `ubuntu-latest`, `windows-latest` and `macos-latest` (Node 22.12 + 24), plus a kind-based K8s e2e job on ubuntu (amd64). Path-filtered to `pforge-claw/**` and the shared CLI files. arm64 coverage comes from the reference environment and community reports. |

_Hardening must confirm D4, the D13 default hostnames, and the Telegram API limits in the Assumptions table; all other decisions are proposed-final._

## Acceptance Criteria

- **MUST**: An unknown Telegram user receives no reply of any kind; an audit line is written (Slice 5 test).
- **MUST**: `/help` (aliases `/start`, `help`, `-help`, `--help`) lists exactly the commands the caller may run in that topic, generated from the single registry in `src/commands.mjs`; the Telegram `/` menu is synced from the same registry, and a drift guard test fails if router, registry and help disagree.
- **MUST**: Every mutating job transitions through `awaiting-approval` and runs only after a valid, unexpired, single-use, identity-bound approval (Slice 10 tests: replay, expiry, wrong user, wrong chat).
- **MUST**: `approveAll` and string-built shell commands appear nowhere in `pforge-claw/` (guard tests).
- **MUST**: No secret value appears in `state/*.jsonl`, logs, or Telegram output (redaction guard test with planted canary values).
- **MUST**: Jobs never touch the operator's working tree — each runs in its own worktree/clone (Slice 9 test).
- **MUST**: `pforge-claw/` imports nothing from `pforge-mcp/` or `pforge-master/` source (guard test + `dep-boundaries` rule).
- **MUST**: `node pforge-mcp/server.mjs --check` passes; `tools.json` is byte-identical to the phase start and `cli-schema.json` differs only by the additive `claw` command.
- **MUST**: No operator-specific value (host, chat id, path, owner, registry, hostname) exists in `pforge-claw/` code, defaults or examples (portability guard test); every example config validates against `config.schema.json`.
- **MUST**: Unit + offline e2e suites pass on ubuntu, windows and macos CI runners, and the kind-based K8s e2e job passes on ubuntu (Slice 28).
- **MUST**: Every optional dependency (OpenBrain, K8s, webhook ingress, STT, GHCP) can be absent: `doctor` reports it and the related features are disabled with an explanatory message, never a crash.
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

1. **Identity**: allowlist of Telegram user IDs with roles (D8). Group/topic messages are accepted only from configured chat IDs. Bot privacy mode on.
2. **Prompt injection**: forwarded messages, links, photos, voice transcripts and file contents are *data*. They can only produce `capture` or `ask` jobs directly; anything mutating requires an approval the model cannot issue. The permission policy (Slice 9) denies writes for `ask`, restricts writes to the job worktree for `task`, and denies network tools beyond MCP for all job types.
3. **Secrets**: env → `secrets.json` resolution at call time; redaction helper wraps every log/audit/Telegram write; canary-based guard tests.
4. **Approvals**: D6 — hashed, single-use, TTL, user- and chat-bound; replay and forgery tests.
5. **Transport**: worker protocol over TLS (`wss`) with HMAC challenge; webhook mode verifies Telegram secret header; dispatcher HTTP binds `127.0.0.1` unless explicitly configured behind ingress.
6. **Blast radius**: worktree-per-job; K8s Job pods with resource limits, `activeDeadlineSeconds`, non-root, read-only root FS where possible, default-deny egress (D13); namespace-scoped RBAC (D12).
7. **Audit**: `audit.jsonl` records every inbound command (user ID, chat, topic, parsed intent — not raw message bodies of forwarded content), every approval decision, and every job mutation summary (branch, PR URL, commit SHAs).
8. **Repo mutation contract**: approvals are the dry-run/confirm step — the approval card shows the intended effect (plan + estimate, or task description + target branch) before anything runs.

## Execution Slices

### Milestone M0 — Foundation

#### Slice 1 — Package scaffold, boundaries, and `pforge claw` CLI twins [sequential]

**Depends On**: none
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/clean-code.instructions.md`, `.github/instructions/release-checklist.instructions.md`

Tasks:
1. Create `pforge-claw/package.json` (`@pforge/pforge-claw`, `type: module`, `engines.node >=22.12.0`, deps per D3, `vitest` dev dep) and add `pforge-claw` to root `package.json#workspaces`; run `npm install` so the lockfile updates.
2. Create `pforge-claw/cli.mjs` with `doctor`, `status`, `start`, `worker`, `service` subcommands (all but `doctor`/`status` print "not yet implemented" and exit 2 until their slice lands).
3. Create `pforge-claw/src/enums.mjs` with frozen `JOB_TYPES`, `JOB_STATES`, `LANE_KINDS`, `VISIBILITY`, `ROLES`, `LANE_EVENT_TYPES`.
4. Add `claw` dispatch to **both** `pforge.ps1` and `pforge.sh` → `node pforge-claw/cli.mjs <args>` (args passed as array).
5. Add `pforge-claw` to `dep-boundaries.mjs` `PACKAGE_RULES` (may not import `pforge-mcp`/`pforge-master`/`pforge-sdk` source).
6. Add `tests/boundaries.test.mjs` — Guard: "pforge-claw imports no Plan Forge package source"; Guard: "no approveAll"; Guard: "no exec( / execSync( with template strings"; Guard: "no operator-specific values" (scans `pforge-claw/` except `tests/fixtures` for real-looking Telegram chat ids, absolute user paths such as drive letters or home directories, personal GitHub owners, private IPs and hostnames that aren't documented placeholders such as `<owner>`, `<registry>`, `example.com`).
7. Register `claw` (with `init`, `doctor`, `status`, `start`, `worker`, `service`, `dev`, `commands` subcommands) in the CLI schema in `pforge-mcp/capabilities/schemas.mjs`; regenerate with `node pforge-mcp/server.mjs --validate` and commit `cli-schema.json`. `tools.json` must not change.

Files: `pforge-claw/package.json`, `pforge-claw/cli.mjs`, `pforge-claw/src/enums.mjs`, `pforge-claw/tests/boundaries.test.mjs`, `package.json`, `package-lock.json`, `pforge.ps1`, `pforge.sh`, `scripts/audit/dep-boundaries.mjs`, `pforge-mcp/capabilities/schemas.mjs`, `pforge-mcp/cli-schema.json`

**Validation Gate**:
```bash
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
1. `src/config.mjs`: resolve `PFORGE_CLAW_HOME` (default `path.join(os.homedir(), ".pforge-claw")` on every OS), load + validate `config.json` against the published `pforge-claw/config.schema.json` (projects, lanes with labels, channel adapters, runtimes, allowlist with roles, policy, schedules, caps, timezone, feature flags). Validation returns structured errors; unknown keys warn. `start` refuses to run with an empty `owner` list.
2. `src/secrets.mjs`: `getSecret(name)` env-first then `secrets.json`; `redact(text)` replaces every loaded secret value and known token shapes with `«redacted:<name>»`; warn if `secrets.json` is world-readable (POSIX) / inherits broad ACL (Windows).
3. `src/registry.mjs`: project lookup by id / `(chatId, topicId)`; path normalisation via `path.resolve` with case-insensitive compare on Windows; reject projects whose path is not a git repo.
4. `doctor`: checks Node version, config validity, each project path, presence (not value) of required secrets, `git`/`pforge`/`copilot` availability, and that each project has a resolvable plan-forge MCP launch command (from its `.vscode/mcp.json`).
5. `pforge claw init`: interactive by default, plus non-interactive `--example single-host|multi-host|k8s --out <dir>`. It writes `config.json` from `pforge-claw/examples/*.json` (placeholders only), lists the secret names to set without ever asking for their values in argv, and runs `doctor`.
6. Tests: valid/invalid config against the schema, every example validates, env-over-file precedence, redaction with canary secrets, Windows/POSIX path compare, doctor JSON output, `init --example` round-trip, refusal with no owner.

Files: `pforge-claw/src/config.mjs`, `pforge-claw/src/secrets.mjs`, `pforge-claw/src/registry.mjs`, `pforge-claw/src/init.mjs`, `pforge-claw/config.schema.json`, `pforge-claw/examples/single-host.json`, `pforge-claw/examples/multi-host.json`, `pforge-claw/examples/k8s.json`, `pforge-claw/cli.mjs`, `pforge-claw/tests/config.test.mjs`, `pforge-claw/tests/secrets.test.mjs`, `pforge-claw/tests/registry.test.mjs`, `pforge-claw/tests/init.test.mjs`

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
1. `src/state/store.mjs`: `append(stream, record)` (adds `ts`, runs `redact`), `fold(stream, reducer)`, `snapshot(stream)` with write-to-temp + rename; single-writer lock file with stale-lock detection.
2. `src/jobs/model.mjs`: job shape, legal transitions table, `transition(job, to, meta)` that throws on illegal moves; `currentJobs()` fold.
3. Tests: crash-safety (partial last line tolerated), illegal transitions rejected, snapshot+tail equals full fold, redaction applied on append.

Files: `pforge-claw/src/state/store.mjs`, `pforge-claw/src/jobs/model.mjs`, `pforge-claw/tests/store.test.mjs`, `pforge-claw/tests/job-model.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/store.test.mjs tests/job-model.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M1 — Chat MVP on a single host (any macOS / Windows / Linux machine)

> No execution hold: M1 flows straight into M2. Every slice from Slice 4 on tests against the shared fake Telegram Bot API helper so the end-to-end harness grows with the build.

#### Slice 4 — Telegram client, formatter, long-poll receiver [sequential]

**Depends On**: Slice 3
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/channels/channel-adapter.mjs`: the `ChannelAdapter` interface per D18 (`start(onUpdate)`, `send`, `edit`, `answerCallback`, `setMenu`, `download`, `typing`, `limits`), with a contract test any adapter must pass. Telegram modules below live under `src/channels/telegram/` and implement it.
2. `src/channels/telegram/client.mjs`: `getUpdates`, `sendMessage`, `editMessageText`, `answerCallbackQuery`, `sendChatAction`, `getFile`/download; `fetch` injected for tests; token from `getSecret`; 429 handling honouring `retry_after`; never include the token in thrown errors.
3. `src/channels/telegram/format.mjs`: MarkdownV2 escape, 4096-char chunking on paragraph boundaries, inline keyboard builder enforcing the 64-byte `callback_data` limit. (Behaviour mirrors `bridge.mjs` helpers; duplication is accepted under D1 and recorded for a follow-up extraction to `pforge-sdk`.)
4. `src/channels/telegram/poller.mjs`: long-poll loop with persisted offset (`state/offsets.json`), exponential backoff, graceful stop on SIGINT/SIGTERM.
5. Tests: escaping table, chunking, callback_data limit, offset persistence across restart, 429 backoff with fake timers, token-never-in-error guard.
6. Configurable `telegram.apiBase` (default `https://api.telegram.org`) and `tests/helpers/fake-telegram.mjs`: an in-process HTTP server implementing `getUpdates` (scripted inbound queue, incl. `callback_query` and forum `message_thread_id`), `sendMessage`, `editMessageText`, `answerCallbackQuery`, `sendChatAction`, `getFile`, `setWebhook`/`deleteWebhook`, recording every outbound call. Every later slice and the Slice 27 e2e suite reuse it.

Files: `pforge-claw/src/channels/channel-adapter.mjs`, `pforge-claw/tests/channel-adapter-contract.test.mjs`, `pforge-claw/src/channels/telegram/client.mjs`, `pforge-claw/src/channels/telegram/format.mjs`, `pforge-claw/src/channels/telegram/poller.mjs`, `pforge-claw/tests/helpers/fake-telegram.mjs`, `pforge-claw/tests/telegram-*.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/telegram-client.test.mjs tests/telegram-format.test.mjs tests/telegram-poller.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 5 — Identity, routing, and command parsing [sequential]

**Depends On**: Slice 4
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`

Tasks:
1. `src/router.mjs`: drop (no reply) any update whose `from.id` is not allowlisted or whose chat is not configured — write an audit line only. Resolve project from `(chat.id, message_thread_id)`; the configured "general" topic routes to the dispatcher.
2. `src/commands.mjs` — the **single command registry** (source of truth for router, `/help`, and the Telegram menu). Each entry: `{ name, aliases, args, summary, details, examples[], roles[], scope: "project"|"general"|"both", mutating, sinceSlice }`. Initial set: `/help`, `/start` (alias of `/help`), `/ask`, `/run <plan> [quorum]`, `/skill <name>`, `/task <description>`, `/status`, `/jobs`, `/budget`, `/remember`, `/recall`, `/idea`, `/bug`, `/abort <job>`, `/retry <job>`, `/lane <id> on|off` (pause/resume an opt-in lane such as a workstation), `/lanes`, `/fanout`, `/new` (start a fresh Forge-Master session for this topic). Commands whose handler lands in a later slice are registered now with `available: false` and are hidden from `/help` until that slice flips them on. Free text in a project topic = `ask`. `node pforge-claw/cli.mjs commands [--markdown|--json]` prints the registry (used by docs in Slice 29).
3. Router dispatches **only** through the registry. An unregistered `/command` from an allowlisted user gets "Unknown command `/x` — try /help" (with a closest-match suggestion); unknown users still get nothing.
4. `/help` (and `/start`, and `-help` / `--help` / `help` typed as plain text): context-aware output — shows only the commands the caller's role may run **and** that apply where they typed it (project topic → project commands with that project's name in the header; `#general` → dispatcher and cross-project commands). Mutating commands are marked 🔒 "needs approval". Grouped as *Ask & memory*, *Work*, *Status & budget*, *Admin*. Fits one message; chunked if it ever exceeds 4096 chars.
5. `/help <command>`: details, argument syntax, 2–3 examples, required role, whether it needs approval, and where it can be used.
6. Telegram `/` autocomplete menu: on `start`, call `setMyCommands` per configured chat (and per-member scope for non-owner roles) from the same registry so the in-app menu always matches `/help`. Re-sync when the config changes.
7. Role enforcement per D8 (`viewer` → `ask`/`help`/`status` only; non-owner mutating → BYOK-only or refused with a message to an *allowlisted* user).
8. Tests: unknown user silent drop (including `/help`), unknown chat silent drop, topic routing, role matrix, command parsing table, help filtered by role and by topic, `/help <cmd>` details, unknown-command suggestion, `setMyCommands` payload built from the registry, and a drift guard: every command the router handles is in the registry and every `available` registry entry has a handler.

Files: `pforge-claw/src/router.mjs`, `pforge-claw/src/commands.mjs`, `pforge-claw/src/handlers/help.mjs`, `pforge-claw/cli.mjs`, `pforge-claw/tests/router.test.mjs`, `pforge-claw/tests/help.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/router.test.mjs tests/help.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/router.test.mjs","utf8");if(!s.includes("silent"))throw new Error("silent-drop test missing")'
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/help.test.mjs","utf8");for(const n of ["role","topic","setMyCommands","drift"])if(!s.includes(n))throw new Error("help test missing: "+n)'
```

#### Slice 6 — Project MCP client + read-only Q&A via Forge-Master [sequential]

**Depends On**: Slice 5
**Context Files**: `.github/instructions/aci-design.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/mcp/project-client.mjs`: start/stop a stdio MCP client for a project using its `.vscode/mcp.json` plan-forge launch entry (args array, `cwd` = project path); idle shutdown after N minutes; one client per project.
2. `ask` handler per D7: `sendChatAction typing` → `forge_master_ask({ message, sessionId, caller, responseFormat, proposeActions: true, contextBlocks: [clawSnapshot] })` → reply (chunked). `proposedActions` render as inline buttons; tapping one creates a job through the normal role check and approval path (never executed directly). Use `proposedActionsMessage` when there are none. Record `usage` in the budget ledger. Persist `(chatId, topicId) → sessionId` in `sessions.jsonl`; `/new` clears it. Empty or error results produce an explicit, friendly message (no silent failure).
3. `cli.mjs start` now runs poller + router + ask handler (M1 single-host mode).
4. Tests with an injected fake MCP client: happy path, session reuse, tool error surfaced, client idle shutdown.

Files: `pforge-claw/src/mcp/project-client.mjs`, `pforge-claw/src/handlers/ask.mjs`, `pforge-claw/cli.mjs`, `pforge-claw/tests/ask.test.mjs`, `pforge-claw/tests/project-client.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/ask.test.mjs tests/project-client.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 7 — Memory and idea capture commands [sequential]

**Depends On**: Slice 6
**Context Files**: `.github/instructions/aci-design.instructions.md`, `.github/instructions/security.instructions.md`

Tasks:
1. `/remember <text>` → project memory capture tool; `/recall <query>` → `forge_search` (project scope) with sources + dates; `/idea <text>` → `forge_crucible_submit`; `/bug <text>` → `forge_bug_register`. All are `capture`/`ask` jobs — no repo mutation, no approval needed.
2. Results echo what was written (id/link) so the operator can verify.
3. Tests per command with fake MCP client, including empty-recall message and tool-error paths.

Files: `pforge-claw/src/handlers/capture-commands.mjs`, `pforge-claw/tests/capture-commands.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/capture-commands.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 8 — Lane interface, LocalLane, Copilot session runtime, queues [sequential]

**Depends On**: Slice 7
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/lanes/lane.mjs`: `Lane` contract `{ kind, id, capabilities, submit(job) → AsyncIterable<LaneEvent>, cancel(jobId), health() }`.
2. `src/runtime/agent-runtime.mjs` interface per D19 plus `src/runtime/byok.mjs` (BYOK provider config; key from env/secrets; key-missing → structured `BYOK_KEY_MISSING`, never the key in errors). Runtime chosen per lane or project from config.
3. `src/runtime/copilot-session.mjs`: default runtime, a wrapper over `@github/copilot-sdk` (`createSession` injected; lazy import), attaches the project's plan-forge MCP server to the session, maps typed session events to `LaneEvent` + usage (null-not-zero), passes `onPermissionRequest` from the policy (Slice 9 provides the real policy; this slice uses deny-all default).
4. `src/lanes/local-lane.mjs`: runs jobs on the dispatcher host; per-project FIFO queue (concurrency 1) + global heavy-job semaphore (`lanes.local.maxHeavy`, default 2).
5. Tests with fake SDK: event mapping, null-not-zero usage, per-project serialisation, global semaphore, cancel.

Files: `pforge-claw/src/lanes/lane.mjs`, `pforge-claw/src/lanes/local-lane.mjs`, `pforge-claw/src/runtime/agent-runtime.mjs`, `pforge-claw/src/runtime/byok.mjs`, `pforge-claw/tests/byok-runtime.test.mjs`, `pforge-claw/src/runtime/copilot-session.mjs`, `pforge-claw/tests/local-lane.test.mjs`, `pforge-claw/tests/copilot-session.test.mjs`

**Validation Gate**:
```bash
node -e 'const s=require("fs").readFileSync("pforge-claw/src/runtime/copilot-session.mjs","utf8");for(const n of ["approveAll","forInProcess"])if(s.includes(n))throw new Error("forbidden token: "+n)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/local-lane.test.mjs tests/copilot-session.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 9 — Job types, worktrees, and the permission policy [sequential]

**Depends On**: Slice 8
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/jobs/worktree.mjs`: `git worktree add` on a new branch `claw/<jobId>` from `baseBranch` under `PFORGE_CLAW_HOME/worktrees/<project>/<jobId>`; remove on completion (keep on failure for N hours, janitor sweep). Args-array spawn only. Refuse if target path resolves inside the operator's working tree.
2. `src/jobs/permission-policy.mjs`: per `JOB_TYPE` policy — `ask`: deny all writes/shell; `skill`/`task`: writes allowed only under the job worktree, shell allowed only for an allowlist (`git`, `node`, `npm`, `npx`, `pforge`, project test commands from registry), deny network tools except MCP; `plan`: delegated to `pforge run-plan` (D10).
3. Job runners: `task` (Copilot session in worktree → commit → push branch → open PR via `gh` args array), `skill` (`forge_run_skill` via MCP in worktree), `plan` (`pforge run-plan` args array in worktree; progress via `forge_watch_live`; abort via `forge_abort`).
4. Tests: worktree path containment, operator-tree refusal, policy matrix (allowed/denied cases incl. `../` escape and symlink), runner wiring with fakes.

Files: `pforge-claw/src/jobs/worktree.mjs`, `pforge-claw/src/jobs/permission-policy.mjs`, `pforge-claw/src/jobs/runners.mjs`, `pforge-claw/tests/worktree.test.mjs`, `pforge-claw/tests/permission-policy.test.mjs`, `pforge-claw/tests/runners.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/worktree.test.mjs tests/permission-policy.test.mjs tests/runners.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 10 — Approvals via `callback_query` [sequential]

**Depends On**: Slice 9
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`

Tasks:
1. `src/approvals.mjs` per D6: issue (random nonce, store hash + jobId + chatId + requester + expiry), verify (hash match, unexpired, unused, approver role, same chat), consume (mark used), expire sweep.
2. Approval card: for `plan` jobs include `forge_estimate_quorum` output (mode, projected cost, slice count); for `task`/`skill` include description, target branch, and lane. Buttons: ✅ Approve / ❌ Reject (+ quorum-mode choices for `plan`).
3. Router handles `callback_query` → `answerCallbackQuery` always (to clear the spinner) → transition job.
4. Tests: happy path, replay rejected, expired rejected, wrong user, wrong chat, viewer cannot approve, tampered callback_data, estimate sourced from the tool (fake) not computed.

Files: `pforge-claw/src/approvals.mjs`, `pforge-claw/src/router.mjs`, `pforge-claw/tests/approvals.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/approvals.test.mjs tests/router.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/approvals.test.mjs","utf8");for(const n of ["replay","expired","wrong user","wrong chat"])if(!s.includes(n))throw new Error("approval test missing: "+n)'
```

#### Slice 11 — Budget governor [sequential]

**Depends On**: Slice 10
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/budget.mjs` per D9: ledger append from session usage, Forge-Master turn `usage` (every `ask`), and post-run `forge_cost_report`; per-project + global daily caps (timezone from config); `check(job)` before lease → `held-budget` with owner-only "approve over budget" button; `/budget` command renders today's spend per project vs caps.
2. Tests: cap boundaries, timezone rollover with fake timers, held job released by owner override, null usage not counted as zero.

Files: `pforge-claw/src/budget.mjs`, `pforge-claw/tests/budget.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/budget.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 12 — Progress, results, and failure recovery UX [sequential]

**Depends On**: Slice 11
**Context Files**: `.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/progress.mjs`: one Telegram message per job, edited in place (rate-limited ≤ 1 edit / 3 s): state, lane, slice n/m, elapsed, spend. Templates follow `status-reporting.instructions.md` (Progress Update, Slice Complete, Failure / Recovery, Run Summary).
2. On finish: summary + PR link / artifact list. On failure: reason + buttons 🔁 Retry · ⏭ Resume-from-next · 🛑 Abort · 🤔 Why? (each mutating → re-enters approval). 🤔 Why? asks Forge-Master with the failure summary as a `contextBlocks` entry and `proposeActions:true`, and its suggested fixes come back as further buttons.
3. Tests: edit throttling with fake timers, template rendering, failure buttons create new approval-gated jobs.

Files: `pforge-claw/src/progress.mjs`, `pforge-claw/tests/progress.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/progress.test.mjs', {stdio:'inherit',shell:true});"
```

> **Parallel group P1** — Slices 13, 14, 15 touch disjoint files and may run `[parallel-safe]` after Slice 12. **Parallel Merge Checkpoint** after the group: full `pforge-claw` suite + boundaries guard.

#### Slice 13 — Scheduler and morning digest [parallel-safe, group P1]

**Depends On**: Slice 12
**Context Files**: `.github/instructions/status-reporting.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/scheduler.mjs` per D16 (tz-aware, persisted `lastRunAt`, no duplicate on restart, catch-up policy = skip missed runs older than 1 h).
2. `src/digest.mjs`: per-project `forge_plan_status`, overnight job outcomes from `jobs.jsonl`, spend from `budget.jsonl`, open bugs, drift summary, plus a "Look at first" section from `forge_master_audit` (top risks + P0 actions as buttons) → one `#general` message with per-project lines.
3. Scheduled skills: config `schedules[] = { project, skill, cron-like spec, requiresApproval }` — scheduled mutating skills still create approval cards unless the owner set `preApproved: true` for that schedule (recorded in audit).
4. Tests: tz rollover, restart no-duplicate, digest rendering with fakes.

Files: `pforge-claw/src/scheduler.mjs`, `pforge-claw/src/digest.mjs`, `pforge-claw/tests/scheduler.test.mjs`, `pforge-claw/tests/digest.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/scheduler.test.mjs tests/digest.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 14 — Alerts relay and stale-work nudges [parallel-safe, group P1]

**Depends On**: Slice 12
**Context Files**: `.github/instructions/status-reporting.instructions.md`

Tasks:
1. `src/alerts.mjs`: subscribe to each project's hub (via `forge_watch_live` polling with cursor) for `forge-master-insight` events (preferred: severity, evidence and suggested action already structured, deduplicated by insight `id`) and raw LiveGuard / secret-scan / drift / run-failed events as a fallback when the observer isn't running → topic message with action buttons (📝 File bug · 🛠 Draft fix → approval-gated `task`; or the insight's `suggestedAction`). `doctor` checks the observer is running for each registered project and advises `forge_master_observe start`.
2. Nudges: phases hardened but not run for > N days, held-budget jobs older than 24 h, failed worktrees awaiting cleanup.
3. De-duplicate alerts by `(project, eventType, fingerprint)` within a window.
4. Tests: dedupe window, button → job creation, cursor persistence.

Files: `pforge-claw/src/alerts.mjs`, `pforge-claw/tests/alerts.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/alerts.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 15 — Capture: forwards, links, photos, voice [parallel-safe, group P1]

**Depends On**: Slice 12
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/capture.mjs`: forwarded message / link / photo in a project topic → triage keyboard (🐞 Bug · 💡 Idea · 🧠 Remember · ❓ Ask about it). Content is treated as data (Security Posture §2) and reaches Forge-Master **only** via `untrustedContext`. It never becomes a mutating job without approval.
2. `src/stt.mjs` per D14: off by default; BYOK provider adapters (`openai`, `azure`) with injected `fetch`; transcript echoed for confirmation before triage; audio file deleted after.
3. Tests: triage mapping, injection attempt in forwarded text cannot create a mutating job, STT disabled path, key-missing path returns structured error without the key.

Files: `pforge-claw/src/capture.mjs`, `pforge-claw/src/stt.mjs`, `pforge-claw/tests/capture.test.mjs`, `pforge-claw/tests/stt.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/capture.test.mjs tests/stt.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/tests/capture.test.mjs","utf8");if(!s.includes("injection"))throw new Error("prompt-injection test missing")'
```

#### Slice 16 — Cross-project `#general`: rollups, fan-out, scoped memory [sequential]

**Depends On**: Slice 13, Slice 14, Slice 15 (Parallel Merge Checkpoint P1)
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/crossproject.mjs`: `/status` rollup (per-project state, active job, today's spend vs caps); `/fanout <task> [projects…]` → parent `fanout` job with one child `task` per project, single approval card listing all targets, combined final report; `/recall --all <q>` searches every project scope **except** `visibility: restricted`.
2. Restricted projects: their content never appears in `#general` output or other topics.
3. Tests: rollup rendering, fan-out approval covers all children, one child failure doesn't cancel siblings, restricted exclusion.

Files: `pforge-claw/src/crossproject.mjs`, `pforge-claw/tests/crossproject.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/crossproject.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 17 — Service packaging (macOS / Linux / Windows) and single-host smoke [sequential]

**Depends On**: Slice 16
**Context Files**: `.github/instructions/release-checklist.instructions.md`, `.github/instructions/security.instructions.md`

Tasks:
1. `service/com.pforge.claw.plist` (launchd), `service/pforge-claw.service` (systemd user unit), `service/install-service.ps1` (Windows Task Scheduler, at-logon, restart-on-failure) **and** `service/install-service.sh` (macOS/Linux) — both support `install | uninstall | status`.
2. `pforge claw service install|uninstall|status` wired in `cli.mjs` and both `pforge` shells.
3. Health: `status` reports poller lag, queue depth per project, last digest, lane health.
4. Single-host smoke: `tests/single-host-smoke.test.mjs` boots `start` against the fake Telegram helper with three fixture repos and drives the success-metric-1 loop (ask → approve → progress → PR link via a scripted Copilot session). Live dogfood moves to Slice 27.

Files: `pforge-claw/service/*`, `pforge-claw/cli.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-claw/tests/service.test.mjs`, `pforge-claw/tests/single-host-smoke.test.mjs`, `pforge-claw/tests/helpers/fixture-repos.mjs`, `pforge-claw/tests/helpers/scripted-copilot.mjs`

**Validation Gate**:
```bash
node -e 'const fs=require("fs");for(const f of ["pforge-claw/service/install-service.ps1","pforge-claw/service/install-service.sh"])if(!fs.existsSync(f))throw new Error("missing twin: "+f)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
node pforge-mcp/server.mjs --check
```

### Milestone M2 — Distributed: dispatcher in K8s, remote workers

#### Slice 18 — Worker protocol, RemoteLane, `pforge claw worker` [sequential]

**Depends On**: Slice 17
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/protocol/messages.mjs`: versioned schemas (`hello`, `challenge`, `auth`, `ready`, `lease`, `ack`, `event`, `cancel`, `heartbeat`, `bye`) with validation.
2. `src/protocol/ws-server.mjs` (dispatcher): `/claw/workers` endpoint, HMAC challenge per D11, worker presence registry, lease/ack/expiry/requeue, event resume by `seq`.
3. `src/protocol/worker-agent.mjs` + `cli.mjs worker`: dials out, authenticates, advertises capabilities (`os`, toolchains, projects it can serve, `macos: true`), runs leased jobs through a local `LocalLane`, reconnects with jittered backoff.
4. `src/lanes/remote-lane.mjs`: `Lane` implementation over the server registry.
5. Tests: secret never on the wire, bad HMAC rejected, lease expiry requeues, duplicate events suppressed on resume, version mismatch handled.

Files: `pforge-claw/src/protocol/*`, `pforge-claw/src/lanes/remote-lane.mjs`, `pforge-claw/cli.mjs`, `pforge-claw/tests/protocol.test.mjs`, `pforge-claw/tests/remote-lane.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/protocol.test.mjs tests/remote-lane.test.mjs', {stdio:'inherit',shell:true});"
```

> **Parallel group P2** — Slices 19 and 20 touch disjoint files. **Parallel Merge Checkpoint** after the group: `kubectl kustomize` render + full suite.

#### Slice 19 — Dispatcher container + webhook mode [parallel-safe, group P2]

**Depends On**: Slice 18
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `deploy/Dockerfile.dispatcher`: multi-stage, Node 22/24 slim, non-root UID, `PFORGE_CLAW_HOME=/data`, `HEALTHCHECK` → `/healthz`.
2. `src/channels/telegram/webhook.mjs`: optional receiver; rejects requests without the matching `X-Telegram-Bot-Api-Secret-Token`; `setWebhook`/`deleteWebhook` managed by `cli.mjs`; switching modes is idempotent.
3. `/healthz` (liveness) and `/readyz` (state store writable, Telegram reachable) on the dispatcher HTTP server (binds `127.0.0.1` unless `http.bind` configured).
4. Tests: missing/wrong secret header → 401 with no processing, mode switch, health endpoints.

Files: `pforge-claw/deploy/Dockerfile.dispatcher`, `pforge-claw/src/channels/telegram/webhook.mjs`, `pforge-claw/src/http.mjs`, `pforge-claw/tests/webhook.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/webhook.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const s=require("fs").readFileSync("pforge-claw/deploy/Dockerfile.dispatcher","utf8");if(!/\nUSER\s+(?!root)/.test(s))throw new Error("dispatcher image must run as non-root")'
```

#### Slice 20 — Kustomize manifests for the dispatcher [parallel-safe, group P2]

**Depends On**: Slice 18
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `deploy/k8s/base/`: Namespace, Deployment (1 replica, `Recreate` strategy — single writer per D5), PVC for `/data`, Service, ServiceAccount, Role + RoleBinding per D12, Secret **references** only (no values; document sealed-secrets / external-secrets), NetworkPolicy for the dispatcher, optional Ingress for webhook + worker WS.
2. `deploy/k8s/overlays/example/` example overlay.
3. Tests: YAML parse + invariants (no `ClusterRole`, Role verbs ⊆ D12, no Secret `data`/`stringData` committed, `runAsNonRoot: true`, `Recreate` strategy).

Files: `pforge-claw/deploy/k8s/**`, `pforge-claw/tests/k8s-manifests.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/k8s-manifests.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M3 — Ephemeral Kubernetes Job lanes

#### Slice 21 — Worker base images [sequential]

**Depends On**: Slice 19, Slice 20 (Parallel Merge Checkpoint P2)
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `deploy/Dockerfile.worker-base`: Node 22/24, `git`, `bash`, `pwsh` (dual-shell parity checks must run), `gh`, Copilot CLI, non-root; entrypoint `pforge claw worker --one-shot`.
2. Stack variants as build args or thin derived Dockerfiles (`node`, `dotnet`, `python`); the registry `image` field selects per project. Images build **multi-arch** (amd64 + arm64) via `docker buildx`, with registry/namespace/tag as build parameters. `pforge-claw/scripts/build-images.ps1` **and** `build-images.sh` twins; nothing pushes to a hardcoded registry.
3. Record D4 outcome: if container Copilot auth is unsupported, worker image defaults to BYOK provider config and `doctor` reports "K8s lanes: BYOK-only".
4. Tests: Dockerfile invariants (non-root, no secrets in `ENV`/`ARG` defaults, both shells installed).

Files: `pforge-claw/deploy/Dockerfile.worker-base`, `pforge-claw/deploy/worker-variants/*`, `pforge-claw/scripts/build-images.ps1`, `pforge-claw/scripts/build-images.sh`, `pforge-claw/tests/worker-image.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/worker-image.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 22 — K8sJobLane [sequential]

**Depends On**: Slice 21
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `src/lanes/k8s-job-lane.mjs`: build Job spec (project image, `activeDeadlineSeconds`, CPU/memory requests+limits, `ttlSecondsAfterFinished`, `backoffLimit: 0`, non-root, emptyDir workspace or PVC repo cache, per-job Secret projection), create via in-cluster REST (`fetch` + SA token + CA), watch status, cancel = delete with propagation.
2. Pod runs `pforge claw worker --one-shot --job <id>` which connects back over the worker protocol for events (no log scraping).
3. Shallow clone of `repo.remote` at `baseBranch` into the workspace; push branch / open PR as in Slice 9.
4. Tests with fake K8s API: spec invariants, create/watch/cancel, deadline exceeded → `failed` with reason, API 403 → structured error.

Files: `pforge-claw/src/lanes/k8s-job-lane.mjs`, `pforge-claw/src/k8s/api.mjs`, `pforge-claw/tests/k8s-job-lane.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/k8s-job-lane.test.mjs', {stdio:'inherit',shell:true});"
```

#### Slice 23 — Egress NetworkPolicy and placement routing [sequential]

**Depends On**: Slice 22
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/architecture-principles.instructions.md`

Tasks:
1. `deploy/k8s/base/networkpolicy-jobs.yaml`: default-deny egress for job pods; allow DNS, dispatcher Service, GitHub/Copilot hostnames (D13, via CIDR/FQDN policy per CNI — document Calico vs Cilium), OpenBrain endpoint.
2. `src/placement.mjs`: choose lane per job from registry `placement.prefer` + `requires` matched against each lane's configured `labels` (e.g. a project requiring `macos` → any enabled lane labelled `macos`), `restricted` projects → their dedicated lanes only, `optIn` lanes only while switched on via `/lane <id> on`; fallback order with explanation in the approval card ("will run on: k8s-jobs (mac-1 offline)"). `/lanes` lists lanes with labels, status and queue depth.
3. Tests: placement table incl. offline fallbacks, restricted pinning, `/lane` opt-in toggle, label matching; manifest invariants for the egress policy.

Files: `pforge-claw/deploy/k8s/base/networkpolicy-jobs.yaml`, `pforge-claw/src/placement.mjs`, `pforge-claw/tests/placement.test.mjs`, `pforge-claw/tests/k8s-manifests.test.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/placement.test.mjs tests/k8s-manifests.test.mjs', {stdio:'inherit',shell:true});"
```

### Milestone M4 — Hardening, docs, ship

#### Slice 26 — Security hardening pass [sequential]

**Depends On**: Slice 23
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`

Tasks:
1. `docs/PFORGE-CLAW-THREAT-MODEL.md`: assets, trust boundaries (Telegram ↔ dispatcher ↔ workers ↔ repos ↔ GHCP), STRIDE table, mitigations mapped to slices.
2. End-to-end guard suite: planted canary secrets across config/env → assert absent from every state file, log, and outbound message; injection corpus (forwarded text instructing "run plan X", "approve", "push to master") → no mutating job created; per-user rate limit (messages/min) with silent throttle for abusive bursts.
3. Run `forge_secret_scan` over `pforge-claw/` and record the result.

Files: `docs/PFORGE-CLAW-THREAT-MODEL.md`, `pforge-claw/tests/security-e2e.test.mjs`, `pforge-claw/src/router.mjs`

**Validation Gate**:
```bash
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run tests/security-e2e.test.mjs', {stdio:'inherit',shell:true});"
node -e 'const fs=require("fs");if(!fs.existsSync("docs/PFORGE-CLAW-THREAT-MODEL.md"))throw new Error("threat model missing")'
```

#### Slice 27 — Full test environment and end-to-end validation [sequential]

**Depends On**: Slice 26
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/status-reporting.instructions.md`

Tasks:
1. Offline e2e suite `pforge-claw/tests/e2e/*.test.mjs` + `test:e2e` script, built on `fake-telegram.mjs`, `fixture-repos.mjs` (three throwaway git repos with a minimal plan-forge setup and a tiny plan, created in a temp dir per run) and `scripted-copilot.mjs` (deterministic Copilot session events). Runs fully offline, no GHCP spend.
2. `pforge claw dev up|down|status` in `cli.mjs` (and both `pforge` shells): boots a local multi-process topology — dispatcher + LocalLane + two RemoteLane workers (fixture lane ids `worker-a` labelled `macos` and `worker-b` labelled `windows`, both opt-in) with separate `PFORGE_CLAW_HOME`s on localhost — pointed at either the fake Telegram server (`--fake`) or the real bot (`--live`).
3. Scenarios (each a named test): (a) away-from-desk loop — ask → `/run` → estimate card → approve → slice progress edits → PR link (success metric 1); (b) three projects concurrent, one held by budget cap then owner-released (metric 3); (c) safety — unknown user silent, approval replay/expiry/wrong-user, forwarded-text injection, canary secrets absent everywhere (metric 4); (d) simulated 7-day digest + alerts with fake clock and two injected dispatcher restarts — no miss/duplicate (metric 2); (e) worker disconnect mid-job → lease expiry → requeue → resume by `seq` with no duplicate Telegram edits; (f) placement — `macos`-labelled job pinned to `worker-a`, `restricted` project never on a shared lane, `/lane worker-b off` respected; (g) help — `/help` in a project topic vs `#general` vs as a `viewer` shows the right command sets, every listed command is runnable by that caller, and the `setMyCommands` menu captured by the fake server matches `/help`.
4. K8s dev overlay `deploy/k8s/overlays/dev/` (k3d/kind) plus `scripts/e2e-k8s.ps1` **and** `scripts/e2e-k8s.sh` twins: build dispatcher + worker images, load into the local cluster, apply, run scenario (a) through a `K8sJobLane`, assert Job cleanup and NetworkPolicy denial of a non-allowlisted egress host, then tear down. Skipped (not failed) when no cluster is reachable; `doctor` explains why.
5. Generic live-environment runbook (`docs/PFORGE-CLAW-GUIDE.md` §Live test environment, drafted here and finalised in Slice 29), written for any topology. Then execute it on the **reference validation environment**: dispatcher on the Linux K8s cluster, macOS worker, Windows worker (opt-in), K8s Job lane, three real projects registered; run scenarios (a) and (b) with real Telegram + GHCP; capture evidence (message screenshots, job ids, PR links, `budget.jsonl` excerpt) in the slice artifact. Record the D4 outcome observed live.

Files: `pforge-claw/tests/e2e/*`, `pforge-claw/tests/helpers/*`, `pforge-claw/package.json`, `pforge-claw/cli.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-claw/deploy/k8s/overlays/dev/*`, `pforge-claw/scripts/e2e-k8s.ps1`, `pforge-claw/scripts/e2e-k8s.sh`

**Validation Gate**:
```bash
node -e 'const p=require("./pforge-claw/package.json");if(!p.scripts||!p.scripts["test:e2e"])throw new Error("test:e2e script missing")'
node -e 'const fs=require("fs");for(const f of ["pforge-claw/scripts/e2e-k8s.ps1","pforge-claw/scripts/e2e-k8s.sh","pforge-claw/deploy/k8s/overlays/dev/kustomization.yaml"])if(!fs.existsSync(f))throw new Error("missing: "+f)'
node -e 'const fs=require("fs");const d="pforge-claw/tests/e2e";const all=fs.readdirSync(d).map(f=>fs.readFileSync(d+"/"+f,"utf8")).join("\n");for(const n of ["away-from-desk","concurrent","safety","7-day","requeue","placement","help"])if(!all.includes(n))throw new Error("e2e scenario missing: "+n)'
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npm run test:e2e', {stdio:'inherit',shell:true});"
```

#### Slice 28 — Cross-platform CI and Tested Platforms matrix [sequential]

**Depends On**: Slice 27
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/release-checklist.instructions.md`

Tasks:
1. Add `.github/workflows/pforge-claw.yml` per D20: matrix `os: [ubuntu-latest, windows-latest, macos-latest]` × `node: [22.12, 24]` running `pforge-claw` unit tests, `test:e2e` (offline), the boundaries/portability guards, and `pforge claw doctor --json` against `examples/single-host.json`. A separate ubuntu job creates a kind cluster and runs `pforge-claw/scripts/e2e-k8s.sh`. Path filters: `pforge-claw/**`, `pforge.ps1`, `pforge.sh`, the workflow itself.
2. Both shells exercised: the windows job runs `pforge.ps1 claw doctor`; ubuntu and macos run `pforge.sh claw doctor`.
3. `docs/PFORGE-CLAW-GUIDE.md` §Tested Platforms: matrix (OS, arch, Node, K8s distro/version, CNI, runtime, channel, result, date, reporter) seeded from CI plus the Slice 27 reference-environment runs (macOS host, Windows host, Linux K8s cluster), with instructions for community submissions (issue template field list).
4. Fix any platform-specific defect the matrix exposes in the slice that owns the code (path, line-ending, spawn or service bugs); record each in the slice notes for the post-mortem.

Files: `.github/workflows/pforge-claw.yml`, `docs/PFORGE-CLAW-GUIDE.md`

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
1. `docs/PFORGE-CLAW-GUIDE.md` (generic, for any operator): what Forge-Claw is, architecture, a quick start per OS (macOS / Windows / Linux), `pforge claw init` + config reference generated from `config.schema.json`, lanes and labels, channel adapter setup (Telegram: BotFather, privacy mode, forum topics), agent runtimes (GHCP default, BYOK), seat/runtime policy (D8), service install per OS, remote workers, Kubernetes deploy from `overlays/example`, budget/approval model, security model summary linking the threat model, live test environment runbook, Tested Platforms, troubleshooting, and the **Chat command reference** generated from `src/commands.mjs` (`node pforge-claw/cli.mjs commands --markdown`).
2. Capabilities surface: add a Forge-Claw entry (companion package, CLI subcommands, chat command list, config file, related hub events) in `pforge-mcp/capabilities/surface.mjs` so `forge_capabilities` reports it; update the Forge-Master description to mention `proposedActions` and observer insights. Regenerate the MCP Tools table with `node scripts/generate-capabilities-doc.mjs`, and hand-update the narrative sections of `docs/capabilities.md` and `docs/capabilities.html`, which the generator does not touch, to describe Forge-Claw and the new Forge-Master contract.
3. Manual: new chapter `docs/manual/forge-claw.html`; update `cli-reference.html` (`pforge claw`), `forge-master.html` and `dashboard-forge-master.html` (new contract fields, proposals, insights), `event-catalog.html` (`forge-master-insight`), `integrating-from-outside.html`, `multi-agent.html`, `how-do-i.html`, `troubleshooting.html`, `glossary.html` (Forge-Claw, dispatcher, lane, worker, channel adapter, agent runtime, proposed action), `book-index.html` / `reader-paths.html`; run `node docs/manual/maintain.mjs` to refresh counts and glossary terms.
4. Top-level docs: `README.md` (feature list + link to the guide), `docs/CLI-GUIDE.md` (`pforge claw`), `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` (Forge-Claw as the native front door; OpenClaw remains an alternative integration), `ROADMAP.md`, `CHANGELOG.md` `[Unreleased]` (experimental `pforge-claw` package, `pforge claw` CLI, cross-platform support, link to the guide), `docs/plans/DEPLOYMENT-ROADMAP.md` status for both phases.
5. Sweep for stale or operator-specific text across all touched docs: no personal hosts, chat ids or paths; every example uses placeholders; every cross-link resolves.

Files: `docs/PFORGE-CLAW-GUIDE.md`, `pforge-mcp/capabilities/surface.mjs`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/manual/*`, `README.md`, `docs/CLI-GUIDE.md`, `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/plans/DEPLOYMENT-ROADMAP.md`

**Validation Gate**:
```bash
node -e 'const s=require("fs").readFileSync("CHANGELOG.md","utf8");const u=s.slice(0,s.indexOf("\n## [",s.indexOf("## [Unreleased]")+5));if(!u.includes("pforge-claw"))throw new Error("CHANGELOG [Unreleased] missing pforge-claw")'
node -e 'const fs=require("fs");const need={"docs/PFORGE-CLAW-GUIDE.md":["Chat command reference","Tested Platforms","overlays/example"],"docs/UNIFIED-SYSTEM-ARCHITECTURE.md":["Forge-Claw"],"README.md":["Forge-Claw"],"docs/CLI-GUIDE.md":["pforge claw"],"docs/manual/forge-claw.html":["Forge-Claw"],"pforge-mcp/capabilities/surface.mjs":["Forge-Claw"]};for(const [f,ns] of Object.entries(need)){const s=fs.readFileSync(f,"utf8");for(const n of ns)if(!s.includes(n))throw new Error(f+" missing "+n)}'
node scripts/generate-capabilities-doc.mjs --check
node docs/manual/maintain.mjs --audit
node pforge-mcp/server.mjs --check
node -e "process.chdir('pforge-claw'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
```

## Re-anchor Checkpoints

- **After Slice 1**: re-read Forbidden. Confirm no source import from `pforge-mcp/` / `pforge-master/`, both shells dispatch `claw`, tool surface unchanged.
- **After Slice 5**: re-read Security Posture §1. Confirm silent-drop for unknown users/chats.
- **After Slice 10**: re-read D6 and the mutating-job MUST. Confirm no code path leases a mutating job without a consumed approval.
- **After Slice 12 (end of M1 core)**: re-read Success Metric 1 and run it against the fake Telegram helper before starting P1.
- **After Slice 17 (end of M1)**: re-read D4, D11, D12. Confirm single-host smoke is green, then continue straight into M2 — no pause.
- **After Slice 20**: re-read D12/D13. Confirm RBAC verbs and namespace scope.
- **After Slice 23**: re-read placement rules and `restricted` semantics. Re-read the Portability & Configurability Contract: no lane or label names in code.
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
- Validation gate fails and root cause isn't found within 30 minutes.
- Budget for the phase exceeds estimate by more than 25 % (`forge_cost_report`).

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
