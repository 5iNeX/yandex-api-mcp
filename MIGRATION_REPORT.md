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
- **Safety:** public image marker and gateway block API writes. Core client also blocks writes at its API boundary. Non-idempotent writes are not retried on 429/5xx/network errors. Pro destructive calls require an exact tool-name confirmation and batches are capped at 50.

## Tests and live verification

| Check | Result |
|---|---|
| `pytest -q` | 282 passed |
| `npm run build && npm test` | 23 TypeScript core + 2 gateway tests passed |
| `npm audit --omit=dev` in core and gateway | 0 vulnerabilities after lockfile update |
| Local Docker build and health | Pass, both backends ready |
| Remote MCP initialize, tools/list, tool call via SSE | Pass; 151 public tools |
| Remote stdio through prepared Tunnel sudo wrapper | Pass; initialize and 151 tools |
| Remote Docker health | Pass, `127.0.0.1:8001/healthz` |
| Direct clients, campaigns, adgroups, ads, keywords | Pass with campaign SelectionCriteria where required |
| Direct report | Pass, actual TSV returned |
| Metrika counters, goals, Reporting API | Pass |
| Wordstat top requests | Pass |
| Audience segments list | Pass |
| Search API SERP read | Pass |
| Webmaster hosts list and external link samples | Pass |
| Webmaster summary, diagnostics, queries, indexing, sitemaps, recrawl quota | **Blocked by OAuth scope** (details below) |
| OAuth refresh | Mocked rotation/401 tests passed; no forced live refresh (old deployment shares token) |
| OpenAI Tunnel new target | Candidate profile `tunnel-client doctor` passed; active profile intentionally unchanged |

Endpoint paths were compared with current official Webmaster documentation (see audit). No destructive Yandex API call was made.

## Proxmox deployment

- Proxmox host: `Porx.m01`; existing LXC **123**, `yandex-mcp`, Debian 13, 2 cores, 2560 MiB RAM, onboot enabled. Existing network configuration was only read, never changed.
- Existing deployment: `/opt/yandex-mcp`, `compose-direct-1` on loopback port 8000, an existing Webmaster container, `tunnel-client.service`, and `yandex-oauth-refresh.timer`. All remain in place.
- New parallel deployment: `/opt/yandex-api-mcp`, container `yandex-api-mcp-yandex-api-mcp-1`, image `local/yandex-api-mcp:0.1.0`, Compose project `yandex-api-mcp`, loopback port **8001**. Container restart policy `unless-stopped`, read-only root filesystem, non-root UID 10001, dropped capabilities, state and secrets mounted from host files.
- New CLI: `/usr/local/bin/yp-api` (old `/bin/yp` preserved). Prepared Tunnel wrapper: `/usr/local/libexec/yandex-api-mcp-stdio`; narrow sudoers entry added for `tunnel-client`. Candidate profile: `/opt/yandex-api-mcp/tunnel-candidate.yaml`; active profile not changed.
- No Proxmox host, LXC, VPN, routing, firewall, DNS, bridge, interface or proxy configuration was modified. No reboot or network service restart occurred. MCP is not publicly exposed.

## OAuth blocker and required scope

The existing OAuth application **Hermes Reports** and its current token request `webmaster:hostinfo` but not `webmaster:verify`. The app settings visibly show only the external-links permission for Webmaster. The current token's scopes include `audience:read`, `direct:api`, `webmaster:hostinfo`, `appmetrica:read`, `passport:business`, and `metrika:read`. Yandex replies to host-level reads with `ACCESS_FORBIDDEN: Required scope: COMMON, application scopes: [ALL_SCOPES, HOST_LIST, EXTERNAL_LINKS]`. Official Webmaster authorization docs require `webmaster:hostinfo` **and** `webmaster:verify`. The endpoint paths match the official reference; this is an OAuth rights issue, not a transport or network error.

Adding `webmaster:verify` in the browser expands application permissions and requires action-time owner approval under the browser confirmation policy. The setting was selected on the edit form but **not saved** while approval is pending. After approval, save the application setting, obtain a new OAuth authorization code/consent (refresh alone cannot add scopes), replace the *new deployment's* OAuth state, and repeat `yp-api verify`. Keep the old token and old deployment intact until verification. The new Tunnel may be switched only after those checks pass.

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

# Prepared Tunnel candidate (does not change active Tunnel)
sudo tunnel-client doctor --profile-file /opt/yandex-api-mcp/tunnel-candidate.yaml
```

## Backup and rollback

A pre-migration backup of old Compose/config/secrets/state/Tunnel files is at `/opt/yandex-mcp/backups/pre-unified-20260929T195000Z.tar.gz` (root-only). New deployment copies the old OAuth and registry into `/opt/yandex-api-mcp/{state,secrets}`; originals were not deleted. To rollback, stop **only** the new Compose project:

```bash
cd /opt/yandex-api-mcp
docker compose -p yandex-api-mcp -f docker-compose.yml stop
```

The old `compose-direct-1`, old Webmaster service and active Tunnel still run. If Tunnel is later switched, restore its backed-up profile and restart only `tunnel-client.service`. Do not alter Proxmox networking.

## Remaining limits

A live OAuth refresh was deliberately not forced while old and new installations share the refresh token; automated refresh was tested with mocks. The new Tunnel-to-ChatGPT path is prepared and locally tested but not switched because Webmaster host-level reads are blocked. Existing website/tool documents outside the new README may still describe the legacy Direct/Metrika-only distribution; the new deployment docs are authoritative for this branch.
