# Unified yandex-api-mcp deployment

The public image runs the webkoth-derived TypeScript core and the existing Python modules behind one MCP gateway. The gateway lists tools from both child MCP servers and routes calls. `/healthz` reports both backends and the number of exposed tools. Docker Compose publishes SSE only on `127.0.0.1:8001`. Stdio is available with `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`.

## Install and manage

Install Docker Engine, Compose v2 and Python 3 on Debian/Ubuntu, then run `sudo ./install.sh`. The installer copies application files to `/opt/yandex-api-mcp`, preserving existing `state/` and `secrets/`, and sets up `yp` or `yp-api`. Run `sudo yp oauth`, `sudo yp service start`, `sudo yp doctor`, and `sudo yp verify`. The root Dockerfile and Compose are public/read-only by default. Pro must be explicitly built with `MCP_EDITION=pro` and `MCP_PUBLIC_READONLY=false`; never publish it automatically.

`yp oauth` requests Webmaster `webmaster:hostinfo webmaster:verify`, Direct `direct:api`, Metrika `metrika:read`, and Audience `audience:read` by default. Request `metrika-write` when uploads are required. One OAuth token is shared by projects in `state/projects.json`. Wordstat uses Direct access. Search API requires `YANDEX_SEARCH_API_FOLDER_ID` and `YANDEX_SEARCH_API_API_KEY` in `secrets/yandex.env`. Yandex OAuth refresh preserves a rotating refresh token in `state/oauth.json`. A new consent flow is required to add scopes.

## OpenAI Tunnel

The current Tunnel profile uses a fixed stdio command to the old Direct MCP. Keep it running until the new server passes `yp verify`, including Webmaster with the required scope. A prepared wrapper can replace the profile command with:

```text
sudo -n /usr/local/libexec/yandex-api-mcp-stdio
```

The wrapper must be root-owned and executable only with a narrow sudoers entry for the `tunnel-client` user. It should run `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. Back up the existing profile before switching; restart only `tunnel-client.service`, then run `tunnel-client doctor --profile yandex-mcp --profile-dir /etc/tunnel-client/profiles` and a remote ChatGPT tool call. Rollback restores the original profile and restarts only the Tunnel service. No MCP port, host route, DNS, firewall or interface change is needed.

## Security and rollback

All secrets are mounted from host files. `docker inspect` contains paths, not token values. The public image marker forces read-only even if environment variables are changed. The gateway suppresses write tools and rejects direct write calls. Pro writes require preview and confirmation; destructive calls require an exact tool-name confirmation and batches are capped at 50. Direct per-item Results are summarized, including partial failures. Network errors and 5xx are retried only for read/idempotent requests.

To rollback the new deployment, stop only `yandex-api-mcp-yandex-api-mcp-1` with `docker compose -p yandex-api-mcp -f /opt/yandex-api-mcp/compose.yandex-api-mcp.yml stop`. The old `/opt/yandex-mcp/` Compose and Tunnel are independent. Application backup files are under `/opt/yandex-mcp/backups/`. Do not alter Proxmox or LXC networking.
