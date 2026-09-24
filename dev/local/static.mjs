// Serve only the built allowlist, under a project subdirectory to catch root-only asset paths.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const demoBasePath = "/yourset-insights-demo/";
export async function createStaticServer(root) {
  const dist = join(root, "dist");
  const manifest = JSON.parse(
    await readFile(join(dist, "MANIFEST.json"), "utf8"),
  );
  const allowed = new Set(
    manifest.files.map((file) =>
      file === "web/index.html" ? "index.html" : file,
    ),
  );
  allowed.add("MANIFEST.json");
  const types = {
    html: "text/html",
    css: "text/css",
    mjs: "text/javascript",
    svg: "image/svg+xml",
    woff2: "font/woff2",
    txt: "text/plain",
    json: "application/json",
  };
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = pathname.slice(demoBasePath.length) || "index.html";
    if (
      req.method !== "GET" ||
      !pathname.startsWith(demoBasePath) ||
      !allowed.has(file)
    ) {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      const bytes = await readFile(join(dist, file));
      res
        .writeHead(200, {
          "Content-Type":
            types[file.split(".").at(-1)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(bytes);
    } catch {
      res.writeHead(500).end("Unavailable");
    }
  });
}
