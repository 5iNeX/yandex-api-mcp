# Session: unified yandex-api-mcp

## Completed

- Audited the webkoth TypeScript project and the existing Python fork; documented architecture options and current Yandex API endpoints.
- Created the `codex/yandex-api-mcp` branch, preserved the old project and imported the new core with MIT attribution.
- Added a unified MCP gateway, shared OAuth refresh, token-free projects, public read-only enforcement, Docker deployment and `yp-api` CLI.
- Built and tested locally: 284 Python tests, 23 TypeScript core tests, 2 gateway tests, Docker health and MCP SSE handshake.
- Deployed a parallel container to LXC 123 and tested real read calls for Direct, Metrika, Wordstat, Audience, Search API and partially Webmaster.
- Backed up the old deployment, prepared and tested a Tunnel candidate wrapper without switching the active Tunnel; no network configuration was changed.

## To Do

- Add `webmaster:verify` to the OAuth application after action-time owner approval, obtain fresh consent and re-run Webmaster host-level read probes.
- Switch the OpenAI Tunnel only after the new MCP passes all read checks and confirm with a ChatGPT tool call.
- Run a live refresh after the old deployment no longer depends on the same refresh token, or with a separate test OAuth application.
