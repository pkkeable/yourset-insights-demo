import { planAt } from "../src/metrics.mjs";
export function applyPlans(source, plans) {
  const data = structuredClone(source);
  for (const plan of [...plans].sort((a, b) => a.version - b.version)) {
    data.plans.push({
      ...planAt(data.plans, plan.effectiveDate),
      id: plan.id,
      version: plan.version,
      effective: plan.effectiveDate,
      calories: plan.calories,
      protein: plan.proteinGrams,
      reason: plan.reason ?? "Saved plan change",
    });
  }
  return data;
}
