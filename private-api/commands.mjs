import { applyPlans } from "./plan-model.mjs";
import { createHash, randomUUID } from "node:crypto";
import { analyze, reviewState, VERSION } from "../src/metrics.mjs";
import { connection, problem } from "./deadlines.mjs";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const text = (value) =>
  typeof value === "string" && !!value.trim() && value.trim().length <= 2000;
const version = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const changesPlan = (type) => ["plan-decision", "plan"].includes(type);
export function command(body, key, type = "plan-decision") {
  const common = ["evidenceRevision", "analysisPeriodDays"];
  const fields = {
    "plan-decision": [
      ...common,
      "expectedPlanVersion",
      "calories",
      "proteinGrams",
      "reason",
      "effectiveDate",
      "reviewDate",
    ],
    plan: [
      ...common,
      "expectedPlanVersion",
      "calories",
      "proteinGrams",
      "reason",
      "effectiveDate",
    ],
    decision: [
      ...common,
      "expectedPlanVersion",
      "choice",
      "reason",
      "effectiveDate",
      "reviewDate",
    ],
    "review-completion": [
      ...common,
      "decisionId",
      "expectedDecisionVersion",
      "outcome",
      "note",
    ],
  };
  if (
    !fields[type] ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !fields[type].includes(k))
  )
    throw problem(400, "invalid_command");
  if (!uuid(key)) throw problem(400, "invalid_idempotency_key");
  if (
    typeof body.evidenceRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.evidenceRevision) ||
    ![14, 28, 90, 180].includes(body.analysisPeriodDays)
  )
    throw problem(400, "invalid_command");
  let payload;
  if (type === "review-completion") {
    if (
      !uuid(body.decisionId) ||
      !version(body.expectedDecisionVersion, 1) ||
      !["continue_plan", "conclude", "stop"].includes(body.outcome) ||
      !text(body.note)
    )
      throw problem(400, "invalid_command");
    payload = {
      type,
      schemaVersion: 1,
      decisionId: body.decisionId.toLowerCase(),
      expectedDecisionVersion: body.expectedDecisionVersion,
      evidenceRevision: body.evidenceRevision,
      analysisPeriodDays: body.analysisPeriodDays,
      outcome: body.outcome,
      note: body.note.trim(),
    };
  } else {
    if (
      !version(body.expectedPlanVersion) ||
      !text(body.reason) ||
      !date(body.effectiveDate) ||
      (body.reviewDate != null && !date(body.reviewDate))
    )
      throw problem(400, "invalid_command");
    if (
      changesPlan(type) &&
      (!Number.isFinite(body.calories) ||
        body.calories <= 0 ||
        !Number.isFinite(body.proteinGrams) ||
        body.proteinGrams <= 0)
    )
      throw problem(400, "invalid_command");
    if (
      type === "decision" &&
      !["accept", "edit", "defer", "reject", "continue_unchanged"].includes(
        body.choice,
      )
    )
      throw problem(400, "invalid_command");
    // Keep the original combined-command representation stable for durable retries.
    payload = {
      type,
      schemaVersion: 1,
      expectedPlanVersion: body.expectedPlanVersion,
      evidenceRevision: body.evidenceRevision,
      analysisPeriodDays: body.analysisPeriodDays,
      ...(changesPlan(type)
        ? { calories: body.calories, proteinGrams: body.proteinGrams }
        : { choice: body.choice }),
      reason: body.reason.trim(),
      effectiveDate: body.effectiveDate,
      reviewDate: body.reviewDate ?? null,
    };
  }
  return { key: key.toLowerCase(), payload, digest: digest(payload) };
}
export async function ownerTransaction(
  pool,
  owner,
  budget,
  fn,
  trace = () => {},
) {
  return connection(pool, budget, async (q) => {
    await q("begin");
    await q("select set_config('yourset.owner',$1,true)", [owner]);
    trace("transaction_open");
    const result = await fn(q);
    await q("commit");
    trace("transaction_committed");
    return result;
  });
}
export async function readContext(pool, owner, budget) {
  return ownerTransaction(pool, owner, budget, async (q) => {
    const row = (
      await q(
        `select revision,data,(select coalesce(max(version),0) from yourset.plans) as version,(select result from yourset.receipts order by ordinal desc limit 1) as latest from yourset.evidence`,
      )
    ).rows[0];
    if (!row) throw problem(409, "evidence_unavailable");
    return {
      planVersion: row.version,
      evidenceRevision: row.revision,
      analysisDate: row.data.clock,
      scenarioId: row.data.id,
      latest: row.latest,
    };
  });
}
export async function commitCommand(pool, owner, budget, c, trace) {
  return ownerTransaction(
    pool,
    owner,
    budget,
    async (q) => {
      await q("select pg_advisory_xact_lock(hashtextextended($1,0))", [owner]);
      const old = (
        await q("select digest,result from yourset.receipts where key=$1", [
          c.key,
        ])
      ).rows[0];
      if (old) {
        if (old.digest !== c.digest) throw problem(409, "idempotency_mismatch");
        return old.result;
      }
      const p = c.payload;
      let selected;
      if (p.type === "review-completion") {
        selected = (
          await q("select content from yourset.decisions where id=$1", [
            p.decisionId,
          ])
        ).rows[0]?.content;
        if (!selected) throw problem(404, "decision_not_found");
        if (selected.status === "completed")
          throw problem(409, "already_completed");
        if (selected.status !== "active")
          throw problem(409, "decision_not_active");
        if (selected.version !== p.expectedDecisionVersion)
          throw problem(409, "decision_version_conflict");
      }
      const current = Number(
        (
          await q(
            "select coalesce(max(version),0) as version from yourset.plans",
          )
        ).rows[0].version,
      );
      if (p.type !== "review-completion" && current !== p.expectedPlanVersion)
        throw problem(409, "version_conflict", { currentPlanVersion: current });
      const evidence = (await q("select revision,data from yourset.evidence"))
        .rows[0];
      if (!evidence || evidence.revision !== p.evidenceRevision)
        throw problem(409, "evidence_conflict", {
          currentEvidenceRevision: evidence?.revision,
        });
      if (p.type === "review-completion") {
        if (selected.effectiveDate > evidence.data.clock)
          throw problem(400, "invalid_dates");
      } else if (
        p.effectiveDate < evidence.data.clock ||
        (p.reviewDate && p.reviewDate < p.effectiveDate)
      )
        throw problem(400, "invalid_dates");
      if (
        changesPlan(p.type) &&
        (evidence.data.plans.some((x) => x.effective === p.effectiveDate) ||
          (
            await q("select 1 from yourset.plans where effective=$1", [
              p.effectiveDate,
            ])
          ).rowCount)
      )
        throw problem(409, "effective_date_conflict");
      const previous = (
        await q("select content from yourset.plans order by version")
      ).rows.map((x) => x.content);
      const data = applyPlans(evidence.data, previous);
      const snapshot = {
        originalPlans: data.plans,
        records: data.records,
        analysisDate: data.clock,
        analysisPeriodDays: p.analysisPeriodDays,
        analysis: analyze(data, p.analysisPeriodDays),
        ruleVersion: VERSION,
      };
      budget.remaining();
      const result = {
        commandId: randomUUID(),
        committedAt: new Date().toISOString(),
      };
      let receiptVersion = current;
      if (changesPlan(p.type)) {
        result.plan = {
          id: randomUUID(),
          version: current + 1,
          calories: p.calories,
          proteinGrams: p.proteinGrams,
          effectiveDate: p.effectiveDate,
          reason: p.reason,
        };
        receiptVersion = result.plan.version;
        await q(
          "insert into yourset.plans(owner,version,effective,content,snapshot) values($1,$2,$3,$4,$5)",
          [owner, receiptVersion, p.effectiveDate, result.plan, snapshot],
        );
      }
      if (["plan-decision", "decision"].includes(p.type)) {
        const choice = p.type === "plan-decision" ? "edit" : p.choice;
        const status = ["defer", "reject"].includes(choice) ? choice : "active";
        const adjustment = result.plan
          ? { calories: p.calories, protein: p.proteinGrams }
          : null;
        if (
          status === "active" &&
          (
            await q(
              `select 1 from yourset.decisions where content->>'status'='active' and content->>'choice'=$1 and content->>'reason'=$2 and content->>'effectiveDate'=$3 and coalesce(content->'adjustment','null'::jsonb)=$4::jsonb`,
              [choice, p.reason, p.effectiveDate, JSON.stringify(adjustment)],
            )
          ).rowCount
        )
          throw problem(409, "already_active");
        result.decision = {
          id: randomUUID(),
          version: 1,
          planVersion: receiptVersion,
          choice,
          status,
          reason: p.reason,
          adjustment,
          effectiveDate: p.effectiveDate,
          reviewDate: p.reviewDate,
          evidenceSnapshotId: randomUUID(),
        };
        await q(
          "insert into yourset.decisions(owner,id,plan_version,content,snapshot) values($1,$2,$3,$4,$5)",
          [
            owner,
            result.decision.id,
            receiptVersion || null,
            result.decision,
            snapshot,
          ],
        );
      }
      if (p.type === "review-completion") {
        const sufficient = !!reviewState(
          {
            ...selected,
            effective: selected.effectiveDate,
            review: selected.reviewDate,
          },
          data,
        ).enough;
        result.decisionId = selected.id;
        result.decisionVersion = selected.version + 1;
        result.status = "completed";
        result.review = {
          id: randomUUID(),
          outcome: p.outcome,
          note: p.note,
          reviewedAt: data.clock,
          evidenceSnapshotId: randomUUID(),
          evidenceSufficient: sufficient,
        };
        await q(
          "insert into yourset.reviews(owner,id,decision_id,content,snapshot) values($1,$2,$3,$4,$5)",
          [owner, result.review.id, selected.id, result.review, snapshot],
        );
        await q("update yourset.decisions set content=$2 where id=$1", [
          selected.id,
          {
            ...selected,
            version: result.decisionVersion,
            status: "completed",
            reviewResult: result.review,
          },
        ]);
      }
      await q(
        "insert into yourset.receipts(owner,key,digest,version,result) values($1,$2,$3,$4,$5)",
        [owner, c.key, c.digest, receiptVersion, result],
      );
      return result;
    },
    trace,
  );
}
