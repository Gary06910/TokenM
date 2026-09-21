#!/bin/sh
set -eu

SCRIPT_PATH=$0
case "$SCRIPT_PATH" in
  /*) ;;
  *) SCRIPT_PATH="$(pwd -P)/$SCRIPT_PATH" ;;
esac
PACKAGE_ROOT=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P)

VERSION=$(tr -d '\r\n' < "$PACKAGE_ROOT/VERSION")
if [ -z "$VERSION" ]; then
  printf '%s\n' 'install.sh: VERSION is empty' >&2
  exit 1
fi

PREFIX=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix=*) PREFIX=${1#*=}; shift ;;
    --prefix)
      if [ "$#" -lt 2 ]; then
        printf '%s\n' 'install.sh: --prefix requires a path' >&2
        exit 2
      fi
      PREFIX=$2
      shift 2
      ;;
    --help|-h)
      printf '%s\n' 'Usage: install.sh [--prefix PATH]' \
        'Default: ~/.local/share/toknow-agent/<VERSION> with ~/.local/bin/toknow-agent' \
        'Override: TO_KNOW_INSTALL_ROOT or --prefix PATH'
      exit 0
      ;;
    *)
      printf 'install.sh: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [ -n "${TO_KNOW_INSTALL_ROOT:-}" ]; then
  if [ -n "$PREFIX" ] && [ "$PREFIX" != "$TO_KNOW_INSTALL_ROOT" ]; then
    printf '%s\n' 'install.sh: --prefix and TO_KNOW_INSTALL_ROOT disagree' >&2
    exit 2
  fi
  PREFIX=$TO_KNOW_INSTALL_ROOT
fi

if [ -z "$PREFIX" ]; then
  PREFIX="$HOME/.local/share/toknow-agent"
  STABLE_BIN="$HOME/.local/bin/toknow-agent"
else
  STABLE_BIN="$PREFIX/bin/toknow-agent"
fi

VERSION_ROOT="$PREFIX/$VERSION"
mkdir -p "$VERSION_ROOT"
cp -a "$PACKAGE_ROOT/." "$VERSION_ROOT/"
mkdir -p "$(dirname -- "$STABLE_BIN")"
ln -sfn "$VERSION_ROOT/bin/toknow-agent" "$STABLE_BIN"

printf 'Installed To Know Server Agent %s\n' "$VERSION"
printf 'Stable launcher: %s\n' "$STABLE_BIN"
