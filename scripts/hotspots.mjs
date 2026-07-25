#!/usr/bin/env node
/**
 * Churn × complexity hotspot report (POLICY.md R-11.2). Refactoring priority
 * should be driven by hotspots, not complexity alone — a file that's complex
 * but never touched is lower risk than a file that's both complex and
 * constantly changed. This combines git commit churn per file over a
 * lookback window with the same ESLint `complexity` rule the
 * complexity-ratchet uses, scored as churn × complexity-violation-count.
 *
 * Usage: node scripts/hotspots.mjs [--days=180] [--top=20] [--json]
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split("=")[1], 10) : fallback;
};
const days = flag("days", 180);
const top = flag("top", 20);
const asJson = args.includes("--json");

function churnByFile() {
  const raw = execSync(
    `git log --since="${days} days ago" --name-only --pretty=format:`,
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const counts = new Map();
  for (const line of raw.split("\n")) {
    const file = line.trim();
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

function complexityByFile() {
  let raw;
  try {
    raw = execSync(
      'pnpm exec eslint . --format json --rule \'{"complexity":["warn",10]}\'',
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    raw = e.stdout ?? "";
  }

  let results;
  try {
    results = JSON.parse(raw);
  } catch {
    console.error(
      "[hotspots] could not parse ESLint JSON output — did it run?\n" +
        raw.slice(0, 500),
    );
    process.exit(2);
  }

  const cwd = `${process.cwd()}/`;
  const counts = new Map();
  for (const file of results) {
    const violations = file.messages.filter((m) => m.ruleId === "complexity");
    if (violations.length === 0) continue;
    const relPath = file.filePath.startsWith(cwd)
      ? file.filePath.slice(cwd.length)
      : file.filePath;
    counts.set(relPath, violations.length);
  }
  return counts;
}

const churn = churnByFile();
const complexity = complexityByFile();

const files = new Set([...churn.keys(), ...complexity.keys()]);
const hotspots = [...files]
  .map((file) => {
    const churnCount = churn.get(file) ?? 0;
    const complexityCount = complexity.get(file) ?? 0;
    return { file, churn: churnCount, complexity: complexityCount, score: churnCount * complexityCount };
  })
  .filter((h) => h.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, top);

if (asJson) {
  console.log(JSON.stringify(hotspots, null, 2));
} else {
  console.log(`# Churn × Complexity Hotspots (R-11.2, last ${days}d, top ${top})`);
  console.log();
  if (hotspots.length === 0) {
    console.log(
      "No files with both churn and complexity violations in this window.",
    );
  } else {
    console.log("| Score | Churn (commits) | Complexity violations | File |");
    console.log("|---|---|---|---|");
    for (const h of hotspots) {
      console.log(`| ${h.score} | ${h.churn} | ${h.complexity} | \`${h.file}\` |`);
    }
    console.log();
    console.log(
      "Highest-scoring files are the best refactoring ROI: frequently changed AND complex.",
    );
  }
}
