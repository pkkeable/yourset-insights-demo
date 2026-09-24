/** Offline source projections. Intentionally absent from the browser allowlist. */
import { localDate } from "../src/metrics.mjs";
const finite = (x) => typeof x === "number" && Number.isFinite(x);
export const capabilities = {
  hevy: {
    status: "synthetic_tested",
    account: "not_tested",
    fields: [
      "session ID",
      "start time",
      "exercise template ID",
      "recorded load",
      "repetitions",
    ],
    gaps: [
      "Routine definitions require separate verification",
      "Equipment/load convention and movement mappings require explicit configuration",
    ],
  },
  appleHealth: {
    status: "synthetic_tested",
    account: "not_tested",
    fields: [
      "original writer",
      "observation time",
      "energy",
      "protein",
      "weight",
      "steps",
    ],
    gaps: [
      "Actual Health Auto Export delivery schema not account-verified",
      "Missing source IDs or writer metadata block overlap resolution",
      "Food-log completeness must be explicitly established",
    ],
  },
  garmin: {
    status: "synthetic_tested",
    account: "not_tested",
    fields: [
      "activity summaries",
      "sleep",
      "HRV",
      "resting HR",
      "chart channels",
    ],
    gaps: ["Field mapping and unit comparisons pending live validation"],
  },
};
export function hevyWorkout(workout, { timezone, exerciseMap }) {
  if (!workout.id || !workout.start_time || !Array.isArray(workout.exercises))
    throw Error("schema_mismatch");
  const rows = [];
  for (const exercise of workout.exercises) {
    const mapping = exerciseMap[exercise.exercise_template_id];
    if (!mapping) continue; // No invented equipment or movement semantics.
    const sets = exercise.sets.filter(
      (s) => finite(s.weight_kg) && finite(s.reps) && s.type !== "warmup",
    );
    for (const [i, s] of sets.entries())
      rows.push({
        id: `${workout.id}:${exercise.index}:${i}`,
        revision: 1,
        kind: "lift",
        value: 1,
        unit: "session",
        date: localDate(workout.start_time, timezone),
        sessionId: String(workout.id),
        exercise: exercise.exercise_template_id,
        equipment: mapping.equipment,
        loadConvention: mapping.loadConvention,
        reps: s.reps,
        load: s.weight_kg,
        movements: mapping.movements,
        writer: "Hevy",
        adapter: "hevy-candidate/1.0.0",
        device: "unknown",
        observationClass: "source_observation",
        observedAt: workout.start_time,
        effort: finite(s.rpe) ? s.rpe : null,
      });
  }
  return {
    rows,
    status: rows.length ? "available" : "mapping_required",
    programDefinitions: "not_verified",
  };
}
/** A strict selected-sample contract, not an assertion about any export app's native JSON. */
export function appleSamples(
  samples,
  { timezone, writers, completeDates = [] },
) {
  const types = {
    dietary_energy: { kind: "calories", unit: "kcal" },
    dietary_protein: { kind: "protein", unit: "g" },
    body_mass: { kind: "weight", unit: "kg" },
    step_count: { kind: "steps", unit: "count" },
  };
  const rows = [];
  const seen = new Set();
  for (const s of samples) {
    const definition = types[s.type];
    if (!definition) continue;
    if (
      !s.id ||
      !s.writer ||
      !s.start ||
      !finite(s.value) ||
      s.unit !== definition.unit
    )
      throw Error("schema_or_unit_mismatch");
    if (writers[definition.kind] !== s.writer) continue;
    const key = `${s.writer}:${s.id}:${s.revision ?? 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: s.id,
      revision: s.revision ?? 1,
      kind: definition.kind,
      value: s.value,
      unit: s.unit,
      date: localDate(s.start, timezone),
      writer: s.writer,
      adapter: "apple-selected-sample/1.0.0",
      device: s.device ?? "unknown",
      observationClass: "source_observation",
      observedAt: s.start,
      complete: completeDates.includes(localDate(s.start, timezone)),
      definition: "Selected sample; daily aggregation required before analysis",
    });
  }
  return {
    rows,
    status: rows.length ? "available" : "valid_empty",
    transport: "not_account_verified",
  };
}
