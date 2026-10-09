// Daily engine canary, invoked by Vercel Cron (see vercel.json).
// Recomputes every synthetic scenario through the same metric engine the demo
// uses, on the deployed Node runtime, and compares a digest of the output with
// the one CI pins below. A mismatch means the production runtime computes
// different numbers from the tested one (for example, ICU or Intl drift).
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. That check is this
// route's only gate: no middleware, rewrites or redirects sit in front of it.
// Without a configured secret every request is refused.
import { createHash, timingSafeEqual } from "node:crypto";
import { SCENARIOS, scenario } from "../../src/scenarios.mjs";
import { analyze, dashboard, VERSION } from "../../src/metrics.mjs";

// Update only for an intentional engine change; tests/cron.test.mjs fails
// until the pin matches the engine again.
export const EXPECTED_FINGERPRINT =
  "6e5abfd9435d1324943a4a5155b810e9f2286228d3f72213590de587ff0aaa53";

export function fingerprint() {
  const hash = createHash("sha256");
  for (const [id] of SCENARIOS) {
    const data = scenario(id),
      a = analyze(data);
    hash.update(JSON.stringify({ id, a, b: dashboard(data, a) }));
  }
  return hash.digest("hex");
}

export function canary(expected = EXPECTED_FINGERPRINT) {
  const actual = fingerprint();
  if (actual !== expected)
    throw Error(`fingerprint mismatch: expected ${expected}, got ${actual}`);
  return { engine: VERSION, scenarios: SCENARIOS.length, fingerprint: actual };
}

// Constant-time comparison: hashing both sides first gives equal-length
// inputs, so neither the value nor its length leaks through timing.
export function authorized(header, secret) {
  if (typeof secret !== "string" || !secret || typeof header !== "string")
    return false;
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

const json = (status, body) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createHandler({
  secret = () => process.env.CRON_SECRET,
  check = canary,
  log = (line) => console.log(line),
  error = (line) => console.error(line),
} = {}) {
  return async function handle(request) {
    if (!authorized(request.headers.get("authorization"), secret()))
      return json(401, { ok: false, error: "unauthorized" });
    const started = performance.now();
    try {
      const result = check();
      log(
        `engine-canary ok engine=${result.engine} scenarios=${result.scenarios} ms=${Math.round(performance.now() - started)}`,
      );
      return json(200, { ok: true, ...result });
    } catch (e) {
      error(`engine-canary failed: ${e.message}`);
      return json(503, { ok: false, error: "canary failed" });
    }
  };
}

export const GET = createHandler();
