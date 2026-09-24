import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { Budget, connection, problem, unavailable } from "./deadlines.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const cookieValue = (req) => {
  const values = (req.headers.cookie ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("yourset_session="));
  const value = values.length === 1 ? values[0].slice(16) : "";
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
};
const claims = (tokens) => {
  try {
    return JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url"),
    );
  } catch {
    throw problem(401, "invalid_session");
  }
};
export function seal(cfg, tokens, owner) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", cfg.key, iv);
  c.setAAD(Buffer.from(owner));
  return {
    kid: cfg.keyId,
    iv: iv.toString("hex"),
    body: Buffer.concat([c.update(JSON.stringify(tokens)), c.final()]).toString(
      "hex",
    ),
    tag: c.getAuthTag().toString("hex"),
  };
}
export function unseal(cfg, row) {
  try {
    const s = row.sealed,
      key = s.kid ? cfg.keys.get(s.kid) : cfg.key,
      d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "hex"));
    if (s.kid) d.setAAD(Buffer.from(row.owner));
    d.setAuthTag(Buffer.from(s.tag, "hex"));
    return JSON.parse(
      Buffer.concat([
        d.update(Buffer.from(s.body, "hex")),
        d.final(),
      ]).toString(),
    );
  } catch {
    throw unavailable();
  }
}
async function upstream(
  cfg,
  budget,
  path,
  { token, body, method = "GET", failure = "invalid_session" } = {},
) {
  let r;
  try {
    r = await fetch(cfg.url + "/auth/v1" + path, {
      method,
      redirect: "error",
      headers: {
        apikey: cfg.publishableKey,
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(budget.remaining(1000)),
    });
  } catch {
    throw unavailable();
  }
  if (r.status >= 500) throw unavailable();
  if (r.status === 429) throw problem(429, "rate_limited");
  if (!r.ok) throw problem(failure === "invalid_mfa" ? 400 : 401, failure);
  if (r.status === 204) return {};
  try {
    return await r.json();
  } catch {
    throw unavailable();
  }
}
function setCookie(res, value, seconds) {
  res.setHeader(
    "Set-Cookie",
    `yourset_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`,
  );
}
const view = (row) => ({
  state: row.stage === "active" ? "authenticated" : "mfa_required",
  sessionView: row.hash,
  needsEnrollment: row.stage === "pending" && !row.factor,
});
function input(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k)) ||
    fields.some((k) => typeof value[k] !== "string")
  )
    throw problem(400, "invalid_auth_input");
  return value;
}
async function throttle(cfg, budget, bucket, limit) {
  await connection(cfg.authDb, budget, async (q) => {
    await q(
      "delete from yourset.auth_throttle where reset_at<now()-interval '1 day'",
    );
    const r = (
      await q(
        "insert into yourset.auth_throttle values($1,1,now()+interval '1 minute') on conflict(bucket) do update set attempts=case when yourset.auth_throttle.reset_at<now() then 1 else yourset.auth_throttle.attempts+1 end,reset_at=case when yourset.auth_throttle.reset_at<now() then now()+interval '1 minute' else yourset.auth_throttle.reset_at end returning attempts",
        [hash(bucket)],
      )
    ).rows[0];
    if (r.attempts > limit) throw problem(429, "rate_limited");
  });
}
async function checkedTokens(cfg, budget, tokens, row) {
  const user = await upstream(cfg, budget, "/user", {
    token: tokens.access_token,
  });
  const c = claims(tokens);
  if (
    c.sub !== user.id ||
    (row && (user.id !== row.owner || c.session_id !== row.upstream)) ||
    !c.session_id ||
    c.exp * 1000 <= Date.now()
  )
    throw problem(401, "invalid_session");
  return { user, claims: c };
}
// The lock spans validation and any refresh exchange so processes cannot rotate the same token concurrently.
export async function withSession(
  req,
  cfg,
  overall,
  fn,
  { privateAccess = false, refresh = false, touch = false } = {},
) {
  const cookie = cookieValue(req);
  if (!cookie) throw problem(401, "unauthenticated");
  const budget = new Budget(privateAccess ? 1000 : 5000);
  budget.end = Math.min(budget.end, overall.end);
  return connection(cfg.authDb, budget, async (q) => {
    await q("begin");
    const row = (
      await q(
        "select s.* from yourset.sessions s join yourset.allowed a on a.owner=s.owner where s.hash=$1 and not s.revoked and s.expires>now() and s.created+($2*interval '1 second')>now() and s.last_seen+interval '15 minutes'>now() for update of s",
        [hash(cookie), cfg.ttl],
      )
    ).rows[0];
    if (!row) throw problem(401, "revoked_or_expired");
    if (
      req.headers["x-yourset-session"] &&
      req.headers["x-yourset-session"] !== row.hash
    )
      throw problem(401, "session_changed");
    if (
      !(
        await q("select yourset.session_valid($1,$2) as valid", [
          row.upstream,
          row.owner,
        ])
      ).rows[0].valid
    )
      throw problem(401, "revoked_or_expired");
    let tokens = unseal(cfg, row);
    if (refresh || claims(tokens).exp * 1000 <= Date.now() + 60000) {
      tokens = await upstream(cfg, budget, "/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: tokens.refresh_token },
      });
    }
    const verified = await checkedTokens(cfg, budget, tokens, row);
    if (
      privateAccess &&
      (row.stage !== "active" || verified.claims.aal !== "aal2")
    )
      throw problem(403, "mfa_required");
    if (row.stage === "active" && verified.claims.aal !== "aal2")
      throw problem(403, "mfa_required");
    await q(
      "update yourset.sessions set sealed=$2,last_seen=case when $3 then now() else last_seen end where hash=$1",
      [row.hash, seal(cfg, tokens, row.owner), touch],
    );
    const result = await fn({ q, row, tokens, budget, ...verified });
    await q("commit");
    return result;
  });
}
export async function admit(req, cfg, budget) {
  return withSession(req, cfg, budget, async ({ row }) => row.owner, {
    privateAccess: true,
    touch: true,
  });
}

