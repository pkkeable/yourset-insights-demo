import test from "node:test";
import assert from "node:assert/strict";
import { server } from "../server.mjs";
test("demo serves only synthetic allowlist and refuses guessed private routes", async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base);
    assert.equal(r.status, 200);
    assert(
      r.headers.get("content-security-policy").includes("connect-src 'none'"),
    );
    for (const p of [
      "/api/ingest",
      "/api/private",
      "/connect",
      "/.env",
      "/collectors/garmin/cli.py",
      "/src/../package.json",
    ])
      assert.equal((await fetch(base + p)).status, 404);
    assert.equal(
      (await fetch(base + "/api/ingest", { method: "POST", body: "{}" }))
        .status,
      404,
    );
    assert.equal((await fetch(base + "/?mode=private")).status, 200);
    const js = await (await fetch(base + "/web/app.mjs")).text();
    assert(!js.includes("supabase.co"));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("static build removes stale output and contains exactly its declared files", async () => {
  const { mkdtemp, mkdir, writeFile, readdir, readFile, rm, cp } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "ysi-build-"));
  try {
    for (const name of ["scripts", "web", "src"])
      await cp(new URL(`../${name}`, import.meta.url), join(root, name), {
        recursive: true,
      });
    await mkdir(join(root, "dist"));
    await writeFile(
      join(root, "dist", "stale-private.txt"),
      "Synthetic sentinel that must never ship",
    );
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root });
    const manifest = JSON.parse(
      await readFile(join(root, "dist/MANIFEST.json"), "utf8"),
    );
    const actual = (
      await readdir(join(root, "dist"), {
        recursive: true,
        withFileTypes: true,
      })
    )
      .filter((x) => x.isFile())
      .map((x) =>
        join(x.parentPath, x.name).slice(join(root, "dist").length + 1),
      )
      .sort();
    const expected = [
      ...manifest.files.map((f) => (f === "web/index.html" ? "index.html" : f)),
      "MANIFEST.json",
    ].sort();
    assert.deepEqual(actual, expected);
    assert.equal(manifest.mode, "synthetic");
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /src="\.\/web\/app\.mjs"/);
    // The deployed artifact is self-contained even under a project subdirectory.
    const { createStaticServer, demoBasePath } =
      await import("../dev/local/static.mjs");
    const app = await createStaticServer(root);
    await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${app.address().port}`;
    try {
      assert.equal((await fetch(base + demoBasePath)).status, 200);
      assert.equal(
        (await fetch(base + demoBasePath + "web/app.mjs")).status,
        200,
      );
      for (const path of [
        "/web/app.mjs",
        demoBasePath + "api/private/dashboard",
        demoBasePath + "package.json",
        demoBasePath + "../.env",
      ])
        assert.equal((await fetch(base + path)).status, 404);
    } finally {
      await new Promise((resolve) => app.close(resolve));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
