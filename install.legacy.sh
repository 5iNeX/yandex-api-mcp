#!/bin/sh
set -eu
# Run from a reviewed repository checkout; do not pipe this script into a shell.
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Нужен Python 3.10+: sudo apt-get install python3' >&2
  exit 1
fi
exec python3 "$repo_dir/installer/install.py" "$@"
