import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  GET,
  EXPECTED_FINGERPRINT,
  authorized,
  canary,
  createHandler,
  fingerprint,
} from "../api/cron/engine-canary.js";
import { SCENARIOS } from "../src/scenarios.mjs";
import { VERSION } from "../src/metrics.mjs";

const SECRET = "synthetic-test-secret-0123456789abcdef";
const URL_ = "https://example.test/api/cron/engine-canary";
const request = (authorization) =>
  new Request(
    URL_,
    authorization === undefined ? {} : { headers: { authorization } },
  );

// A handler whose work and logging are observable, so tests can prove the
// work never runs for an unauthorized caller.
function harness(options = {}) {
  const { check } = options;
  const secret = "secret" in options ? options.secret : SECRET;
  const calls = { check: 0, log: [], error: [] };
  const handler = createHandler({
    secret: () => secret,
    check: () => {
      calls.check++;
      return check ? check() : { engine: VERSION, scenarios: 0 };
    },
    log: (line) => calls.log.push(line),
    error: (line) => calls.error.push(line),
  });
  return { handler, calls };
}

async function expectUnauthorized(handler, calls, authorization) {
  const r = await handler(request(authorization));
  assert.equal(r.status, 401, `header ${JSON.stringify(authorization)}`);
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: false, error: "unauthorized" });
  assert.equal(calls.check, 0, "work must not run without authorization");
  assert.equal(calls.log.length, 0);
}

test("cron rejects a missing Authorization header", async () => {
  const { handler, calls } = harness();
  await expectUnauthorized(handler, calls, undefined);
});

test("cron rejects wrong secrets, wrong schemes and near misses", async () => {
  const { handler, calls } = harness();
  for (const header of [
    "",
    "Bearer",
    "Bearer ",
    `Bearer ${SECRET.slice(0, -1)}x`, // same length, wrong value
    `Bearer ${SECRET.slice(0, -1)}`, // shorter
    `Bearer ${SECRET}0`, // longer
    `bearer ${SECRET}`,
    `Basic ${SECRET}`,
    `Bearer  ${SECRET}`,
    `Bearer ${SECRET} x`,
    SECRET,
  ])
    await expectUnauthorized(handler, calls, header);
});

test("cron fails closed when CRON_SECRET is unset or empty", async () => {
  for (const secret of [undefined, ""]) {
    const { handler, calls } = harness({ secret });
    for (const header of [
      undefined,
      "Bearer ",
      "Bearer undefined",
      `Bearer ${SECRET}`,
    ])
      await expectUnauthorized(handler, calls, header);
  }
  assert.equal(authorized("Bearer ", ""), false);
  assert.equal(authorized("Bearer undefined", undefined), false);
  assert.equal(authorized(null, SECRET), false);
});

test("cron returns 200 JSON and logs exactly one line on success", async () => {
  const { handler, calls } = harness({
    check: () => ({ engine: VERSION, scenarios: 10, fingerprint: "abc" }),
  });
  const r = await handler(request(`Bearer ${SECRET}`));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.engine, VERSION);
  assert.equal(body.scenarios, 10);
  assert.equal(calls.check, 1);
  assert.equal(calls.log.length, 1);
  assert.match(calls.log[0], /^engine-canary ok /);
  assert(!calls.log[0].includes(SECRET), "the secret is never logged");
  assert.equal(calls.error.length, 0);
});

test("cron returns 503 JSON when the work fails, without a success line", async () => {
  const { handler, calls } = harness({
    check: () => {
      throw Error("synthetic engine failure");
    },
  });
  const r = await handler(request(`Bearer ${SECRET}`));
  assert.equal(r.status, 503);
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: false, error: "canary failed" });
  assert.equal(calls.log.length, 0);
  assert.equal(calls.error.length, 1);
  assert.match(
    calls.error[0],
    /^engine-canary failed: synthetic engine failure/,
  );
});

test("canary throws on an engine fingerprint mismatch", () => {
  assert.throws(() => canary("0".repeat(64)), /fingerprint mismatch/);
});

test("pinned fingerprint matches the engine on this runtime", () => {
  // The production canary compares Vercel's Node runtime against this pin.
  // If an intentional engine change breaks this, update EXPECTED_FINGERPRINT.
  assert.equal(fingerprint(), EXPECTED_FINGERPRINT);
  assert.deepEqual(canary(), {
    engine: VERSION,
    scenarios: SCENARIOS.length,
    fingerprint: EXPECTED_FINGERPRINT,
  });
});

test("deployed GET reads CRON_SECRET per request and runs the real engine", async () => {
  const saved = process.env.CRON_SECRET;
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(request(`Bearer ${SECRET}`))).status, 401);
    process.env.CRON_SECRET = SECRET;
    assert.equal((await GET(request("Bearer wrong"))).status, 401);
    const r = await GET(request(`Bearer ${SECRET}`));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      engine: VERSION,
      scenarios: SCENARIOS.length,
      fingerprint: EXPECTED_FINGERPRINT,
    });
    assert.equal(lines.length, 1);
  } finally {
    console.log = original;
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});

test("cron path is scheduled daily and reaches the function unintercepted", async () => {
  const root = new URL("../", import.meta.url);
  const config = JSON.parse(await readFile(new URL("vercel.json", root)));
  assert.deepEqual(config.crons, [
    { path: "/api/cron/engine-canary", schedule: "17 11 * * *" },
  ]);
  // Hobby plans allow at most one run per day: fixed minute and hour only.
  for (const { schedule } of config.crons)
    assert.match(schedule, /^\d{1,2} \d{1,2} \* \* \*$/);
  // Each cron path maps to a deployed function exporting GET.
  for (const { path } of config.crons) {
    const mod = await import(new URL(`.${path}.js`, root));
    assert.equal(typeof mod.GET, "function");
  }
  // No routing middleware, rewrites or redirects sit in front of the route:
  // the bearer check is its only gate. Adding any of these must exempt
  // /api/cron/ explicitly and extend this test.
  const top = await readdir(root);
  assert(!top.some((f) => /^middleware\.(?:[cm]?js|ts)$/.test(f)));
  for (const key of ["rewrites", "redirects", "routes", "trailingSlash"])
    assert.equal(config[key], undefined, `vercel.json ${key}`);
});
