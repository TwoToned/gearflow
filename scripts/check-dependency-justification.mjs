#!/usr/bin/env node
/**
 * New-dependency justification gate (POLICY.md R-6.3). Adding a dependency requires
 * verifying the platform/stdlib can't do it and recording that justification in the
 * PR. This flags new package.json dependencies added on this PR with no
 * accompanying justification note in the PR body (read via the PR_BODY env var,
 * populated from `github.event.pull_request.body` in CI — see ci.yml's Hygiene job).
 *
 * Evidence is mechanical (R-6.3): presence of a justification note, not a judgment
 * on its substance — mirrors check-migration-drift.mjs's escape-hatch shape.
 *
 * Usage: node scripts/check-dependency-justification.mjs [baseRef]
 */
import { execFileSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
// execFileSync (argv array, no shell) — base is passed as a literal argv entry,
// never interpolated into a shell string, so it can't inject shell metacharacters.
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}

let fromRef;
try {
  fromRef = git(["merge-base", "--end-of-options", base, "HEAD"]).trim();
} catch {
  fromRef = base;
}

function loadDepNames(ref) {
  let text;
  try {
    text = git(["show", "--end-of-options", `${ref}:package.json`]);
  } catch {
    return new Set(); // package.json didn't exist at this ref
  }
  const json = JSON.parse(text);
  return new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
  ]);
}

const before = loadDepNames(fromRef);
const after = loadDepNames("HEAD");
const added = [...after].filter((name) => !before.has(name)).sort();

if (added.length === 0) {
  console.log("[dep-justification] OK: no new dependencies added.");
  process.exit(0);
}

const prBody = process.env.PR_BODY ?? "";
// Only an actually-checked box, or an explicit freeform note, counts — the
// PR-template's *unchecked* checkbox text also contains "platform/stdlib", so
// matching that substring alone would pass every unmodified template.
const CHECKED_BOX = /- \[[xX]\]\s*new dependency/i;
const FREEFORM_NOTE = /dependency justification\s*:/i;

if (CHECKED_BOX.test(prBody) || FREEFORM_NOTE.test(prBody)) {
  console.log(
    `[dep-justification] OK: new dependenc${added.length === 1 ? "y" : "ies"} ` +
      `(${added.join(", ")}) justified in the PR body.`,
  );
  process.exit(0);
}

console.error(
  `[dep-justification] FAIL: new dependenc${added.length === 1 ? "y" : "ies"} added ` +
    `(${added.join(", ")}) with no justification note in the PR body (R-6.3).\n` +
    'Check the PR-template box ("New dependency? Confirm platform/stdlib insufficiency ' +
    'and link the justification") and explain why the platform/stdlib can\'t do it.',
);
process.exit(1);
