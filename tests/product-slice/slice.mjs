import assert from "node:assert/strict";
import { verifyWorkflow } from "./workflow.mjs";
import { execFileSync, fork } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  randomBytes,
  randomUUID,
  createHmac,
  createHash,
  createCipheriv,
} from "node:crypto";
import http from "node:http";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { scenario } from "../../src/scenarios.mjs";
import { digest } from "../../private-api/commands.mjs";
import { connectBrowser } from "../../dev/local/browser.mjs";
const cfg = JSON.parse(
  execFileSync(
    "./node_modules/.bin/supabase",
    ["--workdir", "dev/local", "status", "-o", "json"],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(cfg.API_URL, "http://127.0.0.1:55431");
assert.equal(new URL(cfg.DB_URL).hostname, "127.0.0.1");
const admin = new pg.Pool({ connectionString: cfg.DB_URL });
const auth = createClient(cfg.API_URL, cfg.SECRET_KEY ?? cfg.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicKey = cfg.PUBLISHABLE_KEY ?? cfg.ANON_KEY;
let child, appPool, authPool, browser, proxy, proofServer;
const userIds = [],
  metadata = [];
let checks = 0;
const pass = (number, name) => {
  checks++;
  console.log(`PASS ${number}: ${name}`);
};
const base = "http://127.0.0.1:4187";
const totp = (secret) => {
  let bits = "";
  for (const ch of secret.toUpperCase().replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(ch)
      .toString(2)
      .padStart(5, "0");
  const raw = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))),
    t = Buffer.alloc(8);
  t.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", raw).update(t).digest();
  return ((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
};
const key = randomBytes(32);
async function identity() {
  const email = `slice-${randomUUID()}@example.invalid`,
    password = randomBytes(32).toString("hex");
  const u = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(u.error, null);
  userIds.push(u.data.user.id);
  const client = createClient(cfg.API_URL, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.equal(
    (await client.auth.signInWithPassword({ email, password })).error,
    null,
  );
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
  assert.equal(enrolled.error, null);
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totp(enrolled.data.totp.secret),
  });
  assert.equal(verified.error, null);
  const tokens = (await client.auth.getSession()).data.session,
    claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url"),
    );
  assert.equal(claims.aal, "aal2");
  const cookie = randomBytes(32).toString("hex"),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = {
    iv: iv.toString("hex"),
    body: Buffer.concat([
      cipher.update(JSON.stringify(tokens)),
      cipher.final(),
    ]).toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
  const owner = u.data.user.id;
  await admin.query("insert into yourset.allowed values($1)", [owner]);
  await admin.query(
    "insert into yourset.sessions values($1,$2,$3,$4,to_timestamp($5),false)",
    [
      createHash("sha256").update(cookie).digest("hex"),
      owner,
      claims.session_id,
      sealed,
      claims.exp,
    ],
  );
  const data = scenario();
  await admin.query("insert into yourset.evidence values($1,$2,$3)", [
    owner,
    digest(data),
    data,
  ]);
  return { owner, cookie: "yourset_session=" + cookie };
}
async function request(user, body, key = randomUUID(), url = base) {
  const r = await fetch(
    url +
      (body
        ? "/api/private/commands/plan-decision"
        : "/api/private/plan-decision"),
    {
      method: body ? "POST" : "GET",
      headers: {
        cookie: user.cookie,
        ...(body
          ? {
              "Content-Type": "application/json",
              Origin: base,
              "Idempotency-Key": key,
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  return {
    status: r.status,
    body: await r.json(),
    retry: r.headers.get("retry-after"),
  };
}
const counts = async (owner) =>
  (
    await admin.query(
      "select (select count(*) from yourset.plans where owner=$1) as plans,(select count(*) from yourset.decisions where owner=$1) as decisions,(select count(*) from yourset.receipts where owner=$1) as receipts",
      [owner],
    )
  ).rows[0];
const originalFunction =
  "create or replace function yourset.session_valid(sid uuid,uid uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.sessions where id=sid and user_id=uid)$$";
const bodyFor = (ctx, date = "2026-06-29") => ({
  expectedPlanVersion: ctx.planVersion,
  evidenceRevision: ctx.evidenceRevision,
  analysisPeriodDays: 28,
  calories: 2290,
  proteinGrams: 156,
  reason: "Independent synthetic adjustment",
  effectiveDate: date,
  reviewDate: null,
});
try {
  assert.equal(
    (await admin.query("select 1 from pg_namespace where nspname='yourset'"))
      .rowCount,
    0,
  );
  await admin.query(readFileSync("dev/local/product-schema.sql", "utf8"));
  const urls = {};
  for (const role of ["yourset_app", "yourset_auth"]) {
    const password = randomBytes(32).toString("hex");
    await admin.query(`alter role ${role} password '${password}'`);
    const u = new URL(cfg.DB_URL);
    u.username = role;
    u.password = password;
    urls[role] = u.toString();
  }
  appPool = new pg.Pool({ connectionString: urls.yourset_app, max: 1 });
  authPool = new pg.Pool({ connectionString: urls.yourset_auth, max: 1 });
  const user = await identity();
  const testEnv = {
    ...process.env,
    APP_MODE: "private-local",
    PORT: "4187",
    APP_ORIGIN: base,
    SUPABASE_URL: cfg.API_URL,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    APP_DATABASE_URL: urls.yourset_app,
    AUTH_DATABASE_URL: urls.yourset_auth,
    SESSION_ENCRYPTION_KEY: key.toString("base64"),
    SESSION_ENCRYPTION_KEY_ID: "disposable-test",
    SESSION_TTL_SECONDS: "1800",
    SESSION_VALIDITY_TIMEOUT_MS: "1000",
    PRIVATE_REQUEST_TIMEOUT_MS: "5000",
    DATABASE_STATEMENT_TIMEOUT_MS: "2000",
  };
  const startProduct = async () => {
    child = fork("server.mjs", [], {
      env: testEnv,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    child.on("message", (m) => {
      if (m.type === "private-metadata") metadata.push(m);
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(Error("product startup timeout")),
        10000,
      );
      child.on("message", (m) => {
        if (m.type === "ready") {
          clearTimeout(t);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(t);
        reject(Error("product entry exited"));
      });
    });
  };
  await startProduct();
  const html = await fetch(base);
  assert.match(
    html.headers.get("content-security-policy"),
    /connect-src http:\/\/127.0.0.1:4187\/api\/private\//,
  );
  assert.ok((await html.text()).includes("private-local"));
  const ctx = (await request(user)).body,
    cmd = bodyFor(ctx);
  assert.equal(
    (await request(user, { ...cmd, owner: randomUUID() })).status,
    400,
  );
  pass(5, "client owner rejected by product route");
  await admin.query(
    "create function yourset.test_failure() returns trigger language plpgsql as $$begin raise exception using errcode='08006',message='injected infrastructure failure';end$$;create trigger injected after insert on yourset.plans for each row execute function yourset.test_failure()",
  );
  let r = await request(user, cmd);
  assert.equal(r.status, 503);
  assert.equal(r.retry, "1");
  assert.deepEqual(await counts(user.owner), {
    plans: "0",
    decisions: "0",
    receipts: "0",
  });
  await admin.query(
    "drop trigger injected on yourset.plans;drop function yourset.test_failure()",
  );
  pass(6, "injected infrastructure failure rolls back all three rows");
  proxy = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const upstream = await fetch(base + req.url, {
      method: req.method,
      headers: { ...req.headers, host: new URL(base).host },
      body,
    });
    await upstream.arrayBuffer();
    res.destroy();
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const retryKey = randomUUID();
  await assert.rejects(
    request(user, cmd, retryKey, `http://127.0.0.1:${proxy.address().port}`),
  );
  r = await request(user, cmd, retryKey);
  assert.equal(r.status, 200);
  assert.deepEqual((await request(user, cmd, retryKey)).body, r.body);
  assert.deepEqual(await counts(user.owner), {
    plans: "1",
    decisions: "1",
    receipts: "1",
  });
  pass(7, "lost HTTP response retries to one durable command");
  assert.equal(
    (await request(user, { ...cmd, calories: 2300 }, retryKey)).body.error.code,
    "idempotency_mismatch",
  );
  pass(8, "different digest under same key is conflict");
  const next = bodyFor((await request(user)).body, "2026-06-30");
  const race = await Promise.all([request(user, next), request(user, next)]);
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 409]);
  assert.equal(
    race.find((x) => x.status === 409).body.error.code,
    "version_conflict",
  );
  pass(9, "same-version contention yields one commit and one conflict");
  const dashboardRead = async (identity) => {
    const response = await fetch(base + "/api/private/dashboard", {
      headers: identity ? { cookie: identity.cookie } : {},
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await dashboardRead()).status, 401);
  const durableRead = await dashboardRead(user);
  assert.equal(durableRead.status, 200);
  assert.equal(durableRead.body.planVersion, 2);
  assert.equal(durableRead.body.data.plans.at(-1).calories, next.calories);
  assert.equal(durableRead.body.history.length, 2);
  const otherReader = await identity();
  const otherRead = await dashboardRead(otherReader);
  assert.equal(otherRead.status, 200);
  assert.equal(otherRead.body.planVersion, 0);
  assert.equal(otherRead.body.history.length, 0);
  assert(
    !JSON.stringify(otherRead.body).includes(durableRead.body.history[0].id),
  );
  pass(
    "dashboard isolation",
    "owner-scoped records, saved targets and history; anonymous denial",
  );
  assert.equal(
    (await appPool.query("select * from yourset.plans")).rowCount,
    0,
  );
  pass(11, "unscoped restricted product pool reads no rows");
  async function negative() {
    const pool = new pg.Pool({ connectionString: urls.yourset_app, max: 1 });
    try {
      const c = await pool.connect();
      const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid;
      assert.equal(
        (await c.query("select current_setting('yourset.owner',true) as owner"))
          .rows[0].owner,
        null,
      );
      assert.equal((await c.query("select * from yourset.plans")).rowCount, 0);
      await c.query("begin");
      await c.query("select set_config('yourset.owner',$1,true)", [user.owner]);
      assert.ok((await c.query("select * from yourset.plans")).rowCount > 0);
      await c.query("commit");
      c.release();
      const reused = await pool.connect();
      try {
        assert.equal(
          (await reused.query("select pg_backend_pid() as pid")).rows[0].pid,
          pid,
        );
        assert.equal(
          (
            await reused.query(
              "select current_setting('yourset.owner',true) as owner",
            )
          ).rows[0].owner,
          "",
        );
        assert.equal(
          (await reused.query("select * from yourset.plans")).rowCount,
          0,
        );
      } finally {
        reused.release();
      }
    } finally {
      await pool.end();
    }
  }
  await negative();
  try {
    await admin.query(
      "alter policy owner_only on yourset.plans using(owner=current_setting('yourset.owner',true)::uuid) with check(owner=current_setting('yourset.owner',true)::uuid)",
    );
    await assert.rejects(negative(), (e) => e.code === "22P02");
  } finally {
    await admin.query(
      "alter policy owner_only on yourset.plans using(owner=nullif(current_setting('yourset.owner',true),'')::uuid) with check(owner=nullif(current_setting('yourset.owner',true),'')::uuid)",
    );
  }
  await negative();
  pass(
    14,
    "empty/unset owner denies after reuse; null-normalization mutation detected and restored",
  );
  for (const mode of ["error", "timeout"]) {
    const before = await counts(user.owner);
    await admin.query(
      `create or replace function yourset.session_valid(sid uuid,uid uuid) returns boolean language plpgsql security definer set search_path='' as $$begin ${mode === "error" ? "raise exception 'injected lookup failure';" : "perform pg_sleep(3);return true;"} end$$`,
    );
    const t = performance.now();
    r = await request(
      user,
      bodyFor(
        (
          await admin.query(
            "select max(version) as version from yourset.plans where owner=$1",
            [user.owner],
          )
        ).rows[0]
          ? { ...ctx, planVersion: 2 }
          : ctx,
        "2026-07-01",
      ),
    );
    const elapsed = performance.now() - t;
    assert.equal(r.status, 503);
    assert.equal(r.retry, "1");
    assert.deepEqual(Object.keys(r.body), ["error"]);
    assert.ok(elapsed < 1500);
    assert.deepEqual(await counts(user.owner), before);
    await admin.query(originalFunction);
    assert.equal((await request(user)).status, 200);
    const dirty = await admin.query(
      "select count(*) from pg_stat_activity where usename in ('yourset_app','yourset_auth') and state='idle in transaction (aborted)'",
    );
    assert.equal(Number(dirty.rows[0].count), 0);
    console.log(
      JSON.stringify({ check: "lookup_" + mode, elapsedMs: elapsed }),
    );
    pass(
      "fail-closed " + mode,
      "503 + Retry-After, no private data/write, bounded, pool healthy afterward",
    );
  }
  // Contention reaches the inner lock timeout before the outer command deadline.
  const blocker = await admin.connect();
  await blocker.query("begin");
  await blocker.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    user.owner,
  ]);
  const t = performance.now();
  try {
    r = await request(user, bodyFor((await request(user)).body, "2026-07-01"));
    assert.equal(r.status, 503);
    assert.equal(r.retry, "1");
    assert.ok(performance.now() - t < 2000);
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
  assert.equal((await request(user)).status, 200);
  pass(
    "deadline",
    "contended lock expires before overall deadline and recovers",
  );
  // Cumulative contention: upstream delay, lock wait, then two slow writes.
  const beforeDeadline = await counts(user.owner);
  await admin.query(
    "create or replace function yourset.session_valid(sid uuid,uid uuid) returns boolean language plpgsql security definer set search_path='' as $$begin perform pg_sleep(0.6);return exists(select 1 from auth.sessions where id=sid and user_id=uid);end$$",
  );
  await admin.query(
    "create function yourset.test_slow() returns trigger language plpgsql as $$begin perform pg_sleep(1.8);return new;end$$;create trigger slow_plan after insert on yourset.plans for each row execute function yourset.test_slow();create trigger slow_decision after insert on yourset.decisions for each row execute function yourset.test_slow()",
  );
  const held = await admin.connect();
  await held.query("begin");
  await held.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    user.owner,
  ]);
  const release = setTimeout(
    () => held.query("rollback").then(() => held.release()),
    1300,
  );
  const cumulativeStart = performance.now();
  try {
    r = await request(user, bodyFor({ ...ctx, planVersion: 2 }, "2026-07-01"));
    assert.equal(r.status, 503);
    assert.equal(r.retry, "1");
    const elapsed = performance.now() - cumulativeStart;
    assert.ok(elapsed < 5000);
    assert.deepEqual(await counts(user.owner), beforeDeadline);
    console.log(
      JSON.stringify({
        check: "cumulative_deadline",
        elapsedMs: elapsed,
        outerMs: 5000,
      }),
    );
  } finally {
    await admin.query(
      "drop trigger slow_plan on yourset.plans;drop trigger slow_decision on yourset.decisions;drop function yourset.test_slow()",
    );
    await admin.query(originalFunction);
  }
  assert.equal((await request(user)).status, 200);
  pass(
    "cumulative deadline",
    "remaining-budget statement cancellation precedes outer deadline; no writes; recovery",
  );
  // Command timing: new durable commands, not reads or receipt replays.
  const times = [];
  for (let i = 0; i < 100; i++) {
    const date = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
      context = (await request(user)).body;
    const t = performance.now();
    r = await request(user, bodyFor(context, date));
    assert.equal(r.status, 200);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      measurement: "product_command_ms",
      n: times.length,
      concurrency: 1,
      p50: times[49],
      p95: times[94],
      max: times.at(-1),
    }),
  );
  // Interactive browser proof uses a disposable loopback helper, never a product bypass.
  if (process.env.YOURSET_EXTERNAL_BROWSER === "1") {
    const before = await counts(user.owner);
    let saved,
      phase = 0,
      finish,
      fail;
    const completed = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    proofServer = http.createServer(async (req, res) => {
      try {
        if (req.url === "/bootstrap" && req.method === "GET") {
          res
            .writeHead(302, {
              "Set-Cookie": `${user.cookie}; HttpOnly; SameSite=Strict; Path=/`,
              Location: base,
              "Cache-Control": "no-store",
            })
            .end();
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(404).end();
          return;
        }
        if (req.url === "/saved" && phase === 0) {
          saved = await counts(user.owner);
          assert.equal(Number(saved.plans), Number(before.plans) + 1);
          assert.equal(saved.plans, saved.decisions);
          assert.equal(saved.plans, saved.receipts);
          const posts = metadata.filter(
            (x) => x.method === "POST" && x.status === 200,
          );
          assert.ok(
            posts.some(
              (p) =>
                metadata.some(
                  (x) =>
                    x.requestId === p.requestId &&
                    x.phase === "transaction_open",
                ) &&
                metadata.some(
                  (x) =>
                    x.requestId === p.requestId &&
                    x.phase === "transaction_committed",
                ),
            ),
          );
          phase = 1;
          console.log(
            "PASS observed browser save: route, transaction, durable plan/decision/receipt",
          );
        } else if (req.url === "/reloaded" && phase === 1) {
          assert.deepEqual(await counts(user.owner), saved);
          assert.ok(
            metadata.filter((x) => x.method === "GET" && x.status === 200)
              .length > 1,
          );
          phase = 2;
          pass(
            "runtime",
            "browser save and reload verified against real product and durable rows",
          );
        } else if (req.url === "/break" && phase === 2) {
          await admin.query(
            "create or replace function yourset.session_valid(sid uuid,uid uuid) returns boolean language plpgsql security definer set search_path='' as $$begin raise exception 'deliberate path failure';end$$",
          );
          phase = 3;
          console.log(
            "Real upstream lookup path deliberately broken for browser test",
          );
        } else if (req.url === "/failed" && phase === 3) {
          assert.deepEqual(await counts(user.owner), saved);
          assert.ok(
            metadata.some((x) => x.method === "POST" && x.status === 503),
          );
          await admin.query(originalFunction);
          phase = 4;
          pass(
            "runtime failure",
            "browser visible error + actual 503; durable counts unchanged",
          );
          res.end("verified");
          finish();
          return;
        } else {
          res.writeHead(409).end("invalid proof phase");
          return;
        }
        res.end("verified");
      } catch (e) {
        res.writeHead(500).end("proof failed");
        fail(e);
      }
    });
    await new Promise((r) => proofServer.listen(4188, "127.0.0.1", r));
    console.log(
      "BROWSER PROOF READY: open http://127.0.0.1:4188/bootstrap; helper is synthetic-only and disposable",
    );
    const limit = setTimeout(
      () => fail(Error("browser proof timeout")),
      900000,
    );
    try {
      await completed;
    } finally {
      clearTimeout(limit);
    }
    console.log(
      JSON.stringify({
        runtimeMetadata: metadata.filter((x) => x.method === "POST").slice(-12),
      }),
    );
  } else {
    // Browser exercises the served product HTML and existing edit-targets branch.
    browser = await connectBrowser();
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "yourset_session",
        value: user.cookie.split("=")[1],
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    const browserMeta = [];
    page.on("response", (response) => {
      if (response.url().startsWith(base + "/api/private/"))
        browserMeta.push({
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    await page.goto(base);
    await page.locator('button[data-page="Investigations"]').first().click();
    await page
      .locator("#private-save-status")
      .filter({ hasText: "restored" })
      .waitFor();
    await page.locator("#decision-form [name=choice]").selectOption("edit");
    await page.locator("#decision-form [name=calories]").fill("2300");
    await page.locator("#decision-form [name=protein]").fill("157");
    await page
      .locator("#decision-form [name=reason]")
      .fill("Synthetic browser route proof");
    await page.locator("#decision-form [name=effective]").fill("2027-01-01");
    await page.locator("#decision-form [name=review]").fill("2027-01-20");
    const before = await counts(user.owner);
    await page
      .locator(
        "#decision-form button[type=submit], #decision-form button:not([type])",
      )
      .last()
      .click();
    await page
      .locator("#private-save-status")
      .filter({ hasText: "Decision saved with it" })
      .waitFor();
    const after = await counts(user.owner);
    assert.equal(Number(after.plans), Number(before.plans) + 1);
    assert.equal(after.plans, after.decisions);
    assert.equal(after.plans, after.receipts);
    const savedVersion = (await request(user)).body.planVersion;
    await page.reload();
    await page.locator('button[data-page="Investigations"]').first().click();
    await page
      .locator("#private-save-status")
      .filter({ hasText: `Committed plan version ${savedVersion} restored` })
      .waitFor();
    await page.locator('button[data-page="Overview"]').first().click();
    assert.equal(
      await page.locator(".overview-trends > [data-card]").count(),
      6,
    );
    const model = await dashboardRead(user);
    const savedPlan = model.body.data.plans.find(
      (p) => p.version === savedVersion,
    );
    assert(savedPlan && savedPlan.calories === 2300);
    await page.locator("#edit-plan").click();
    assert.equal(
      await page
        .locator("main td")
        .filter({ hasText: /^2300$/ })
        .count(),
      1,
    );
    // Advance only the synthetic server observation clock to exercise the dated target.
    const originalEvidence = (
      await admin.query("select data from yourset.evidence where owner=$1", [
        user.owner,
      ])
    ).rows[0].data;
    const advanced = structuredClone(originalEvidence);
    advanced.clock = "2027-01-02";
    advanced.records.push({
      ...advanced.records.find((r) => r.kind === "calories"),
      id: "read-next-day",
      date: "2027-01-01",
      value: 2300,
      complete: true,
    });
    await admin.query(
      "update yourset.evidence set data=$2,revision=$3 where owner=$1",
      [user.owner, advanced, digest(advanced)],
    );
    await page.reload();
    await page
      .locator("[data-current-plan]")
      .filter({ hasText: "2,300 kcal" })
      .waitFor();
    await page
      .locator('[data-card="nutrition"]')
      .filter({ hasText: "2,300" })
      .waitFor();
    await admin.query(
      "update yourset.evidence set data=$2,revision=$3 where owner=$1",
      [user.owner, originalEvidence, digest(originalEvidence)],
    );
    await page.reload();
    await page.locator('button[data-page="Investigations"]').first().click();
    pass(
      "dashboard reload",
      "six cards and saved effective-dated targets drive the dashboard after reload",
    );
    const posts = metadata.filter(
      (x) => x.method === "POST" && x.status === 200,
    );
    assert.ok(
      posts.some(
        (p) =>
          metadata.some(
            (x) =>
              x.requestId === p.requestId && x.phase === "transaction_open",
          ) &&
          metadata.some(
            (x) =>
              x.requestId === p.requestId &&
              x.phase === "transaction_committed",
          ),
      ),
    );
    pass(
      "runtime",
      "real product entry, browser POST, transaction metadata, durable rows and reload restore",
    );
    await verifyWorkflow({
      admin,
      appPool,
      identity,
      browser,
      base,
      pass,
      restart: async () => {
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGTERM");
        });
        await startProduct();
      },
    });
    // Empty-plan and partial-data renderer proof uses a separate owner, not a browser data stub.
    const emptySource = scenario("gaps");
    emptySource.plans = [];
    emptySource.records = emptySource.records.filter(
      (r) => !["weight", "sleep", "rhr", "hrv", "aerobic"].includes(r.kind),
    );
    await admin.query(
      "update yourset.evidence set data=$2,revision=$3 where owner=$1",
      [otherReader.owner, emptySource, digest(emptySource)],
    );
    const emptyContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await emptyContext.addCookies([
      {
        name: "yourset_session",
        value: otherReader.cookie.split("=")[1],
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const emptyPage = await emptyContext.newPage(),
      renderErrors = [];
    emptyPage.on("pageerror", (e) => renderErrors.push(e.message));
    await emptyPage.goto(base);
    await emptyPage
      .locator('[data-card="weight"]')
      .filter({ hasText: "Not available" })
      .waitFor();
    assert.equal(
      await emptyPage.locator(".overview-trends > [data-card]").count(),
      6,
    );
    await emptyPage
      .locator('[data-chart="lift"][data-metric="minutes"]')
      .click();
    assert(
      (await emptyPage.locator('[data-card="lift"]').innerText()).includes(
        "minutes · this period",
      ),
    );
    await emptyPage
      .locator('[data-chart="recovery"][data-metric="rhr"]')
      .focus();
    await emptyPage.keyboard.press("Enter");
    assert.equal(
      await emptyPage
        .locator('[data-chart="recovery"][data-metric="rhr"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await emptyPage.screenshot({
      path: "/tmp/ysi-overview-desktop.png",
      fullPage: true,
    });
    await emptyPage.setViewportSize({ width: 390, height: 844 });
    assert(
      await emptyPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await emptyPage.screenshot({
      path: "/tmp/ysi-overview-mobile.png",
      fullPage: true,
    });
    await emptyPage.locator('button[data-page="Training"]').first().click();
    await emptyPage
      .getByText("No program sequence configured", { exact: true })
      .waitFor();
    await emptyPage.locator("#edit-plan").click();
    assert.equal(
      await emptyPage.locator("#plan-form [name=calories]").inputValue(),
      "",
    );
    assert.deepEqual(renderErrors, []);
    await emptyContext.close();
    pass(
      "renderer",
      "empty plans, missing recovery/weight, chart switches, keyboard and mobile overflow",
    );
    // Break the live server dependency without a browser interception or fallback.
    await admin.query(
      "create or replace function yourset.session_valid(sid uuid,uid uuid) returns boolean language plpgsql security definer set search_path='' as $$begin raise exception 'deliberate path failure';end$$",
    );
    await page.locator("#decision-form [name=choice]").selectOption("edit");
    await page.locator("#decision-form [name=calories]").fill("2310");
    await page.locator("#decision-form [name=protein]").fill("158");
    await page
      .locator("#decision-form [name=reason]")
      .fill("Synthetic failure proof");
    await page.locator("#decision-form [name=effective]").fill("2027-02-01");
    await page.locator("#decision-form [name=review]").fill("2027-02-20");
    await page
      .locator(
        "#decision-form button[type=submit], #decision-form button:not([type])",
      )
      .last()
      .click();
    await page
      .locator("#private-save-status")
      .filter({ hasText: "Server unavailable. Save not confirmed" })
      .waitFor();
    assert.deepEqual(await counts(user.owner), after);
    await admin.query(originalFunction);
    console.log(
      JSON.stringify({
        runtimePath: browserMeta,
        deliberateFailure:
          "visible error; durable counts unchanged; no browser-memory save",
      }),
    );
    pass(
      "runtime failure",
      "broken real server dependency fails visibly without local save",
    );
    await admin.query("delete from yourset.evidence where owner=$1", [
      user.owner,
    ]);
    await page.reload();
    await page
      .locator("#private-read-status")
      .filter({ hasText: "unavailable" })
      .waitFor();
    assert.equal(await page.locator(".overview-trends").count(), 0);
    assert.equal(await page.locator("#scenario").count(), 0);
    pass(
      "dashboard failed read",
      "missing canonical evidence blocks dashboard without synthetic fallback",
    );
  }
  const start = performance.now();
  await admin.query("update yourset.sessions set revoked=true where hash=$1", [
    createHash("sha256").update(user.cookie.split("=")[1]).digest("hex"),
  ]);
  r = await request(user, cmd, retryKey);
  assert.equal(r.status, 401);
  assert.equal((await request(user)).status, 401);
  console.log(
    JSON.stringify({
      measurement: "product_revocation_seconds",
      value: (performance.now() - start) / 1000,
    }),
  );
  pass(
    15,
    "old credential denied on command replay and private read after revocation",
  );
  console.log(`RESULT ${checks} product slice checks passed`);
} catch (e) {
  console.error(
    "PRODUCT SLICE FAILED",
    e.code ?? e.name,
    e.stack
      ?.split("\n")
      .find((line) => line.includes("slice.mjs:"))
      ?.trim() ?? "details suppressed",
  );
  process.exitCode = 1;
} finally {
  if (proofServer) await new Promise((r) => proofServer.close(r));
  if (browser) await browser.close();
  if (proxy) await new Promise((r) => proxy.close(r));
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  if (appPool) await appPool.end();
  if (authPool) await authPool.end();
  for (const id of userIds) await auth.auth.admin.deleteUser(id);
  await admin.end();
}
