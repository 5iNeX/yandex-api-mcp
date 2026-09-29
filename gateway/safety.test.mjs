import test from "node:test";
import assert from "node:assert/strict";
import { allowedTool, guardCall, isWriteCall, isWriteTool } from "./safety.mjs";

test("public build suppresses and blocks all known writes", () => {
  process.env.MCP_PUBLIC_READONLY = "true";
  process.env.MCP_EDITION = "public";
  for (const name of ["yandex_webmaster_hosts_delete", "yandex_direct_campaigns_manage", "yandex_metrika_logs_clean", "accounts.delete", "direct.hf.delete_ads", "direct.hf.clone_campaign", "direct.hf.bid_sweep_run", "metrica.goals.delete", "audience.raw_call"]) {
    assert.equal(isWriteTool(name), true);
    assert.equal(allowedTool({ name }), false);
    assert.throws(() => guardCall(name, { confirm: true }), /disabled/);
  }
});

test("human-friendly mutations are classified before forwarding", () => {
  for (const name of ["direct.hf.pause_ads", "direct.hf.set_campaign_budget", "direct.hf.apply_plan",
    "direct.hf.ensure_assets_for_campaign", "metrica.hf.create_goal", "metrica.hf.delete_goal",
    "audience.hf.apply_activation_plan", "join.hf.direct_vs_metrica_by_yclid"]) {
    assert.equal(isWriteTool(name), true, name);
  }
  for (const name of ["direct.hf.find_ads", "direct.hf.report_keywords", "metrica.hf.report_geo",
    "audience.hf.segment_health", "join.hf.direct_vs_metrica_by_utm"]) {
    assert.equal(isWriteTool(name), false, name);
  }
});

test("pro write preview, destructive confirmation, and batch cap", () => {
  process.env.MCP_PUBLIC_READONLY = "false";
  process.env.MCP_EDITION = "pro";
  assert.match(guardCall("yandex_webmaster_hosts_delete", { host_id: "x" }).content[0].text, /preview/);
  assert.throws(() => guardCall("yandex_webmaster_hosts_delete", { confirm: true }), /destructive_confirmation/);
  assert.equal(guardCall("yandex_webmaster_hosts_delete", { confirm: true, destructive_confirmation: "yandex_webmaster_hosts_delete" }), null);
  assert.throws(() => guardCall("yandex_direct_ads_manage", { confirm: true, params: { Ads: Array(51) } }), /50/);
});

test("Logs API mixed tool guards create, clean and cancel while retaining reads", () => {
  process.env.MCP_PUBLIC_READONLY = "true";
  process.env.MCP_EDITION = "public";
  assert.equal(allowedTool({ name: "metrica.logs_export" }), true);
  assert.equal(isWriteCall("metrica.logs_export", { action: "download" }), false);
  assert.equal(guardCall("metrica.logs_export", { action: "download" }), null);
  for (const action of ["create", "clean", "cancel", "CREATE"]) {
    assert.equal(isWriteCall("metrica.logs_export", { action }), true);
    assert.throws(() => guardCall("metrica.logs_export", { action, confirm: true }), /disabled/);
  }
  process.env.MCP_PUBLIC_READONLY = "false";
  process.env.MCP_EDITION = "pro";
  assert.match(guardCall("metrica.logs_export", { action: "create" }).content[0].text, /preview/);
  assert.throws(() => guardCall("metrica.logs_export", { action: "clean", confirm: true }), /destructive_confirmation/);
});
