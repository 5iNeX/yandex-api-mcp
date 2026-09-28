# Linux installer fork

## Completed

- Created the public `5iNeX/yandex-direct-metrica-mcp` fork from upstream v2.0.17, preserving Apache-2.0 attribution.
- Added a standalone Debian/Ubuntu installer with Russian `yp` commands, an empty registry, protected local credentials, independent provider discovery, backups and confirmed linking/removal.
- Added PKCE authorization, provider validation, MCP readiness rollback, protected candidate retry and expiry-aware refresh service/timer.
- Added optional outbound-only OpenAI Tunnel setup with HTTP/HTTPS CONNECT process proxy, a dedicated systemd user, `LoadCredential`, a fixed stdio sudo wrapper, and local health/doctor checks.
- Verified v0.0.15 configuration against official OpenAI tunnel-client source: proxy schemes are HTTP/HTTPS, not SOCKS.
- Added public-mode guards for destructive Metrica Logs clean/cancel operations and English/Russian guides.
- Local mocked regression suite: 280 tests passed. Installer lint, compile check, shell syntax and dry-run passed.
- Added isolated Docker runtime acceptance checks and Python 3.10/3.11/3.13 installer CI. These never call live provider APIs.
- No existing production deployment, customer registry, network route or authorization was changed or imported.

## To Do

- A new owner must supply and approve their own Yandex OAuth application and Direct API permissions, then verify their own APIs.
- A new owner must create and associate their own OpenAI Tunnel and runtime key, connect ChatGPT, and verify tools from that remote client.
- Public ChatGPT catalog distribution is a separate submission/review; this fork provides a private developer Tunnel connection.
- Automatic source upgrades and cross-platform server installers are outside this initial implementation.
