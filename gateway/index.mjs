#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allowedTool, guardCall } from "./safety.mjs";
import { accessToken } from "../core/dist/oauth.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.env.YANDEX_EXTRA_ENV_FILE) process.loadEnvFile(process.env.YANDEX_EXTRA_ENV_FILE);
const expectedClose = new WeakSet();
const BACKENDS = [
  { id: "core", command: "node", args: [resolve(ROOT, "core/dist/index.js")] },
  { id: "services", command: process.env.YANDEX_PYTHON || "python3", args: ["-m", "mcp_yandex_ad"] }
];

function backendEnvironment() {
  const env = { ...process.env };
  if (env.YANDEX_OAUTH_FILE) {
    const auth = JSON.parse(readFileSync(env.YANDEX_OAUTH_FILE, "utf8"));
    if (env.YANDEX_OAUTH_APP_FILE) Object.assign(auth, JSON.parse(readFileSync(env.YANDEX_OAUTH_APP_FILE, "utf8")));
    if (auth.access_token) {
      env.YANDEX_OAUTH_TOKEN = auth.access_token;
      env.YANDEX_ACCESS_TOKEN = auth.access_token;
    }
    if (auth.refresh_token) env.YANDEX_REFRESH_TOKEN = auth.refresh_token;
    if (auth.client_id) env.YANDEX_CLIENT_ID = auth.client_id;
    if (auth.client_secret) env.YANDEX_CLIENT_SECRET = auth.client_secret;
  }
  if (env.YANDEX_PROJECTS_CONFIG) env.MCP_ACCOUNTS_FILE = env.YANDEX_PROJECTS_CONFIG;
  return env;
}

async function connectBackends() {
  const backends = [];
  const toolOwners = new Map();
  for (const spec of BACKENDS) {
    const client = new Client({ name: "yandex-api-mcp-gateway", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: spec.command, args: spec.args, env: backendEnvironment(), stderr: "inherit", cwd: ROOT
    });
    try {
      await client.connect(transport);
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) {
          if (!allowedTool(tool)) continue;
          if (toolOwners.has(tool.name)) throw new Error(`Duplicate MCP tool: ${tool.name}`);
          toolOwners.set(tool.name, { client, tool, backend: spec.id });
        }
        cursor = page.nextCursor;
      } while (cursor);
      const originalOnClose = transport.onclose;
      transport.onclose = () => {
        originalOnClose?.();
        if (!expectedClose.has(transport)) {
          console.error(`${spec.id}: backend exited; restarting gateway`);
          process.exit(1);
        }
      };
      backends.push({ ...spec, client, transport });
      console.error(`${spec.id}: ready`);
    } catch (error) {
      await transport.close().catch(() => {});
      console.error(`${spec.id}: unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (backends.length === 0 || (process.env.YANDEX_REQUIRE_ALL_BACKENDS === "true" && backends.length !== BACKENDS.length)) {
    for (const b of backends) { expectedClose.add(b.transport); await b.client.close().catch(() => {}); }
    throw new Error("Required MCP backends are unavailable");
  }
  return { backends, toolOwners };
}

function newServer(state) {
  const server = new Server({ name: "yandex-api-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...state.toolOwners.values()].map(({ tool }) => tool)
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const token = await accessToken();
    if (token !== state.token) await state.reconnect(token);
    const owner = state.toolOwners.get(params.name);
    if (!owner) throw new Error(`Unknown or disabled tool: ${params.name}`);
    const preview = guardCall(params.name, params.arguments || {});
    if (preview) return preview;
    const args = { ...params.arguments };
    delete args.destructive_confirmation;
    if (owner.backend === "core" && params.name.startsWith("yandex_webmaster_")) delete args.confirm;
    return owner.client.callTool({ ...params, arguments: args });
  });
  return server;
}

async function main() {
  const token = await accessToken();
  const initial = await connectBackends();
  let reconnecting = null;
  const state = { ...initial, token, reconnect: async (newToken) => {
    if (state.token === newToken) return;
    if (!reconnecting) reconnecting = (async () => {
      const old = state.backends;
      const next = await connectBackends();
      state.backends = next.backends;
      state.toolOwners = next.toolOwners;
      state.token = newToken;
      for (const b of old) { expectedClose.add(b.transport); await b.client.close().catch(() => {}); }
    })().finally(() => { reconnecting = null; });
    await reconnecting;
  } };
  const shutdown = () => { for (const b of state.backends) { expectedClose.add(b.transport); void b.client.close(); } };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  if (!process.argv.includes("--sse")) {
    await newServer(state).connect(new StdioServerTransport());
    return;
  }
  const sessions = new Map();
  const host = process.env.MCP_BIND_HOST || "127.0.0.1";
  const port = Number(process.env.MCP_PORT || "8001");
  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      if (url.pathname === "/healthz") {
        const healthy = state.backends.length === BACKENDS.length;
        res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", backends: state.backends.map((b) => b.id), tools: state.toolOwners.size }));
      } else if (url.pathname === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        sessions.set(transport.sessionId, transport);
        transport.onclose = () => sessions.delete(transport.sessionId);
        await newServer(state).connect(transport);
      } else if (url.pathname === "/messages" && req.method === "POST") {
        const transport = sessions.get(url.searchParams.get("sessionId"));
        if (!transport) { res.writeHead(404); res.end(); return; }
        await transport.handlePostMessage(req, res);
      } else { res.writeHead(404); res.end(); }
    } catch (error) {
      console.error("HTTP MCP error:", error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  http.listen(port, host, () => console.error(`Yandex API MCP listening on ${host}:${port}`));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
