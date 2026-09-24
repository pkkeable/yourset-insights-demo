import test from "node:test";
import assert from "node:assert/strict";
import { appleSamples, hevyWorkout } from "../adapters/intake.mjs";
test("Apple projection retains original writer and never assumes complete logging", () => {
  const s = {
    id: "one",
    writer: "Food writer",
    start: "2026-06-01T12:00:00Z",
    value: 400,
    type: "dietary_energy",
    unit: "kcal",
  };
  const r = appleSamples(
    [s, s, { ...s, id: "mirror", writer: "Mirrored app" }],
    { timezone: "Europe/London", writers: { calories: "Food writer" } },
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].writer, "Food writer");
  assert.equal(r.rows[0].complete, false);
});
test("Apple projection blocks missing provenance and incompatible units", () => {
  assert.throws(() =>
    appleSamples(
      [
        {
          id: "x",
          start: "2026-06-01T00:00:00Z",
          value: 10,
          type: "body_mass",
          unit: "lb",
        },
      ],
      { timezone: "UTC", writers: { weight: "scale" } },
    ),
  );
});
test("Hevy history never invents prescribed routine or effort", () => {
  const w = {
    id: "session",
    start_time: "2026-06-01T12:00:00Z",
    exercises: [
      {
        index: 0,
        exercise_template_id: "row",
        sets: [{ weight_kg: 40, reps: 8, type: "normal" }],
      },
    ],
  };
  assert.equal(
    hevyWorkout(w, { timezone: "UTC", exerciseMap: {} }).status,
    "mapping_required",
  );
  const r = hevyWorkout(w, {
    timezone: "UTC",
    exerciseMap: {
      row: {
        equipment: "cable-A",
        loadConvention: "stack kg",
        movements: ["upper"],
      },
    },
  });
  assert.equal(r.rows[0].effort, null);
  assert.equal(r.programDefinitions, "not_verified");
  assert.equal(r.rows[0].sessionId, "session");
});
