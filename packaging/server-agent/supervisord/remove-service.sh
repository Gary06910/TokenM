#!/bin/sh
set -eu

SCRIPT_PATH=$0
case "$SCRIPT_PATH" in
  /*) ;;
  *) SCRIPT_PATH="$(pwd -P)/$SCRIPT_PATH" ;;
esac
PACKAGE_ROOT=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd -P)
NODE="$PACKAGE_ROOT/runtime/node/bin/node"
INSTALLER="$PACKAGE_ROOT/app/src/server-agent/serviceInstaller.js"

if [ ! -x "$NODE" ] || [ ! -f "$INSTALLER" ]; then
  printf '%s\n' 'remove-service.sh: packaged Server Agent runtime is unavailable' >&2
  exit 1
fi

"$NODE" "$INSTALLER" remove --service-manager supervisord "$@"
