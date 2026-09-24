import { shift } from "./metrics.mjs";
export const CLOCK = "2026-06-29";
export const SCENARIOS = [
  ["slowdown", "Weight-loss slowdown"],
  ["weekends", "Weekend intake"],
  ["steps", "Reduced movement"],
  ["strength", "Strength during a cut"],
  ["lower", "Missed lower-body work"],
  ["recovery", "Recovery concerns"],
  ["gaps", "Incomplete food logs"],
  ["substitution", "Equipment substitution"],
  ["working", "Plan working"],
  ["followup", "Review an adjustment"],
];
export function dateAt(i) {
  return new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
}
export function scenario(id = "slowdown") {
  if (!SCENARIOS.some((s) => s[0] === id)) throw Error("Unknown scenario");
  let seed = 421;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const plan = {
    id: "plan-1",
    effective: dateAt(-332),
    phase: "Cut-leaning recomp",
    calories: 2280,
    protein: 155,
    proteinFloor: 140,
    stepsMin: 8200,
    stepsMax: 10800,
    liftsPerWeek: 4,
    weekStartsOn: 1,
    aerobicPerWeek: 1,
    sequence: ["Pull A", "Push A", "Z2", "Pull B", "Push B"],
    movement: ["upper", "lower"],
    reason: "Independent synthetic baseline",
    weightRange: null,
  };
  const records = [];
  const add = (kind, i, value, extra = {}) =>
    records.push({
      id: `${kind}-${i}`,
      revision: 1,
      date: dateAt(i),
      kind,
      value,
      unit:
        {
          weight: "kg",
          calories: "kcal",
          protein: "g",
          steps: "count",
          sleep: "hours",
          rhr: "bpm",
          hrv: "ms",
          composition: "percent",
          waist: "cm",
        }[kind] ?? "session",
      writer: ["calories", "protein"].includes(kind)
        ? "Demo food writer"
        : kind === "weight" || kind === "composition"
          ? "Demo scale"
          : "Demo training device",
      adapter: "synthetic/1.0.0",
      device: "Simulated instrument",
      observationClass:
        kind === "composition" ? "provider_derived" : "source_observation",
      fetchedAt: "2026-06-29T07:00:00Z",
      ...extra,
    });
  for (let i = -332; i < 28; i++) {
    // Keep the original recent fixtures unchanged when extending history.
    if (i === -28) seed = 421;
    const current = i >= 0,
      cycle = ((i % 7) + 7) % 7,
      weekend = cycle >= 5;
    const slow = ["slowdown", "weekends", "steps", "gaps", "recovery"].includes(
      id,
    );
    let weight =
      83.6 -
      Math.min(i, -1) * 0.047 -
      Math.max(i + 1, 0) * (slow ? 0.009 : 0.043) +
      noise() * 0.09;
    add("weight", i, weight);
    add(
      "calories",
      i,
      2280 +
        (weekend && ["weekends", "slowdown"].includes(id) && current ? 560 : 0),
      { complete: !(id === "gaps" && current && weekend) },
    );
    add("protein", i, 158 + (((i % 3) + 3) % 3) * 3, {
      complete: !(id === "gaps" && current && weekend),
    });
    add(
      "steps",
      i,
      9100 +
        (((i % 3) + 3) % 3) * 180 -
        (current && ["steps", "slowdown"].includes(id) ? 2600 : 0),
    );
    if (id !== "gaps") {
      add(
        "sleep",
        i,
        7.7 + noise() * 0.25 - (current && id === "recovery" ? 1.2 : 0),
      );
      add("rhr", i, 54 + noise() * 2 + (current && id === "recovery" ? 7 : 0));
      add("hrv", i, 51 + noise() * 3 - (current && id === "recovery" ? 10 : 0));
    }
    if (i % 7 === 0 || i === 27)
      add("composition", i, 24.2 - i * 0.012, {
        method: "Simulated bioimpedance; unvalidated tissue estimate",
      });
    if (i === 2 || i === 23)
      add("waist", i, 91 - i * 0.02, { method: "Synthetic tape observation" });
    if ([0, 1, 3, 4].includes(cycle)) {
      const seq = { 0: "Pull A", 1: "Push A", 3: "Pull B", 4: "Push B" }[cycle];
      add("lift", i, 1, {
        sessionId: `session-${i}`,
        routine: seq,
        movements: id === "lower" && current ? ["upper"] : ["upper", "lower"],
        exercise: "Seated cable row",
        equipment:
          id === "substitution" && current ? "Cable stack B" : "Cable stack A",
        loadConvention: "stack kg",
        setType: "working",
        workoutElapsedMinutes: 48 + cycle * 3,
        reps: 8,
        load: 50 + (current && id === "strength" ? 5 : 0),
        writer: "Demo strength logger",
      });
    }
    if (cycle === 2)
      add("aerobic", i, 35, {
        sport: "Z2",
        sessionId: `cardio-${i}`,
        unit: "minutes",
      });
  }
  if (id === "gaps")
    for (const r of records)
      if (r.kind === "calories" && r.date === "2026-06-28") {
        r.value = null;
        r.complete = false;
      }
  // Distinct synthetic anchors share session identities, never attendance counts.
  for (const r of records.filter((r) => r.kind === "lift")) {
    const hasLower = r.movements.includes("lower");
    r.movements = ["upper"];
    records.push({
      ...r,
      id: r.id + ":press",
      exercise: "Chest press",
      equipment: r.equipment.endsWith("B") ? "Chest press B" : "Chest press A",
      loadConvention: "machine kg",
      load: r.load - 20,
    });
    if (hasLower)
      records.push({
        ...r,
        id: r.id + ":leg",
        exercise: "Leg press",
        equipment: r.equipment.endsWith("B") ? "Leg press B" : "Leg press A",
        loadConvention: "machine kg",
        load: r.load + 40,
        movements: ["lower"],
      });
  }
  const plans = [plan];
  if (id === "followup")
    plans.push({
      ...plan,
      id: "plan-2",
      effective: "2026-06-15",
      stepsMin: 9000,
      reason: "Synthetic user chose consistent movement",
    });
  return {
    id,
    label: SCENARIOS.find((s) => s[0] === id)[1],
    clock: CLOCK,
    timezone: "Europe/London",
    stepWriter: "Demo training device",
    plans,
    records,
    trainingCoverage: {
      lift: { from: dateAt(-332), to: dateAt(27) },
      aerobic: { from: dateAt(-332), to: dateAt(27) },
    },
    sourceStatus: {
      nutrition: "synthetic_tested",
      strength: "synthetic_tested",
      garmin: "not_account_tested",
      appleHealth: "not_account_tested",
    },
  };
}

export function addSyntheticFollowup(data, decision) {
  const start =
    data.clock > decision.effective ? data.clock : decision.effective;
  const offset = Math.round(
    (Date.parse(start) - Date.parse("2026-06-01")) / 86400000,
  );
  const records = scenario("working")
    .records.filter((r) => r.date >= "2026-06-01" && r.date < "2026-06-15")
    .map((r) => ({
      ...r,
      id: `followup:${start}:${r.id}`,
      date: shift(r.date, offset),
      ...(r.sessionId ? { sessionId: `followup:${start}:${r.sessionId}` } : {}),
      value: r.kind === "weight" ? r.value - 1 : r.value,
    }));
  return {
    ...data,
    clock: shift(start, 14),
    records: [...data.records, ...records],
  };
}
