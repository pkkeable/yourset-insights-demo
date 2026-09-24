import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, createHmac, createHash } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { scenario } from "../../src/scenarios.mjs";
import { digest } from "../../private-api/commands.mjs";
import { connectBrowser } from "../../dev/local/browser.mjs";
import { unseal } from "../../private-api/auth.mjs";

const cfg = JSON.parse(
  execFileSync(
    "./node_modules/.bin/supabase",
    ["--workdir", "dev/local", "status", "-o", "json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(cfg.API_URL, "http://127.0.0.1:55431");
assert.equal(new URL(cfg.DB_URL).hostname, "127.0.0.1");
const admin = new pg.Pool({ connectionString: cfg.DB_URL }),
  auth = createClient(cfg.API_URL, cfg.SECRET_KEY ?? cfg.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const publicKey = cfg.PUBLISHABLE_KEY ?? cfg.ANON_KEY,
  base = "http://127.0.0.1:4187",
  originalKey = randomBytes(32),
  rotatedKey = randomBytes(32);
let child,
  second,
  browser,
  proxy,
  env,
  step = "setup",
  count = 0,
  failRefresh = false,
  slowRefresh = false,
  failLogout = false,
  activeRefresh = 0,
  maxRefresh = 0;
const userIds = [],
  metadata = [];
const pass = (name) => {
  count++;
  console.log(`PASS AUTH ${count}: ${name}`);
};
const hash = (cookie) =>
  createHash("sha256").update(cookie.split("=")[1]).digest("hex");
const totp = (secret) => {
  let bits = "";
  for (const c of secret)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const raw = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))),
    time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", raw).update(time).digest();
  return ((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
};
async function user(allowed = true) {
  const email = `auth-${randomUUID()}@example.invalid`,
    password = randomBytes(32).toString("hex");
  const result = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(result.error, null);
  const owner = result.data.user.id;
  userIds.push(owner);
  if (allowed) {
    await admin.query("insert into yourset.allowed values($1)", [owner]);
    const data = scenario();
    await admin.query("insert into yourset.evidence values($1,$2,$3)", [
      owner,
      digest(data),
      data,
    ]);
  }
  return { email, password, owner };
}
async function req(path, cookie, body, origin = base) {
  const r = await fetch(origin + "/api/private/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    cookieHeader: r.headers.get("set-cookie"),
    retry: r.headers.get("retry-after"),
  };
}
async function stop(process) {
  if (process && process.exitCode === null) {
    process.kill("SIGTERM");
    await new Promise((r) => process.once("exit", r));
  }
}
async function start(overrides = {}) {
  const process = fork("server.mjs", [], {
    env: { ...env, ...overrides },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  process.stdout.on("data", () => {});
  process.stderr.on("data", () => {});
  process.on("message", (m) => {
    if (m.type === "private-metadata") metadata.push(m);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("startup timeout")), 10000);
    process.on("message", (m) => {
      if (m.type === "ready") {
        clearTimeout(timer);
        resolve();
      }
    });
    process.once("exit", () => {
      clearTimeout(timer);
      reject(Error("startup failure"));
    });
  });
  return process;
}
async function loginApi(person) {
  const login = await req("auth/login", null, {
    email: person.email,
    password: person.password,
  });
  assert.equal(login.status, 200);
  let secret = person.secret;
  if (login.body.needsEnrollment) {
    const enrolled = await req("auth/enroll", login.cookie, {});
    assert.equal(enrolled.status, 200);
    secret = enrolled.body.secret;
    person.secret = secret;
  }
  const verified = await req("auth/verify", login.cookie, {
    code: totp(secret),
  });
  assert.equal(verified.status, 200);
  return verified.cookie;
}
try {
  await admin.query(readFileSync("dev/local/product-schema.sql", "utf8"));
  const urls = {};
  for (const role of ["yourset_app", "yourset_auth"]) {
    const password = randomBytes(32).toString("hex");
    await admin.query(`alter role ${role} password '${password}'`);
    const url = new URL(cfg.DB_URL);
    url.username = role;
    url.password = password;
    urls[role] = url.toString();
  }
  proxy = http.createServer(async (request, response) => {
    const refreshing =
      request.url === "/auth/v1/token?grant_type=refresh_token";
    try {
      if (refreshing) {
        activeRefresh++;
        maxRefresh = Math.max(maxRefresh, activeRefresh);
        if (slowRefresh) await new Promise((r) => setTimeout(r, 1500));
        else await new Promise((r) => setTimeout(r, 60));
      }
      if (
        (refreshing && failRefresh) ||
        (request.url.startsWith("/auth/v1/logout") && failLogout)
      ) {
        response.writeHead(503).end("{}");
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const r = await fetch(cfg.API_URL + request.url, {
        method: request.method,
        headers: { ...request.headers, host: new URL(cfg.API_URL).host },
        body: body || undefined,
      });
      response
        .writeHead(r.status, { "Content-Type": "application/json" })
        .end(await r.text());
    } catch {
      response.writeHead(503).end("{}");
    } finally {
      if (refreshing) activeRefresh--;
    }
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  env = {
    ...process.env,
    APP_MODE: "private-local",
    PORT: "4187",
    APP_ORIGIN: base,
    SUPABASE_URL: `http://127.0.0.1:${proxy.address().port}`,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    APP_DATABASE_URL: urls.yourset_app,
    AUTH_DATABASE_URL: urls.yourset_auth,
    SESSION_ENCRYPTION_KEY: originalKey.toString("base64"),
    SESSION_ENCRYPTION_KEY_ID: "first",
    SESSION_TTL_SECONDS: "1800",
    SESSION_VALIDITY_TIMEOUT_MS: "1000",
    PRIVATE_REQUEST_TIMEOUT_MS: "5000",
    DATABASE_STATEMENT_TIMEOUT_MS: "2000",
  };
  const a = await user(),
    b = await user(),
    excluded = await user(false);
  child = await start();
  step = "anonymous/CSRF";
  assert.equal((await req("plan-decision")).status, 401);
  const csrf = await fetch(base + "/api/private/auth/login", {
    method: "POST",
    headers: {
      Origin: "http://example.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(csrf.status, 403);
  pass("anonymous read and forged login Origin denied");
  step = "login rejection";
  assert.equal(
    (
      await req("auth/login", null, {
        email: a.email,
        password: "not-the-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req("auth/login", null, {
        email: excluded.email,
        password: excluded.password,
      })
    ).status,
    401,
  );
  pass("bad credentials and non-allowed identity rejected generically");
  step = "browser password/MFA";
  browser = await connectBrowser();
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(base);
  await page.locator("#auth-login [name=email]").fill(a.email);
  await page.locator("#auth-login [name=password]").fill(a.password);
  await page.locator("#auth-login button").click();
  await page.locator("#auth-verify").waitFor();
  const pending =
    "yourset_session=" +
    (await context.cookies()).find((c) => c.name === "yourset_session").value;
  assert.equal((await req("plan-decision", pending)).status, 403);
  await admin.query(
    "update yourset.sessions set stage='active' where hash=$1",
    [hash(pending)],
  );
  assert.equal((await req("plan-decision", pending)).status, 403);
  await admin.query(
    "update yourset.sessions set stage='pending' where hash=$1",
    [hash(pending)],
  );
  pass(
    "password-only and forged active-stage AAL1 sessions cannot read private data",
  );
  await page.locator("#auth-enroll").click();
  await page.locator("#totp-setup-key").waitFor();
  a.secret = await page.locator("#totp-setup-key").textContent();
  await page.reload();
  await page.locator("#auth-enroll").click();
  await page.locator("#totp-setup-key").waitFor();
  assert.equal(await page.locator("#totp-setup-key").textContent(), a.secret);
  await page.locator("#auth-verify [name=code]").fill(totp(a.secret));
  await page.locator("#auth-verify button").click();
  await page.locator("#auth-logout").waitFor();
  const cookieA =
    "yourset_session=" +
    (await context.cookies()).find((c) => c.name === "yourset_session").value;
  assert.notEqual(cookieA, pending);
  assert.equal((await req("plan-decision", pending)).status, 401);
  assert.equal((await req("plan-decision", cookieA)).status, 200);
  assert.equal(
    (await context.cookies()).find((c) => c.name === "yourset_session")
      .httpOnly,
    true,
  );
  assert.equal(
    await page.evaluate(() => document.cookie.includes("yourset_session")),
    false,
  );
  assert.equal(await page.locator("#totp-setup-key").count(), 0);
  pass(
    "real browser enrollment and MFA rotate cookie; tokens/setup secret absent after admission",
  );
  step = "direct API denial";
  const activeRow = (
    await admin.query("select * from yourset.sessions where hash=$1", [
      hash(cookieA),
    ])
  ).rows[0];
  const activeTokens = unseal(
    { key: originalKey, keys: new Map([["first", originalKey]]) },
    activeRow,
  );
  for (const method of ["GET", "POST"]) {
    const r = await fetch(cfg.API_URL + "/rest/v1/plans", {
      method,
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + activeTokens.access_token,
        [method === "GET" ? "Accept-Profile" : "Content-Profile"]: "yourset",
        "Content-Type": "application/json",
      },
      body:
        method === "POST"
          ? JSON.stringify({
              owner: a.owner,
              version: 99,
              effective: "2026-06-29",
              content: {},
            })
          : undefined,
    });
    assert.ok([401, 403, 404, 406].includes(r.status));
  }
  pass(
    "valid AAL2 token cannot read/write private tables through the Data API",
  );

  step = "browser save";
  await page.locator('button[data-page="Investigations"]').first().click();
  await page
    .locator("#private-save-status")
    .filter({ hasText: "Private dashboard loaded" })
    .waitFor();
  await page.locator("#decision-form [name=choice]").selectOption("edit");
  for (const [name, value] of Object.entries({
    calories: "2300",
    protein: "157",
    reason: "Synthetic authenticated save",
    effective: "2026-06-29",
  }))
    await page.locator(`#decision-form [name=${name}]`).fill(value);
  await page.locator("#decision-form button").last().click();
  await page
    .locator("#private-save-status")
    .filter({ hasText: "Decision saved with it" })
    .waitFor();
  pass("ordinary browser sign-in reaches existing durable command");
  step = "cross owner";
  const cookieB = await loginApi(b);
  assert.equal((await req("plan-decision", cookieB)).body.planVersion, 0);
  assert.equal((await req("plan-decision", cookieA)).body.planVersion, 1);
  assert.equal(
    (await req("plan-decision?owner=" + a.owner, cookieB)).body.planVersion,
    0,
  );
  pass("second allowed identity cannot read first identity plan");
  const wrongView = await fetch(base + "/api/private/plan-decision", {
    headers: { Cookie: cookieB, "X-YourSet-Session": hash(cookieA) },
  });
  assert.equal(wrongView.status, 401);
  pass(
    "stale browser session-view binding cannot read under a switched account",
  );
  step = "restart";
  await stop(child);
  child = await start();
  assert.equal((await req("plan-decision", cookieA)).body.planVersion, 1);
  await page.reload();
  await page.locator('button[data-page="Investigations"]').first().click();
  await page
    .locator("#private-save-status")
    .filter({ hasText: "version 1 restored" })
    .waitFor();
  pass(
    "real process restart and browser reload restore a valid session and durable version",
  );
  step = "refresh across processes";
  second = await start({ PORT: "4189", APP_ORIGIN: "http://127.0.0.1:4189" });
  maxRefresh = 0;
  const priorSealed = (
    await admin.query("select sealed from yourset.sessions where hash=$1", [
      hash(cookieA),
    ])
  ).rows[0].sealed;
  const refreshed = await Promise.all([
    req("auth/refresh", cookieA, {}),
    req("auth/refresh", cookieA, {}, "http://127.0.0.1:4189"),
  ]);
  assert.deepEqual(
    refreshed.map((r) => r.status),
    [200, 200],
  );
  assert.equal(maxRefresh, 1);
  assert.notDeepEqual(
    (
      await admin.query("select sealed from yourset.sessions where hash=$1", [
        hash(cookieA),
      ])
    ).rows[0].sealed,
    priorSealed,
  );
  assert.equal((await req("plan-decision", cookieA)).status, 200);
  await stop(second);
  pass("concurrent refresh across two real processes serialized and persisted");
  step = "refresh failure";
  failRefresh = true;
  let t = performance.now(),
    r = await req("auth/refresh", cookieA, {});
  assert.equal(r.status, 503);
  assert.equal(r.retry, "1");
  assert.deepEqual(Object.keys(r.body), ["error"]);
  assert.ok(performance.now() - t < 1500);
  failRefresh = false;
  assert.equal((await req("auth/refresh", cookieA, {})).status, 200);
  pass("refresh infrastructure failure denies safely and recovers");
  step = "refresh timeout";
  slowRefresh = true;
  t = performance.now();
  r = await req("auth/refresh", cookieA, {});
  assert.equal(r.status, 503);
  assert.equal(r.retry, "1");
  assert.ok(performance.now() - t < 1500);
  slowRefresh = false;
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal((await req("auth/refresh", cookieA, {})).status, 200);
  pass("refresh timeout is bounded; subsequent healthy refresh succeeds");
  step = "key loss";
  await stop(child);
  child = await start({
    SESSION_ENCRYPTION_KEY: rotatedKey.toString("base64"),
    SESSION_ENCRYPTION_KEY_ID: "missing",
  });
  assert.equal((await req("plan-decision", cookieA)).status, 503);
  await stop(child);
  child = await start();
  assert.equal((await req("plan-decision", cookieA)).status, 200);
  pass(
    "wrong encryption key fails closed; correct-key restart restores valid session",
  );
  step = "key rotation";
  await stop(child);
  child = await start({
    SESSION_ENCRYPTION_KEY: rotatedKey.toString("base64"),
    SESSION_ENCRYPTION_KEY_ID: "second",
    SESSION_PREVIOUS_KEYS: JSON.stringify({
      first: originalKey.toString("base64"),
    }),
  });
  assert.equal((await req("plan-decision", cookieA)).status, 200);
  assert.equal(
    (
      await admin.query("select sealed from yourset.sessions where hash=$1", [
        hash(cookieA),
      ])
    ).rows[0].sealed.kid,
    "second",
  );
  pass("previous-key overlap rewraps session under current key");
  step = "expiry";
  await admin.query(
    "update yourset.sessions set last_seen=now()-interval '16 minutes' where hash=$1",
    [hash(cookieB)],
  );
  assert.equal((await req("plan-decision", cookieB)).status, 401);
  await admin.query(
    "update yourset.sessions set last_seen=now(),expires=now()-interval '1 second' where hash=$1",
    [hash(cookieB)],
  );
  assert.equal((await req("plan-decision", cookieB)).status, 401);
  pass("idle and absolute expiry independently deny old credential");
  step = "multi tab logout";
  const other = await context.newPage();
  await other.goto(base);
  await other.locator("#auth-logout").waitFor();
  failLogout = true;
  let releaseLate, seenLate;
  const lateGate = new Promise((r) => (releaseLate = r)),
    lateSeen = new Promise((r) => (seenLate = r));
  await page.goto(base + "?history=1");
  await page.locator("#auth-logout").waitFor();
  await page.route("**/api/private/dashboard", async (route) => {
    const response = await route.fetch();
    seenLate();
    await lateGate;
    await route.fulfill({ response });
  });
  await page.goto(base + "?history=2");
  await lateSeen;
  await page.locator("#auth-logout").waitFor();
  await page.locator("#auth-logout").click();
  await page
    .locator("#auth-message")
    .filter({ hasText: "Signed out." })
    .waitFor();
  await other.locator("#auth-login").waitFor();
  assert.equal(await page.locator("#private-save-status").count(), 0);
  assert.equal(await other.locator("#private-save-status").count(), 0);
  assert.equal((await req("plan-decision", cookieA)).status, 401);
  assert.equal(
    (
      await admin.query(
        "select upstream_pending from yourset.sessions where hash=$1",
        [hash(cookieA)],
      )
    ).rows[0].upstream_pending,
    true,
  );
  pass("logout clears both tabs and denies old cookie despite upstream outage");
  releaseLate();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#private-save-status").count(), 0);
  await page.unroute("**/api/private/dashboard");
  await page.goBack();
  await page.locator("#auth-login").waitFor();
  assert.ok(
    !(await page.textContent("body")).includes("Synthetic authenticated save"),
  );
  pass(
    "late real private response and browser back navigation cannot restore logged-out state",
  );
  step = "durable upstream retry";
  failLogout = false;
  await admin.query(
    "update yourset.sessions set retry_at=now() where hash=$1",
    [hash(cookieA)],
  );
  await stop(child);
  child = await start({
    SESSION_ENCRYPTION_KEY: rotatedKey.toString("base64"),
    SESSION_ENCRYPTION_KEY_ID: "second",
    SESSION_PREVIOUS_KEYS: JSON.stringify({
      first: originalKey.toString("base64"),
    }),
  });
  for (let i = 0; i < 40; i++) {
    if (
      !(
        await admin.query(
          "select upstream_pending from yourset.sessions where hash=$1",
          [hash(cookieA)],
        )
      ).rows[0].upstream_pending
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (
      await admin.query(
        "select upstream_pending from yourset.sessions where hash=$1",
        [hash(cookieA)],
      )
    ).rows[0].upstream_pending,
    false,
  );
  assert.equal(
    Number(
      (
        await admin.query(
          "select count(*) from auth.sessions where id=(select upstream from yourset.sessions where hash=$1)",
          [hash(cookieA)],
        )
      ).rows[0].count,
    ),
    0,
  );
  pass(
    "pending upstream signout survives restart and removes real upstream session",
  );
  step = "return/sign in again";
  await page.reload();
  await page.locator("#auth-login").waitFor();
  await page.locator("#auth-login [name=email]").fill(b.email);
  await page.locator("#auth-login [name=password]").fill(b.password);
  await page.locator("#auth-login button").click();
  await page.locator("#auth-verify [name=code]").fill(totp(b.secret));
  await page.locator("#auth-verify button").click();
  await page.locator("#auth-logout").waitFor();
  await page.locator('button[data-page="Investigations"]').first().click();
  await page
    .locator("#private-save-status")
    .filter({ hasText: "No plan edit committed yet" })
    .waitFor();
  assert.ok(
    !(await page.textContent("body")).includes("Synthetic authenticated save"),
  );
  pass("logout/reload/account switch shows no prior owner private state");
  step = "MFA attempt budget";
  const attemptUser = await user();
  let pendingAttempt = await req("auth/login", null, {
    email: attemptUser.email,
    password: attemptUser.password,
  });
  let enrollment = await req("auth/enroll", pendingAttempt.cookie, {});
  assert.equal(enrollment.status, 200);
  for (let i = 0; i < 6; i++) {
    const wrong = String(
      (Number(totp(enrollment.body.secret)) + 500000) % 1000000,
    ).padStart(6, "0");
    assert.equal(
      (await req("auth/verify", pendingAttempt.cookie, { code: wrong })).status,
      400,
    );
  }
  assert.equal(
    (
      await req("auth/verify", pendingAttempt.cookie, {
        code: totp(enrollment.body.secret),
      })
    ).status,
    401,
  );
  pass(
    "six invalid MFA codes revoke pending session; correct code cannot revive it",
  );
  step = "durable login throttle";
  await admin.query(
    "insert into yourset.auth_throttle values($1,10,now()+interval '1 minute') on conflict(bucket) do update set attempts=10,reset_at=now()+interval '1 minute'",
    [
      createHash("sha256")
        .update("email:" + attemptUser.email)
        .digest("hex"),
    ],
  );
  const limited = await req("auth/login", null, {
    email: attemptUser.email,
    password: attemptUser.password,
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.retry, "60");
  pass("durable login throttle returns 429 and Retry-After");
  step = "upstream revocation";
  const newCookie =
    "yourset_session=" +
    (await context.cookies()).find((c) => c.name === "yourset_session").value;
  await admin.query(
    "delete from auth.sessions where id=(select upstream from yourset.sessions where hash=$1)",
    [hash(newCookie)],
  );
  assert.equal((await req("plan-decision", newCookie)).status, 401);
  pass("upstream session disappearance denies application admission");
  step = "metadata";
  for (const m of metadata)
    assert.ok(
      Object.keys(m).every((k) =>
        [
          "type",
          "requestId",
          "method",
          "path",
          "phase",
          "status",
          "durationMs",
        ].includes(k),
      ),
    );
  assert.ok(!JSON.stringify(metadata).includes(a.password));
  assert.ok(!JSON.stringify(metadata).includes(a.secret));
  pass(
    "runtime metadata contains only approved fields, no submitted credentials",
  );
  console.log(`RESULT ${count} authentication checks passed`);
} catch (e) {
  console.error(
    "AUTH SUITE FAILED at " + step + " (" + (e.code ?? e.name) + ")",
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stop(second);
  await stop(child);
  if (proxy) await new Promise((r) => proxy.close(r));
  for (const id of userIds) await auth.auth.admin.deleteUser(id);
  await admin.end();
}
