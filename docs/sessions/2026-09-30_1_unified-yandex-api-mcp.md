# Session: unified yandex-api-mcp

## Completed

- Audited the webkoth TypeScript project and the existing Python fork; documented architecture options and current Yandex API endpoints.
- Created the `codex/yandex-api-mcp` branch, preserved the old project and imported the new core with MIT attribution.
- Added a unified MCP gateway, shared OAuth refresh, token-free projects, public read-only enforcement, Docker deployment and `yp-api` CLI.
- Built and tested locally: 288 Python tests, 23 TypeScript core tests, 4 gateway tests, Docker health and MCP SSE handshake.
- Closed the mixed Metrika Logs API `create` write bypass in public mode, disabled automatic retries for mutating Python Direct/Metrika/Audience/Logs actions, and classified mutating human-friendly Direct/Metrika tools in the gateway.
- Deployed a parallel container to LXC 123 and tested real read calls for Direct, Metrika, Wordstat, Audience, Search API and partially Webmaster.
- Backed up the old deployment, prepared and tested a Tunnel candidate wrapper without switching the active Tunnel; no network configuration was changed.
- Rebuilt only the new LXC 123 container with the Logs API safety fix. Confirmed 151 tools, healthy backends, live MCP rejection of Logs `create`/`clean`/`cancel`, and continued read access to Direct/Metrika/Wordstat/Audience/Search API.
- Checked the existing Webmaster workers for a different authorized token; they share the same token and host-summary reads still receive HTTP 403.
- After owner approval, reauthorized only the new deployment with `webmaster:verify`; a live OAuth refresh and full multi-service `yp-api verify` passed.
- Fixed mandatory `order_by` for Webmaster popular queries and the `/links/internal/broken/` routes. The expanded read-only Webmaster smoke passed 34/39 tools; five lacked safe existing IDs.
- Backed up and switched only the active Tunnel profile to the new MCP. The Tunnel is active and ready, the control-plane poll passed, and the old Direct container remains healthy.
- Verified `direct.list_clients` through the installed Yandex connector after cutover. The owner manually refreshed ChatGPT's Yandex app catalog and reports that the new tool is visible. A new ChatGPT conversation returned `3 — yandex_webmaster_hosts_list`; its UI did not expose the tool-call trace.

## To Do

- Inspect a post-refresh Webmaster tool-call trace through the installed ChatGPT Yandex app if the UI makes one available; its response has already been observed.
