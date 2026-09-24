// Export a reviewed committed allowlist. Never copy the worktree or its history.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, chmod, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const [destination, ref = "HEAD"] = process.argv.slice(2);
if (!destination)
  throw Error("Usage: node scripts/export-source.mjs EMPTY_DESTINATION [ref]");
const target = resolve(destination);
const git = (args) =>
  execFileSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
const commit = git(["rev-parse", "--verify", `${ref}^{commit}`])
  .toString()
  .trim();
const files = git(["show", `${commit}:docs/release-files.txt`])
  .toString()
  .trim()
  .split("\n");
if (
  new Set(files).size !== files.length ||
  files.some(
    (f) =>
      !f ||
      f.startsWith("/") ||
      f.split("/").includes("..") ||
      f.split("/").includes(".git"),
  )
)
  throw Error("Invalid release allowlist");
try {
  if ((await readdir(target)).length)
    throw Error("Export destination must be empty");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(target, { recursive: true });
const manifest = [];
for (const file of files) {
  const mode = git(["ls-tree", commit, "--", file]).toString().split(" ")[0];
  if (!["100644", "100755"].includes(mode))
    throw Error(`Not an ordinary source file: ${file}`);
  const bytes = git(["show", `${commit}:${file}`]);
  const output = resolve(target, file);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  await chmod(output, mode === "100755" ? 0o755 : 0o644);
  manifest.push({
    path: file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  resolve(target, "SOURCE_RELEASE.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceCommit: commit,
      historyCopied: false,
      files: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Exported ${files.length} reviewed files and a digest manifest. No Git history copied.`,
);
