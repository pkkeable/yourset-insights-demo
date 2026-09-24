import test from "node:test";
import assert from "node:assert/strict";
import { command } from "../private-api/commands.mjs";
import { Budget, publicError } from "../private-api/deadlines.mjs";
import { configuration } from "../private-api/config.mjs";
import { createServer } from "../server.mjs";
const body = {
  expectedPlanVersion: 0,
  evidenceRevision: "a".repeat(64),
  analysisPeriodDays: 28,
  calories: 2300,
  proteinGrams: 156,
  reason: " Synthetic test ",
  effectiveDate: "2026-06-29",
};
const key = "00000000-0000-4000-8000-000000000001";
test("canonical digest ignores JSON property order and normalizes optional review/text", () => {
  const a = command(body, key),
    b = command(
      {
        ...Object.fromEntries(Object.entries(body).reverse()),
        reason: "Synthetic test",
        reviewDate: null,
      },
      key,
    );
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, command({ ...body, calories: 2301 }, key).digest);
});
test("contract rejects owner, invalid dates and unsupported reporting periods", () => {
  for (const b of [
    { ...body, owner: "someone" },
    { ...body, effectiveDate: "2026-02-30" },
    { ...body, analysisPeriodDays: 365 },
  ])
    assert.throws(
      () => command(b, key),
      (e) => e.status === 400,
    );
});
test("client-correctable SQL rollbacks stay 400/409; infrastructure stays 503", () => {
  for (const code of ["23503", "23514", "23502", "22P02"]) {
    const e = publicError({ code });
    assert.equal(e.status, 400);
    assert.equal(e.code, "constraint_violation");
  }
  assert.equal(publicError({ code: "23505" }).status, 409);
  for (const code of ["08006", "53300", "57014", "55P03"])
    assert.equal(publicError({ code }).status, 503);
});
test("operation caps shrink with remaining command budget instead of accumulating", () => {
  const b = new Budget(5000);
  assert.equal(b.remaining(2000), 2000);
  b.end = performance.now() + 700;
  assert.ok(b.remaining(2000) <= 550);
  b.end = performance.now() + 100;
  assert.throws(
    () => b.remaining(),
    (e) => e.status === 503,
  );
});
test("private configuration rejects missing templates, unsupported URLs and deadline drift", () => {
  assert.throws(() => configuration({}), /Missing private configuration/);
  assert.throws(
    () => configuration({ APP_ORIGIN: "REPLACE_WITH_EXACT_LOCAL_ORIGIN" }),
    /Missing private configuration/,
  );
  assert.throws(
    () => configuration({ APP_ORIGIN: "https://example.invalid" }),
    /Local slice only/,
  );
  assert.throws(
    () =>
      configuration({
        APP_ORIGIN: "http://127.0.0.1:4187",
        SESSION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        SESSION_ENCRYPTION_KEY_ID: "test",
        SESSION_VALIDITY_TIMEOUT_MS: "900",
      }),
    /Slice deadline/,
  );
});
test("served private runtime marker and CSP restrict connection access to the API prefix", async () => {
  const app = createServer(
    async (req, res) => res.end("test"),
    "http://127.0.0.1:4187",
  );
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  try {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/`);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /connect-src http:\/\/127.0.0.1:4187\/api\/private\/;/);
    assert.ok(!csp.includes("connect-src 'self'"));
    assert.ok(
      (await response.text()).includes(
        'name="yourset-runtime" content="private-local"',
      ),
    );
  } finally {
    await new Promise((r) => app.close(r));
  }
});

test("command types have distinct receipts and reject unrelated fields", () => {
  const { calories, proteinGrams, ...decisionBody } = body;
  const decision = command(
    { ...decisionBody, choice: "defer" },
    key,
    "decision",
  );
  assert.equal(decision.payload.choice, "defer");
  assert.equal(decision.payload.reason, "Synthetic test");
  assert.notEqual(command(body, key, "plan").digest, command(body, key).digest);
  for (const [type, b] of [
    ["decision", { ...body, choice: "accept" }],
    ["plan", { ...body, owner: key }],
    [
      "review-completion",
      {
        decisionId: key,
        expectedDecisionVersion: 0,
        evidenceRevision: body.evidenceRevision,
        analysisPeriodDays: 28,
        outcome: "stop",
        note: "A note",
      },
    ],
  ])
    assert.throws(
      () => command(b, key, type),
      (e) => e.status === 400,
    );
});
