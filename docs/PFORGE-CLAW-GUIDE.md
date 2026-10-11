# Forge-Claw Guide

## What Forge-Claw is

Forge-Claw is an experimental, opt-in, host-level chat front door for Plan Forge. It receives Telegram messages, routes allowed requests through Forge-Master for reasoning, and dispatches governed work to configured execution lanes. It is not installed, configured, or started by `setup`; operators explicitly initialize and run it from a Plan Forge framework checkout. It is additive to the existing remote notification bridge.

## Architecture

The Telegram `ChannelAdapter` receives messages and renders replies, progress, and approval cards. A dispatcher authorizes each caller and chooses a lane. `AgentRuntime` abstracts GHCP and BYOK providers. Local, remote, or Kubernetes lanes execute jobs; project MCP calls use that project's home lane. The home lane owns its checkout and canonical `.forge` history. Remote workers connect outbound to the dispatcher and never expose a listener. The composition root in `pforge claw start` builds the shared context, starts available features, builds lanes, then starts dispatch.

## Prerequisites and Quick start

All platforms require Node.js 22.12 or newer, a Plan Forge framework checkout, an explicit Telegram bot token stored outside committed config, and at least one allowlisted operator. GHCP work requires the seat holder's authenticated Copilot runtime; BYOK is available where configured. Keep `PFORGE_CLAW_HOME` host-level, outside project repositories.

### macOS

Install the supported Node.js version, authenticate the operator's Copilot seat if using GHCP, then initialize an example and review its configuration:

```sh
pforge claw init --example single-host --out ./claw
pforge claw doctor --home ./claw
pforge claw start --home ./claw
```

### Windows

Use PowerShell 7+, install the supported Node.js version, then initialize and validate before starting:

```powershell
pforge claw init --example single-host --out .\claw
pforge claw doctor --home .\claw
pforge claw start --home .\claw
```

### Linux

Install the supported Node.js version and the selected runtime, then initialize and validate:

```sh
pforge claw init --example single-host --out ./claw
pforge claw doctor --home ./claw
pforge claw start --home ./claw
```

For a multi-host deployment, choose `--example multi-host`; for Kubernetes, choose `--example k8s`. `doctor` reports configuration problems and fixes, but does not prove live provider authentication or CNI enforcement.

## Configuration reference

The host configuration lives at `PFORGE_CLAW_HOME/config.json` (default home: `~/.pforge-claw/`). Secret values belong in environment variables or the ignored, access-restricted secrets store; config stores secret *names*, never secret values. The JSON Schema at `pforge-claw/config.schema.json` is normative. Defaults below are included only where declared by that schema.

