# yandex-api-mcp

One MCP endpoint for Yandex Webmaster, Direct, Metrika, Wordstat, Audience and Search API. The default Docker build is public and read only. The TypeScript core derives from [webkoth/yandex-mcp](https://github.com/webkoth/yandex-mcp) (MIT); the Python adapter retains Wordstat, Audience, Search API and additional read tools from this repository.

On Debian/Ubuntu with Docker Engine, Compose v2 and Python 3, run `sudo ./install.sh`, then `sudo yp oauth`, `sudo yp service start`, and `sudo yp doctor`. If `yp` already belongs to an older installation, use `yp-api`. State and secrets live under `/opt/yandex-api-mcp/{state,secrets}` and are mounted into the container, never baked into the image. Compose binds SSE to `127.0.0.1:8001`.

OAuth scopes: Webmaster needs `webmaster:hostinfo webmaster:verify`; Direct needs `direct:api`; Metrika needs `metrika:read` (and `metrika:write` for uploads); Audience needs `audience:read`. Search API uses a separate folder ID and API key in `secrets/yandex.env`. Scope expansion requires a new authorization code; refresh cannot add scopes.

`yp project list|add|remove` manages a token-free project registry. `yp discover`, `yp verify`, `yp doctor`, `yp logs`, and `yp connector info` cover discovery and diagnostics. Project-aware Direct and Metrika tools accept an explicit `project` argument. The gateway runs TypeScript and Python MCP backends and merges their tools; token refresh is automatic and persisted.

Local MCP clients can run `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs` over stdio. ChatGPT can use OpenAI Tunnel after read-only API verification and OAuth scope completion. Deployment results, verified calls, limitations, rollback, and commands are in [MIGRATION_REPORT.md](MIGRATION_REPORT.md). Full setup details: [docs/unified-deployment.md](docs/unified-deployment.md).
