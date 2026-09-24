import { readDashboard } from "./dashboard.mjs";
import { randomUUID } from "node:crypto";
import { Budget, problem, publicError, unavailable } from "./deadlines.mjs";
import { command, commitCommand, readContext } from "./commands.mjs";
import { admit, authRoute, flushRevocations } from "./auth.mjs";
async function body(req, budget) {
  let raw = "",
    size = 0,
    timer;
  try {
    return await Promise.race([
      (async () => {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) throw problem(400, "body_too_large");
          raw += chunk;
        }
        try {
          return JSON.parse(raw);
        } catch {
          throw problem(400, "invalid_json");
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), budget.remaining());
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function privateRuntime(cfg) {
  const sweep = setInterval(() => {
    void flushRevocations(cfg);
  }, 30000);
  sweep.unref();
  void flushRevocations(cfg);
  const handler = async (req, res) => {
    const path = new URL(req.url, cfg.origin).pathname;
    const requestId = randomUUID(),
      started = performance.now(),
      budget = new Budget(5000);
    const trace = (phase) =>
      process.send?.({
        type: "private-metadata",
        requestId,
        method: req.method,
        path,
        phase,
      });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-ID", requestId);
    try {
      if (req.headers.host !== new URL(cfg.origin).host)
        throw problem(403, "invalid_host");
      const isAuth = path.startsWith("/api/private/auth/");
      if (
        !isAuth &&
        !(
          (req.method === "POST" &&
            ["plan-decision", "plan", "decision", "review-completion"].some(
              (type) => path === `/api/private/commands/${type}`,
            )) ||
          (req.method === "GET" &&
            ["/api/private/plan-decision", "/api/private/dashboard"].includes(
              path,
            ))
        )
      )
        throw problem(404, "not_found");
      if (
        req.method === "POST" &&
        (req.headers.origin !== cfg.origin ||
          req.headers["content-type"] !== "application/json")
      )
        throw problem(403, "invalid_origin");
      if (isAuth) {
        const result = await authRoute(
          path,
          req,
          res,
          cfg,
          budget,
          req.method === "POST" ? await body(req, budget) : null,
        );
        res.end(JSON.stringify(result));
        return;
      }
      const parsed =
        req.method === "POST"
          ? command(
              await body(req, budget),
              req.headers["idempotency-key"],
              path.split("/").at(-1),
            )
          : null;
      const owner = await admit(req, cfg, budget);
      trace("admitted");
      const result = parsed
        ? await commitCommand(cfg.appDb, owner, budget, parsed, trace)
        : path === "/api/private/dashboard"
          ? await readDashboard(cfg.appDb, owner, budget)
          : await readContext(cfg.appDb, owner, budget);
      res.end(JSON.stringify(result));
    } catch (error) {
      const e = publicError(error);
      res.statusCode = e.status;
      if (e.status === 503 || e.status === 429)
        res.setHeader("Retry-After", e.status === 429 ? "60" : "1");
      res.end(
        JSON.stringify({
          error: {
            code: e.code,
            message:
              e.status === 503
                ? "Service unavailable. Retry the same command."
                : e.code.replaceAll("_", " "),
            ...(e.currentPlanVersion !== undefined
              ? { currentPlanVersion: e.currentPlanVersion }
              : {}),
            ...(e.currentEvidenceRevision
              ? { currentEvidenceRevision: e.currentEvidenceRevision }
              : {}),
          },
        }),
      );
    } finally {
      process.send?.({
        type: "private-metadata",
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: performance.now() - started,
        phase: "response",
      });
    }
  };
  handler.close = () => clearInterval(sweep);
  return handler;
}
