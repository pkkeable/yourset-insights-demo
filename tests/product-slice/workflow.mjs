import { Budget } from "../../private-api/deadlines.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { scenario, addSyntheticFollowup } from "../../src/scenarios.mjs";
import { ownerTransaction, digest } from "../../private-api/commands.mjs";

export async function verifyWorkflow({
  admin,
  appPool,
  identity,
  browser,
  base,
  restart,
  pass,
}) {
  const owner = await identity(),
    other = await identity();
  const read = async (who = owner) => {
    const r = await fetch(base + "/api/private/dashboard", {
      headers: { cookie: who.cookie },
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  const post = async (type, body, key = randomUUID(), who = owner) => {
    const r = await fetch(base + "/api/private/commands/" + type, {
      method: "POST",
      headers: {
        cookie: who.cookie,
        Origin: base,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  let model = await read();
  const initial = {
    expectedPlanVersion: 0,
    evidenceRevision: model.evidenceRevision,
    analysisPeriodDays: 28,
    choice: "defer",
    reason: "Wait for a consistent observation window",
    effectiveDate: model.analysisDate,
    reviewDate: null,
  };
  const firstKey = randomUUID();
  const deferred = await post("decision", initial, firstKey);
  assert.equal(deferred.status, 200);
  assert.equal(deferred.body.decision.status, "defer");
  assert.deepEqual(
    (await post("decision", initial, firstKey)).body,
    deferred.body,
  );
  assert.equal(
    (await post("decision", { ...initial, reason: "Changed" }, firstKey)).body
      .error.code,
    "idempotency_mismatch",
  );
  assert.equal((await read()).planVersion, 0);
  pass(
    "decision without plan",
    "durable defer, replay and mismatch without inventing a plan revision",
  );

  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "yourset_session",
      value: owner.cookie.split("=")[1],
      url: base,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator("#edit-plan").click();
  for (const [name, value] of Object.entries({
    calories: "2350",
    protein: "168",
    reason: "Synthetic standalone target change",
  }))
    await page.locator(`#plan-form [name=${name}]`).fill(value);
  await page.locator("#plan-form button.primary").click();
  await page
    .locator(".global-status")
    .filter({ hasText: "Plan version 1 saved" })
    .waitFor();
  await page.reload();
  await page
    .locator("[data-current-plan]")
    .filter({ hasText: "2,350 kcal" })
    .waitFor();
  model = await read();
  assert.equal(model.planVersion, 1);
  assert.equal(model.history.length, 1);
  assert.equal(model.history[0].status, "defer");
  const planCount = Number(
    (
      await admin.query("select count(*) from yourset.plans where owner=$1", [
        owner.owner,
      ])
    ).rows[0].count,
  );
  assert.equal(planCount, 1);
  const planSnapshot = (
    await admin.query("select snapshot from yourset.plans where owner=$1", [
      owner.owner,
    ])
  ).rows[0].snapshot;
  assert.equal(planSnapshot.records.length, model.data.records.length);
  assert.equal(planSnapshot.originalPlans.length, scenario().plans.length);
  pass(
    "standalone plan",
    "browser save and reload update targets without creating an adjustment",
  );

  const activeBody = {
    ...initial,
    expectedPlanVersion: 1,
    choice: "accept",
    reason: "Review execution before changing targets",
  };
  assert.equal(
    (await post("decision", { ...activeBody, expectedPlanVersion: 0 })).body
      .error.code,
    "version_conflict",
  );
  assert.equal(
    (
      await post("decision", {
        ...activeBody,
        evidenceRevision: "0".repeat(64),
      })
    ).body.error.code,
    "evidence_conflict",
  );
  await page.locator('button[data-page="Investigations"]').first().click();
  await page.locator("#decision-form [name=reason]").fill(activeBody.reason);
  await page.locator("#decision-form [name=review]").fill("2026-07-13");
  await page.locator("#decision-form button.primary").click();
  await page
    .locator("#private-save-status")
    .filter({ hasText: "Decision version 1 saved" })
    .waitFor();
  model = await read();
  const action = model.history.find((d) => d.status === "active");
  assert(action);
  assert.equal(
    (await post("decision", activeBody)).body.error.code,
    "already_active",
  );
  const originalSnapshot = (
    await admin.query(
      "select snapshot from yourset.decisions where owner=$1 and id=$2",
      [owner.owner, action.id],
    )
  ).rows[0].snapshot;
  const reviewBody = {
    decisionId: action.id,
    expectedDecisionVersion: 1,
    evidenceRevision: model.evidenceRevision,
    analysisPeriodDays: 28,
    outcome: "continue_plan",
    note: "Continue while more observations accumulate",
  };
  const otherModel = await read(other);
  assert.equal(
    (
      await post(
        "review-completion",
        { ...reviewBody, evidenceRevision: otherModel.evidenceRevision },
        randomUUID(),
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        "review-completion",
        { ...reviewBody, decisionId: randomUUID() },
        randomUUID(),
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post("review-completion", {
        ...reviewBody,
        expectedDecisionVersion: 2,
      })
    ).body.error.code,
    "decision_version_conflict",
  );
  pass(
    "decision conflicts",
    "stale versions/evidence, duplicate active actions and other-owner review denied",
  );

  await admin.query(
    "create function yourset.review_failure() returns trigger language plpgsql as $$begin raise exception using errcode='08006',message='injected';end$$;create trigger injected_review after update on yourset.decisions for each row execute function yourset.review_failure()",
  );
  const rollbackResult = await post("review-completion", reviewBody);
  assert.equal(rollbackResult.status, 503);
  assert.equal(
    (await read()).history.find((d) => d.id === action.id).status,
    "active",
  );
  assert.equal(
    Number(
      (
        await admin.query(
          "select count(*) from yourset.reviews where owner=$1",
          [owner.owner],
        )
      ).rows[0].count,
    ),
    0,
  );
  await admin.query(
    "drop trigger injected_review on yourset.decisions;drop function yourset.review_failure()",
  );
  await assert.rejects(
    ownerTransaction(appPool, owner.owner, new Budget(), (q) =>
      q("update yourset.decisions set snapshot='{}'::jsonb where id=$1", [
        action.id,
      ]),
    ),
    (e) => e.code === "42501",
  );
  assert.equal(
    (await appPool.query("select * from yourset.reviews")).rowCount,
    0,
  );
  pass(
    "review rollback",
    "failed completion leaves action active and no review; snapshot updates denied",
  );
  const future = addSyntheticFollowup(model.data, action);
  await admin.query(
    "update yourset.evidence set data=$2,revision=$3 where owner=$1",
    [
      owner.owner,
      { ...future, plans: scenario().plans },
      digest({ ...future, plans: scenario().plans }),
    ],
  );
  await page.reload();
  await page.locator(`[data-review-id="${action.id}"]`).click();
  await page
    .locator("#review-form [name=note]")
    .fill(
      "Consistent execution observed; keep the plan and continue monitoring.",
    );
  await page.locator("#review-form button.primary").click();
  await page
    .locator(".global-status")
    .filter({ hasText: "decision version 2 completed" })
    .waitFor();
  model = await read();
  const closed = model.history.find((d) => d.id === action.id);
  assert.equal(closed.status, "completed");
  assert.equal(closed.reviewResult.outcome, "continue_plan");
  assert.equal(model.planVersion, 1);
  assert.equal(model.data.plans.at(-1).calories, 2350);
  assert.deepEqual(
    (
      await admin.query(
        "select snapshot from yourset.decisions where owner=$1 and id=$2",
        [owner.owner, action.id],
      )
    ).rows[0].snapshot,
    originalSnapshot,
  );
  const receipt = (
    await admin.query(
      "select key,result from yourset.receipts where owner=$1 order by ordinal desc limit 1",
      [owner.owner],
    )
  ).rows[0];
  const committedReview = {
    ...reviewBody,
    evidenceRevision: model.evidenceRevision,
    note: closed.reviewResult.note,
  };
  assert.deepEqual(
    (await post("review-completion", committedReview, receipt.key)).body,
    receipt.result,
  );
  assert.equal(
    (await post("review-completion", committedReview)).body.error.code,
    "already_completed",
  );
  assert.equal(
    (
      await post(
        "review-completion",
        { ...committedReview, note: "Changed" },
        receipt.key,
      )
    ).body.error.code,
    "idempotency_mismatch",
  );
  assert.equal(
    Number(
      (
        await admin.query(
          "select count(*) from yourset.reviews where owner=$1",
          [owner.owner],
        )
      ).rows[0].count,
    ),
    1,
  );
  pass(
    "review persistence",
    "browser review closes action, preserves original evidence/targets and replays exactly once",
  );

  await restart();
  await page.reload();
  await page
    .locator("[data-current-plan]")
    .filter({ hasText: "2,350 kcal" })
    .waitFor();
  assert.equal(
    await page.locator(`[data-review-id="${action.id}"]`).count(),
    0,
  );
  assert.deepEqual((await read()).history, model.history);
  assert.deepEqual(errors, []);
  await context.close();
  pass(
    "workflow restart",
    "plan, deferred decision and completed review survive real process restart",
  );
}
