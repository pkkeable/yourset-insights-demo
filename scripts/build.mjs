import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
const files = [
  "web/assets/yourset-logo.svg",
  "web/assets/dm-sans.woff2",
  "web/assets/jetbrains-mono.woff2",
  "web/assets/DM-Sans-OFL.txt",
  "web/assets/JetBrains-Mono-OFL.txt",
  "web/index.html",
  "web/style.css",
  "web/app.mjs",
  "src/metrics.mjs",
  "src/overview.mjs",
  "web/overview-view.mjs",
  "src/scenarios.mjs",
];
// Rebuild the generated output so stale files cannot escape the allowlist.
await rm("dist", { recursive: true, force: true });
for (const file of files) {
  const target = file === "web/index.html" ? "index.html" : file;
  await mkdir(`dist/${target.split("/").slice(0, -1).join("/")}`, {
    recursive: true,
  });
  if (file === "web/index.html") {
    // Static hosts do not run server.mjs, so keep the no-network policy in
    // the generated document. The private runtime uses its own HTTP policy.
    const html = await readFile(file, "utf8");
    const policy =
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    await writeFile(
      `dist/${target}`,
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
    );
  } else {
    await copyFile(file, `dist/${target}`);
  }
}
await writeFile(
  "dist/MANIFEST.json",
  JSON.stringify({ mode: "synthetic", liveRoutes: false, files }, null, 2),
);
console.log(
  "Built allowlisted synthetic files only. No private adapter or configuration bundled.",
);
