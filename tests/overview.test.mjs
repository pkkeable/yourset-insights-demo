import test from "node:test";
import assert from "node:assert/strict";
import { scenario } from "../src/scenarios.mjs";
import { analyze, planAt, dashboard } from "../src/metrics.mjs";
import {
  activityTotal,
  activitySeries,
  strengthSeries,
  recordedNutrition,
} from "../src/overview.mjs";
import { dashboardDocument } from "../private-api/dashboard.mjs";

test("activity counts sessions once, excludes warmups from sets and does not invent duration", () => {
  const rows = [
    {
      id: "1",
      writer: "a",
      sessionId: "s",
      setType: "working",
      workoutElapsedMinutes: 50,
    },
    {
      id: "2",
      writer: "a",
      sessionId: "s",
      setType: "warmup",
      workoutElapsedMinutes: 50,
    },
  ];
  assert.equal(activityTotal(rows, "lift", "sessions"), 1);
  assert.equal(activityTotal(rows, "lift", "sets"), 1);
  assert.equal(activityTotal(rows, "lift", "minutes"), 50);
  assert.equal(
    activityTotal(
      [{ ...rows[0], workoutElapsedMinutes: undefined }],
      "lift",
      "minutes",
    ),
    null,
  );
  assert.equal(
    activityTotal([{ ...rows[0], setType: undefined }], "lift", "sets"),
    null,
  );
  assert.equal(
    activityTotal(
      [...rows, { ...rows[0], workoutElapsedMinutes: 20 }],
      "lift",
      "minutes",
    ),
    null,
  );
});
test("rolling activity uses preceding six days, revisions and explicit coverage", () => {
  const d = scenario(),
    a = analyze(d),
    r = d.records.find((r) => r.kind === "lift" && r.date === a.current.from);
  const m = activitySeries(d, a, "lift", "sessions");
  assert.equal(m.points.length, 28);
  assert.equal(m.points[0].value, 4);
  assert.equal(m.total, 16);
  d.records.push({ ...r, revision: 2, removed: true });
  // Other sets from the same session keep it one attendance record.
  assert.equal(activitySeries(d, analyze(d), "lift", "sessions").total, 16);
  delete d.trainingCoverage;
  assert(
    activitySeries(d, analyze(d), "lift", "sessions").points.every(
      (r) => r.value === null,
    ),
  );
  d.records = d.records.filter((r) => r.kind !== "aerobic");
  assert.equal(activitySeries(d, analyze(d), "aerobic", "minutes").total, null);
});
test("nutrition uses recorded days separately from explicitly complete days; duplicate totals are withheld", () => {
  const d = scenario("gaps"),
    a = analyze(d),
    m = recordedNutrition(a);
  assert.equal(m.calories.length, 27);
  assert.equal(a.current.calories.count, 20);
  d.records.push({
    ...d.records.find(
      (r) => r.kind === "calories" && r.date === a.current.from,
    ),
    id: "competing",
    writer: "other",
  });
  assert.equal(recordedNutrition(analyze(d)).calories.length, 26);
});
test("strength picker excludes mismatched equipment and never combines exercise loads", () => {
  const d = scenario("substitution");
  assert.equal(strengthSeries(analyze(d)).points.length, 0);
  const a = analyze(scenario()),
    m = strengthSeries(a);
  assert.equal(m.options.length, 3);
  assert(m.points.every((r) => r.value === m.points[0].value));
  assert.notEqual(
    strengthSeries(a, m.options[1].key).points[0].value,
    m.points[0].value,
  );
});
test("durable dashboard merges targets by effective date, retaining original plans and evidence", () => {
  const data = scenario(),
    original = structuredClone(data),
    plan = {
      id: "saved",
      version: 1,
      effectiveDate: data.clock,
      calories: 2400,
      proteinGrams: 170,
      reason: "Synthetic choice",
    };
  const doc = dashboardDocument({
    revision: "a".repeat(64),
    data,
    plans: [plan],
    decisions: [],
    latest: null,
  });
  assert.deepEqual(data, original);
  assert.equal(doc.planVersion, 1);
  assert.equal(planAt(doc.data.plans, data.clock).calories, 2400);
  assert.equal(planAt(doc.data.plans, "2026-06-28").calories, 2280);
  doc.data.clock = "2026-06-30";
  doc.data.records.push({
    ...data.records.find((r) => r.kind === "calories"),
    id: "next-day",
    date: "2026-06-29",
    value: 2400,
    complete: true,
  });
  const metric = dashboard(doc.data, analyze(doc.data)).execution[0];
  assert(metric.targets.includes(2400));
  assert.equal(metric.target, (27 * 2280 + 2400) / 28);
  assert.throws(
    () => dashboardDocument(null),
    (e) => e.code === "evidence_unavailable",
  );
});
