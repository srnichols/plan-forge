#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: install-service.sh <install|uninstall|status> [--dry-run] [--home <dir>] [--node <path>] [--cli <path>]' >&2
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

action=$1
shift
case "$action" in
  install|uninstall|status) ;;
  *) usage; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node_bin=${NODE:-node}
exec "$node_bin" "$script_dir/service-manager.mjs" "$action" "$@"
