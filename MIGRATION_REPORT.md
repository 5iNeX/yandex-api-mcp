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
| `pytest -q` | 290 passed after live agent report fixes |
| `npm run build && npm test` | 23 TypeScript core + 4 gateway tests passed |
| `npm audit --omit=dev` in core and gateway | 0 vulnerabilities after lockfile update |
| Local Docker build and health | Pass, both backends ready |
| Remote MCP initialize, tools/list, tool call via SSE | Pass; 151 public tools |
| Remote stdio through prepared Tunnel sudo wrapper | Pass; initialize and 151 tools |
| Remote Docker health | Pass, `127.0.0.1:8001/healthz` |
| Deployed public Logs API guard | Pass: live MCP calls with `create`, `clean`, `cancel` were blocked before provider access |
| Docker restart and reconnection | Pass; both backends and 151 tools returned after restart |
| Public mode with pro environment overrides | Pass; TypeScript and Python API guards remained read-only |
| Draft PR and new-repository CI | Pass, including Docker smoke, Python/Node tests and installer matrix |
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
| ChatGPT app tool catalog | Owner manually updated the installed Yandex app's tools; a new ChatGPT conversation returned `3` and named `yandex_webmaster_hosts_list`, though its UI did not expose the underlying tool-call trace |
| Installed Yandex app read call | `direct.list_clients` succeeded through the connector after Tunnel cutover |
| Agent report incident retest | Metrika geo city and time-series reads, Direct campaign report, and Direct adextensions list passed through the installed Yandex connector after repair |

Endpoint paths were compared with current official Webmaster documentation (see audit). No destructive Yandex API call was made.

## Proxmox deployment

- Proxmox host: `Porx.m01`; existing LXC **123**, `yandex-mcp`, Debian 13, 2 cores, 2560 MiB RAM, onboot enabled. Existing network configuration was only read, never changed.
- Existing deployment: `/opt/yandex-mcp`, `compose-direct-1` on loopback port 8000, an existing Webmaster container, `tunnel-client.service`, and `yandex-oauth-refresh.timer`. All remain in place.
- New parallel deployment: `/opt/yandex-api-mcp`, container `yandex-api-mcp-yandex-api-mcp-1`, image `local/yandex-api-mcp:0.1.0`, Compose project `yandex-api-mcp`, loopback port **8001**. Container restart policy `unless-stopped`, read-only root filesystem, non-root UID 10001, dropped capabilities, state and secrets mounted from host files.
- Observed steady memory use was about **132 MiB**. `docker inspect` contains no OAuth token, client secret or Search API key values; port 8001 is published only on `127.0.0.1`.
- New CLI: `/usr/local/bin/yp-api` (old `/bin/yp` preserved). Tunnel wrapper: `/usr/local/libexec/yandex-api-mcp-stdio`; narrow sudoers entry for `tunnel-client`. Active profile `/etc/tunnel-client/profiles/yandex-mcp.yaml` points to the new wrapper. The old profile was backed up before the switch.
- `tunnel-client.service` now uses `Restart=always`: its previous `Restart=on-failure` did not recover when an interrupted stdio command caused the Tunnel to exit successfully during a new-container recreate. Only this application unit was edited and reloaded; the prior unit is backed up under `/opt/yandex-api-mcp/backups/`.
- No Proxmox host, LXC, VPN, routing, firewall, DNS, bridge, interface or proxy configuration was modified. No reboot or network service restart occurred. MCP is not publicly exposed.

## OAuth and Webmaster verification

The existing OAuth application **Hermes Reports** originally lacked `webmaster:verify`. The owner added and saved that permission. The application UI then showed both Webmaster permissions. A fresh OAuth consent used the existing scopes plus `webmaster:verify`; the new access/refresh pair was written only to `/opt/yandex-api-mcp/state/oauth.json` after a live Webmaster summary probe succeeded. The previous new-deployment state is backed up under `/opt/yandex-api-mcp/backups/`. The token exchange response omitted a `scope` field, so the state records the requested scopes; access was verified through Webmaster, Direct, Metrika and Audience API calls. The new refresh token differs from the old token. A live `yp-api refresh` and full `yp-api verify` succeeded afterward.

The seven running legacy Webmaster worker containers were checked without printing their environment. Before reauthorization, their `YANDEX_WEBMASTER_TOKEN` was identical to the old token and host summary returned HTTP 403. They and the old Direct deployment were not changed; a read-only Direct clients probe from the old container still passed after the new token was refreshed.

The first full smoke found two inherited webkoth route/parameter defects. Popular queries omitted mandatory `order_by`; broken internal links omitted the `/broken/` path segment. Both were corrected and verified through the live API. The repeatable script `scripts/webmaster-live-check.mjs` covered all 39 exposed read-only Webmaster tools: 34 succeeded, and five were skipped because their required task/request IDs or a user sitemap were absent. No write was used to create test fixtures.

## Live agent report incident, 2026-09-30

Tunnel logs showed two `metrica.hf.report_geo` failures (`ym:s:geoCity`, API code 4001), two `metrica.hf.report_time_series` failures (bare `visits`, API code 4002), one `direct.report` invalid request, and one `direct.list_adextensions` invalid request. The Metrika geo preset used unsupported dimensions; it now uses the documented `ym:s:regionCity` and `ym:s:regionCountry`. The time-series preset now accepts `visits`, `users`, and `pageviews` as aliases for full Metrika metric names. The Python Direct report builder now always includes the required `SelectionCriteria` object and defaults the period to `YESTERDAY` when no dates are supplied. An explicit live Direct report before repair exposed the missing `SelectionCriteria` detail. `direct.list_adextensions` worked with default arguments on a live account; the earlier invalid request depended on the agent's supplied arguments, which were not logged. Invalid Metrika HF metrics now return a structured error instead of a connector output-validation failure.

After backing up `server.py` and `hf_metrica.py` to `/opt/yandex-api-mcp/backups/report-fix-20260930/`, only the new image/container was rebuilt and recreated. The active Tunnel exited cleanly when its stdio subprocess was interrupted, and systemd did not restart it under the old policy. Its unit was backed up to `/opt/yandex-api-mcp/backups/tunnel-client-before-restart-policy-20260930.service`, changed to `Restart=always`, reloaded, and started. Final `yp-api doctor` and Tunnel ready/control-plane-poll checks passed. A live post-repair connector retest succeeded for the four report/list calls named above; no write API call was made. To revert this incident, restore the backed-up application files and unit, rebuild/recreate only the new Compose service, and restart only `tunnel-client.service`.

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

The owner manually refreshed the installed ChatGPT Yandex application's tool catalog and reports that the new tool appears. In a new ChatGPT conversation using that app, a read-only prompt for the Webmaster host count returned `3 — yandex_webmaster_hosts_list`. The ChatGPT UI displayed the result but no underlying tool-call trace, so this is client-level response evidence rather than an independently inspected invocation log. The earlier pre-refresh prompt returned `0` without a visible tool call and is superseded. A read-only `direct.list_clients` call through the installed connector succeeded after Tunnel cutover. The tunnel itself is ready and its stdio command starts the new core and Python adapter. Existing website/tool documents outside the new README may still describe the legacy Direct/Metrika-only distribution; the new deployment docs are authoritative for this branch.