| Path | Type | Required | Default | Enum/Constraints |
|---|---|---:|---|---|
| `v` | constant `1` | yes | — | |
| `instanceId` | string | yes | — | minLength=1 |
| `timezone` | string | yes | — | minLength=1 |
| `channels` | object | no | — | |
| `channels.telegram` | object | no | — | |
| `channels.telegram.enabled` | boolean | no | — | |
| `channels.telegram.botTokenSecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `channels.telegram.mode` | enum | no | `"poll"` | enum: poll, webhook |
| `channels.telegram.generalChat` | object | no | — | |
| `channels.telegram.generalChat.chatId` | string \| integer | yes | — | minLength=1 |
| `channels.telegram.generalChat.topicId` | string \| integer | no | — | minLength=1 |
| `channels.telegram.webhook` | object | no | — | |
| `channels.telegram.webhook.url` | string | no | — | |
| `channels.telegram.webhook.secretTokenSecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `allowlist[].channel` | enum | yes | — | enum: telegram |
| `allowlist[].userId` | string \| integer | yes | — | minLength=1 |
| `allowlist[].role` | enum | yes | — | enum: owner, approver, viewer |
| `allowlist[].alias` | string | no | — | |
| `allowlist` | array | yes | — | items: object |
| `policy` | object | no | — | |
| `policy.ghcpRoles` | array | no | `["owner"]` | items: enum |
| `policy.nonOwnerRuntime` | string | no | `"byok-only"` | |
| `runtimes` | object | no | — | |
| `runtimes.default` | string | no | — | |
| `runtimes.nonOwnerRuntime` | string | no | `"byok-only"` | |
| `runtimes.byok` | object | no | — | |
| `runtimes.byok.anthropic` | object | no | — | |
| `runtimes.byok.anthropic.keySecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `runtimes.byok.anthropic.endpoint` | string | no | — | minLength=1 |
| `runtimes.byok.openai` | object | no | — | |
| `runtimes.byok.openai.keySecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `runtimes.byok.openai.endpoint` | string | no | — | minLength=1 |
| `runtimes.byok.azure` | object | no | — | |
| `runtimes.byok.azure.keySecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `runtimes.byok.azure.endpoint` | string | no | — | |
| `runtimes.pforgeCommand` | string or string[] | no | — | |
| `runtimes.ghCommand` | string or string[] | no | — | |
| `lanes[].id` | string | yes | — | minLength=1 |
| `lanes[].kind` | enum | yes | — | enum: local, remote, k8s |
| `lanes[].labels` | array | no | — | items: string |
| `lanes[].enabled` | boolean | no | — | |
| `lanes[].optIn` | boolean | no | — | |
| `lanes[].runtime` | enum | no | — | copilot-sdk, anthropic, openai, azure; `byok:` aliases accepted |
| `lanes[].k8s` | object | no | — | |
| `lanes[].k8s.namespace` | string | no | — | |
| `lanes[].k8s.defaultImage` | string | no | — | |
| `lanes[].k8s.deadlineSeconds` | integer | no | — | minimum=1; per-job execution deadline |
| `lanes[].k8s.ttlSecondsAfterFinished` | integer | no | — | minimum=0; cleanup retention starts only after canonical application acknowledgement |
| `lanes[].k8s.laneSecret` | string | no | `"PFORGE_CLAW_K8S_LANE_SECRET"` | pattern: `^[A-Z][A-Z0-9_]*$` |
| `lanes` | array | yes | — | items: object |
| `projects[].id` | string | yes | — | minLength=1 |
| `projects[].displayName` | string | no | — | |
| `projects[].repo` | object | yes | — | |
| `projects[].repo.path` | string | yes | — | minLength=1 |
| `projects[].repo.remote` | string | no | — | |
| `projects[].repo.baseBranch` | string | no | — | |
| `projects[].repo.forgeHome` | string | no | — | |
| `projects[].channel` | object | yes | — | |
| `projects[].channel.adapter` | enum | yes | — | enum: telegram |
| `projects[].channel.chatId` | string \| integer | yes | — | minLength=1 |
| `projects[].channel.topicId` | string \| integer | no | — | minLength=1 |
| `projects[].placement` | object | no | — | |
| `projects[].placement.prefer` | array | no | — | items: string |
| `projects[].placement.requires` | array | no | — | items: string |
| `projects[].models` | object | no | — | |
| `projects[].models.chat` | string | no | — | |
| `projects[].models.work` | string | no | — | |
| `projects[].runtime` | enum | no | — | copilot-sdk, anthropic, openai, azure; `byok:` aliases accepted |
| `projects[].bootstrap` | object | no | — | Per-project override of the host bootstrap settings |
| `projects[].bootstrap.copy` | array | no | — | items: string |
| `projects[].bootstrap.env` | array | no | — | Secret variable names only |
| `projects[].bootstrap.install` | enum | no | — | link, ci, npm-ci, none |
| `projects[].homeLane` | string | yes | — | |
| `projects[].keepAlive` | boolean | no | — | |
| `projects[].budget` | object | no | — | |
| `projects[].budget.dailyUSD` | number | no | — | minimum=0 |
| `projects[].budget.dailyPremiumRequests` | integer | no | — | minimum=0 |
| `projects[].budget.maxUnknownPerDay` | integer | no | — | minimum=0 |
| `projects[].visibility` | enum | no | — | enum: normal, restricted |
| `projects[].image` | string | no | — | |
| `projects[].memory` | object | no | — | |
| `projects[].memory.l3` | enum | no | — | enum: off, openbrain |
| `projects` | array | yes | — | items: object |
| `budget` | object | no | — | |
| `budget.dailyUSD` | number | no | — | minimum=0 |
| `budget.dailyPremiumRequests` | integer | no | — | minimum=0 |
| `budget.maxUnknownPerDay` | integer | no | — | minimum=0 |
| `jobs` | object | no | — | |
| `jobs.keepFailedWorktreeHours` | number | no | — | minimum=0 |
| `jobs.pushOnFailure` | boolean | no | `false` | |
| `bootstrap` | object | no | — | |
| `bootstrap.copy` | array | no | — | items: string |
| `bootstrap.env` | array | no | — | Secret variable names only |
| `bootstrap.install` | enum | no | — | enum: link, ci, npm-ci, none |
| `mcp` | object | no | — | |
| `mcp.serverName` | string | no | — | |
| `mcp.idleMinutes` | number | no | — | minimum=0 |
| `mcp.toolProfile` | string | no | — | |
| `schedules[].id` | string | yes | — | minLength=1 |
| `schedules[].kind` | enum | yes | — | enum: digest, skill |
| `schedules[].at` | string | yes | — | pattern: `^(?:daily (?:[01][0-9]|2[0-3]):[0-5][0-9]|weekly (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:[01][0-9]|2[0-3]):[0-5][0-9]|monthly (?:[1-9]|1[0-9]|2[0-8]) (?:[01][0-9]|2[0-3]):[0-5][0-9]|every (?:[5-9]|[1-9][0-9]+)m)$` |
| `schedules[].project` | string | no | — | |
| `schedules[].skill` | string | no | — | |
| `schedules[].preApproved` | boolean | no | — | |
| `schedules` | array | no | — | items: object |
| `capture` | object | no | — | |
| `capture.voice` | object | no | — | |
| `capture.voice.enabled` | boolean | no | `false` | |
| `capture.voice.provider` | string | no | — | |
| `capture.voice.keySecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `capture.voice.endpoint` | string | no | — | Transcription endpoint; falls back to the configured provider endpoint |
| `capture.voice.model` | string | no | — | Configured transcription model; no model is hardcoded |
| `memory` | object | no | — | |
| `memory.openbrain` | object | no | — | |
| `memory.openbrain.endpoint` | string | no | — | |
| `memory.openbrain.tokenSecret` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `memory.openbrain.header` | string | no | — | |
| `memory.botNamespace` | string | no | — | |
| `memory.captureTaskOutcomes` | boolean | no | — | |
| `memory.captureApprovals` | boolean | no | — | |
| `memory.captureInsights` | boolean | no | — | |
| `worker` | object | no | — | |
| `worker.dispatcherUrl` | string | no | — | |
| `worker.laneId` | string | no | — | |
| `worker.secretName` | string | no | — | pattern: `^[A-Z][A-Z0-9_]*$` |
| `worker.allowInsecureLan` | boolean | no | `false` | |
| `http` | object | no | — | |
| `http.bind` | string | no | `"127.0.0.1"` | |
| `http.port` | integer | no | — | minimum=1; maximum=65535 |
| `k8s` | object | no | — | |
| `k8s.egress` | object | no | — | |
| `k8s.egress.allow` | array | no | — | items: string |

