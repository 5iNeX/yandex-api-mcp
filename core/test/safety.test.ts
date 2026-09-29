import { test } from "node:test";
import assert from "node:assert/strict";
import { pctChange, checkLimits, buildDiff, summarizeResults, weekendWarning } from "../src/direct/safety.js";

test("pctChange computes absolute percent change", () => {
  assert.equal(pctChange(100, 130), 30);
  assert.equal(pctChange(100, 40), 60);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(0, 5), Infinity);
});

test("checkLimits flags budget and bid changes over the limit", () => {
  const limits = { max_budget_change_pct: 30, max_bid_change_pct: 50 };
  const violations = checkLimits(
    [
      { field: "DailyBudget", kind: "budget", current: 100, proposed: 200 },
      { field: "Bid", kind: "bid", current: 10, proposed: 12 },
    ],
    limits
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, "DailyBudget");
});

test("buildDiff returns only changed fields", () => {
  const diff = buildDiff({ a: 1, b: 2 }, { a: 1, b: 5, c: 9 });
  assert.deepEqual(diff, [
    { field: "b", current: 2, proposed: 5 },
    { field: "c", current: undefined, proposed: 9 },
  ]);
});

test("weekendWarning fires Fri-Sun in Moscow time and stays silent Mon-Thu", () => {
  // 2026-07-03 is a Friday; UTC 22:00 Thu = 01:00 Fri in Moscow (UTC+3)
  assert.match(weekendWarning(new Date("2026-07-03T12:00:00+03:00")) ?? "", /Fri/);
  assert.match(weekendWarning(new Date("2026-07-04T12:00:00+03:00")) ?? "", /Sat/);
  assert.match(weekendWarning(new Date("2026-07-05T12:00:00+03:00")) ?? "", /Sun/);
  assert.equal(weekendWarning(new Date("2026-06-29T12:00:00+03:00")), null); // Monday
  assert.equal(weekendWarning(new Date("2026-07-02T12:00:00+03:00")), null); // Thursday
  assert.match(weekendWarning(new Date("2026-07-02T22:30:00Z")) ?? "", /Fri/); // Thu UTC, already Fri in MSK
});

test("summarizeResults reports per-item errors from Direct write results", () => {
  const response = {
    result: {
      AddResults: [
        { Id: 1 },
        { Errors: [{ Code: 6000, Message: "Inconsistent object" }] },
        { Id: 2, Warnings: [{ Code: 10151, Message: "Already suspended" }] },
      ],
    },
  };
  const s = summarizeResults(response);
  assert.equal(s?.operation, "AddResults");
  assert.equal(s?.total, 3);
  assert.equal(s?.succeeded, 2);
  assert.equal(s?.failed, 1);
  assert.equal(s?.warnings, 1);
  assert.equal(s?.itemErrors[0].index, 1);
  assert.equal(summarizeResults({ result: {} }), null);
  assert.equal(summarizeResults(null), null);
});
