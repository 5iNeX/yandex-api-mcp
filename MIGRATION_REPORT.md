# Migration report: yandex-api-mcp

Date: 2026-09-30. Implementation commit: `ceac3044120acf9c9af3c61b4b2171836865f9ba`. The final documentation/deployment commit SHA is reported in the delivery response; a commit cannot contain its own SHA without changing it.

GitHub: [new yandex-api-mcp repository](https://github.com/5iNeX/yandex-api-mcp), with the reviewed `codex/yandex-api-mcp` branch; the same branch is pushed to the original fork and has a [draft PR](https://github.com/5iNeX/yandex-direct-metrica-mcp/pull/1). Neither repository's existing main branch was merged.

## Architecture and reason

`webkoth/yandex-mcp` is the main TypeScript core for Webmaster, Direct and Metrika. The prior Python server is retained as a read-oriented MCP adapter for Wordstat, Audience, Search API and additional Direct/Metrika tools. A Node gateway exposes one stdio/SSE MCP endpoint and merges `tools/list` and `tools/call`. This avoids rewriting working clients. [Technical audit and alternatives](docs/audit-2026-09-30.md).

The fork's Linux installer, `yp` concept, Docker deployment and OpenAI Tunnel integration were adapted. The new name is `yandex-api-mcp` in package metadata, MCP server identification, Docker image and documentation. Historic Python entry points remain as compatibility aliases. The public image stays read-only; pro image publishing is manual-only.

## Implemented services

- **Webmaster:** retained webkoth hosts, verification, summary, SQI history, queries and analytics, indexing/history/archive, URLs/events, sitemaps, recrawl/quota, diagnostics, links, Pro export and feeds. Public gateway hides all mutating tools.
- **Direct:** clients/agency `Client-Login`, sandbox, campaigns, adgroups, ads, keywords, bids, bid modifiers, reports, Units/quota, partial failure summary. Pro writes have preview and confirmation.
- **Metrika:** counters/goals/segments/filters, reporting, Logs API, offline conversions, expenses, CRM/orders and calls; uploads are pro-only.
- **Wordstat, Audience, Search API:** preserved from the Python project and exposed through the same gateway.
- **OAuth:** one shared state file and token-free project registry. Access token refresh occurs before expiry or after 401, writes atomically to persistent state and reconnects child processes. The Python adapter also retains its own in-process refresh behavior. Separate Webmaster token is opt-in with `YANDEX_WEBMASTER_TOKEN_DISTINCT=true` if a different OAuth application is genuinely needed.
- **Safety:** public image marker and gateway block API writes. Core client also blocks writes at its API boundary. Non-idempotent writes are not retried on 429/5xx/network errors, including Python Direct, Metrika Management, Audience and Logs API mutations. Pro destructive calls require an exact tool-name confirmation and batches are capped at 50.
- **Logs API:** the mixed `metrica.logs_export` tool permits read actions in public mode. `create`, `clean` and `cancel` are denied in both gateway and Python backend; pro calls require preview/confirmation, and these actions are not retried automatically.

## Tests and live verification

| Check | Result |
|---|---|
| `pytest -q` | 288 passed |
| `npm run build && npm test` | 23 TypeScript core + 4 gateway tests passed |
| `npm audit --omit=dev` in core and gateway | 0 vulnerabilities after lockfile update |
| Local Docker build and health | Pass, both backends ready |
| Remote MCP initialize, tools/list, tool call via SSE | Pass; 151 public tools |
| Remote stdio through prepared Tunnel sudo wrapper | Pass; initialize and 151 tools |
| Remote Docker health | Pass, `127.0.0.1:8001/healthz` |
| Deployed public Logs API guard | Pass: live MCP calls with `create`, `clean`, `cancel` were blocked before provider access |
| Docker restart and reconnection | Pass; both backends and 151 tools returned after restart |
| Public mode with pro environment overrides | Pass; TypeScript and Python API guards remained read-only |
| Draft PR CI | Seven checks passed, including Docker smoke, Python/Node tests and lint |
| Direct clients, campaigns, adgroups, ads, keywords | Pass with campaign SelectionCriteria where required |
| Direct report | Pass, actual TSV returned |
| Metrika counters, goals, Reporting API | Pass |
| Wordstat top requests | Pass |
| Audience segments list | Pass |
| Search API SERP read | Pass |
| Webmaster read-only smoke | 34 of 39 tools passed through the deployed MCP; five status/get tools skipped for absent task/request IDs or a user sitemap |
| Webmaster query and internal-link fixes | Required `order_by` and `/links/internal/broken/` paths verified against live API |
| OAuth refresh | Mocked rotation/401 tests and live refresh of the new token passed; full API probe passed afterward |
| OpenAI Tunnel new target | Active profile switched; service active, `/healthz` and `/readyz` 200, control-plane poll succeeded |
| ChatGPT app tool catalog | Still lists the old Direct/Metrika tools; separate "Update tools" UI action is pending owner confirmation |

Endpoint paths were compared with current official Webmaster documentation (see audit). No destructive Yandex API call was made.

## Proxmox deployment

- Proxmox host: `Porx.m01`; existing LXC **123**, `yandex-mcp`, Debian 13, 2 cores, 2560 MiB RAM, onboot enabled. Existing network configuration was only read, never changed.
- Existing deployment: `/opt/yandex-mcp`, `compose-direct-1` on loopback port 8000, an existing Webmaster container, `tunnel-client.service`, and `yandex-oauth-refresh.timer`. All remain in place.
- New parallel deployment: `/opt/yandex-api-mcp`, container `yandex-api-mcp-yandex-api-mcp-1`, image `local/yandex-api-mcp:0.1.0`, Compose project `yandex-api-mcp`, loopback port **8001**. Container restart policy `unless-stopped`, read-only root filesystem, non-root UID 10001, dropped capabilities, state and secrets mounted from host files.
- Observed steady memory use was about **132 MiB**. `docker inspect` contains no OAuth token, client secret or Search API key values; port 8001 is published only on `127.0.0.1`.
- New CLI: `/usr/local/bin/yp-api` (old `/bin/yp` preserved). Tunnel wrapper: `/usr/local/libexec/yandex-api-mcp-stdio`; narrow sudoers entry for `tunnel-client`. Active profile `/etc/tunnel-client/profiles/yandex-mcp.yaml` points to the new wrapper. The old profile was backed up before the switch.
- No Proxmox host, LXC, VPN, routing, firewall, DNS, bridge, interface or proxy configuration was modified. No reboot or network service restart occurred. MCP is not publicly exposed.

## OAuth and Webmaster verification

The existing OAuth application **Hermes Reports** originally lacked `webmaster:verify`. The owner added and saved that permission. The application UI then showed both Webmaster permissions. A fresh OAuth consent used the existing scopes plus `webmaster:verify`; the new access/refresh pair was written only to `/opt/yandex-api-mcp/state/oauth.json` after a live Webmaster summary probe succeeded. The previous new-deployment state is backed up under `/opt/yandex-api-mcp/backups/`. The token exchange response omitted a `scope` field, so the state records the requested scopes; access was verified through Webmaster, Direct, Metrika and Audience API calls. The new refresh token differs from the old token. A live `yp-api refresh` and full `yp-api verify` succeeded afterward.

The seven running legacy Webmaster worker containers were checked without printing their environment. Before reauthorization, their `YANDEX_WEBMASTER_TOKEN` was identical to the old token and host summary returned HTTP 403. They and the old Direct deployment were not changed; a read-only Direct clients probe from the old container still passed after the new token was refreshed.

The first full smoke found two inherited webkoth route/parameter defects. Popular queries omitted mandatory `order_by`; broken internal links omitted the `/broken/` path segment. Both were corrected and verified through the live API. The repeatable script `scripts/webmaster-live-check.mjs` covered all 39 exposed read-only Webmaster tools: 34 succeeded, and five were skipped because their required task/request IDs or a user sitemap were absent. No write was used to create test fixtures.

## Commands

```bash
# On LXC 123
sudo yp-api doctor
sudo yp-api verify
sudo yp-api project list
sudo yp-api discover
sudo yp-api service status
sudo yp-api logs --tail 80
cd /opt/yandex-api-mcp && docker compose -p yandex-api-mcp -f docker-compose.yml ps
curl http://127.0.0.1:8001/healthz

# Active Tunnel health
sudo /usr/local/bin/tunnel-client health --port 8080 --require-control-plane-poll --json
```

## Backup and rollback

A pre-migration backup of old Compose/config/secrets/state/Tunnel files is at `/opt/yandex-mcp/backups/pre-unified-20260929T195000Z.tar.gz` (root-only). The active Tunnel profile backup is `/opt/yandex-api-mcp/backups/tunnel-before-cutover-20260930T053554Z.yaml`; OAuth backups are in the same root-only directory. The old deployment remains running. To rollback, restore the old profile and restart **only** Tunnel, then stop **only** the new Compose project:

```bash
cp /opt/yandex-api-mcp/backups/tunnel-before-cutover-20260930T053554Z.yaml /etc/tunnel-client/profiles/yandex-mcp.yaml
systemctl restart tunnel-client.service
cd /opt/yandex-api-mcp
docker compose -p yandex-api-mcp -f docker-compose.yml stop
```

The old `compose-direct-1` and old Webmaster services still run. Do not alter Proxmox networking.

## Remaining limits

The installed ChatGPT Yandex application's static tool catalog remains from the old MCP. A ChatGPT prompt asking for the Webmaster host count returned `0` without a visible tool call, so it is **not** evidence of end-to-end Webmaster access through ChatGPT. The settings page offers "Update tools"; that action is pending action-time owner confirmation because it expands the app's access to the new 151-tool catalog. The tunnel itself is ready and its stdio command starts the new core and Python adapter. Existing website/tool documents outside the new README may still describe the legacy Direct/Metrika-only distribution; the new deployment docs are authoritative for this branch.
