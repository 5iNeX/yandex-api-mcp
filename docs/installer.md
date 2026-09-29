# Linux installer (fork)

> This page covers the legacy Direct/Metrika installer. For the unified yandex-api-mcp, use [unified deployment](unified-deployment.md).

[Русская инструкция](ru/installer.md)

This fork of [georgy-agaev/yandex-direct-metrica-mcp](https://github.com/georgy-agaev/yandex-direct-metrica-mcp) adds a Russian terminal installer and project manager. The upstream MCP remains Apache-2.0. Each installation uses its own Yandex authorization and its own OpenAI Tunnel; the repository contains no deployment credentials or customer registry.

## Supported environment

- Debian 12/13 or Ubuntu 22.04/24.04, Python 3.10+, systemd.
- Linux amd64 or arm64, root/sudo, Docker Engine 28+ with the Compose plugin.
- VM, VPS, bare metal, or an LXC already capable of running Docker. For LXC, its administrator must enable the required nesting/container features. This installer does not provision Proxmox or change host/container networking.
- Outbound HTTPS to Yandex, package registries, GitHub and OpenAI. An existing HTTP/HTTPS CONNECT proxy can be used **only by tunnel-client**.

macOS/Windows users can still use upstream `scripts/setup.py` with their local MCP clients. This server installer is Linux-only.

## Install

```bash
git clone https://github.com/5iNeX/yandex-direct-metrica-mcp.git
cd yandex-direct-metrica-mcp
./install.sh --plan
sudo ./install.sh --install-deps
```

Review the checkout before running it as root. No `curl | sh` is required. `--install-deps` installs required distro packages and, when Docker is absent, configures the signed official Docker apt repository and installs Engine/Compose. It starts Docker and installs an official Compose plugin with SHA256 verification when a distro plugin is unavailable. A manually downloaded Compose plugin needs manual updates; see [Docker's instructions](https://docs.docker.com/compose/install/linux/).

Existing Docker installations are reused and never removed or automatically upgraded; Engine 28+ is required. If Docker/Compose are already configured, omit `--install-deps`. Use `--no-setup` to install files first and run `yp setup` later. An existing prefix or `yp` command causes the installer to stop rather than replace an installation. One global `yp` installation per Linux system is supported.

Default runtime: `/opt/yandex-mcp`. An alternative prefix is supported in a root-owned permanent directory, for example:

```bash
sudo ./install.sh --prefix /srv/yandex-mcp --port 8001 --install-deps
```

## Yandex authorization

The Russian wizard asks for Direct + Metrica, Direct only, or Metrica only. Audience is optional. Create **your own** Yandex OAuth application and configure its redirect URI. The default is `https://oauth.yandex.ru/verification_code`.

Enable only the needed permissions:

- Direct: `direct:api`, with production/full Direct API access approved for that application.
- Metrica: `metrika:read`.
- Audience (optional): `audience:read`.

Enter Client ID locally, then Client Secret through hidden input. Open the generated authorization URL in your browser and paste the confirmation code or complete redirect URL through hidden input. The installer uses an [authorization code with PKCE](https://www.yandex.ru/dev/id/doc/ru/codes/code-url), validates `state` when receiving a redirect URL, exchanges the code itself, and stores credentials locally with mode `0600`. The manual verification-code route does not return a browser callback to the installer; PKCE binds the exchange to its verifier.

An existing access token can also be entered locally. Without a refresh token, there is no automatic renewal.

Before activation, the selected provider APIs are tested. The MCP is then started and `tools/list` must pass. Previous configuration is backed up and restored on startup/readiness failure. A failed candidate stays in protected secrets, including a possibly rotated refresh token; use `yp resume` to retry. Revoking access in Yandex is a separate action; the installer never revokes the previous token.

A daily systemd timer checks token expiry, refreshing after at most 75 days or earlier near expiry. Imported access tokens do not get a refresh timer. API approval and access to delegated cabinets remain the owner's responsibility; the installer cannot grant them.

## Projects

```bash
yp                 # Russian project menu
yp --show          # current registry
yp --discover      # accessible new accounts/counters
yp --verify        # reload and check accounts.list
```

The initial registry is empty. Select what to add. Direct-only, Metrica-only and linked profiles are supported. Matching a Direct login to a counter is a suggestion requiring confirmation. Removing a profile changes only the local registry. Metrica discovery uses `offset/per_page` pagination and requests active counters.

`clients.get` does not enumerate every delegated Direct cabinet. Use **«Добавить Direct по известному логину»** if needed; access is checked using a read-only campaigns request. Do not expect every counter's owner to have a matching Direct login.

Registry backups live in `backups/`. Only one local `yp` operation can run at once. Persistent SSE and tunnel stdio processes share the same registry; SSE is explicitly reloaded and stdio refreshes it by file modification time.

## OpenAI Tunnel / ChatGPT

```bash
yp tunnel
yp doctor
yp connector
```

The wizard first checks HTTPS reachability to `api.openai.com`. Then it asks for **your own** tunnel ID and runtime API key (Tunnels Read + Use), after you associate the tunnel with your ChatGPT workspace and OpenAI organization. Do not enter an organization admin API key. See [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

The official tunnel-client is copied from an existing installation or downloaded from its latest GitHub release with SHA256 verification. The profile uses environment references. Secrets are supplied to its dedicated systemd user through `LoadCredential`, not embedded in the unit file. The user is not added to the Docker group; a sudo rule allows only a root-owned fixed stdio wrapper without arguments.

An optional HTTP/HTTPS CONNECT proxy is passed only to tunnel-client. **v0.0.15 rejects SOCKS URLs**; if your existing infrastructure exposes only SOCKS, provide an HTTP CONNECT bridge outside this installer. The main gateway and Yandex traffic are unchanged; no VPN is created. Ambient proxy variables are cleared from the stdio wrapper and are never injected into the MCP container.

MCP binds to `127.0.0.1:8000`; health/UI binds to loopback, default port 8080. The health port must be free. No public ports, domain, TLS termination or inbound firewall exceptions are needed.

`doctor` checks local SSE and stdio `tools/list`, the registry, tunnel `/healthz`, `/readyz`, and `tunnel-client doctor`. These local checks do not prove that a remote ChatGPT workspace is connected. Use the developer-mode app flow from the official docs, select **Connection: Tunnel**, enter your tunnel ID, and ask ChatGPT to call `accounts.list` or list the tools. UI labels may vary with the account/workspace. Workspace administrator policy and developer-mode availability apply.

This is a private developer connection. A public listing in the ChatGPT plugin catalog is a separate submission/review.

## Operations and recovery

| Command | Purpose |
| --- | --- |
| `yp setup` | Continue initial setup |
| `yp oauth` | Reauthorize Yandex and test the candidate |
| `yp resume` | Retry a protected saved OAuth candidate |
| `yp refresh` | Refresh if due (also run by the timer) |
| `yp doctor` | Local MCP/tunnel diagnostics |
| `yp connector` | Show your tunnel ID and ChatGPT connection steps |

Service names use the Compose project name (default `yandex-mcp`):

```bash
sudo systemctl status yandex-mcp-tunnel-yandex-mcp.service
sudo systemctl list-timers yandex-mcp-refresh-yandex-mcp.timer
sudo docker compose --project-name yandex-mcp --file /opt/yandex-mcp/compose.yaml ps
```

Do not publish `docker compose config`, `docker inspect`, secret files or environment dumps: they can contain credentials. Protected backups contain previous credentials; retain them locally and remove them according to your backup policy. The installer does not erase your data or implement unattended upgrades. Keep the reviewed checkout and runtime backup; source updates require an explicit maintenance procedure.

## Scope and verification

The default server is the public read-only edition. Direct/Metrica and optional Audience are configured by this wizard. Wordstat/Search API credentials, Webmaster adapters, private PRO plugins and an intelligence layer are outside this installer. Existing upstream configuration paths remain available.

Tests mock providers and service management; CI never calls live Yandex/OpenAI APIs. `python3 scripts/installer_smoke.py` builds an isolated runtime with a fixture token, checks Compose, SSE/stdio `tools/list`, registry reload and destructive Logs guards, then removes its containers. It requires Docker. No real credentials are used. A fresh user's OAuth, production permissions, tunnel runtime key and remote ChatGPT association must be verified on that user's installation.
