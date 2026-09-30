# yandex-api-mcp

One read-only-by-default MCP server for Yandex Webmaster, Direct, Metrika, Wordstat, Audience, and Search API. It exposes a single MCP endpoint and supports multiple projects with one shared OAuth token.

See the [complete Russian setup guide](README.md) for Yandex OAuth application creation, permissions, Yandex Cloud keys, installation, projects, verification, and MCP clients.

## Quick start on Debian or Ubuntu

Install Docker Engine, Docker Compose v2, Python 3, and Git. Create a Yandex OAuth application with redirect URI `https://oauth.yandex.ru/verification_code` and the scopes you need: `webmaster:hostinfo` and `webmaster:verify`, `direct:api`, `metrika:read`, and `audience:read`. Direct production API access and account permissions must also be granted by Yandex/the account owner.

```bash
git clone https://github.com/5iNeX/yandex-api-mcp.git
cd yandex-api-mcp
sudo ./install.sh
sudo yp-api oauth
sudo yp-api service start
sudo yp-api doctor
sudo yp-api discover
```

The installer stores OAuth state in `/opt/yandex-api-mcp/state/` and application secrets in `/opt/yandex-api-mcp/secrets/`, outside Git and the image. It binds SSE only to `127.0.0.1:8001`. `yp-api verify` performs read-only live API probes.

Wordstat and Search API require a Yandex Cloud folder ID and an API key for a service account with `search-api.webSearch.user`. If key scopes are configured, include `yc.search-api.execute`. Put `YANDEX_SEARCH_API_FOLDER_ID` and `YANDEX_SEARCH_API_API_KEY` in `/opt/yandex-api-mcp/secrets/yandex.env`.

For local MCP clients, use stdio: `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. ChatGPT requires a separately created [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels); `yp-api` checks an existing Tunnel but does not create OpenAI credentials or the Tunnel automatically.

The default public image blocks writes. A separate pro build has guarded writes and is not published automatically. Project metadata is token-free, while access tokens refresh automatically when a refresh token is available. See [MIGRATION_REPORT.md](MIGRATION_REPORT.md) for live verification and deployment details. License: [Apache-2.0](LICENSE) with [MIT](core/LICENSE) TypeScript core.
