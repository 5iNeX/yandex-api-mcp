#!/usr/bin/env node
// Read-only end-to-end probe. Output is limited to status and response shape.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const url = new URL(process.env.MCP_URL || "http://127.0.0.1:8001/sse");
const client = new Client({ name: "yandex-api-mcp-live-check", version: "0.1.0" });
const results = [];

function dataFrom(result) {
  const text = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "";
  try { return JSON.parse(text); } catch { return text; }
}

async function probe(name, args = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const data = dataFrom(result);
    const error = result.isError || (data && typeof data === "object" && (data.error || data.error_code));
    const record = { tool: name, status: error ? "api_error" : "ok" };
    if (!error && data && typeof data === "object") record.shape = Object.keys(data).slice(0, 10);
    if (error) {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      record.detail = message.replace(/(?:Bearer|OAuth)\s+\S+/gi, "[AUTH REDACTED]")
        .replace(/(?:access_token|refresh_token|client_secret)[^,\s}]*/gi, "[REDACTED]")
        .replace(/https?:[^\s]+/g, "[URL]").slice(0, 220);
    }
    results.push(record);
    return error ? null : data;
  } catch (error) {
    results.push({ tool: name, status: "failed", error_type: error?.constructor?.name || "Error",
      detail: String(error?.message || "").replace(/https?:[^\s]+/g, "[URL]").slice(0, 180) });
    return null;
  }
}

try {
  await client.connect(new SSEClientTransport(url));
  const tools = (await client.listTools()).tools;
  results.push({ tool: "mcp.initialize+tools/list", status: "ok", tool_count: tools.length });
  const has = (name) => tools.some((t) => t.name === name);
  const projects = await probe("yandex_projects_list");
  const project = projects?.active || projects?.projects?.[0]?.id;
  const hosts = await probe("yandex_webmaster_hosts_list");
  const host = hosts?.hosts?.[0]?.host_id || hosts?.hosts?.[0]?.hostId;
  if (host) {
    for (const name of ["yandex_webmaster_summary_get", "yandex_webmaster_diagnostics_get",
      "yandex_webmaster_search_queries_popular", "yandex_webmaster_indexing_history",
      "yandex_webmaster_sitemaps_list", "yandex_webmaster_links_external_samples",
      "yandex_webmaster_recrawl_quota"]) await probe(name, { host_id: host });
  } else results.push({ tool: "webmaster.host-dependent", status: "skipped_no_host" });

  const directArgs = { project, field_names: ["Id"], page: { Limit: 1, Offset: 0 } };
  let campaignId;
  for (const name of ["yandex_direct_clients_get", "yandex_direct_campaigns_get",
    "yandex_direct_adgroups_get", "yandex_direct_ads_get", "yandex_direct_keywords_get"]) {
    const args = name.endsWith("clients_get") ? { project, field_names: ["Login"] } :
      name.endsWith("campaigns_get") ? directArgs :
      { ...directArgs, selection_criteria: { CampaignIds: [campaignId] } };
    if (args.selection_criteria && !campaignId) { results.push({ tool: name, status: "skipped_no_campaign" }); continue; }
    const response = await probe(name, args);
    if (name.endsWith("campaigns_get")) campaignId = response?.result?.result?.Campaigns?.[0]?.Id ?? response?.result?.Campaigns?.[0]?.Id;
  }
  if (has("yandex_direct_report")) await probe("yandex_direct_report", { project, max_polls: 1,
    report: { SelectionCriteria: {}, FieldNames: ["Date", "CampaignId", "Impressions", "Clicks", "Cost"],
      ReportName: `yandex-api-mcp-check-${Date.now()}`, ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
      DateRangeType: "YESTERDAY", Format: "TSV", IncludeVAT: "NO", IncludeDiscount: "NO" } });

  const counters = await probe("yandex_metrika_counters_list", { project });
  const counter = counters?.counters?.[0]?.id || projects?.projects?.[0]?.metrica_counter_ids?.[0];
  if (counter) {
    await probe("yandex_metrika_goals_list", { project, counter_id: Number(counter) });
    await probe("yandex_metrika_stat_data", { project, ids: String(counter), metrics: "ym:s:visits", date1: "yesterday", date2: "yesterday" });
  } else results.push({ tool: "metrika.counter-dependent", status: "skipped_no_counter" });

  for (const [name, args] of [
    ["wordstat.top_requests", { phrase: "маркетинг", num_phrases: 5 }],
    ["audience.segments.list", { limit: 1, offset: 0 }],
    ["search_serp", { query: "Яндекс", n_results: 5, include_raw: false }]
  ]) if (has(name)) await probe(name, args);
} finally {
  await client.close().catch(() => {});
}

console.log(JSON.stringify(results, null, 2));
if (results.some((x) => x.status === "failed" || x.status === "api_error")) process.exitCode = 1;
