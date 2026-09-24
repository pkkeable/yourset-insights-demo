import pg from "pg";
export function configuration(env = process.env) {
  const required = (name) => {
    const v = env[name];
    if (!v || v.includes("REPLACE_WITH_"))
      throw Error("Missing private configuration: " + name);
    return v;
  };
  const local = (name) => {
    const value = required(name),
      u = new URL(value);
    if (u.hostname !== "127.0.0.1") throw Error("Local slice only: " + name);
    return value;
  };
  const origin = local("APP_ORIGIN");
  if (new URL(origin).origin !== origin || new URL(origin).protocol !== "http:")
    throw Error("Exact local HTTP origin required");
  const key = Buffer.from(required("SESSION_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw Error("Invalid session key");
  const keyId = required("SESSION_ENCRYPTION_KEY_ID");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(keyId))
    throw Error("Invalid session key ID");
  const keys = new Map([[keyId, key]]);
  if (env.SESSION_PREVIOUS_KEYS) {
    let previous;
    try {
      previous = JSON.parse(env.SESSION_PREVIOUS_KEYS);
    } catch {
      throw Error("Invalid previous session keys");
    }
    if (!previous || Array.isArray(previous) || typeof previous !== "object")
      throw Error("Invalid previous session keys");
    for (const [id, value] of Object.entries(previous)) {
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        id === keyId ||
        typeof value !== "string" ||
        Buffer.from(value, "base64").length !== 32
      )
        throw Error("Invalid previous session keys");
      keys.set(id, Buffer.from(value, "base64"));
    }
  }
  const durations = {
    SESSION_VALIDITY_TIMEOUT_MS: 1000,
    PRIVATE_REQUEST_TIMEOUT_MS: 5000,
    DATABASE_STATEMENT_TIMEOUT_MS: 2000,
  };
  for (const [name, value] of Object.entries(durations))
    if (Number(required(name)) !== value)
      throw Error("Slice deadline must match accepted contract: " + name);
  const ttl = Number(required("SESSION_TTL_SECONDS"));
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 1800)
    throw Error("Invalid session TTL");
  const appUrl = local("APP_DATABASE_URL"),
    authUrl = local("AUTH_DATABASE_URL");
  if (
    new URL(appUrl).username !== "yourset_app" ||
    new URL(authUrl).username !== "yourset_auth"
  )
    throw Error("Restricted product roles required");
  const pool = (url) =>
    new pg.Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 10000,
    });
  const appDb = pool(appUrl),
    authDb = pool(authUrl);
  appDb.on("error", () => {});
  authDb.on("error", () => {});
  return {
    origin,
    url: local("SUPABASE_URL"),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
    key,
    keyId,
    keys,
    appDb,
    authDb,
    ttl,
  };
}
