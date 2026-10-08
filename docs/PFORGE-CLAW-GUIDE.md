# Forge-Claw Guide

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

If Kubernetes prerequisites are unavailable, record the scripts' explicit
`SKIPPED:` reason as skipped, not passed. Kubernetes/CNI and live D4 diagnostics
are not currently supplied by doctor; preserve doctor output without claiming
it verifies those conditions. The current scripts and probe still require
end-to-end validation before their output can be used as live lane evidence.

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
