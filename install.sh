#!/bin/sh
set -eu
# Install from a reviewed checkout. This does not modify host networking.
if [ "$(id -u)" -ne 0 ]; then
  echo "Run: sudo ./install.sh" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with Compose v2 is required. Install it before running this script." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required for the yp management CLI." >&2
  exit 1
fi
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=/opt/yandex-api-mcp
mkdir -p "$target" "$target/state" "$target/secrets"
if [ "$repo_dir" != "$target" ]; then
  tar -C "$repo_dir" --exclude=.git --exclude=node_modules --exclude=core/node_modules \
    --exclude=core/dist --exclude=.venv --exclude=graphify-out \
    --exclude=state --exclude=secrets --exclude=private --exclude=.env \
    --exclude='*.key' -cf - . | tar -C "$target" -xf -
fi
chmod 700 "$target/state"
chmod 750 "$target/secrets"
install -m 0755 "$target/scripts/yp_api.py" /usr/local/bin/yp-api
if [ ! -e /usr/local/bin/yp ] && [ ! -e /bin/yp ]; then
  ln -s /usr/local/bin/yp-api /usr/local/bin/yp
  cli=yp
else
  cli=yp-api
  echo "Existing yp command preserved. Use yp-api for yandex-api-mcp."
fi
echo "Installed application files in $target. Running setup."
"/usr/local/bin/yp-api" setup
echo "Management CLI: $cli"
