import test from "node:test";
import assert from "node:assert/strict";
import { returningLifter } from "../src/returning-lifter.mjs";
import {
  METRICS,
  weeklyBuckets,
  metricTrack,
  timelineAssessment,
  dailyRecords,
  datedTargets,
} from "../src/timeline.mjs";
import { analyze, decide, editPlan, usMeasure } from "../src/metrics.mjs";
import { scenario, addSyntheticFollowup } from "../src/scenarios.mjs";
import { timelineModel, timelineView } from "../web/timeline-view.mjs";
const rounded = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
const setup = () => {
  const data = returningLifter(),
    a = analyze(data, 56);
  return { data, a, weeks: weeklyBuckets(data, a) };
};
test("daily fixture aggregates to every supplied reference value through the shared engine", () => {
  const { data, weeks } = setup();
  assert.equal(weeks.length, 8);
  assert.deepEqual(
    weeks.map((w) => rounded(usMeasure("weight", w.weight.mean).value)),
    [200.2, 199.3, 199, 197.7, 197.9, 196.4, 195.8, 195.1],
  );
  assert.deepEqual(
    weeks.map((w) => w.calories.mean),
    [2300, 2250, 2210, null, 2170, 2190, 2180, 2160],
  );
  assert.deepEqual(
    weeks.map((w) => rounded(w.sleep.mean)),
    [7, 7.2, 7.3, 7.4, 7.5, 7.5, 7.5, 7.5],
  );
  for (const [name, values] of Object.entries({
    Bench: [135, 140, 145, 150, 152.5, 155, 155, 155],
    Squat: [185, 195, 200, 205, 210, 215, 215, 215],
    Row: [95, 97.5, 100, 105, 107.5, 110, 110, 110],
  })) {
    const key = Object.keys(weeks[0].lifts.anchors).find((k) =>
      k.startsWith(name + "|"),
    );
    assert.deepEqual(
      metricTrack(data, weeks, METRICS[1], key).points.map((p) =>
        rounded(p.value),
      ),
      values,
    );
  }
  assert.equal(weeks[3].calories.count, 0);
});
test("headline requires three completed matched weekly buckets and sufficient weight", () => {
  const { data, a } = setup();
  assert.equal(
    timelineAssessment(data, a).title,
    "Weight down. Bench, Squat and Row weekly maximum loads unchanged for three weeks.",
  );
  assert.equal(timelineAssessment(data, analyze(data, 14)), null);
  assert.equal(
    timelineAssessment(scenario("gaps"), analyze(scenario("gaps"))),
    null,
  );
  for (const change of [
    (r) => (r.reps = 6),
    (r) => (r.equipment = "Different bar"),
    (r) => (r.writer = "Different source"),
    (r) => (r.loadConvention = "per hand"),
  ]) {
    const d = structuredClone(data);
    d.records
      .filter((r) => r.kind === "lift" && r.date >= "2026-10-19")
      .forEach(change);
    assert.equal(timelineAssessment(d, analyze(d, 56)), null);
  }
  const d = structuredClone(data);
  d.records = d.records.filter(
    (r) => r.kind !== "lift" || r.date < "2026-10-19",
  );
  assert.equal(timelineAssessment(d, analyze(d, 56)), null);
});
test("max load stays within exact group, revisions resolve and missing weeks are never carried", () => {
  const { data } = setup();
  const row = data.records.find((r) => r.exercise === "Bench");
  data.records.push({ ...row, id: "heavy-other-reps", reps: 1, load: 200 });
  data.records.push({ ...row, revision: 2, load: 62 });
  const weeks = weeklyBuckets(data, analyze(data, 56));
  const key = Object.keys(weeks[0].lifts.anchors).find(
    (k) => k.startsWith("Bench|") && k.includes("|5|"),
  );
  assert.equal(weeks[0].lifts.anchors[key], 62);
  assert.equal(
    dailyRecords(data, weeks[0], METRICS[1], key).find((r) => r.id === row.id)
      .revision,
    2,
  );
  data.records = data.records.filter(
    (r) => r.date < "2026-10-19" || r.exercise !== "Bench",
  );
  assert.equal(
    metricTrack(
      data,
      weeklyBuckets(data, analyze(data, 56)),
      METRICS[1],
      key,
    ).points.at(-1).value,
    null,
  );
});
test("daily records preserve observations, completeness and dated plan changes", () => {
  const { data, weeks } = setup();
  const food = METRICS.find((m) => m.id === "calories");
  assert.equal(dailyRecords(data, weeks[3], food).length, 0);
  const rows = dailyRecords(data, weeks[0], food);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].value, 2240);
  assert.equal(rows[0].plan.calories, 2200);
  data.plans.push({
    ...data.plans[0],
    id: "changed",
    effective: "2026-10-22",
    calories: 2250,
  });
  const targets = datedTargets(data, weeks.at(-1));
  assert.equal(targets.changed, true);
  assert.deepEqual(
    targets.days.map((d) => d.value),
    [2200, 2200, 2200, 2250, 2250, 2250, 2250],
  );
  data.records.find(
    (r) => r.kind === "calories" && r.date === "2026-08-31",
  ).complete = false;
  assert.equal(weeklyBuckets(data, analyze(data, 56))[0].calories.count, 6);
  assert.equal(dailyRecords(data, weeks[0], food)[0].complete, false);
});
test("selection persists across metric changes; windows and scenarios reconcile it", () => {
  const { data, a } = setup();
  const state = {
    week: "2026-09-21",
    anchor: null,
    metrics: ["weight", "strength"],
  };
  timelineModel(data, a, state);
  state.metrics = METRICS.map((m) => m.id);
  timelineModel(data, a, state);
  assert.equal(state.week, "2026-09-21");
  timelineModel(data, analyze(data, 14), state);
  assert.equal(state.week, "2026-10-19");
  timelineModel(scenario("working"), analyze(scenario("working")), state);
  assert.equal(state.week, "2026-06-22");
});
test("catalogue preserves all families and distinguishes absence from connection and partial coverage", () => {
  const { data, weeks } = setup();
  const status = (id) =>
    metricTrack(
      data,
      weeks,
      METRICS.find((m) => m.id === id),
      null,
    ).state;
  assert.equal(METRICS.length, 16);
  assert.equal(status("protein"), "unavailable");
  assert.equal(status("rhr"), "not connected");
  assert.equal(status("calories"), "incomplete");
  assert.equal(status("sleep"), "available");
});
test("decision snapshot preserves original weekly assessment after plan edits and followup", () => {
  const { data, a } = setup();
  const original = {
    ...a,
    title: timelineAssessment(data, a).title,
    timelineAssessment: timelineAssessment(data, a),
  };
  const d = decide(data, original, {
    choice: "continue_unchanged",
    effective: data.clock,
    review: "2026-11-09",
  });
  const saved = structuredClone(d);
  const changed = editPlan(data, {
    effective: data.clock,
    calories: 2250,
    protein: 160,
    reason: "Fictional explicit choice",
  });
  const follow = addSyntheticFollowup(changed, d);
  assert.equal(follow.clock, "2026-11-09");
  assert.deepEqual(d, saved);
  assert.equal(d.originalPlans[0].calories, 2200);
  assert.equal(d.analysis.timelineAssessment.weeks[0].from, "2026-10-05");
  assert.equal(weeklyBuckets(follow, analyze(follow, 14)).length, 2);
});