export async function authRoute(path, req, res, cfg, budget, body) {
  const route = path.slice("/api/private/auth/".length);
  if (route === "login" && req.method === "POST") {
    input(body, ["email", "password"]);
    if (
      !body.email.includes("@") ||
      body.email.length > 254 ||
      !body.password ||
      body.password.length > 1024
    )
      throw problem(400, "invalid_auth_input");
    await throttle(cfg, budget, "ip:" + req.socket.remoteAddress, 60);
    await throttle(cfg, budget, "email:" + body.email.trim().toLowerCase(), 10);
    const tokens = await upstream(cfg, budget, "/token?grant_type=password", {
      method: "POST",
      body: { email: body.email.trim(), password: body.password },
      failure: "invalid_credentials",
    });
    const { user, claims: c } = await checkedTokens(cfg, budget, tokens);
    const allowed = await connection(
      cfg.authDb,
      budget,
      async (q) =>
        (await q("select owner from yourset.allowed where owner=$1", [user.id]))
          .rowCount > 0,
    );
    if (!allowed) {
      try {
        await upstream(cfg, budget, "/logout?scope=local", {
          method: "POST",
          token: tokens.access_token,
        });
      } catch {}
      throw problem(401, "invalid_credentials");
    }
    const cookie = randomBytes(32).toString("hex"),
      factor =
        user.factors?.find(
          (f) => f.factor_type === "totp" && f.status === "verified",
        )?.id ?? null;
    await connection(cfg.authDb, budget, async (q) => {
      await q("begin");
      const old = cookieValue(req);
      if (old)
        await q(
          "update yourset.sessions set revoked=true,upstream_pending=true where hash=$1",
          [hash(old)],
        );
      await q(
        "insert into yourset.sessions(hash,owner,upstream,sealed,expires,stage,factor) values($1,$2,$3,$4,now()+interval '5 minutes','pending',$5)",
        [
          hash(cookie),
          user.id,
          c.session_id,
          seal(cfg, tokens, user.id),
          factor,
        ],
      );
      await q("commit");
    });
    setCookie(res, cookie, 300);
    return { state: "mfa_required", needsEnrollment: !factor };
  }
  if (route === "logout" && req.method === "POST") {
    input(body, []);
    const cookie = cookieValue(req);
    if (cookie)
      await connection(cfg.authDb, budget, async (q) => {
        await q(
          "update yourset.sessions set revoked=true,upstream_pending=true where hash=$1",
          [hash(cookie)],
        );
      });
    setCookie(res, "", 0);
    if (cookie) await flushRevocations(cfg, hash(cookie), budget);
    return { state: "signed_out" };
  }
  if (route === "session" && req.method === "GET")
    return withSession(req, cfg, budget, async ({ row, user }) => ({
      ...view(row),
      needsEnrollment:
        row.stage === "pending" &&
        !user.factors?.some((f) => f.status === "verified"),
    }));
  if (route === "refresh" && req.method === "POST") {
    input(body, []);
    return withSession(req, cfg, budget, async ({ row }) => view(row), {
      privateAccess: true,
      refresh: true,
      touch: true,
    });
  }
  if (route === "enroll" && req.method === "POST") {
    input(body, []);
    return withSession(
      req,
      cfg,
      budget,
      async ({ q, row, tokens, user, budget }) => {
        if (
          row.stage !== "pending" ||
          user.factors?.some((f) => f.status === "verified")
        )
          throw problem(409, "mfa_already_enrolled");
        if (tokens.enrollment) return tokens.enrollment;
        const factor = await upstream(cfg, budget, "/factors", {
          method: "POST",
          token: tokens.access_token,
          body: {
            factor_type: "totp",
            friendly_name: "YourSet authenticator",
            issuer: "YourSet Insights",
          },
        });
        const enrollment = { factorId: factor.id, secret: factor.totp.secret };
        await q(
          "update yourset.sessions set factor=$2,sealed=$3 where hash=$1",
          [
            row.hash,
            factor.id,
            seal(cfg, { ...tokens, enrollment }, row.owner),
          ],
        );
        return enrollment;
      },
    );
  }
  if (route === "verify" && req.method === "POST") {
    input(body, ["code"]);
    if (!/^\d{6}$/.test(body.code)) throw problem(400, "invalid_mfa");
    const result = await withSession(
      req,
      cfg,
      budget,
      async ({ q, row, tokens, budget }) => {
        if (row.stage !== "pending" || !row.factor)
          throw problem(409, "mfa_not_pending");
        let verified;
        try {
          const challenge = await upstream(
            cfg,
            budget,
            `/factors/${row.factor}/challenge`,
            {
              method: "POST",
              token: tokens.access_token,
              body: {},
              failure: "invalid_mfa",
            },
          );
          verified = await upstream(
            cfg,
            budget,
            `/factors/${row.factor}/verify`,
            {
              method: "POST",
              token: tokens.access_token,
              body: { challenge_id: challenge.id, code: body.code },
              failure: "invalid_mfa",
            },
          );
        } catch (e) {
          if (e.status === 400) {
            await q(
              "update yourset.sessions set attempts=attempts+1,revoked=attempts>=5,upstream_pending=attempts>=5 where hash=$1",
              [row.hash],
            );
            return { invalid: true };
          }
          throw e;
        }
        const check = await checkedTokens(cfg, budget, verified, row);
        if (check.claims.aal !== "aal2") throw problem(403, "mfa_required");
        const cookie = randomBytes(32).toString("hex");
        await q("update yourset.sessions set revoked=true where hash=$1", [
          row.hash,
        ]);
        await q(
          "insert into yourset.sessions(hash,owner,upstream,sealed,expires) values($1,$2,$3,$4,now()+($5*interval '1 second'))",
          [
            hash(cookie),
            row.owner,
            row.upstream,
            seal(cfg, verified, row.owner),
            cfg.ttl,
          ],
        );
        return { cookie, state: "authenticated", sessionView: hash(cookie) };
      },
    );
    if (result.invalid) throw problem(400, "invalid_mfa");
    setCookie(res, result.cookie, cfg.ttl);
    return { state: result.state, sessionView: result.sessionView };
  }
  throw problem(404, "not_found");
}