## Lanes and labels

Lanes are operator-defined execution targets: `local`, `remote`, or `k8s`. Give them descriptive IDs and labels such as `macos`, `windows`, `linux`, or `ephemeral`; placement can prefer lane IDs and require labels. An `optIn` lane receives work only after an owner enables it with `/lane <id> on`. Each project names a `homeLane`, where its checkout and canonical `.forge` history live. Lanes are isolated execution capacity, not Forge-Master reasoning lanes.

Lane IDs are identifiers, not implementation switches. A local home can have any ID, and a remote lane named `local` still uses the remote transport. Runtime selection follows `projects[].runtime`, then the executing lane's `runtime`, then `runtimes.default`. BYOK credentials are resolved from the executing lane's secret store at call time; configuration contains only provider endpoints and secret names. A non-owner request must have an eligible configured BYOK runtime; merely setting `nonOwnerRuntime: "byok-only"` does not authorize use of a Copilot seat.

## Telegram setup

Create a bot with BotFather and place the token value in the secret store under the configured environment-variable name. Do not put the token in `config.json`, source, logs, screenshots, or evidence. Use long-polling by default; webhook mode is opt-in and must be configured with a secret token and public HTTPS endpoint.

For free-text messages in a Telegram group, disable BotFather privacy mode or make the bot a group administrator. Privacy mode only controls which messages Telegram delivers; **it is not the security boundary**. The configured chat/user allowlist is the authorization boundary, and unknown identities are silently dropped.

