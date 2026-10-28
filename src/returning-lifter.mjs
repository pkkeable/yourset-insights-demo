import { shift } from "./metrics.mjs";

// Independent fictional observations. Symmetric offsets reproduce each supplied
// weekly mean; the fixture's unknown provenance is never presented as real data.
export function returningLifter() {
  const weight = [200.2, 199.3, 199, 197.7, 197.9, 196.4, 195.8, 195.1];
  const calories = [2300, 2250, 2210, null, 2170, 2190, 2180, 2160];
  const sleep = [7, 7.2, 7.3, 7.4, 7.5, 7.5, 7.5, 7.5];
  const loads = {
    Bench: [135, 140, 145, 150, 152.5, 155, 155, 155],
    Squat: [185, 195, 200, 205, 210, 215, 215, 215],
    Row: [95, 97.5, 100, 105, 107.5, 110, 110, 110],
  };
  const records = [];
  const add = (kind, date, value, extra = {}) =>
    records.push({
      id: `fictional:${kind}:${date}:${extra.exercise ?? ""}`,
      revision: 1,
      date,
      kind,
      value,
      unit: { weight: "kg", calories: "kcal", sleep: "hours", lift: "session" }[
        kind
      ],
      writer: "Fictional fixture",
      adapter: "synthetic/returning-lifter/1",
      device: "Synthetic observation; source device unavailable",
      observationClass: "synthetic",
      fetchedAt: "2026-10-26T00:00:00Z",
      ...extra,
    });
  for (let w = 0; w < 8; w++)
    for (let day = 0; day < 7; day++) {
      const date = shift("2026-08-31", w * 7 + day);
      add("weight", date, (weight[w] + (day - 3) * 0.1) * 0.45359237);
      add("sleep", date, sleep[w] + (day - 3) * 0.05);
      if (calories[w] !== null)
        add("calories", date, calories[w] + (day - 3) * 20, { complete: true });
      if (day === 1 || day === 4)
        for (const [exercise, weekly] of Object.entries(loads))
          add("lift", date, 1, {
            exercise,
            equipment: "Barbell",
            loadConvention: "combined kg",
            reps: 5,
            load: (weekly[w] - (day === 1 ? 2.5 : 0)) * 0.45359237,
            sessionId: `fictional-session:${date}`,
            setType: "working",
            workoutElapsedMinutes: 45,
            movements: [exercise === "Squat" ? "lower" : "upper"],
          });
    }
  return {
    id: "returning",
    label: "Returning lifter · eight weeks",
    clock: "2026-10-26",
    timezone: "America/Los_Angeles",
    stepWriter: "Fictional fixture",
    records,
    plans: [
      {
        id: "fictional-plan-1",
        effective: "2026-08-31",
        phase: "Returning to lifting",
        calories: 2200,
        protein: null,
        proteinFloor: null,
        weekStartsOn: 1,
        weightRange: null,
        movement: ["upper", "lower"],
        reason:
          "Fictional person’s chosen target; 2200 kcal/day through Oct 25",
      },
    ],
    trainingCoverage: { lift: { from: "2026-08-31", to: "2026-10-25" } },
    metricAvailability: {
      protein: "unavailable",
      steps: "not connected",
      rhr: "not connected",
      hrv: "not connected",
      aerobic: "not connected",
      composition: "unavailable",
      waist: "unavailable",
    },
    sourceStatus: {
      nutrition: "synthetic_tested",
      strength: "synthetic_tested",
    },
  };
}
