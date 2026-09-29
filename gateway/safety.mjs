import { readFileSync } from "node:fs";

const WRITE_NAMES = new Set([
  "yandex_webmaster_hosts_add", "yandex_webmaster_hosts_delete",
  "yandex_webmaster_verification_start", "yandex_webmaster_sitemaps_add",
  "yandex_webmaster_sitemaps_delete", "yandex_webmaster_recrawl_submit",
  "yandex_webmaster_recrawl_sitemap_submit", "yandex_webmaster_feeds_add",
  "yandex_webmaster_feeds_batch_add", "yandex_webmaster_feeds_batch_delete",
  "yandex_webmaster_feeds_change_regions", "yandex_webmaster_indexing_archive_create",
  "yandex_webmaster_pro_export_start", "yandex_metrika_logs_request_create",
  "yandex_metrika_logs_clean", "yandex_metrika_expenses_upload",
  "yandex_metrika_crm_orders_upload", "yandex_metrika_calls_upload",
  "yandex_metrika_offline_conversions_upload", "yandex_metrika_goal_add",
  "yandex_metrika_goal_update", "yandex_metrika_goal_delete"
]);

const DESTRUCTIVE_NAMES = new Set([
  "yandex_webmaster_hosts_delete", "yandex_webmaster_sitemaps_delete",
  "yandex_webmaster_feeds_batch_delete", "yandex_metrika_logs_clean",
  "yandex_metrika_goal_delete"
]);

export function isWriteTool(name) {
  return WRITE_NAMES.has(name) || /^yandex_direct_.*_(?:manage|set)$/.test(name) ||
    /^(?:accounts\.(?:upsert|delete)|auth\.|write\.confirm|project\.(?:add|remove))/.test(name) ||
    /^direct\.(?:create_|update_|raw_call)/.test(name) ||
    /^(?:metrica|audience)\.(?:raw_call|goals\.(?:create|update|delete)|segments\.(?:create|update|delete))$/.test(name) ||
    /^audience\.upload\.start$/.test(name) ||
    (name.startsWith("direct.hf.") && !/^direct\.hf\.(?:find_|get_|report_|pressure_report$|plan_changes$|bid_sweep_(?:plan|analyze)$)/.test(name)) ||
    (name.startsWith("metrica.hf.") && !/^metrica\.hf\.(?:list_accessible_counters$|counter_summary$|report_|logs_export_preset$)/.test(name)) ||
    (name.startsWith("audience.hf.") && name === "audience.hf.apply_activation_plan") ||
    name === "join.hf.direct_vs_metrica_by_yclid";
}

export function isWriteCall(name, args = {}) {
  return isWriteTool(name) ||
    (name === "metrica.logs_export" && ["create", "clean", "cancel"].includes(String(args.action || "").toLowerCase()));
}

export function isDestructiveTool(name) {
  return DESTRUCTIVE_NAMES.has(name) || /\.(?:delete|delete_ads|delete_keywords|clear_bid_modifiers|delete_goal)$/.test(name) ||
    /^direct\.hf\.(?:archive|unarchive)_/.test(name);
}

export function isPublicReadOnly() {
  try { if (readFileSync("/app/.mcp_edition", "utf8").trim() === "public") return true; } catch {}
  return process.env.MCP_PUBLIC_READONLY !== "false" || process.env.MCP_EDITION !== "pro";
}

export function allowedTool(tool) {
  return !isPublicReadOnly() || !isWriteTool(tool.name);
}

export function guardCall(name, args = {}) {
  if (isPublicReadOnly() && isWriteCall(name, args)) throw new Error("Write operation disabled by public/read-only policy");
  if (!isWriteCall(name, args)) return null;
  if (args.confirm !== true) {
    return { content: [{ type: "text", text: JSON.stringify({ preview: true, tool: name, arguments: args, note: "No API mutation performed. Call again with confirm:true to execute." }) }] };
  }
  const destructive = isDestructiveTool(name) ||
    (name === "metrica.logs_export" && ["clean", "cancel"].includes(String(args.action || "").toLowerCase())) ||
    /^(Delete|Archive|Suspend)$/i.test(String(args.method || ""));
  if (destructive && args.destructive_confirmation !== name) {
    throw new Error(`Destructive operation requires destructive_confirmation: ${name}`);
  }
  const batch = Object.values(args.params || {}).find((v) => Array.isArray(v));
  if (Array.isArray(batch) && batch.length > 50) throw new Error("Batch write limit is 50 items");
  if (/^yandex_direct_(?:campaigns_manage|bids_set)$/.test(name) && !Array.isArray(args.money_deltas)) {
    throw new Error("Budget or bid write requires explicit money_deltas for limit checks");
  }
  return null;
}
