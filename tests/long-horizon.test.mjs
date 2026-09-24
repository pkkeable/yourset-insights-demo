import test from "node:test";
import assert from "node:assert/strict";
import { scenario, SCENARIOS } from "../src/scenarios.mjs";
import { analyze, dashboard } from "../src/metrics.mjs";
for (const days of [90, 180])
  for (const [id] of SCENARIOS)
    test(`${id}: ${days}-day view has actual equal-length histories`, () => {
      const data = scenario(id),
        a = analyze(data, days),
        d = dashboard(data, a);
      assert.equal(a.current.days, days);
      assert.equal(a.previous.days, days);
      assert.equal(a.current.weight.count, days);
      assert.equal(a.previous.weight.count, days);
      assert.equal(a.current.to, "2026-06-28");
      assert.equal(a.current.from, days === 90 ? "2026-03-31" : "2025-12-31");
      assert.equal(a.previous.from, days === 90 ? "2025-12-31" : "2025-07-04");
      assert.equal(
        new Set(
          [...a.current.weight.rows, ...a.previous.weight.rows].map(
            (r) => r.date,
          ),
        ).size,
        days * 2,
      );
      assert.equal(d.execution[0].actual, a.current.calories.mean);
      assert.equal(d.weight.slope, a.current.weight.slope);
      assert.equal(a.last7.weight.count, 7);
      assert.equal(a.recoveryWindow.from, "2026-06-01");
    });
test("long-window averages cannot hide the recent recovery constraint", () => {
  const a = analyze(scenario("recovery"), 180);
  assert(Math.abs(a.delta.sleep) < 0.75);
  assert(a.recoveryConcern);
  assert.equal(a.action, "defer");
  assert(dashboard(scenario("recovery"), a).next.includes("recovery"));
  assert(
    a.evidence
      .find((e) => e.title.includes("Recovery"))
      .detail.includes("latest 28-day check"),
  );
});
test("28 days remains default; original recent input values remain stable", () => {
  const a = analyze(scenario("weekends"));
  assert.equal(a.periodDays, 28);
  assert.equal(a.current.calories.mean, 2440);
  assert.equal(a.delta.calories, 160);
  assert.equal(a.current.lifts.count, 16);
  assert.equal(a.previous.calories.mean, 2280);
});
