#!/usr/bin/env node
// Read-only Webmaster MCP smoke. Logs status and response shape, never payloads.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const client = new Client({ name: "yandex-api-mcp-webmaster-check", version: "0.1.0" });
const results = [];
const data = new Map();

function safeDetail(value) {
  return String(value).replace(/https?:[^\s]+/g, "[URL]")
    .replace(/(?:Bearer|OAuth)\s+\S+/gi, "[AUTH REDACTED]").slice(0, 150);
}

async function probe(name, args = {}) {
  try {
    const response = await client.callTool({ name, arguments: args });
    const body = response.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
    let payload;
    try { payload = JSON.parse(body); } catch { payload = body; }
    if (response.isError || payload?.error || (typeof payload === "string" && /^HTTP [45]\d\d/.test(payload))) {
      results.push({ name, status: "error", detail: safeDetail(payload?.error?.message || body) });
      return null;
    }
    results.push({ name, status: "ok", keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 6) : [] });
    data.set(name, payload);
    return payload;
  } catch (error) {
    results.push({ name, status: "error", detail: safeDetail(error?.message || error) });
    return null;
  }
}

function skip(name, reason) { results.push({ name, status: "skip", reason }); }

try {
  await client.connect(new SSEClientTransport(new URL(process.env.MCP_URL || "http://127.0.0.1:8001/sse")));
  const tools = (await client.listTools()).tools.filter((tool) => tool.name.startsWith("yandex_webmaster_"));
  const definitions = new Map(tools.map((tool) => [tool.name, tool]));
  const hosts = await probe("yandex_webmaster_hosts_list");
  const host_id = hosts?.hosts?.[0]?.host_id;
  await probe("yandex_webmaster_user_get");
  if (!host_id) throw new Error("No accessible Webmaster host for the read-only smoke");
  const fixtures = {};
  for (const name of ["yandex_webmaster_search_queries_popular", "yandex_webmaster_sitemaps_list",
    "yandex_webmaster_sitemaps_user_list", "yandex_webmaster_important_urls_list",
    "yandex_webmaster_recrawl_list", "yandex_webmaster_feeds_list"]) {
    fixtures[name] = await probe(name, { host_id, limit: 1 });
  }
  const ids = {
    query_id: fixtures.yandex_webmaster_search_queries_popular?.queries?.[0]?.query_id,
    sitemap_id: fixtures.yandex_webmaster_sitemaps_list?.sitemaps?.[0]?.sitemap_id,
    url: fixtures.yandex_webmaster_important_urls_list?.urls?.[0]?.url,
  };
  for (const [name, tool] of definitions) {
    if (results.some((item) => item.name === name)) continue;
    const required = tool.inputSchema?.required || [];
    const args = { host_id };
    let missing = null;
    for (const key of required) {
      if (key === "host_id") continue;
      if (key === "sitemap_id" && name === "yandex_webmaster_sitemaps_user_get") {
        args[key] = fixtures.yandex_webmaster_sitemaps_user_list?.sitemaps?.[0]?.sitemap_id;
      } else if (key in ids) args[key] = ids[key];
      if (args[key] === undefined) missing = key;
    }
    if (missing) { skip(name, `no ${missing} fixture`); continue; }
    if (tool.inputSchema?.properties?.limit) args.limit = 1;
    await probe(name, args);
  }
  for (const result of results) console.log(JSON.stringify(result));
  console.log(JSON.stringify({ summary: { total: tools.length, ok: results.filter((x) => x.status === "ok").length,
    skipped: results.filter((x) => x.status === "skip").length,
    errors: results.filter((x) => x.status === "error").length } }));
  if (results.some((x) => x.status === "error")) process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
