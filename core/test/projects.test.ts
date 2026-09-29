import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegistry, ProjectRegistry } from "../src/projects.js";

function makeReg() {
  return new ProjectRegistry(parseRegistry({ projects: [{ id: "a", token: "1" }, { id: "b", token: "2" }] }));
}

test("parseRegistry falls back to a default project from env token", () => {
  const projects = parseRegistry(null, "ENV_TOKEN");
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, "default");
  assert.equal(projects[0].token, "ENV_TOKEN");
  assert.equal(projects[0].direct.sandbox, false);
  assert.equal(projects[0].direct.limits.max_budget_change_pct, 30);
});

test("parseRegistry reads projects and applies direct defaults", () => {
  const raw = { projects: [{ id: "a", token: "T", direct: { sandbox: true } }] };
  const projects = parseRegistry(raw, undefined);
  assert.equal(projects[0].id, "a");
  assert.equal(projects[0].direct.sandbox, true);
  assert.equal(projects[0].direct.client_login, null);
  assert.equal(projects[0].direct.limits.max_bid_change_pct, 50);
});

test("parseRegistry accepts a shared token and rejects entries without id", () => {
  assert.equal(parseRegistry({ projects: [{ id: "a" }] }, undefined)[0].token, undefined);
  assert.throws(() => parseRegistry({ projects: [{ token: "t" }] }, undefined), /id/);
});

test("parseRegistry rejects duplicate ids", () => {
  const raw = { projects: [{ id: "a", token: "1" }, { id: "a", token: "2" }] };
  assert.throws(() => parseRegistry(raw, undefined), /Duplicate project id/);
});

test("parseRegistry throws when nothing is configured", () => {
  assert.throws(() => parseRegistry(null, undefined), /No projects configured/);
});

test("ProjectRegistry defaults active to the first project", () => {
  const reg = makeReg();
  assert.equal(reg.active, "a");
  assert.deepEqual(reg.list().map((p) => p.id), ["a", "b"]);
});

test("ProjectRegistry.setActive switches and validates", () => {
  const reg = makeReg();
  reg.setActive("b");
  assert.equal(reg.active, "b");
  assert.throws(() => reg.setActive("zzz"), /Unknown project/);
});

test("ProjectRegistry.resolve returns explicit or active project", () => {
  const reg = makeReg();
  assert.equal(reg.resolve().id, "a");
  assert.equal(reg.resolve("b").id, "b");
  assert.throws(() => reg.resolve("zzz"), /Unknown project/);
});

test("ProjectRegistry rejects an empty project list", () => {
  assert.throws(() => new ProjectRegistry([]), /at least one project/);
});
