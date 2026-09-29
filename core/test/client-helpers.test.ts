import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthHeader, directBaseUrl, buildDirectPayload } from "../src/client.js";

test("buildAuthHeader formats OAuth and Bearer", () => {
  assert.equal(buildAuthHeader("OAuth", "T"), "OAuth T");
  assert.equal(buildAuthHeader("Bearer", "T"), "Bearer T");
});

test("directBaseUrl switches on sandbox flag", () => {
  assert.equal(directBaseUrl(false), "https://api.direct.yandex.com/json/v5");
  assert.equal(directBaseUrl(true), "https://api-sandbox.direct.yandex.com/json/v5");
});

test("buildDirectPayload wraps method and params", () => {
  assert.equal(buildDirectPayload("get", { a: 1 }), '{"method":"get","params":{"a":1}}');
});
