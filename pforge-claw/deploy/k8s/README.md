# Kubernetes dispatcher

The example overlay deploys one dispatcher in the `pforge-claw` namespace. It
uses the `pforge-claw-secrets` Secret; no Secret object or credential value is
stored in these manifests.

| Secret key | Used for |
|---|---|
| `PFORGE_CLAW_TELEGRAM_TOKEN` | Required Telegram Bot API token |
| `PFORGE_CLAW_TELEGRAM_WEBHOOK_SECRET` | Optional webhook verification secret |
| `PFORGE_CLAW_WORKER_SECRET` | Generated worker enrollment secret; not mounted by this dispatcher base |
| `PFORGE_CLAW_GH_TOKEN` | Optional Git operations for pods or workers without `gh auth` |
| `PFORGE_CLAW_COPILOT_TOKEN` | Optional Copilot Requests: Read token |
| `PFORGE_BRIDGE_SECRET` | Bridge access for the later memory-drain integration |
| `OPENBRAIN_URL`, `OPENBRAIN_KEY` | Optional direct OpenBrain endpoint and access key |

The dispatcher currently reads the Telegram token and the optional webhook,
GitHub, and Copilot keys from `pforge-claw-secrets`. Store any additional
integration keys in the same managed Secret only when the corresponding
integration is enabled. Prefer Sealed Secrets or External Secrets in a cluster.
For a manual setup, use a secure shell or secrets manager and replace the
placeholder before running:

```sh
kubectl create secret generic pforge-claw-secrets \
  --namespace pforge-claw \
  --from-literal=PFORGE_CLAW_TELEGRAM_TOKEN='REPLACE_WITH_TELEGRAM_TOKEN'
```

Do not commit secret values or a populated Secret manifest. Enable webhook
mode only after configuring the optional webhook key. The example config uses
Telegram polling by default.

Set `newName` and `newTag` in `overlays/example/kustomization.yaml` to the
published dispatcher image. Set the ingress class and provide the
`pforge-claw-tls` TLS Secret through your cluster's certificate workflow. TLS
must terminate at the ingress or an upstream trusted proxy. The ingress exposes
only `/telegram/webhook` and `/claw/workers`; health endpoints are not exposed.
Configure an adequate WebSocket idle timeout on the ingress controller for
long-lived worker connections.

The dispatcher policy restricts ingress and permits DNS and TCP 443 egress.
The worker policies deny ingress and egress by default, then permit only
cluster DNS and the namespace-local dispatcher. There is **no public-HTTPS
catch-all** for workers. Enforcement requires a NetworkPolicy-capable CNI.

Add explicit external IPs/CIDRs to `config.json#k8s.egress.allow`, including a
private OpenBrain endpoint when needed. Render a namespaced, additive
TCP/443 policy offline with either shell and include the output file as an
overlay resource:

```powershell
.\scripts\render-egress.ps1 -Config .\deploy\k8s\overlays\example\config.json -Namespace <namespace>
```

```sh
bash scripts/render-egress.sh --config deploy/k8s/overlays/example/config.json --namespace <namespace>
```

These renderers emit only policy JSON to stdout, never other configuration
or credentials, and do not access a cluster. Empty allowlists permit no
external targets. Invalid CIDRs and `/0` ranges are rejected.
Standard NetworkPolicy cannot allowlist DNS hostnames. The GitHub/Copilot/npm
hostname defaults in the example therefore require an operator-managed FQDN
policy (such as Cilium) or a constrained egress proxy; the portable renderer
returns `K8S_EGRESS_HOSTNAME_UNSUPPORTED` instead of widening the allowlist.
The base policy includes a commented FQDN example, not an automatically
installed CNI extension. Keep every additional allow policy under review:
NetworkPolicy allowances are additive.

The PVC requests `ReadWriteOnce`; ensure the cluster has a default storage
class, or set `storageClassName` in `overlays/example/patch-pvc.yaml`. The
container runs as UID/GID 10001 and the mounted data volume must be writable by
that identity. `Recreate` reduces overlapping dispatcher writers, but RWO plus
Recreate cannot guarantee a single writer during a node partition.

The manifest tests deliberately use a small, strict YAML subset parser. Keep
manifests to block maps and lists, simple inline scalar lists, and plain,
quoted, integer, boolean, or null scalars. Anchors, aliases, tags, block
scalars, and complex inline flow values are not supported.

## One-shot Job credentials and execution

Stop the dispatcher and run `pforge claw worker enroll --lane <k8s-lane>`.
This creates a 256-bit lane secret in the dispatcher's restricted
`<home>/secrets.json` under `k8s.laneSecret` (default
`PFORGE_CLAW_K8S_LANE_SECRET`). Only the name is printed. Use `--rotate` to
replace an existing secret; rotation invalidates keys for outstanding pods.
An environment variable of the same name takes precedence over the file:
enrollment warns about this, so rotate the managed environment secret too.
Restart the dispatcher after enrollment or rotation.

The lane secret stays on the dispatcher. Each Job receives only a derived
`PFORGE_CLAW_JOB_KEY`, bound to its lane and job. Anyone with read access to
the Job or Pod can read this key. It authenticates only that job and loses
authentication eligibility on completion, cancellation, or deadline expiry.
Restrict Job/Pod read access accordingly.

