# Deploying yandex-api-mcp

The [README](../README.md) is the complete new-installation guide, covering Yandex OAuth, Search API credentials, project setup, and MCP clients. This page is an operations reference.

## Runtime

`sudo ./install.sh` copies the application to `/opt/yandex-api-mcp`. Docker Compose starts one public MCP container with both backends. SSE binds to `127.0.0.1:8001/sse` only. `state/oauth.json` stores the rotating access/refresh token; `state/projects.json` stores token-free project mappings. `secrets/oauth-app.json` and `secrets/yandex.env` hold application credentials and Search API keys outside Git and the image.

`yp-api oauth` requests `webmaster:hostinfo webmaster:verify direct:api metrika:read audience:read` by default. Wordstat and Search API need a separate Yandex Cloud folder ID and API key. Adding OAuth permissions requires a new authorization-code flow. Access tokens refresh automatically when a refresh token is available.

## Operations

```bash
sudo yp-api service status
sudo yp-api doctor
sudo yp-api discover
sudo yp-api project list
sudo yp-api verify
sudo yp-api logs --tail 80
```

`verify` performs live read calls. Optional Wordstat/Search API probes can fail until their Cloud credentials are configured. After changing project profiles, run `sudo yp-api service restart`.

## OpenAI Tunnel

Configure OpenAI Secure MCP Tunnel separately with your own Tunnel ID and runtime API key. Its MCP stdio command is `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. Use a systemd service with `Restart=always` because a temporary MCP subprocess exit can cause tunnel-client to exit successfully. Check `tunnel-client health --port 8080 --require-control-plane-poll --json` and refresh the installed ChatGPT application's tool catalog. See [OpenAI's official guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Updates and rollback

Back up protected `/opt/yandex-api-mcp/state/` and `secrets/` before updating. Pull a reviewed source revision, rerun `sudo ./install.sh`, then check `doctor` and `verify`. The installer preserves state and secrets. If rollback is needed, restore the previous image/source and only this application's configuration. Be careful with OAuth backups: the refresh token may have rotated since the backup. No routing, DNS, firewall, or host networking change is needed.
