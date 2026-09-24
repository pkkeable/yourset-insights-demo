import test from "node:test";
import assert from "node:assert/strict";
import { scenario, SCENARIOS } from "../src/scenarios.mjs";
import {
  analyze,
  windowMetrics,
  slope,
  localDate,
  decide,
  editPlan,
  planAt,
  reassess,
  latestRevisions,
} from "../src/metrics.mjs";
for (const [id] of SCENARIOS)
  test(`scenario ${id}: deterministic metric and narrative consistency`, () => {
    const d = scenario(id),
      a = analyze(d);
    assert.deepEqual(d, scenario(id));
    assert.equal(a.current.days, 28);
    assert.equal(a.previous.to, "2026-05-31");
    assert.equal(a.current.from, "2026-06-01");
    assert.equal(a.whole.weight.rows.length, 28);
    assert.equal(a.latestWeight, a.whole.weight.rows.at(-1).value);
    assert.equal(
      a.netWeight,
      a.whole.weight.rows.at(-1).value - a.whole.weight.rows[0].value,
    );
    if (a.slowdown)
      assert(a.evidence[0].detail.includes(a.current.weight.slope.toFixed(2)));
  });
test("slowdown compares fits rather than last weigh-in", () => {
  const d = scenario("slowdown");
  assert.equal(analyze(d).slowdown, true);
  const s = scenario("working");
  s.records.find((r) => r.id === "weight-27").value += 0.15;
  assert.equal(analyze(s).slowdown, false);
});
test("weekend arithmetic includes 5 weekdays and 2 weekend days", () => {
  const a = analyze(scenario("weekends"));
  assert.equal(a.current.calories.weeks[0].mean, (2280 * 5 + 2840 * 2) / 7);
  assert.equal(a.current.calories.mean, 2440);
  assert.equal(a.current.calories.targetVariance, 160);
  assert.equal(a.delta.calories, 160);
});
test("reduced steps explains observation without calorie conversion", () => {
  const a = analyze(scenario("steps"));
  assert(a.delta.steps < -2400);
  const e = a.evidence.find((e) => e.title === "Recorded movement is lower");
  assert.equal(e.type, "plausible_explanation");
  assert(!e.detail.includes("kcal"));
});
test("strength during cut preserves mixed goals", () => {
  const a = analyze(scenario("strength"));
  assert.equal(a.delta.strength, 5);
  assert.equal(a.action, "continue_unchanged");
  assert(a.netWeight < 0);
});
test("attendance cannot conceal missing lower-body exposure", () => {
  const a = analyze(scenario("lower"));
  assert.equal(a.current.lifts.count, 16);
  assert.equal(a.current.lifts.lower, 0);
  assert.equal(a.missingLower, true);
  assert.equal(a.action, "investigate");
});
test("poor recovery withholds routine adjustment suggestions", () => {
  const a = analyze(scenario("recovery"));
  assert(a.recoveryConcern);
  assert.equal(a.action, "defer");
  assert(!("readiness" in a));
});
test("missing weekends suppress full-period intake but retain weight", () => {
  const a = analyze(scenario("gaps"));
  assert.equal(a.current.calories.count, 20);
  assert.equal(a.current.calories.days, 28);
  assert.equal(a.current.calories.mean, 2280);
  assert.equal(a.current.calories.weeks[0].mean, null);
  assert(!a.complete);
  assert(a.current.weight.slope !== null);
  assert(!a.recoveryKnown);
});
test("equipment substitution creates boundary without fabricated progress", () => {
  const a = analyze(scenario("substitution"));
  assert.equal(a.delta.strength, null);
  assert.equal(a.action, "collect_missing_evidence");
  assert.equal(a.whole.lifts.rows.length, 48);
});
test("no-action scenario actually leaves plan unchanged", () =>
  assert.equal(analyze(scenario("working")).action, "continue_unchanged"));
