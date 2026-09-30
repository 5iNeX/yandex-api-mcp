# Unified yandex-api-mcp deployment

The public image runs the webkoth-derived TypeScript core and the existing Python modules behind one MCP gateway. The gateway lists tools from both child MCP servers and routes calls. `/healthz` reports both backends and the number of exposed tools. Docker Compose publishes SSE only on `127.0.0.1:8001`. Stdio is available with `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`.

## Install and manage

Install Docker Engine, Compose v2 and Python 3 on Debian/Ubuntu, then run `sudo ./install.sh`. The installer copies application files to `/opt/yandex-api-mcp`, preserving existing `state/` and `secrets/`, and sets up `yp` or `yp-api`. Run `sudo yp oauth`, `sudo yp service start`, `sudo yp doctor`, and `sudo yp verify`. The root Dockerfile and Compose are public/read-only by default. Pro must be explicitly built with `MCP_EDITION=pro` and `MCP_PUBLIC_READONLY=false`; never publish it automatically.

`yp oauth` requests Webmaster `webmaster:hostinfo webmaster:verify`, Direct `direct:api`, Metrika `metrika:read`, and Audience `audience:read` by default. Request `metrika-write` when uploads are required. One OAuth token is shared by projects in `state/projects.json`. Wordstat uses Direct access. Search API requires `YANDEX_SEARCH_API_FOLDER_ID` and `YANDEX_SEARCH_API_API_KEY` in `secrets/yandex.env`. Yandex OAuth refresh preserves a rotating refresh token in `state/oauth.json`. A new consent flow is required to add scopes.

## OpenAI Tunnel

The LXC 123 Tunnel profile now uses the new MCP after `yp-api verify` and the expanded Webmaster read-only smoke passed. Its stdio command is:

```text
sudo -n /usr/local/libexec/yandex-api-mcp-stdio
```

The root-owned wrapper has a narrow sudoers entry for the `tunnel-client` user and runs `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. The prior profile is backed up at `/opt/yandex-api-mcp/backups/tunnel-before-cutover-20260930T053554Z.yaml`. `tunnel-client health --port 8080 --require-control-plane-poll --json` returned ready after cutover. The owner manually refreshed the installed ChatGPT Yandex application's tool catalog and reports that the new tool is visible. Rollback restores that profile and restarts only `tunnel-client.service`. No MCP port, host route, DNS, firewall or interface change is needed.

## Security and rollback

All secrets are mounted from host files. `docker inspect` contains paths, not token values. The public image marker forces read-only even if environment variables are changed. The gateway suppresses write tools and rejects direct write calls. Pro writes require preview and confirmation; destructive calls require an exact tool-name confirmation and batches are capped at 50. Direct per-item Results are summarized, including partial failures. Network errors and 5xx are retried only for read/idempotent requests.

To rollback, restore the prior Tunnel profile from `/opt/yandex-api-mcp/backups/tunnel-before-cutover-20260930T053554Z.yaml`, restart only `tunnel-client.service`, then stop only `yandex-api-mcp-yandex-api-mcp-1` with `docker compose -p yandex-api-mcp -f /opt/yandex-api-mcp/compose.yandex-api-mcp.yml stop`. The old `/opt/yandex-mcp/` Compose remains healthy. Application backup files are under both installations' `backups/` directories. Do not alter Proxmox or LXC networking.