Enable forum topics and map each project to its own topic. Configure the general chat/topic separately; project commands resolve against that topic so status, memory, and jobs remain scoped to the intended project.

## Agent runtimes

GHCP (`copilot-sdk`) is the default runtime. An operator must use their own seat and authentication. BYOK runtimes support `anthropic`, `openai`, and `azure`; configure only environment-variable names such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `AZURE_OPENAI_API_KEY`, never key values. Use BYOK where a non-owner is allowed to trigger execution under the configured policy.

## Seat and runtime policy

By default, only `owner` identities may trigger GHCP-backed jobs. `approver` and `viewer` identities cannot use another person's Copilot seat; non-owners may trigger work only with a configured BYOK runtime, otherwise they are limited to read-only `ask`. The `policy.ghcpRoles` and `policy.nonOwnerRuntime` settings are configurable, but each operator is responsible for their own license terms.

## Service install

Install, inspect, or remove the host service with `pforge claw service install`, `pforge claw service status`, or `pforge claw service uninstall`. Service integration uses launchd on macOS, systemd on Linux, and Task Scheduler on Windows. Review the generated service configuration and home path before installation; services run with the host account's privileges.

## Remote workers

Enroll a worker on the dispatcher with `pforge claw worker enroll --lane <lane-id>`, then join it once with `pforge claw worker join --code <code>`. Revoke it with `pforge claw worker revoke <worker-id>`. Enrollment codes are single-use and expire; worker credentials are generated and stored by the worker, not typed into configuration.

Workers dial outbound to the dispatcher. Use `wss://` for remote connections; plain `ws://` is permitted only for loopback unless the explicit insecure-LAN option is enabled, which is warned on every connection. Provide TLS through an ingress/reverse proxy or a private overlay network such as Tailscale or WireGuard. Worker hosts do not expose listening ports.

## Kubernetes

Deploy the example Kustomize overlay from `pforge-claw/deploy/k8s/overlays/example`. Review namespace, images, storage, ingress, resource limits, secrets, and egress policy before applying. RBAC is namespace-scoped and limited to the required jobs and pods resources.

Plain Kubernetes `NetworkPolicy` rules match IP blocks, not hostnames. Hostname allowlisting therefore depends on the cluster CNI's FQDN policy support; without enforcing NetworkPolicy, egress restrictions are not effective.

## Budgets and approvals

Mutating work requires an approval bound to both the requesting chat and the approving allowlisted identity. Approval tokens are hashed, single-use, time-limited, and cannot be issued by Forge-Master. Budget policy tracks reported USD and premium requests separately; usage that a runtime does not report stays `null`, never `0`. Once the configured unknown-usage threshold is exceeded, further mutating work is held. Budget holds require an owner-authorized release.

A requesting owner may explicitly approve their own job; a second person is not required. Exact-expiry, current-role, chat/topic, forged-token and replay checks still apply. A fanout approval covers only the declared children, not any job that copies its parent ID. If a budget-hold card expires, an owner can retrieve a fresh same-topic card with `/budget`; retrieval never releases the hold automatically.

Plan actuals are collected through the job workspace's own `forge_cost_report` and correlated with that run's summary before cleanup. Aggregate spend or a canonical home's latest run is not attributed to a job by guesswork. Missing or mismatched actuals remain unknown. Operator auto-approval of development tools does not change Forge-Claw's application approvals or SDK permission policy.

Skill classification is conservative: only an explicit trusted `readOnly: true`
metadata result can skip mutation approval. The current native
`forge_run_skill` dry-run response does not expose that field, so its skills
remain approval-pending even if their source frontmatter declares read-only.
Forge-Claw does not infer permission from a model suggestion, skill name or
missing metadata. This limitation does not disable skill execution after a
valid approval.

## Security model summary