test("empty selected rows collapse while strength overlays preserve independent matched series", () => {
  const { data, a } = setup();
  const state = {
    metrics: ["weight", "strength", "protein", "calories"],
    week: null,
    anchor: null,
    recordMetric: "weight",
  };
  const html = timelineView(data, a, state);
  assert.equal((html.match(/data-overlay-series=/g) || []).length, 3);
  const protein = html.match(
    /<article[^>]+data-track="protein"[\s\S]*?<\/article>/,
  )[0];
  assert.match(protein, /No eligible observations/);
  assert.doesNotMatch(protein, /<svg/);
  assert.match(protein, /Details/);
  const calories = html.match(
    /<article[^>]+data-track="calories"[\s\S]*?<\/article>/,
  )[0];
  assert.match(calories, /<svg/);
  for (const name of ["Bench", "Squat", "Row"])
    assert.match(html, new RegExp(name));
  assert.match(html, /2026-10-05–2026-10-25/);
  state.strengthMode = "split";
  const split = timelineView(data, a, state, true);
  assert.equal((split.match(/data-split-lift=/g) || []).length, 3);
  assert.doesNotMatch(split, /data-overlay-series=/);
  assert.equal(state.week, "2026-10-19");
});

test("headline names only lift groups with eligible three-week comparisons", () => {
  const { data } = setup();
  data.records = data.records.filter(
    (r) => r.kind !== "lift" || r.exercise === "Bench",
  );
  assert.equal(
    timelineAssessment(data, analyze(data, 56)).title,
    "Weight down. Bench weekly maximum loads unchanged for three weeks.",
  );
});
