# Session: standalone README and onboarding

## Completed

- Replaced the root README with a complete Russian first-install guide for the new yandex-api-mcp repository, without links to the previous project.
- Documented Yandex OAuth app creation, scopes, Direct access, separate Yandex Cloud credentials for Wordstat/Search API, installation, projects, live verification, local MCP clients, and ChatGPT Tunnel limits.
- Updated the English overview and both current deployment guides to describe the new product rather than one machine's migration.
- Corrected `yp-api oauth` to record requested scopes when the token response omits them, removed the inaccurate Wordstat OAuth mapping, and made an unconfigured Tunnel optional in `yp-api doctor`.
- Added focused CLI tests for scope persistence, Wordstat-only OAuth guidance, and the optional Tunnel diagnostic.
- Backed up and updated only the installed `yp-api` script in LXC 123. Live `yp-api doctor` and `yp-api connector info` passed without restarting MCP or Tunnel.

## To Do

- A new user's OpenAI Secure MCP Tunnel must be created and authorized in that user's own OpenAI workspace; `yp-api` does not provision OpenAI credentials or a Tunnel.
