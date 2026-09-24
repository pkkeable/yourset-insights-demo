// Tracked-tree privacy gate. Runs on the current index/working tree.
// This is a backstop, not the defence: private material is kept out of the
// tree by location (see docs/PRIVACY_WORKFLOW.md), not by pattern matching.
// A scanner cannot decide whether a document is private, nor prove that a
// table or screenshot is synthetic.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

// Paths that must never be tracked. Mirrors the private block in .gitignore;
// segment-anchored entries deliberately allow private-api/ and auth.mjs.
const forbidden = [
  /(^|\/)(?:\.env(?:\.|$)|auth|exports|private|\.private|node_modules|\.venv)(?:\/|$)/i,
  /PRIVATE_OWNER_CONTEXT|IMPLEMENTATION_BRIEF|START_HERE|validation_report|state\.sqlite|sample\.normalized/,
  /VERIFICATION|SOURCE_CHECK|ROADMAP|PRODUCTION_CONTRACT|DASHBOARD_(?:SPEC|REVIEW)|DESIGN_DECISIONS/,
  /handoff|diagnostic|evidence/i,
  /(^|\/)MANIFEST\.json$/,
];

// Credential shapes. Hand-maintained patterns rot; gitleaks is the real
// credential gate in the hooks and in CI. These cover the formats this
// project can plausibly leak.
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

const text = /\.(?:md|mjs|js|py|json|sql|txt|toml|lock|in|css|html|yml|yaml)$/;
const problems = [];

for (const f of files) {
  if (forbidden.some((r) => r.test(f))) {
    problems.push(`prohibited tracked path: ${f}`);
    continue;
  }
  if (statSync(f).size >= 3e6)
    problems.push(`unexpected large tracked file: ${f}`);
  if (!text.test(f)) continue;
  const body = readFileSync(f, "utf8");
  for (const [label, re] of credentials) {
    if (re.test(body)) problems.push(`possible ${label}: ${f}`);
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s) in the tracked tree\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nPrivate material belongs outside the tree. See docs/PRIVACY_WORKFLOW.md.",
  );
  process.exit(1);
}

console.log(
  `PASS: ${files.length} tracked files checked. Human content review remains required; this scanner cannot prove data are synthetic.`,
);
