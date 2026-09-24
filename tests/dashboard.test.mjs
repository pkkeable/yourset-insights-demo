import test from "node:test";
import assert from "node:assert/strict";
import {
  scenario,
  SCENARIOS,
  addSyntheticFollowup,
} from "../src/scenarios.mjs";
import { analyze, dashboard, decide, reviewState } from "../src/metrics.mjs";

for (const [id] of SCENARIOS)
  test(`dashboard ${id}: complete answer model and numerical identity`, () => {
    const data = scenario(id),
      a = analyze(data),
      d = dashboard(data, a);
    assert(d.headline && d.next && d.caveat && d.strengthSummary);
    assert.equal(d.execution.length, 5);
    assert.equal(d.recovery.length, 3);
    assert.equal(d.weight.latest, a.latestWeight);
    assert(Number.isFinite(d.weight.latest));
    assert.equal(d.weight.mean7, a.last7.weight.mean);
    assert.equal(d.weight.slope, a.current.weight.slope);
    assert.equal(d.execution[0].actual, a.current.calories.mean);
    assert.equal(d.execution[0].versusPlan, a.current.calories.targetVariance);
    assert.equal(d.execution[0].versusPrior, a.delta.calories);
    assert.equal(d.execution[3].actual, a.current.lifts.count);
    assert.equal(d.execution[4].actual, a.current.aerobic.count);
    assert.equal(d.recovery[0].delta, a.delta.sleep);
    assert.equal(
      a.strengthCounts.improving +
        a.strengthCounts.stable +
        a.strengthCounts.declining +
        a.strengthCounts.unknown,
      a.strengthKeys.length,
    );
    assert(d.priorities.length <= 3);
  });
