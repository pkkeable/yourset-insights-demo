import { latestRevisions, shift, mean, usMeasure } from "./metrics.mjs";
export const anchorKey = (r) =>
  [r.exercise, r.equipment, r.loadConvention, r.reps, r.writer].join("|");
export function recordedNutrition(a) {
  const daily = (kind) => {
    const groups = new Map();
    for (const r of a.current.rows.filter(
      (r) => r.kind === kind && Number.isFinite(r.value),
    )) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    // Canonical nutrition input is a daily total, never competing writer totals.
    return [...groups]
      .filter(([, rs]) => rs.length === 1)
      .map(([date, rs]) => ({
        date,
        value: rs[0].value,
        complete: rs[0].complete === true,
      }));
  };
  const calories = daily("calories"),
    protein = daily("protein");
  return {
    calories,
    protein,
    energyMean: mean(calories.map((r) => r.value)),
    proteinMean: mean(protein.map((r) => r.value)),
  };
}
export function strengthSeries(a, selected) {
  const options = a.strengthKeys.map((key) => ({
    key,
    label:
      key.split("|").slice(0, 2).join(" · ") +
      " · " +
      key.split("|")[3] +
      " reps",
  }));
  const key = options.some((x) => x.key === selected)
    ? selected
    : options[0]?.key;
  const days = new Map();
  for (const r of a.current.lifts.rows.filter((r) => anchorKey(r) === key))
    days.set(
      r.date,
      Math.max(days.get(r.date) ?? -Infinity, usMeasure("load", r.load).value),
    );
  return {
    key,
    options,
    points: [...days]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function activityTotal(rows, kind, mode) {
  if (!rows.length) return 0;
  const sessions = new Map();
  for (const r of rows) {
    const key = [r.writer, r.sessionId ?? r.id].join("|");
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(r);
  }
  if (mode === "sessions") return sessions.size;
  if (mode === "sets")
    return rows.every((r) => r.setType)
      ? rows.filter((r) => r.setType !== "warmup").length
      : null;
  if (kind === "aerobic")
    return rows.every((r) => r.unit === "minutes" && Number.isFinite(r.value))
      ? rows.reduce((n, r) => n + r.value, 0)
      : null;
  let minutes = 0;
  for (const group of sessions.values()) {
    const durations = [...new Set(group.map((r) => r.workoutElapsedMinutes))];
    if (
      durations.length !== 1 ||
      !Number.isFinite(durations[0]) ||
      durations[0] <= 0
    )
      return null;
    minutes += durations[0];
  }
  return minutes;
}
export function activitySeries(data, a, kind, mode) {
  const c = a.current;
  const all = latestRevisions(data.records).filter((r) => r.kind === kind);
  const rows = all.filter((r) => r.date >= c.from && r.date <= c.to);
  const coverage = data.trainingCoverage?.[kind];
  const points = [];
  if (rows.length)
    for (let date = c.from; date <= c.to; date = shift(date, 1)) {
      const from = shift(date, -6);
      const covered = coverage && coverage.from <= from && coverage.to >= date;
      points.push({
        date,
        value: covered
          ? activityTotal(
              all.filter((r) => r.date >= from && r.date <= date),
              kind,
              mode,
            )
          : null,
      });
    }
  return {
    points,
    total: rows.length ? activityTotal(rows, kind, mode) : null,
    observations: rows.length,
  };
}