test("plan changes do not rewrite target adherence", () => {
  const d = scenario("weekends"),
    before = analyze(d);
  const changed = editPlan(d, {
    effective: d.clock,
    calories: 2400,
    protein: 160,
    reason: "user entered",
  });
  assert.equal(changed.plans.length, 2);
  assert.equal(
    analyze(changed).current.calories.targetVariance,
    before.current.calories.targetVariance,
  );
  assert.equal(planAt(changed.plans, "2026-06-14").calories, 2280);
  assert.throws(() =>
    editPlan(d, {
      effective: "2026-06-12",
      calories: 2400,
      protein: 160,
      reason: "retroactive",
    }),
  );
});
test("decision snapshots preserve revisions when source gets corrected", () => {
  const d = scenario(),
    a = analyze(d);
  const dec = decide(d, a, {
    choice: "accept",
    effective: d.clock,
    review: "2026-07-13",
  });
  const old = dec.evidence[0].value;
  d.records[0].value = 99;
  d.plans[0].calories = 1900;
  assert.equal(dec.evidence[0].value, old);
  assert.equal(dec.originalPlans[0].calories, 2280);
  assert.equal(reassess(dec, d).status, "awaiting_observations");
});
test("all decision choices are validated and explicit edit requires reason", () => {
  const d = scenario(),
    a = analyze(d);
  for (const choice of [
    "accept",
    "defer",
    "reject",
    "continue_unchanged",
    "edit",
  ])
    assert.equal(
      decide(d, a, {
        choice,
        reason: "review",
        effective: d.clock,
        review: "2026-07-13",
      }).choice,
      choice,
    );
  assert.throws(() =>
    decide(d, a, { choice: "edit", effective: d.clock, review: "2026-07-13" }),
  );
  assert.throws(() =>
    decide(d, a, {
      choice: "accept",
      effective: d.clock,
      review: "2026-06-01",
    }),
  );
});
test("followup partitions later execution and preserves original advice", () => {
  const d = scenario("followup"),
    before = {
      ...d,
      clock: "2026-06-15",
      records: d.records.filter((r) => r.date < "2026-06-15"),
    };
  const dec = decide(before, analyze(before), {
    choice: "edit",
    reason: "movement consistency",
    effective: "2026-06-15",
    review: "2026-06-29",
  });
  const r = reassess(dec, d);
  assert.equal(r.status, "review_due");
  assert.equal(r.execution.days, 14);
  assert.equal(r.execution.calories.count, 14);
  assert(r.caution.includes("do not establish"));
  assert.equal(dec.analysis.asOf, "2026-06-15");
});
test("source revision idempotency, corrections and removal", () => {
  const a = { id: "1", writer: "x", revision: 1, value: 2 },
    b = { ...a, revision: 2, value: 3 };
  assert.equal(latestRevisions([a, a, b, a])[0].value, 3);
  assert.equal(
    latestRevisions([a, b, { ...b, revision: 3, removed: true }]).length,
    0,
  );
});
test("zero remains valid; missing source does not become zero", () => {
  const d = scenario();
  for (const r of d.records) if (r.kind === "steps") r.value = 0;
  assert.equal(analyze(d).current.steps.mean, 0);
  d.records = d.records.filter((r) => r.kind !== "steps");
  assert.equal(analyze(d).current.steps.mean, null);
});
test("overlapping step writers are not summed", () => {
  const d = scenario(),
    before = analyze(d).current.steps.mean;
  d.records.push(
    ...d.records
      .filter((r) => r.kind === "steps")
      .map((r) => ({ ...r, writer: "Mirror" })),
  );
  assert.equal(analyze(d).current.steps.mean, before);
});
test("date windows exclude provisional today and boundaries align", () => {
  const d = scenario();
  d.records.push({ ...d.records[0], id: "today", date: d.clock, value: 999 });
  const a = analyze(d);
  assert.equal(a.whole.weight.count, 28);
  assert.equal(windowMetrics(d, "2026-06-14", "2026-06-15").weight.count, 2);
});
test("local dates handle DST and cross-midnight without double conversion", () => {
  assert.equal(
    localDate("2026-03-08T07:59:00Z", "America/Los_Angeles"),
    "2026-03-07",
  );
  assert.equal(
    localDate("2026-03-08T10:01:00Z", "America/Los_Angeles"),
    "2026-03-08",
  );
  assert.equal(
    localDate("2026-11-01T09:30:00Z", "America/Los_Angeles"),
    "2026-11-01",
  );
});
test("OLS uses calendar spacing, not row indices; sparse data stays unknown", () => {
  const rows = [0, 2, 5, 9].map((i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    value: 90 - i * 0.1,
  }));
  assert(Math.abs(slope(rows) + 0.7) < 1e-10);
  assert.equal(slope(rows.slice(0, 3)), null);
});
test("sparse waist cannot imply a supported composition trend", () => {
  const a = analyze(scenario());
  assert.equal(a.whole.waist.count, 2);
  assert(
    a.limitations.some((x) => x.includes("waist observations are sparse")),
  );
});
test("a comparable strength decline is not labeled stable or plan working", () => {
  const d = scenario("working");
  for (const r of d.records)
    if (r.kind === "lift" && r.date >= "2026-06-01") r.load -= 5;
  const a = analyze(d);
  assert.equal(a.delta.strength, -5);
  assert.equal(a.action, "investigate");
  assert(a.evidence.some((e) => e.title === "Comparable strength declined"));
});
test("movement exposure counts unique sessions rather than individual sets", () => {
  const d = scenario("working");
  const existing = d.records.find(
    (r) => r.kind === "lift" && r.date === "2026-06-15",
  );
  d.records.push({ ...existing, id: "second-set" });
  assert.equal(analyze(d).current.lifts.lower, 16);
});
test("multiple decisions retain independent historical snapshots", async () => {
  const { appendDecision } = await import("../src/metrics.mjs");
  const d = scenario(),
    a = analyze(d);
  let history = [];
  const first = decide(d, a, {
    choice: "defer",
    effective: d.clock,
    review: "2026-07-13",
  });
  first.id = "first";
  history = appendDecision(history, first);
  const next = { ...first, id: "second", choice: "accept" };
  history = appendDecision(history, next);
  first.reason = "changed after save";
  assert.equal(history.length, 2);
  assert.equal(history[0].reason, "");
  assert.equal(history[0].choice, "defer");
  assert.throws(() => appendDecision(history, next));
});
test("loading follow-up adds only new dates and unique sessions on each step", async () => {
  const { addSyntheticFollowup } = await import("../src/scenarios.mjs");
  let d = scenario("followup");
  const decision = { effective: "2026-06-15" };
  d = addSyntheticFollowup(d, decision);
  assert.equal(d.clock, "2026-07-13");
  assert.equal(analyze(d).current.weight.rows.length, 28);
  assert.equal(analyze(d).whole.lifts.count, 16);
  d = addSyntheticFollowup(d, decision);
  assert.equal(d.clock, "2026-07-27");
  assert.equal(analyze(d).current.weight.rows.length, 28);
  assert.equal(analyze(d).whole.lifts.count, 16);
});
