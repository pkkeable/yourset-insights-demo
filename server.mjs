import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const routes = {
  "/web/assets/yourset-logo.svg": "web/assets/yourset-logo.svg",
  "/web/assets/dm-sans.woff2": "web/assets/dm-sans.woff2",
  "/web/assets/jetbrains-mono.woff2": "web/assets/jetbrains-mono.woff2",
  "/": "web/index.html",
  "/web/style.css": "web/style.css",
  "/web/app.mjs": "web/app.mjs",
  "/src/overview.mjs": "src/overview.mjs",
  "/web/overview-view.mjs": "web/overview-view.mjs",
  "/src/metrics.mjs": "src/metrics.mjs",
  "/src/scenarios.mjs": "src/scenarios.mjs",
};
export function createServer(privateHandler = null, origin = null) {
  return http.createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    };
    if (privateHandler)
      headers["Content-Security-Policy"] = headers[
        "Content-Security-Policy"
      ].replace("connect-src 'none'", `connect-src ${origin}/api/private/`);
    let path;
    try {
      path = new URL(req.url, "http://localhost").pathname;
    } catch {
      res.writeHead(400, headers).end();
      return;
    }
    if (privateHandler && path.startsWith("/api/private/")) {
      for (const [key, value] of Object.entries(headers))
        res.setHeader(key, value);
      await privateHandler(req, res);
      return;
    }
    if (req.method !== "GET" || !routes[path]) {
      res.writeHead(404, headers).end("Not found");
      return;
    }
    try {
      const file = routes[path];
      res
        .writeHead(200, {
          ...headers,
          "Content-Type": file.endsWith(".html")
            ? "text/html; charset=utf-8"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : file.endsWith(".woff2")
                  ? "font/woff2"
                  : "text/javascript",
        })
        .end(
          file === "web/index.html" && privateHandler
            ? (await readFile(root + file, "utf8")).replace(
                "</head>",
                '<meta name="yourset-runtime" content="private-local"></head>',
              )
            : await readFile(root + file),
        );
    } catch {
      res.writeHead(500, headers).end("Unavailable");
    }
  });
}
export const server = createServer();
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.env.APP_MODE ?? "synthetic";
  if (!["synthetic", "private-local"].includes(mode))
    throw Error("Unsupported runtime mode");
  let active = server,
    cfg,
    privateHandler;
  if (mode === "private-local") {
    const { configuration } = await import("./private-api/config.mjs");
    const { privateRuntime } = await import("./private-api/runtime.mjs");
    cfg = configuration();
    privateHandler = privateRuntime(cfg);
    active = createServer(privateHandler, cfg.origin);
    if (Number(new URL(cfg.origin).port) !== Number(process.env.PORT))
      throw Error("Origin/port mismatch");
  }
  active.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", () => {
    console.log(
      mode === "synthetic"
        ? "Synthetic demo listening on loopback"
        : "Local product slice listening on loopback",
    );
    process.send?.({ type: "ready" });
  });
  process.on("SIGTERM", () => {
    privateHandler?.close();
    active.close(async () => {
      if (cfg) {
        await cfg.appDb.end();
        await cfg.authDb.end();
      }
      process.exit(0);
    });
  });
}
