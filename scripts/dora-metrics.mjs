#!/usr/bin/env node
/**
 * DORA metrics (POLICY.md R-11.1) computed at the project level from GitHub Actions
 * deploy runs + git history — no external platform needed. "Deploy" = the
 * build-image.yml workflow (push to main). Prints a markdown report to stdout.
 *
 * Reference bands are historical/elite only; current DORA guidance is to improve
 * against your own baseline, not hit cross-project targets.
 */
import { execSync } from "node:child_process";

const WORKFLOW = "build-image.yml";
const WINDOW_DAYS = Number(process.env.DORA_WINDOW_DAYS || 30);
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const since = Date.now() - WINDOW_DAYS * 864e5;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const hrs = (ms) => (ms == null ? "n/a" : `${(ms / 36e5).toFixed(1)} h`);

let runs = [];
try {
  runs = JSON.parse(
    sh(
      `gh run list --workflow ${WORKFLOW} --branch main --limit 200 ` +
        `--json databaseId,conclusion,status,createdAt,updatedAt,headSha`,
    ),
  );
} catch {
  console.log("# DORA metrics\n\n_Could not query GitHub Actions (gh unavailable)._");
  process.exit(0);
}

const completed = runs
  .filter((r) => r.status === "completed" && new Date(r.createdAt).getTime() >= since)
  .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
const successes = completed.filter((r) => r.conclusion === "success");
const failures = completed.filter((r) => r.conclusion === "failure");

// Deployment frequency
const perWeek = ((successes.length / WINDOW_DAYS) * 7).toFixed(1);

// Change failure rate
const cfr = completed.length
  ? ((failures.length / completed.length) * 100).toFixed(0) + "%"
  : "n/a";

// Failed-deployment recovery time: failure -> next success
const recoveries = [];
for (let i = 0; i < completed.length; i++) {
  if (completed[i].conclusion !== "failure") continue;
  const next = completed.slice(i + 1).find((r) => r.conclusion === "success");
  if (next)
    recoveries.push(new Date(next.updatedAt) - new Date(completed[i].updatedAt));
}

// Lead time for changes: head commit authored -> deploy completed (successes)
const leadTimes = [];
for (const r of successes) {
  try {
    const committed = sh(`git show -s --format=%cI ${r.headSha}`).trim();
    if (committed)
      leadTimes.push(new Date(r.updatedAt) - new Date(committed));
  } catch {
    /* shallow clone / missing sha — skip */
  }
}

// Rework rate (proxy): share of window commits that are reverts.
let reworkRate = "n/a";
try {
  const log = sh(`git log --since="${WINDOW_DAYS} days ago" --pretty=%s`).split("\n").filter(Boolean);
  if (log.length) {
    const reverts = log.filter((s) => /^revert|^fix\(revert|rollback/i.test(s)).length;
    reworkRate = `${((reverts / log.length) * 100).toFixed(0)}% (${reverts}/${log.length} commits; revert proxy)`;
  }
} catch {
  /* ignore */
}

const today = new Date(process.env.DORA_TODAY || sh("git log -1 --format=%cI").trim());
console.log(`# DORA metrics — last ${WINDOW_DAYS} days`);
console.log(`\n_As of ${today.toISOString().slice(0, 10)} · deploy = \`${WORKFLOW}\` on main._\n`);
console.log("| Metric | Value |");
console.log("|---|---|");
console.log(`| Deployment frequency | ${successes.length} deploys (~${perWeek}/week) |`);
console.log(`| Lead time for changes (median) | ${hrs(median(leadTimes))} |`);
console.log(`| Change failure rate | ${cfr} (${failures.length}/${completed.length}) |`);
console.log(`| Failed-deployment recovery (median) | ${hrs(median(recoveries))} |`);
console.log(`| Rework rate | ${reworkRate} |`);
console.log(
  "\n_Owner: Jayden Nawotka. Track against our own baseline (R-11.1) — not cross-project bands._",
);
