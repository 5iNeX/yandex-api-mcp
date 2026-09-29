import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessToken } from "../src/oauth.js";
import { getClient, initRegistry } from "../src/client.js";

test("expired shared OAuth token refreshes and persists rotated credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yandex-oauth-"));
  const file = join(dir, "oauth.json");
  const priorFetch = globalThis.fetch;
  process.env.YANDEX_OAUTH_FILE = file;
  writeFileSync(file, JSON.stringify({ access_token: "old", refresh_token: "refresh-old", client_id: "id",
    client_secret: "secret", issued_at: 1, expires_in: 1 }), { mode: 0o600 });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.match(String(init?.body), /grant_type=refresh_token/);
    return new Response(JSON.stringify({ access_token: "new", refresh_token: "refresh-new", expires_in: 3600 }), { status: 200 });
  };
  try {
    assert.equal(await accessToken(), "new");
    assert.equal(await accessToken(), "new");
    assert.equal(calls, 1);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.refresh_token, "refresh-new");
    assert.equal(saved.access_token, "new");
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.YANDEX_OAUTH_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Webmaster host paths preserve the Yandex host ID and 5xx GET is retried", async () => {
  const priorFetch = globalThis.fetch;
  process.env.YANDEX_OAUTH_TOKEN = "test";
  process.env.YANDEX_WEBMASTER_TOKEN = "webmaster";
  process.env.YANDEX_WEBMASTER_TOKEN_DISTINCT = "true";
  initRegistry();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "OAuth webmaster");
    if (path.endsWith("/v4/user")) return new Response('{"user_id":42}', { status: 200 });
    assert.match(path, /\/v4\/user\/42\/hosts\/https:example\.com:443\/summary$/);
    calls += 1;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    const result = await getClient().webmasterRequest("GET", "/hosts/{host_id}/summary", { hostId: "https:example.com:443" });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.YANDEX_WEBMASTER_TOKEN;
    delete process.env.YANDEX_WEBMASTER_TOKEN_DISTINCT;
    delete process.env.YANDEX_OAUTH_TOKEN;
  }
});

test("non-idempotent POST does not retry after 503", async () => {
  const priorFetch = globalThis.fetch;
  process.env.YANDEX_OAUTH_TOKEN = "test";
  initRegistry();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("unavailable", { status: 503 }); };
  try {
    await assert.rejects(() => getClient().request("POST", "/v4/host", { body: {} }), /503/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.YANDEX_OAUTH_TOKEN;
  }
});

test("public core blocks writes even when called without the gateway", async () => {
  process.env.MCP_EDITION = "public";
  process.env.MCP_PUBLIC_READONLY = "true";
  process.env.YANDEX_OAUTH_TOKEN = "test";
  initRegistry();
  try {
    await assert.rejects(() => getClient().webmasterRequest("DELETE", "/hosts/{host_id}", { hostId: "site" }), /disabled/);
    await assert.rejects(() => getClient().directRequest("campaigns", "update", {}), /disabled/);
    await assert.rejects(() => getClient().metrikaRequest("DELETE", "/management/v1/counter/1/goal/2"), /disabled/);
  } finally {
    delete process.env.MCP_EDITION;
    delete process.env.MCP_PUBLIC_READONLY;
    delete process.env.YANDEX_OAUTH_TOKEN;
  }
});

test("HTTP 401 refreshes once and retries the read with the new token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yandex-401-"));
  const file = join(dir, "oauth.json");
  const priorFetch = globalThis.fetch;
  process.env.YANDEX_OAUTH_FILE = file;
  writeFileSync(file, JSON.stringify({ access_token: "stale", refresh_token: "refresh", client_id: "id",
    client_secret: "secret", issued_at: Math.floor(Date.now() / 1000), expires_in: 3600 }), { mode: 0o600 });
  initRegistry();
  let apiCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth.yandex.ru/token")) {
      return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "refresh2", expires_in: 3600 }), { status: 200 });
    }
    apiCalls += 1;
    const auth = (init?.headers as Record<string, string>).Authorization;
    return auth === "OAuth stale" ? new Response("unauthorized", { status: 401 }) :
      new Response('{"ok":true}', { status: 200 });
  };
  try {
    assert.deepEqual(await getClient().request("GET", "/v4/user"), { ok: true });
    assert.equal(apiCalls, 2);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).refresh_token, "refresh2");
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.YANDEX_OAUTH_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP 429 on a read uses backoff and retries", async () => {
  const priorFetch = globalThis.fetch;
  process.env.YANDEX_OAUTH_TOKEN = "test";
  initRegistry();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("rate limit", { status: 429, headers: { "Retry-After": "0" } }) :
      new Response('{"ok":true}', { status: 200 });
  };
  try {
    assert.deepEqual(await getClient().request("GET", "/v4/user"), { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.YANDEX_OAUTH_TOKEN;
  }
});
