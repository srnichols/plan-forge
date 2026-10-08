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

The NetworkPolicy restricts dispatcher ingress and permits DNS and TCP 443
egress. It requires a CNI that enforces Kubernetes NetworkPolicy. Standard
NetworkPolicy cannot allowlist DNS hostnames; use an egress proxy when a
hostname-level allowlist is required. Worker Job egress is handled by Slice 23
and is not configured by this dispatcher policy.

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
runners and PR lifecycle as local execution. Project model/runtime settings
for pods come from the copied `.forge.json`; configure them there.

L2 artifacts precede the terminal event. The pod exits 0 only after successful
execution and acknowledgement of that terminal sequence; failure or an
unacknowledged deadline exits 1. A received heartbeat proves transport
receipt, not canonical L2 application: consolidation and its conflicts are
separate dispatcher guarantees. Grants expire after five minutes with **no
clock-skew tolerance**. All dispatcher and worker nodes need synchronized NTP.

| Code | Action |
|---|---|
| `K8S_LANE_SECRET_MISSING` | Enroll the lane or set its named secret on the dispatcher. |
| `WORKER_JOB_UNKNOWN` | Check that the job is pending and has not finished, been cancelled, or expired. |
| `LEASE_GRANT_INVALID` | Check the job/lane binding, credentials, payload integrity, and node clocks. |
| `l2-sync-incomplete` | Inspect L2 collection/consolidation and the Job deadline; do not treat execution as successful. |