The [Forge-Claw threat model on GitHub](https://github.com/srnichols/plan-forge/blob/planning/main/docs/PFORGE-CLAW-THREAT-MODEL.md) describes trust boundaries, abuse cases, mitigations, and known gaps. Allowlist identity and single-use approvals govern chat-triggered work; forwarded content is untrusted data; secrets stay outside configuration; each mutating job uses an isolated worktree or clone; workers connect outbound over authenticated TLS.

Git worktrees are **not OS sandboxes**. They isolate repository changes, not processes, credentials, network access, or kernel privileges. Use a dedicated account or container boundary for stronger isolation. Preserve the threat model's blocked and pending caveats; do not infer safety guarantees from offline tests.

## Experimental release readiness

Forge-Claw is an opt-in Node ESM source package, not a new TypeScript build
pipeline. A candidate needs reproducible dependency installation and a complete
committed source tree, including the project MCP client and its history/runtime
helpers. A green dirty-worktree test alone is not proof that a fresh checkout
contains those modules.

For a fresh checkout, the existing `node pforge-mcp/server.mjs --validate`
generates the intentionally ignored CLI schema before its first `--check`;
normal MCP startup generates that artifact too. This is metadata generation,
not compilation. Keep frozen inventory checks separate from changes to the
public tool contract.

Maintainers must validate the complete unit and offline end-to-end suites,
unchanged source-quality rules, public tool inventory and documentation before
preparing a release. The version synchronizer includes Claw's manifest and its
root workspace lock entry when present, and the release commit allowlist permits
that manifest, not arbitrary Claw source changes. The SDK retains its independent
version. These metadata safeguards do not install or start Claw. No release
version has been selected here, and no image publication or deployment is implied.

Cross-platform CI at Node 22.12 and 24, an actual disposable Kubernetes/CNI run,
and authenticated Telegram, GitHub Copilot/BYOK and memory checks remain distinct
acceptance gates. Offline fixture images and mocked provider calls cannot replace
those results. `/forget` remains unavailable, and there is no npm publication.

Configure an operator environment only after the candidate is accepted: choose
project remotes and paths, home/execution lanes, allowlisted identities and
chat/topic routes, models/runtimes, private secret references, budgets and any
cluster overlay. None of those operator values belongs in product source or the
shipped example configurations.

## Live test environment

**MANUAL (operator)** — Live Telegram, GitHub, authenticated GitHub Copilot,
BYOK, and Kubernetes checks require operator-controlled credentials and
infrastructure. Offline fixture results are not evidence of a live D4 outcome.

### Bot and project checklist

Create a bot with BotFather and provide its token through
`PFORGE_CLAW_TELEGRAM_TOKEN`. Do not put the token in committed configuration,
screenshots, logs, or evidence. Turn privacy off through BotFather, or make the
bot an administrator so it can read messages in the test forum.

Use a Telegram forum with topics enabled. Configure a general topic and three
separate project topics in the dispatcher's configuration. Register each
project with its repository path, base branch, channel/chat/topic route,
home lane, and placement preferences. Make the third project restricted. Use
three disposable repositories with test remotes and a `main` branch; approved
plan runs push a `claw/<job-id>` branch and create a pull request.

Set the Telegram allowlist explicitly: one owner, an approver, and a viewer,
using their actual user IDs. Keep unknown users outside the allowlist. Check
that help and menus reflect each caller's role and topic before running work.

### Local and remote lanes

Use `pforge claw dev up --fake` for an isolated local development topology;
use `pforge claw dev status` and `pforge claw dev down` to inspect and stop it.
The fake topology does not prove that real provider authentication works.

For a live bot, set the token in the environment before
`pforge claw dev up --live`. Treat the current development launcher as
unverified for the environment-only token requirement until its implementation
and live-mode tests demonstrate that the token is never written to disk.

For live remote workers, run `pforge claw worker enroll --lane <remote-lane>`
and complete the one-time join with a worker-specific `PFORGE_CLAW_HOME`.
Verify each authenticated WebSocket connection and opt in each lane before
assigning work. Keep restricted projects on the local lane.

### D4 runtime options

Before running a mutating plan, choose an operator-controlled authentication
path: an existing seat-holder Copilot login, `PFORGE_CLAW_COPILOT_TOKEN`, or
BYOK credentials supported by the selected runtime. Keep credentials in the
environment or ignored `.forge/secrets.json`; never place them in fixture
repositories, generated files, command logs, screenshots, or evidence. A fake
runtime does not validate any live authentication path.

Use TLS (`wss://`) for remote worker connections outside the deliberately
isolated local test environment. Do not expose an insecure worker endpoint to
an untrusted network.

### Kubernetes lane

Verify the selected Kubernetes context before running either
`pforge-claw/scripts/e2e-k8s.ps1` or `pforge-claw/scripts/e2e-k8s.sh`.
Use a dedicated kind or k3d test cluster and a CNI that enforces NetworkPolicy.
A reachable cluster without enforcing CNI cannot prove egress isolation.

Enroll the configured lane on the dispatcher with
`pforge claw worker enroll --lane <k8s-lane>`. Keep enrollment material and the
lane secret on the dispatcher. Job pods receive derived per-job keys, never
the reusable lane secret or a general worker credential.

Validate an allowlisted positive control and an independently reachable,
non-allowlisted destination. DNS failure, an unreachable destination, or a
timeout alone is not evidence of policy denial. Record Job completion and
deletion separately. Tear down only resources owned by that test run.

If Kubernetes prerequisites are unavailable, record the explicit blocked,
not-run or skip reason as unverified, not passed. Kubernetes/CNI and live D4 diagnostics
are not currently supplied by doctor; preserve doctor output without claiming
it verifies those conditions. The current scripts and probe still require
end-to-end validation before their output can be used as live lane evidence.

The disposable Kubernetes gate now has separate dispatcher and worker fixture
image targets in `pforge-claw/deploy/Dockerfile.k8s-fixtures`, built from the
framework repository root. Pass `--context`, a fresh
`pforge-claw-e2e-...` namespace, and explicit dispatcher/worker fixture image
tags to the Bash gate, or the matching named PowerShell parameters. The CI
workflow builds both targets and requires signed-job, positive canonical
application-ACK, nonempty history-file and cleanup evidence. `blocked`,
`dry-run`, missing proof and skip output cannot satisfy that gate.

These images replace external model, Git/PR and Telegram edges for a dedicated
test cluster; they are **not production images or live provider evidence**.
Do not build, load or deploy them into an operator namespace without explicit
authorization. Offline fixture tests prove the protocol and gate wiring, not
that the actual image, CNI or cluster run has passed.

### Scenario (a): away from the desk

In a project topic, send `/ask` with a question about the plan, then request
`/run Phase-1-DEMO-PLAN.md`. Retain the estimate card and confirm the checkout,
remote branches, and pull-request list are unchanged before approval. Have the
designated approver approve the card. Retain the consumed approval, monotonic
progress edits, pushed branch, one PR creation call, and final PR URL. Confirm
that the original checkout remains clean and at its original commit.

### Scenario (b): concurrent work and budget hold

Run one job for each of the three projects under a deliberately low daily
budget cap. Keep the restricted project on the local lane. Hold two jobs at
their runtime barriers and verify their active windows overlap on distinct
lanes and workspaces. Retain the third job's `held-budget` audit row and card.
Verify a non-owner cannot release the hold, then have the owner release it and
record terminal results and per-job/project `budget.jsonl` rows.

### Cleanup and evidence

Stop workers and the dispatcher, disable temporary lanes, remove only the
dedicated test namespace and disposable repositories, and revoke worker
enrollment where applicable. Do not clean up operator-owned resources or
credentials.

Record the following for each scenario:

| Evidence | Operator record |
|---|---|
| Revision | Commit SHA and any uncommitted test changes |
| Topology | Dispatcher home, lane IDs, worker IDs, and cluster context |
| Jobs | All job IDs and terminal states |
| Screenshots | Redacted request, estimate, approval, progress, and budget cards |
| Publishing | Branch refs and PR links; number of PR creation calls |
| Budget | Redacted `budget.jsonl` excerpt showing project/job attribution |
| Diagnostics | Complete, redacted `pforge claw doctor --json` output |
| Kubernetes | Positive control, denial evidence, CNI, Job deletion, or skip reason |
| D4 outcome | Authenticated GHCP, BYOK only, or not tested; observed provider/runtime |

**MANUAL (operator): stop here.** An agent must not infer live authentication,
egress enforcement, or a successful operator run from offline fixtures. Leave
the evidence table blank until the operator performs and records the scenarios.

## Tested Platforms

CI covers offline unit and end-to-end tests, scripted/fake Telegram interactions, and a doctor smoke test against the placeholder example configuration. It does not cover authenticated GitHub Copilot or BYOK, or live Telegram. The doctor smoke test confirms example diagnostics and does not prove Kubernetes/CNI or authentication readiness.

| OS | Arch | Node | K8s distro/version | CNI | Runtime | Channel | Result | Date | Reporter | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| ubuntu-latest | pending | 22.12 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| ubuntu-latest | pending | 24 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| windows-latest | pending | 22.12 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| windows-latest | pending | 24 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| macos-latest | pending | 22.12 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| macos-latest | pending | 24 | N/A | N/A | N/A | fake (offline) | pending | pending | pending | pending |
| ubuntu-latest (kind) | amd64 | 24 | kind / v1.32.2 | Calico 3.30.3 | containerd | pending | pending | pending | pending | pending |
| macOS reference host | unknown | unknown | N/A | N/A | unknown | unknown | pending | pending | pending | pending |
| Windows reference host | unknown | unknown | N/A | N/A | unknown | unknown | pending | pending | pending | pending |
| Linux reference cluster | unknown | unknown | unknown | unknown | unknown | unknown | pending | pending | pending | pending |

### Submitting a result

For a community issue, include every table column (OS, architecture, Node, Kubernetes distribution/version, CNI, runtime, channel, result, date, reporter, and evidence), plus the commit SHA or version and install method; commands run and scenario; expected and actual results; redacted `pforge claw doctor --json` output; evidence URL; and any skip or failure reason. Use the `forge-claw-platform` label. No issue template is required.

Maintainers replace `pending` cells after the first green run and include the CI run URL in the Evidence field. Missing environment details should remain `unknown`; use `N/A` only when a field does not apply.

## Troubleshooting

| Symptom | Check |
|---|---|
| No Telegram reply | Confirm the sender and chat are allowlisted; unknown callers are silently dropped. Check the configured bot secret name and `pforge claw doctor`. |
| Free-text group messages do not arrive | Disable BotFather privacy mode or make the bot an administrator. This affects message delivery, not authorization. |
| A topic routes to the wrong project | Verify the configured chat/topic mapping and each project's `homeLane`. |
| Runtime unavailable | Check GHCP seat-holder authentication or the configured BYOK environment-variable name; run doctor without exposing values. |
| Worker join fails or code expired | Enrollment codes are single-use and expire; enroll again and join with the new code. |
| Worker TLS connection fails | Use `wss://` with a valid certificate, or a trusted private overlay; non-loopback plain `ws://` is refused by default. |
| Lane is offline or receives no jobs | Check worker connectivity, lane enabled/opt-in state, labels, and project placement requirements. |
| Job held by budget | Inspect reported usage and unknown-usage count; an owner must explicitly release a budget hold. Unknown usage remains `null`. |

## Chat command reference

The following registry output is generated by `node pforge-claw/cli.mjs commands --markdown`:

```
| name | aliases | args | scope | roles | 🔒 | available | sinceSlice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| help | start | [command] | both | owner,approver,viewer |  | true | 5 |
| ask |  | <question> | project | owner,approver,viewer |  | true | 6 |
| new |  |  | project | owner,approver |  | true | 6 |
| run |  | <plan> [quorum] | project | owner,approver | yes | true | 9 |
| skill |  | <skill> [args] | project | owner,approver | yes | true | 9 |
| task |  | <description> | project | owner,approver | yes | true | 9 |
| status |  |  | both | owner,approver,viewer |  | true | 16 |
| jobs |  | [filter] | both | owner,approver |  | true | 9 |
| budget |  | [today] | both | owner,approver |  | true | 11 |
| remember |  | <fact> | project | owner,approver |  | true | 7 |
| recall |  | [--all] <query> | both | owner,approver |  | true | 7 |
| idea |  | <idea> | project | owner,approver |  | true | 7 |
| bug |  | <description> | project | owner,approver |  | true | 7 |
| abort |  | <job-id> | project | owner,approver | yes | true | 12 |
| retry |  | <job-id> | project | owner,approver | yes | true | 12 |
| lane |  | <id> <on\|off> | general | owner | yes | true | 23 |
| lanes |  |  | general | owner,approver |  | true | 23 |
| fanout |  | <task> [-- projects…] | general | owner,approver | yes | true | 16 |
| forget |  | <memory-id> | project | owner | yes | false | 24 |
```

`/help` is caller- and topic-filtered: it lists only commands the current identity can use. `/forget` is registered for discovery but is not currently available (`available: false`).