// Durable, bounded upstream signout retries; application denial is already committed.
export async function flushRevocations(cfg, onlyHash = null, overall = null) {
  const budget = new Budget(3000);
  if (overall) budget.end = Math.min(budget.end, overall.end);
  try {
    await connection(cfg.authDb, budget, async (q) => {
      await q("begin");
      const rows = (
        await q(
          "select * from yourset.sessions where revoked and upstream_pending and revoke_attempts<5 and retry_at<=now() and ($1::text is null or hash=$1) order by retry_at limit 1 for update skip locked",
          [onlyHash],
        )
      ).rows;
      for (const row of rows) {
        let done = false,
          tokens;
        try {
          tokens = unseal(cfg, row);
          if (claims(tokens).exp * 1000 <= Date.now())
            tokens = await upstream(
              cfg,
              budget,
              "/token?grant_type=refresh_token",
              { method: "POST", body: { refresh_token: tokens.refresh_token } },
            );
          await upstream(cfg, budget, "/logout?scope=local", {
            method: "POST",
            token: tokens.access_token,
          });
          done = true;
        } catch (e) {
          if (e.status === 401) done = true;
        }
        await q(
          "update yourset.sessions set upstream_pending=$2,revoke_attempts=revoke_attempts+1,retry_at=now()+(least(300,power(2,revoke_attempts)*5)*interval '1 second'),sealed=$3 where hash=$1",
          [row.hash, !done, tokens ? seal(cfg, tokens, row.owner) : row.sealed],
        );
      }
      await q("commit");
    });
  } catch {
    /* Stored pending state remains denied; retry on the next bounded sweep. */
  }
}
