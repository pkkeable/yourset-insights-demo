import test from "node:test";
import assert from "node:assert/strict";
import {
  scenario,
  SCENARIOS,
  addSyntheticFollowup,
} from "../src/scenarios.mjs";
import {
  analyze,
  dashboard,
  usMeasure,
  formatUS,
  displayEvidence,
  decide,
  appendDecision,
  completeReview,
  reviewState,
} from "../src/metrics.mjs";

test("US conversions use exact definitions, with source values unchanged", () => {
  assert(Math.abs(usMeasure("weight", 0.45359237).value - 1) < 1e-12);
  assert(Math.abs(usMeasure("waist", 2.54).value - 1) < 1e-12);
  assert(Math.abs(usMeasure("distance", 1609.344).value - 1) < 1e-12);
  assert(Math.abs(usMeasure("elevation", 0.3048).value - 1) < 1e-12);
  assert(Math.abs(usMeasure("speed", 1).value - 2.2369362920544) < 1e-10);
  assert.equal(formatUS("weight", 81.6466266), "180.0 lb");
  assert.equal(formatUS("load", 100), "220.5 lb");
  assert.equal(formatUS("waist", 91.44), "36.0 in");
  assert.equal(formatUS("distance", 1000), "0.62 mi");
  assert.equal(formatUS("pace", 300), "8:03 min/mi");
  assert.equal(formatUS("pace", 600 / 1.609344), "10:00 min/mi");
});
test("missing, true zero, negative rates and rounded zero remain distinct", () => {
  for (const v of [null, undefined, NaN, Infinity])
    assert.equal(formatUS("weight", v), "Not available");
  assert.equal(formatUS("distance", 0), "0.00 mi");
  assert.equal(
    formatUS("weightRate", -0.45359237, { signed: true }),
    "-1.00 lb/week",
  );
  assert.equal(
    formatUS("weightRate", 0.45359237, { signed: true }),
    "+1.00 lb/week",
  );
  assert.equal(formatUS("weight", -0.000001, { signed: true }), "0.0 lb");
  assert.equal(formatUS("pace", -1), "Not available");
  assert.throws(() => usMeasure("unknown", 1));
});
for (const [id] of SCENARIOS)
  test(`US display preserves ${id} source records and analytical decisions`, () => {
    const data = scenario(id),
      source = structuredClone(data),
      a = analyze(data),
      before = structuredClone(a);
    const d = dashboard(data, a);
    formatUS("weight", d.weight.latest);
    formatUS("weightRate", d.weight.slope);
    for (const r of a.anchorChanges) {
      formatUS("load", r.before);
      formatUS("load", r.after);
    }
    for (const e of a.evidence)
      assert(!/\bkg\b|kilograms/.test(displayEvidence(e)));
    assert.deepEqual(data, source);
    assert.deepEqual(a, before);
    assert.deepEqual(analyze(data), a);
  });
test("weight narrative renders the same US values as the trend card", () => {
  const a = analyze(scenario("slowdown")),
    e = a.evidence.find((e) => e.measurement);
  assert(
    displayEvidence(e).includes(formatUS("weightRate", a.current.weight.slope)),
  );
  assert(
    displayEvidence(e).includes(
      formatUS("weightRate", a.previous.weight.slope),
    ),
  );
  assert.equal(e.measurement.current, a.current.weight.slope);
});
test("distance absence is unknown; a supplied distance is converted with coverage", () => {
  const data = scenario("working");
  assert.equal(analyze(data).current.aerobic.distanceMeters, null);
  const rows = data.records.filter(
    (r) => r.kind === "aerobic" && r.date >= "2026-06-01",
  );
  rows[0].distanceMeters = 1609.344;
  rows[1].distanceMeters = 0;
  const a = analyze(data);
  assert.equal(a.current.aerobic.distanceCount, 2);
  assert.equal(a.current.aerobic.count, 4);
  assert.equal(
    formatUS("distance", a.current.aerobic.distanceMeters),
    "1.00 mi",
  );
});
test("finishing review closes only the selected action and preserves both snapshots", () => {
  const data = scenario("working"),
    dec = decide(data, analyze(data), {
      choice: "accept",
      reason: "Review execution",
      effective: data.clock,
      review: "2026-07-13",
    });
  const history = appendDecision([], dec),
    original = structuredClone(history),
    future = addSyntheticFollowup(data, dec),
    plans = structuredClone(future.plans);
  const reviewed = completeReview(history, dec.id, future, {
    outcome: "continue_plan",
    note: "Execution is consistent. Continue and observe.",
    analysis: analyze(future, 14),
  });
  assert.deepEqual(history, original);
  assert.deepEqual(future.plans, plans);
  assert.equal(reviewed[0].reviewResult.assessment.periodDays, 14);
  assert.equal(reviewed[0].status, "completed");
  assert.equal(reviewed[0].reviewResult.evidenceSufficient, true);
  assert.deepEqual(reviewed[0].analysis, dec.analysis);
  assert.deepEqual(reviewed[0].evidence, dec.evidence);
  assert.equal(reviewed[0].reviewResult.reviewedAt, "2026-07-13");
  assert(
    !dashboard(future, analyze(future), reviewed).next.includes(
      "checkpoint is due",
    ),
  );
  future.records[0].value = 999;
  assert.notEqual(reviewed[0].reviewResult.evidence[0].value, 999);
  assert.throws(() =>
    completeReview(reviewed, dec.id, future, {
      outcome: "conclude",
      note: "Again",
    }),
  );
});
test("review requires an explicit outcome and note, with limited evidence retained", () => {
  const data = scenario(),
    dec = decide(data, analyze(data), {
      choice: "accept",
      effective: data.clock,
    }),
    h = [dec];
  assert.throws(() =>
    completeReview(h, dec.id, data, { outcome: "conclude", note: "" }),
  );
  assert.throws(() =>
    completeReview(h, dec.id, data, { outcome: "magical", note: "test" }),
  );
  const stopped = completeReview(h, dec.id, data, {
    outcome: "stop",
    note: "Need more evidence first.",
  });
  assert.equal(stopped[0].reviewResult.evidenceSufficient, false);
  assert.equal(stopped[0].reviewResult.outcome, "stop");
});
test("duplicate active actions are blocked, but a later new action is allowed after review", () => {
  const data = scenario(),
    a = analyze(data),
    input = {
      choice: "accept",
      reason: "Check execution",
      effective: data.clock,
    };
  const first = decide(data, a, input),
    h = appendDecision([], first);
  assert.throws(
    () => appendDecision(h, decide(data, a, input)),
    /already active/,
  );
  const closed = completeReview(h, first.id, data, {
    outcome: "stop",
    note: "Close the first action.",
  });
  assert.equal(appendDecision(closed, decide(data, a, input)).length, 2);
});
test("old recovery readings cannot certify sufficient evidence for a due review", () => {
  const data = scenario(),
    dec = decide(data, analyze(data), {
      choice: "accept",
      effective: data.clock,
      review: "2026-07-13",
    }),
    future = addSyntheticFollowup(data, dec);
  future.records = future.records.filter(
    (r) => !["sleep", "rhr"].includes(r.kind) || r.date < "2026-07-08",
  );
  assert.equal(
    reviewState(dec, future).label,
    "Review due with insufficient evidence",
  );
});
