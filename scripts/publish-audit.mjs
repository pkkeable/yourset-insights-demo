// Full-history publish audit. Answers: "if this ref were made public today,
// what would be exposed?" — over EVERY revision, not just the current tree.
//
// History is cumulative and GitHub does not garbage-collect unreachable
// commits: anything ever pushed stays retrievable by SHA. So the tree being
// clean is not sufficient; every blob that ever existed must be clean too.
//
// Usage: node scripts/publish-audit.mjs [ref]   (default: HEAD)
import { execFileSync } from "node:child_process";

const ref = process.argv[2] ?? "HEAD";
const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });

const forbidden = [
  /(^|\/)(?:\.env(?:\.|$)|auth|exports|private|\.private|node_modules|\.venv)(?:\/|$)/i,
  /PRIVATE_OWNER_CONTEXT|IMPLEMENTATION_BRIEF|START_HERE|validation_report|state\.sqlite|sample\.normalized/,
  /VERIFICATION|SOURCE_CHECK|ROADMAP|PRODUCTION_CONTRACT|DASHBOARD_(?:SPEC|REVIEW)|DESIGN_DECISIONS/,
  /handoff|diagnostic|evidence/i,
  /(^|\/)MANIFEST\.json$/,
];

const credentials = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["Stripe live key", /sk_live_[A-Za-z0-9]{20,}/],
  [
    "JWT (Supabase anon/service_role)",
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  ],
  ["Supabase API key", /sb_(?:secret|publishable)_[A-Za-z0-9]{16,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["OpenAI key", /\bsk-[A-Za-z0-9]{20,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Password in connection URL", /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/],
  ["Private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

// Every object reachable from the ref, with the path it was seen at.
const paths = new Map(); // sha -> Set(path)
for (const line of git(["rev-list", "--objects", ref]).split("\n")) {
  if (!line) continue;
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const [sha, p] = [line.slice(0, sp), line.slice(sp + 1)];
  if (!paths.has(sha)) paths.set(sha, new Set());
  paths.get(sha).add(p);
}

const blobs = git(["cat-file", "--batch-check"], {
  input: [...paths.keys()].join("\n"),
})
  .split("\n")
  .filter((l) => l.includes(" blob "))
  .map((l) => l.split(" ")[0]);

// One batch read; parse the length-delimited stream as buffers so binary
// blobs cannot corrupt framing.
const raw = execFileSync("git", ["cat-file", "--batch"], {
  input: blobs.join("\n") + "\n",
  maxBuffer: 1 << 30,
});

const problems = [];
let scanned = 0;
let off = 0;
while (off < raw.length) {
  const nl = raw.indexOf(0x0a, off);
  if (nl < 0) break;
  const [sha, , sizeStr] = raw.subarray(off, nl).toString("utf8").split(" ");
  const size = Number(sizeStr);
  if (!Number.isFinite(size)) break;
  const body = raw.subarray(nl + 1, nl + 1 + size);
  off = nl + 1 + size + 1;
  scanned++;

  const where = [...(paths.get(sha) ?? ["<unknown>"])].join(", ");
  if (body.includes(0)) continue; // binary: fonts/images, not text-scannable
  const textBody = body.toString("utf8");
  for (const [label, re] of credentials) {
    if (re.test(textBody))
      problems.push(`possible ${label} in ${where} (blob ${sha.slice(0, 10)})`);
  }
}

for (const set of paths.values())
  for (const p of set)
    if (p && forbidden.some((r) => r.test(p)))
      problems.push(`prohibited path in history: ${p}`);

const commits = git(["rev-list", "--count", ref]).trim();
const identities = [
  ...new Set(
    git(["log", "--format=%an <%ae>%n%cn <%ce>", ref])
      .split("\n")
      .filter(Boolean),
  ),
];

console.log(`Publish audit of ${ref}`);
console.log(
  `  commits: ${commits}   blob revisions scanned: ${scanned}   paths: ${paths.size}`,
);
console.log(`  identities: ${identities.join(" | ")}`);

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} finding(s) in full history\n`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  console.error(
    "\nHistory is cumulative: removing the file in a later commit does NOT help.",
  );
  process.exit(1);
}
console.log("\nPASS: no findings across full history.");
console.log(
  "Publication gates in docs/PUBLICATION.md remain a human decision.",
);
