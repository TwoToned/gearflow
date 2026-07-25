#!/usr/bin/env node
/**
 * PR size advisory (POLICY.md R-2.8 / T-2). SHOULD-level, not a gate: PRs should stay
 * ≤ 400 changed LOC (target 200-400). This never fails the build — it only reports the
 * changed-LOC total (excluding R-0.5 exclusions) so ci.yml can post a soft PR comment
 * when a PR is over budget. Mirrors check-migration-drift.mjs's merge-base diff shape.
 *
 * Usage: node scripts/pr-size-check.mjs [baseRef]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const base = process.argv[2] || "origin/main";
const TARGET_LOC = 400;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}

let range;
try {
  const mergeBase = git(["merge-base", "--end-of-options", base, "HEAD"]).trim();
  range = [mergeBase, "HEAD"];
} catch {
  range = [base, "HEAD"];
}

// R-0.5 exclusions: generated code, vendored code, lockfiles, migrations, test fixtures.
const EXCLUDE_PATTERNS = [
  /^pnpm-lock\.yaml$/,
  /^prisma\/migrations\//,
  /^src\/generated\//,
  /^convex\/_generated\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)fixtures\//,
];

const numstat = git(["diff", "--numstat", "--end-of-options", ...range]);

let changedLoc = 0;
const included = [];
for (const line of numstat.split("\n").filter(Boolean)) {
  const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
  const path = pathParts.join("\t");
  if (EXCLUDE_PATTERNS.some((re) => re.test(path))) continue;
  // Binary files report "-" for added/deleted — not LOC, skip.
  const added = Number(addedRaw);
  const deleted = Number(deletedRaw);
  if (Number.isNaN(added) || Number.isNaN(deleted)) continue;
  changedLoc += added + deleted;
  included.push(path);
}

const overBudget = changedLoc > TARGET_LOC;

console.log(
  `[pr-size] ${changedLoc} changed LOC across ${included.length} file(s) (R-0.5 exclusions applied), ` +
    `T-2 target ≤ ${TARGET_LOC}.`,
);
if (overBudget) {
  console.log(
    `[pr-size] Over the SHOULD-level T-2 target (R-2.8) — non-blocking, reported as a PR comment.`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `over_budget=${overBudget}\nchanged_loc=${changedLoc}\n`,
  );
}

// SHOULD-level (R-2.8) — never fails the build.
process.exit(0);
