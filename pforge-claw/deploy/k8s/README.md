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