test("default has 56 real synthetic calendar days, including all prior weekdays", () => {
  const data = scenario("weekends"),
    a = analyze(data),
    d = dashboard(data, a);
  assert.equal(a.previous.from, "2026-05-04");
  assert.equal(a.previous.to, "2026-05-31");
  assert.equal(a.current.from, "2026-06-01");
  assert.equal(a.current.to, "2026-06-28");
  assert.equal(a.previous.weight.count, 28);
  assert.equal(a.current.weight.count, 28);
  assert.equal(d.execution[0].actual, 2440);
  assert.equal(d.execution[0].target, 2280);
  assert.equal(d.execution[3].target, 16);
  assert.equal(d.execution[4].target, 4);
  assert.equal(d.weekend.count, 8);
  assert.equal(d.weekend.weekdayCount, 20);
  assert.equal(d.weekend.delta, 560);
});
test("14-day selection computes real aligned periods rather than relabeling", () => {
  const data = scenario("weekends"),
    a = analyze(data, 14),
    d = dashboard(data, a);
  assert.equal(a.previous.from, "2026-06-01");
  assert.equal(a.current.from, "2026-06-15");
  assert.equal(d.execution[0].versusPrior, 0);
  assert.equal(d.execution[0].versusPlan, 160);
  assert.equal(d.execution[3].target, 8);
  assert.equal(d.execution[4].target, 2);
  assert.equal(d.weekend.count, 4);
  assert.throws(() => analyze(data, 21));
});
test("historical calorie and protein target changes use eligible-day targets", () => {
  const data = scenario("weekends");
  data.plans.push({
    ...data.plans[0],
    id: "p2",
    effective: "2026-06-15",
    calories: 2380,
    protein: 165,
  });
  const a = analyze(data),
    d = dashboard(data, a),
    energy = d.execution[0],
    protein = d.execution[1];
  assert.equal(energy.target, 2330);
  assert.equal(energy.versusPlan, 110);
  assert.equal(energy.versusPrior, 160);
  assert.equal(energy.targets.length, 2);
  assert.equal(energy.eligibleDays, 28);
  assert.equal(protein.target, 160);
  assert(Math.abs(protein.versusPlan - (protein.actual - 160)) < 1e-9);
});
test("unconfigured dates do not create historical target adherence", () => {
  const data = scenario();
  data.plans[0].effective = null;
  const d = dashboard(data, analyze(data));
  assert.equal(d.execution[0].eligibleDays, 0);
  assert.equal(d.execution[0].versusPlan, null);
  assert.equal(d.execution[1].floorEligibleDays, 0);
  assert.equal(d.execution[3].target, null);
  assert(!d.next.includes("Return to"));
});
test("missing weekends and empty measures preserve unknown rather than zero", () => {
  const data = scenario("gaps");
  data.records = data.records.filter(
    (r) => !["waist", "steps"].includes(r.kind),
  );
  const a = analyze(data),
    d = dashboard(data, a);
  assert.equal(d.weekend.count, 0);
  assert.equal(d.weekend.mean, null);
  assert.equal(d.weekend.delta, null);
  assert.equal(d.execution[0].count, 20);
  assert.equal(d.execution[0].actual, 2280);
  assert.equal(d.execution[2].actual, null);
  assert.equal(d.recovery[0].current, null);
  assert.equal(a.current.waist.count, 0);
  assert.equal(a.weightRangeState, "unconfigured");
});
test("stale recovery with ample historical coverage cannot reassure or restore execution", () => {
  const data = scenario("slowdown");
  data.records = data.records.filter(
    (r) => !["sleep", "rhr", "hrv"].includes(r.kind) || r.date < "2026-06-25",
  );
  const a = analyze(data),
    d = dashboard(data, a);
  assert(a.current.sleep.count >= 7);
  assert.equal(a.recoveryKnown, false);
  assert(d.recovery.every((r) => r.stale));
  assert(d.next.includes("recent recovery"));
  assert(!d.next.includes("Return to"));
});
test("absent weight prevents a continue-unchanged trend claim", () => {
  const data = scenario("working");
  data.records = data.records.filter((r) => r.kind !== "weight");
  const a = analyze(data),
    d = dashboard(data, a);
  assert.equal(d.weight.latest, null);
  assert.equal(d.weight.slope, null);
  assert.equal(a.action, "collect_missing_evidence");
  assert(d.next.includes("weight observations"));
});
test("mixed strength directions remain visible even when average load is unchanged", () => {
  const data = scenario("working");
  for (const r of data.records)
    if (r.kind === "lift" && r.date >= "2026-06-01") {
      if (r.exercise === "Seated cable row") r.load += 5;
      if (r.exercise === "Chest press") r.load -= 5;
    }
  const a = analyze(data),
    d = dashboard(data, a);
  assert.equal(a.delta.strength, 0);
  assert.equal(a.strengthCounts.declining, 1);
  assert.equal(a.strengthCounts.improving, 1);
  assert.equal(a.strengthCounts.stable, 1);
  assert.equal(a.action, "investigate");
  assert(d.headline.includes("declined"));
  assert(d.next.includes("declining"));
});
test("substitution excludes all incompatible anchors; missing lower differs from substitution", () => {
  const a = analyze(scenario("substitution"));
  assert.equal(a.excludedAnchors, 3);
  assert.equal(a.anchorChanges.length, 0);
  const b = analyze(scenario("lower"));
  assert(b.missingLower);
  assert.equal(b.current.lifts.lower, 0);
  assert.equal(b.current.lifts.count, 16);
});
test("partial plan weeks and unknown alignment do not multiply weekly targets blindly", () => {
  const data = scenario("working");
  data.clock = "2026-06-26";
  let d = dashboard(data, analyze(data));
  assert.equal(d.execution[3].weeks, 3);
  assert.equal(d.execution[3].target, 12);
  delete data.plans[0].weekStartsOn;
  d = dashboard(data, analyze(data));
  assert.equal(d.execution[3].target, null);
  assert.equal(d.execution[3].baseline, 4);
});
test("review due has explicit evidence sufficiency and optional review date", () => {
  const data = scenario("working");
  const dec = decide(data, analyze(data), {
    choice: "accept",
    effective: data.clock,
    review: "2026-07-13",
  });
  assert.equal(reviewState(dec, data).label, "Awaiting observations");
  const future = addSyntheticFollowup(data, dec);
  assert.equal(
    reviewState(dec, future).label,
    "Review due with sufficient evidence",
  );
  future.records = future.records.filter(
    (r) => r.kind !== "calories" || r.date < "2026-06-29",
  );
  assert.equal(
    reviewState(dec, future).label,
    "Review due with insufficient evidence",
  );
  const undated = decide(data, analyze(data), {
    choice: "accept",
    effective: data.clock,
  });
  assert.equal(reviewState(undated, data).label, "Review date not set");
  for (const choice of ["defer", "reject"])
    assert.equal(
      reviewState(
        decide(data, analyze(data), { choice, effective: data.clock }),
        data,
      ).active,
      false,
    );
});
test("due adjustment becomes the default next action and gaps qualify the review", () => {
  const data = scenario("working");
  const dec = decide(data, analyze(data), {
    choice: "accept",
    effective: data.clock,
    review: "2026-07-13",
  });
  const future = addSyntheticFollowup(data, dec);
  assert(
    dashboard(future, analyze(future), [dec]).next.includes(
      "checkpoint is due",
    ),
  );
  future.records = future.records.filter(
    (r) => r.kind !== "sleep" || r.date < "2026-06-29",
  );
  assert(
    dashboard(future, analyze(future), [dec]).next.includes(
      "missing post-decision",
    ),
  );
});
test("stability tolerance agrees between evidence, summary and action", () => {
  const data = scenario("working");
  for (const r of data.records)
    if (r.kind === "lift" && r.date >= "2026-06-01") r.load *= 0.995;
  const a = analyze(data),
    d = dashboard(data, a);
  assert.equal(a.strengthCounts.stable, 3);
  assert.equal(a.strengthCounts.declining, 0);
  assert.equal(a.action, "continue_unchanged");
  assert(d.headline.includes("holding"));
  assert(a.evidence.some((e) => e.title === "Comparable strength is stable"));
  assert(!a.evidence.some((e) => e.title === "Comparable strength declined"));
});
