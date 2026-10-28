import {
  windowMetrics,
  shift,
  finite,
  usMeasure,
  mean,
  latestRevisions,
  planAt,
} from "./metrics.mjs";
import { activityTotal } from "./overview.mjs";
export const METRICS = [
  ["weight", "Weight", "Weight & nutrition", "lb", "weight"],
  ["strength", "Strength", "Training & activity", "lb", "lift"],
  [
    "calories",
    "Recorded calories",
    "Weight & nutrition",
    "kcal/day",
    "calories",
  ],
  ["protein", "Protein", "Weight & nutrition", "g/day", "protein"],
  ["sleep", "Sleep", "Recovery", "hours/night", "sleep"],
  ["rhr", "Resting heart rate", "Recovery", "bpm", "rhr"],
  ["hrv", "HRV", "Recovery", "ms", "hrv"],
  ["steps", "Steps", "Training & activity", "steps/day", "steps"],
  [
    "liftSessions",
    "Lifting sessions",
    "Training & activity",
    "sessions/week",
    "lift",
    "sessions",
  ],
  [
    "liftSets",
    "Working sets",
    "Training & activity",
    "sets/week",
    "lift",
    "sets",
  ],
  [
    "liftMinutes",
    "Lifting duration",
    "Training & activity",
    "minutes/week",
    "lift",
    "minutes",
  ],
  [
    "cardioMinutes",
    "Cardio duration",
    "Training & activity",
    "minutes/week",
    "aerobic",
    "minutes",
  ],
  [
    "cardioSessions",
    "Cardio sessions",
    "Training & activity",
    "sessions/week",
    "aerobic",
    "sessions",
  ],
  ["distance", "Cardio distance", "Training & activity", "mi/week", "aerobic"],
  ["waist", "Waist", "Weight & nutrition", "in", "waist"],
  [
    "composition",
    "Scale body-fat estimate",
    "Weight & nutrition",
    "% · provider estimate",
    "composition",
  ],
].map(([id, label, group, unit, kind, mode]) => ({
  id,
  label,
  group,
  unit,
  kind,
  mode,
}));
export function weeklyBuckets(data, a) {
  const weeks = [];
  // Only complete Monday–Sunday buckets inside the selected window.
  let from = a.current.from;
  while (new Date(from + "T00:00:00Z").getUTCDay() !== 1) from = shift(from, 1);
  for (; shift(from, 6) <= a.current.to; from = shift(from, 7))
    weeks.push(windowMetrics(data, from, shift(from, 6)));
  return weeks;
}
export function timelineAssessment(data, a) {
  const weeks = weeklyBuckets(data, a),
    last = weeks.slice(-3);
  const keys =
    last.length === 3
      ? Object.keys(last[0].lifts.anchors).filter((k) =>
          last.every((w) => finite(w.lifts.anchors[k])),
        )
      : [];
  const flat =
    keys.length > 0 &&
    keys.every((k) =>
      last.every(
        (w) => Math.abs(w.lifts.anchors[k] - last[0].lifts.anchors[k]) < 1e-8,
      ),
    );
  const weightDown =
    weeks.length > 1 &&
    weeks.every((w) => w.weight.count >= 4) &&
    weeks.at(-1).weight.mean < weeks[0].weight.mean;
  const earlierImprovement = weeks
    .slice(0, -3)
    .some((w) =>
      keys.every(
        (k) =>
          finite(w.lifts.anchors[k]) &&
          w.lifts.anchors[k] < last[0].lifts.anchors[k],
      ),
    );
  const liftNames = [...new Set(keys.map((key) => key.split("|")[0]))];
  const namedLifts = new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  })
    .format(liftNames)
    .replace(", and ", " and ");
  if (flat && weightDown && earlierImprovement)
    return {
      title: `Weight down. ${namedLifts} weekly maximum loads unchanged for three weeks.`,
      detail: `${keys.length} matched lift groups have unchanged recorded weekly maximum loads across the three completed weekly buckets ${last[0].from}–${last.at(-1).to}. Recorded loads do not establish physiological strength. Scale weight does not establish fat loss; coincident trends do not establish cause.`,
      next: "Review the evidence, then choose whether to continue the plan or record a review action. No calorie change is prescribed.",
      weeks: last.map((w) => ({
        from: w.from,
        to: w.to,
        anchors: w.lifts.anchors,
      })),
      keys,
    };
  return null;
}
export function metricTrack(data, weeks, metric, anchor) {
  const points = weeks.map((w) => {
    let value = null,
      count = 0;
    if (metric.id === "strength") {
      value = usMeasure("load", w.lifts.anchors[anchor] ?? null).value;
      count = w.lifts.rows.filter(
        (r) =>
          [r.exercise, r.equipment, r.loadConvention, r.reps, r.writer].join(
            "|",
          ) === anchor,
      ).length;
    } else if (metric.mode) {
      const rows = w.rows.filter((r) => r.kind === metric.kind),
        coverage = data.trainingCoverage?.[metric.kind];
      count = rows.length;
      if (coverage && coverage.from <= w.from && coverage.to >= w.to)
        value = activityTotal(rows, metric.kind, metric.mode);
    } else if (metric.id === "distance") {
      value = usMeasure("distance", w.aerobic.distanceMeters).value;
      count = w.aerobic.distanceCount;
    } else {
      const stat = w[metric.kind];
      count = stat?.count ?? 0;
      value = stat?.mean ?? null;
      if (["weight", "waist"].includes(metric.kind))
        value = usMeasure(metric.kind, value).value;
    }
    return { from: w.from, to: w.to, value, count, days: 7 };
  });
  const any = points.some((p) => finite(p.value));
  const state = any
    ? points.some(
        (p) =>
          !finite(p.value) ||
          (!metric.mode && metric.kind !== "lift" && p.count < 7),
      )
      ? "incomplete"
      : "available"
    : (data.metricAvailability?.[metric.kind] ?? "unavailable");
  return { points, state };
}
export function dailyRecords(data, week, metric, anchor) {
  return latestRevisions(data.records)
    .filter(
      (r) =>
        r.date >= week.from &&
        r.date <= week.to &&
        r.kind === metric.kind &&
        (r.kind !== "steps" || r.writer === data.stepWriter) &&
        (metric.id !== "strength" ||
          [r.exercise, r.equipment, r.loadConvention, r.reps, r.writer].join(
            "|",
          ) === anchor),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ ...r, plan: planAt(data.plans, r.date) }));
}
export function datedTargets(data, week) {
  const targets = [];
  for (let date = week.from; date <= week.to; date = shift(date, 1)) {
    const p = planAt(data.plans, date);
    targets.push({ date, value: p?.calories ?? null, id: p?.id ?? null });
  }
  return {
    days: targets,
    mean: mean(targets.map((t) => t.value)),
    changed: new Set(targets.map((t) => t.id)).size > 1,
  };
}
