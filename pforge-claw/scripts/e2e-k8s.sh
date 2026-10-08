#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_root="$(cd -- "$script_dir/.." && pwd)"

if ! command -v kubectl >/dev/null 2>&1; then
  printf '%s\n' "SKIPPED: kubectl is not installed."
  exit 0
fi
if command -v kind >/dev/null 2>&1; then
  cluster_tool=kind
elif command -v k3d >/dev/null 2>&1; then
  cluster_tool=k3d
else
  printf '%s\n' "SKIPPED: neither kind nor k3d is installed."
  exit 0
fi
if ! kubectl cluster-info >/dev/null 2>&1; then
  printf '%s\n' "SKIPPED: no reachable Kubernetes cluster."
  exit 0
fi

namespace="pforge-claw-e2e-$(printf '%s' "$RANDOM$RANDOM" | sha256sum | cut -c1-12)"
images=(
  pforge-claw-dev/local/pforge-claw-dispatcher:dev
  pforge-claw-dev/local/pforge-claw-worker-node:dev
)
cleanup() {
  status=$?
  trap - EXIT
  set +e
  kubectl delete namespace "$namespace" --ignore-not-found=true --wait=true >/dev/null
  cleanup_status=$?
  if (( status == 0 && cleanup_status != 0 )); then status=$cleanup_status; fi
  exit "$status"
}
trap cleanup EXIT

"$script_dir/build-images.sh" \
  --registry pforge-claw-dev \
  --namespace local \
  --tag dev \
  --variants node \
  --platforms linux/amd64 \
  --load
docker build --file "$package_root/deploy/Dockerfile.dispatcher" --tag "${images[0]}" "$package_root"
if [[ "$cluster_tool" == kind ]]; then
  kind load docker-image "${images[@]}"
else
  k3d image import "${images[@]}"
fi
kubectl create namespace "$namespace"
kubectl apply -k "$package_root/deploy/k8s/overlays/dev" -n "$namespace"
kubectl wait --for=condition=complete job/pforge-claw-egress-probe -n "$namespace" --timeout=90s
npm --prefix "$package_root" run test:e2e -- --run tests/e2e/away-from-desk.test.mjs
kubectl wait --for=delete job/pforge-claw-egress-probe -n "$namespace" --timeout=45s
