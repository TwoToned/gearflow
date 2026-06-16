// Generates build-info.json at CI image-build time. The production container
// image is built from a clean context with no .git directory (and node:22-slim
// has no git binary), so src/server/changelog.ts reads this baked file instead
// of shelling out to git. Run from the repo root with full git history available
// (the workflow checks out with fetch-depth: 0).
//
//   node scripts/generate-build-info.mjs
//
// Output shape matches what changelog.ts expects:
//   { hash, commitCount, changelog: [{ hash, date, message }] }
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Unit Separator — safe field delimiter that can't appear in a commit subject.
const US = "\x1f";

function git(args) {
  // execFileSync (no shell) keeps "--date=format:%d %b %Y" as a single arg so
  // the spaces in the date format aren't split into separate git revisions.
  return execFileSync("git", args, { encoding: "utf-8" });
}

const hash = git(["rev-parse", "--short", "HEAD"]).trim();
const commitCount = git(["rev-list", "--count", "HEAD"]).trim();

const raw = git([
  "log",
  "--no-merges",
  `--format=%h${US}%ad${US}%s`,
  "--date=format:%d %b %Y",
]);

const changelog = raw
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [h, date, ...rest] = line.split(US);
    return { hash: h, date, message: rest.join(US) };
  });

writeFileSync("build-info.json", JSON.stringify({ hash, commitCount, changelog }));
console.log(
  `build-info.json: ${hash} (${commitCount} commits, ${changelog.length} changelog entries)`,
);
