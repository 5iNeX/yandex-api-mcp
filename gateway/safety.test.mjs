import test from "node:test";
import assert from "node:assert/strict";
import { allowedTool, guardCall, isWriteTool } from "./safety.mjs";

test("public build suppresses and blocks all known writes", () => {
  process.env.MCP_PUBLIC_READONLY = "true";
  process.env.MCP_EDITION = "public";
  for (const name of ["yandex_webmaster_hosts_delete", "yandex_direct_campaigns_manage", "yandex_metrika_logs_clean", "accounts.delete", "direct.hf.delete_ads", "direct.hf.clone_campaign", "direct.hf.bid_sweep_run", "metrica.goals.delete", "audience.raw_call"]) {
    assert.equal(isWriteTool(name), true);
    assert.equal(allowedTool({ name }), false);
    assert.throws(() => guardCall(name, { confirm: true }), /disabled/);
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
