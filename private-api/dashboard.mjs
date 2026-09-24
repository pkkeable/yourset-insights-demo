import { applyPlans } from "./plan-model.mjs";
import { ownerTransaction } from "./commands.mjs";
import { problem } from "./deadlines.mjs";

// One representation of saved targets for both reads and subsequent commands.
export function dashboardDocument(row) {
  if (!row) throw problem(409, "evidence_unavailable");
  if (
    !Array.isArray(row.data?.records) ||
    !Array.isArray(row.data?.plans) ||
    row.data.records.length > 50000 ||
    row.plans.length > 1000 ||
    row.decisions.length > 1000
  )
    throw problem(503, "dashboard_unavailable");
  const data = applyPlans(row.data, row.plans);
  const history = row.decisions.map(({ content: d, snapshot: s }) => ({
    ...d,
    effective: d.effectiveDate,
    review: d.reviewDate,
    originalPlans: s.originalPlans,
    evidenceCount: s.evidenceCount ?? s.records?.length ?? 0,
    analysis: s.analysis,
    ruleVersion: s.ruleVersion,
    createdAt: s.analysisDate,
  }));
  return {
    schemaVersion: 1,
    evidenceRevision: row.revision,
    planVersion: Math.max(0, ...row.plans.map((p) => p.version)),
    analysisDate: data.clock,
    scenarioId: data.id,
    data,
    history,
    latest: row.latest,
  };
}
export async function readDashboard(pool, owner, budget) {
  return ownerTransaction(pool, owner, budget, async (q) => {
    // One SQL statement: records, plans, decisions and receipt share a snapshot.
    // RLS applies to every subquery through the restricted application role.
    const row = (
      await q(`select revision,data,
      coalesce((select jsonb_agg(content order by version) from yourset.plans),'[]'::jsonb) as plans,
      coalesce((select jsonb_agg(jsonb_build_object('content',content,'snapshot',jsonb_build_object('originalPlans',snapshot->'originalPlans','analysisDate',snapshot->'analysisDate','ruleVersion',snapshot->'ruleVersion','evidenceCount',jsonb_array_length(snapshot->'records'),'analysis',jsonb_build_object('title',snapshot->'analysis'->'title','action',snapshot->'analysis'->'action'))) order by content->>'effectiveDate',id) from yourset.decisions),'[]'::jsonb) as decisions,
      (select result from yourset.receipts order by ordinal desc limit 1) as latest
      from yourset.evidence`)
    ).rows[0];
    const doc = dashboardDocument(row);
    if (Buffer.byteLength(JSON.stringify(doc)) > 16 * 1024 * 1024)
      throw problem(503, "dashboard_unavailable");
    return doc;
  });
}
