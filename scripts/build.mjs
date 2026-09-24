import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
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
  await copyFile(file, `dist/${target}`);
}
await writeFile(
  "dist/MANIFEST.json",
  JSON.stringify({ mode: "synthetic", liveRoutes: false, files }, null, 2),
);
console.log(
  "Built allowlisted synthetic files only. No private adapter or configuration bundled.",
);
