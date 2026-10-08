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
home lane, and placement preferences. Make the third project restricted.

Set the Telegram allowlist explicitly: one owner, an approver, and a viewer,
using their actual user IDs. Keep unknown users outside the allowlist. Check
that help and menus reflect each caller's role and topic before running work.
Use test repositories and test remotes: approved runs push branches and create
pull requests.

### Local and remote lanes

Use `pforge claw dev up --fake` for an isolated local development topology;
use `pforge claw dev status` and `pforge claw dev down` to inspect and stop it.
The fake topology does not prove that real provider authentication works.

For a live bot, set the token in the environment before
`pforge claw dev up --live`. Treat the current development launcher as
unverified for the environment-only token requirement until its implementation
and live-mode tests demonstrate that the token is never written to disk.

Remote lanes are opt-in. Enable them deliberately, give each worker its own
home, enroll it, and verify authenticated connectivity before assigning work.
Do not assign restricted projects to remote workers.

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

### Evidence: away-from-desk and concurrent runs

For scenario (a), ask about the plan, request a run, retain the estimate card,
approve it, and retain progress updates and the final PR link. Verify that
there was no mutation before approval, that the branch reached the test
remote, and that exactly one PR was created.

For scenario (b), run three project jobs with overlapping execution under a
low budget cap. Retain the held-budget card, rejection of a non-owner release,
successful owner release, terminal results, and per-project ledger attribution.

Record the following for both scenarios:

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
egress enforcement, or a successful operator run from offline fixtures.