Pods run `pforge claw worker --one-shot --job <id>` without needing a local
claw config. Required environment variables are `PFORGE_CLAW_JOB_ID`,
`PFORGE_CLAW_JOB_KEY`, `PFORGE_CLAW_LANE_ID`,
`PFORGE_CLAW_DISPATCHER_URL`, and the positive finite
`PFORGE_CLAW_JOB_DEADLINE_SECONDS`. A missing or mismatched value exits 2.
The worker verifies the approval grant before cloning, applies the home
lane's allow-listed bootstrap files, creates `claw/<id>`, and uses the same
runners and PR lifecycle as local execution. The verified, immutable lease
payload owns repository/base branch, model/runtime/provider references,
quorum/resume and bootstrap copy/environment/install choices. A copied
`.forge.json` or the host's defaults must not replace those signed values.
Provider values are resolved from the executing pod's own secret environment;
only references enter the signed payload.

The worker image supplies Git, `gh`, Bash, PowerShell and a process-only
credential helper. `PFORGE_CLAW_GH_TOKEN` becomes `GH_TOKEN`; HTTPS clone,
push and PR commands share that job-owned environment, without `gh auth
login` or `git config --global` writes. SSH, insecure HTTP, local paths and
credential-bearing repository URLs are rejected for these token-only pods.
The author/committer default is `Forge-Claw <claw@localhost>`; explicit
`GIT_AUTHOR_*` and `GIT_COMMITTER_*` environment values are retained only
when free of control characters. Git/GH debugging and inherited Git
configuration injection are disabled. `/work/home` and `/work/claw` are
ephemeral writable directories; the image root stays read-only.

L2 artifacts precede the terminal event. The pod exits 0 only after successful
execution, identity-matching canonical application acknowledgement and the
terminal receipt/cleanup handoff; failure or an unacknowledged deadline exits
1. Application ACK binds `jobId`, `projectId`, `deltaId` and `sha256Total`.
A heartbeat's sequence number proves transport receipt only. A negative ACK,
conflict, cancellation or timeout cannot authorize success or remove the only
history copy. Lease grants have **no clock-skew tolerance** and may be renewed
only within the job deadline without changing the approved payload. All
dispatcher and worker nodes need synchronized NTP.

Worker Jobs intentionally omit Kubernetes `ttlSecondsAfterFinished`: the TTL
controller cannot check canonical history. The lane's existing
`k8s.ttlSecondsAfterFinished` setting instead records
`pforge-claw/cleanup-after-ack-seconds` and delays dispatcher deletion **after**
matching application proof. Failed/unconfirmed/running-cancelled Jobs remain
for recovery; cancellation revokes authentication and requests worker abort,
but does not delete their ephemeral storage. A connection-timeout pod that
never started can be deleted. A dispatcher restart may leave an acknowledged
Job behind if its in-memory cleanup timer was lost; retained Jobs require
operator inspection, never blind deletion.

| Code | Action |
|---|---|
| `K8S_LANE_SECRET_MISSING` | Enroll the lane or set its named secret on the dispatcher. |
| `WORKER_JOB_UNKNOWN` | Check that the job is pending and has not finished, been cancelled, or expired. |
| `LEASE_GRANT_INVALID` | Check the job/lane binding, credentials, payload integrity, and node clocks. |
| `l2-sync-incomplete` | Inspect L2 collection/consolidation and the Job deadline; do not treat execution as successful. |

## Kubernetes acceptance gate and safe diagnostics

`scripts/e2e-k8s.ps1` and `scripts/e2e-k8s.sh` share `k8s-e2e.mjs`. They
require explicitly supplied prebuilt dispatcher/one-shot **fixture** images,
the coordinator-owned `tests/helpers/k8s-{dispatcher,worker,scenario}.mjs`
contracts, an explicit kind/k3d context and a fresh `pforge-claw-e2e-*`
namespace. Missing contracts return `K8S_E2E_FIXTURE_CONTRACTS_PENDING`
(exit 2) before any cluster operation. The gate never builds images and
never substitutes a local offline rig for a deployed dispatcher.

The scenario must exercise the real composition root and `K8sJobLane`,
consume an approval and verify the lease grant, then produce one-shot Job,
PR, ordered history artifacts and a matching application ACK. Its bounded
proof contains expected and canonical artifact paths/SHA-256 values and the
actual ordered LaneEvents. The driver waits for the worker Job to complete,
checks its image/command/security/deadline/job-key-only environment, validates
the proof and then checks deletion. Separate positive-control and
worker-labelled probes establish that a reachable disallowed target is
actually denied, not merely unavailable.

For CI failure diagnostics, pipe one Pod's JSON into
`node scripts/k8s-diagnostics.mjs`, not `describe` or a raw Pod dump: a Pod's
literal environment contains its derived authentication key. The helper reads
at most 1 MiB and emits at most 10 KiB/16 container statuses: validated
namespace/name/phase, readiness, restart count, a fixed-set reason, exit
code and normalized timestamps, plus count/truncation metadata. It never
copies environments, commands, args, annotations or raw messages. Invalid
input returns only `{ "ok": false, "code": "K8S_DIAGNOSTICS_INPUT_INVALID" }`
on stdout with exit 2; oversized input uses `K8S_DIAGNOSTICS_INPUT_TOO_LARGE`.

Offline renderer, mocked-command driver, canonical-receiver and canary tests
are not live acceptance. Image availability, CNI enforcement, real in-cluster
RBAC/authentication, deadlines, history retention and cleanup still require a
separately authorized live gate.
