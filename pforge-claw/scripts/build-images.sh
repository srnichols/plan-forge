#!/usr/bin/env bash
set -euo pipefail

registry=""
namespace=""
tag=""
variants="node,dotnet,python"
platforms="linux/amd64,linux/arm64"
node_version="24"
push=false
dry_run=false
load=false

usage() {
  printf '%s\n' \
    "Usage: build-images.sh --registry <host[:port]> --namespace <name> --tag <tag> [options]" \
    "Options: --variants node,dotnet,python --platforms linux/amd64,linux/arm64" \
    "         --node-version 22|24 --push --load --dry-run" >&2
}

fail() {
  printf 'build-images: %s\n' "$1" >&2
  usage
  exit 2
}

while (($#)); do
  case "$1" in
    --registry)
      (($# >= 2)) || fail "--registry requires a value"
      registry="$2"
      shift 2
      ;;
    --namespace)
      (($# >= 2)) || fail "--namespace requires a value"
      namespace="$2"
      shift 2
      ;;
    --tag)
      (($# >= 2)) || fail "--tag requires a value"
      tag="$2"
      shift 2
      ;;
    --variants)
      (($# >= 2)) || fail "--variants requires a value"
      variants="$2"
      shift 2
      ;;
    --platforms)
      (($# >= 2)) || fail "--platforms requires a value"
      platforms="$2"
      shift 2
      ;;
    --node-version)
      (($# >= 2)) || fail "--node-version requires a value"
      node_version="$2"
      shift 2
      ;;
    --push)
      push=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --load)
      load=true
      shift
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ -n "$registry" ]] || fail "--registry is required"
[[ -n "$namespace" ]] || fail "--namespace is required"
[[ -n "$tag" ]] || fail "--tag is required"
[[ "$registry" =~ ^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*(:[0-9]{1,5})?$ ]] || fail "invalid registry: $registry"
if [[ "$registry" == *:* ]]; then
  registry_port="${registry##*:}"
  ((10#$registry_port > 0 && 10#$registry_port <= 65535)) || fail "registry port must be between 1 and 65535"
fi
[[ "$namespace" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$ ]] || fail "invalid namespace: $namespace"
[[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "invalid tag: $tag"
[[ "$node_version" == 22 || "$node_version" == 24 ]] || fail "--node-version must be 22 or 24"
[[ -n "$variants" && "$variants" != ,* && "$variants" != *, && "$variants" != *,,* ]] || fail "variants must be a comma-separated list"
[[ -n "$platforms" && "$platforms" != ,* && "$platforms" != *, && "$platforms" != *,,* ]] || fail "platforms must be a comma-separated list"

IFS=, read -r -a variant_list <<< "$variants"
IFS=, read -r -a platform_list <<< "$platforms"
declare -A seen_variants=()
for variant in "${variant_list[@]}"; do
  [[ "$variant" == node || "$variant" == dotnet || "$variant" == python ]] || fail "unsupported variant: $variant"
  [[ -z "${seen_variants[$variant]+set}" ]] || fail "duplicate variant: $variant"
  seen_variants[$variant]=1
done
declare -A seen_platforms=()
for platform in "${platform_list[@]}"; do
  [[ "$platform" == linux/amd64 || "$platform" == linux/arm64 ]] || fail "unsupported platform: $platform"
  [[ -z "${seen_platforms[$platform]+set}" ]] || fail "duplicate platform: $platform"
  seen_platforms[$platform]=1
done
(( ${#platform_list[@]} > 0 )) || fail "at least one platform is required"
if [[ "$load" == true && ${#platform_list[@]} -gt 1 ]]; then
  fail "--load cannot be used with multiple platforms"
fi
if [[ "$push" == true && "$load" == true ]]; then
  fail "--push and --load cannot be combined"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
context_dir="$(cd -- "$script_dir/.." && pwd)"
base_dockerfile="$context_dir/deploy/Dockerfile.worker-base"
base_image="$registry/$namespace/pforge-claw-worker-base:$tag"
platform_argument="$(IFS=,; printf '%s' "${platform_list[*]}")"
variant_output=()

if [[ "$push" == true ]]; then
  variant_output=(--push)
elif [[ "$load" == true || ${#platform_list[@]} -eq 1 ]]; then
  variant_output=(--load)
else
  variant_output=(--output type=cacheonly)
fi

run_docker() {
  if [[ "$dry_run" == true ]]; then
    printf '%s\n' "--- docker"
    printf '  %s\n' "$@"
    return
  fi
  docker "$@"
}

if [[ "$dry_run" != true ]]; then
  if ! docker buildx version; then
    printf '%s\n' "build-images: docker buildx is required" >&2
    exit 1
  fi
fi

base_args=(
  buildx build
  --platform "$platform_argument"
  --file "$base_dockerfile"
  --tag "$base_image"
  --build-arg "NODE_VERSION=$node_version"
  "${variant_output[@]}"
  "$context_dir"
)
run_docker "${base_args[@]}"

for variant in "${variant_list[@]}"; do
  variant_args=(
    buildx build
    --platform "$platform_argument"
    --file "$context_dir/deploy/worker-variants/Dockerfile.$variant"
    --tag "$registry/$namespace/pforge-claw-worker-$variant:$tag"
    --build-arg "BASE_IMAGE=$base_image"
    "${variant_output[@]}"
    "$context_dir"
  )
  run_docker "${variant_args[@]}"
done
