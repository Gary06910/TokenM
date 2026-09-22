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
USER_SERVICE=0
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
    --user-service)
      USER_SERVICE=1
      shift
      ;;
    --help|-h)
      printf '%s\n' 'Usage: install.sh [--prefix PATH]' \
        '       install.sh --user-service' \
        'Default: ~/.local/share/toknow-agent/<VERSION> with ~/.local/bin/toknow-agent' \
        'Override: TO_KNOW_INSTALL_ROOT or --prefix PATH' \
        'User service: default install root only; requires systemctl --user'
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

if [ "$USER_SERVICE" -eq 1 ]; then
  DEFAULT_PREFIX="$HOME/.local/share/toknow-agent"
  if [ "$PREFIX" != "$DEFAULT_PREFIX" ]; then
    printf '%s\n' 'install.sh: --user-service requires the default install root ~/.local/share/toknow-agent' >&2
    exit 2
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    printf '%s\n' 'install.sh: --user-service requires systemctl' >&2
    exit 1
  fi
  UNIT_SOURCE="$PACKAGE_ROOT/systemd/toknow-agent.service"
  if [ ! -f "$UNIT_SOURCE" ]; then
    printf '%s\n' 'install.sh: packaged systemd user unit is missing' >&2
    exit 1
  fi
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  UNIT_PATH="$UNIT_DIR/toknow-agent.service"
  if [ -L "$UNIT_PATH" ]; then
    printf '%s\n' 'install.sh: refusing to overwrite a symlinked user unit' >&2
    exit 1
  fi
  if [ -e "$UNIT_PATH" ] \
    && ! cmp -s "$UNIT_SOURCE" "$UNIT_PATH" \
    && ! grep -Fqx '# Managed by To Know Server Agent installer.' "$UNIT_PATH"; then
    printf '%s\n' 'install.sh: existing user unit is not managed by To Know' >&2
    exit 1
  fi
fi

VERSION_ROOT="$PREFIX/$VERSION"
mkdir -p "$VERSION_ROOT"
cp -a "$PACKAGE_ROOT/." "$VERSION_ROOT/"
mkdir -p "$(dirname -- "$STABLE_BIN")"
ln -sfn "$VERSION_ROOT/bin/toknow-agent" "$STABLE_BIN"

printf 'Installed To Know Server Agent %s\n' "$VERSION"
printf 'Stable launcher: %s\n' "$STABLE_BIN"

if [ "$USER_SERVICE" -eq 1 ]; then
  mkdir -p "$UNIT_DIR"
  cp "$UNIT_SOURCE" "$UNIT_PATH"
  chmod 0644 "$UNIT_PATH"
  if ! systemctl --user daemon-reload; then
    printf '%s\n' 'install.sh: systemctl --user daemon-reload failed; user manager may be unavailable' >&2
    exit 1
  fi
  if ! systemctl --user enable --now toknow-agent.service; then
    printf '%s\n' 'install.sh: systemctl --user enable --now failed' >&2
    exit 1
  fi
  printf 'User service enabled: %s\n' "$UNIT_PATH"
fi
