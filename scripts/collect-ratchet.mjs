#!/usr/bin/env node
/**
 * Unbounded-read ratchet (POLICY.md R-9.8). Counts org-wide `.collect()` scans —
 * a query narrowed only by an `by_organizationId*` index and then `.collect()`ed,
 * i.e. "read every row for this org" on a growable table. These are the R-9.8
 * hazard: they scan without an upper bound as data grows.
 *
 * Like the any-ratchet and dependency-cruiser baselines, this is a RATCHET: the
 * count may not exceed the committed baseline. New org-wide `.collect()`s fail CI;
 * as existing ones are bounded/paginated, lower the baseline. It never blocks the
 * legitimately-bounded reads (by parent id, single-doc lookups, aggregations that
 * need the full set) — only the org-wide full scans.
 *
 * Usage: node scripts/collect-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONVEX_DIR = "convex";
const BASELINE_FILE = ".collect-ratchet-baseline";

function countOrgWideCollects() {
  let total = 0;
  const perFile = {};
  for (const name of readdirSync(CONVEX_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const lines = readFileSync(join(CONVEX_DIR, name), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/withIndex\("by_organizationId/.test(lines[i])) continue;
      const window = lines.slice(i, i + 4).join("\n");
      if (
        window.includes(".collect()") &&
        !window.includes(".take(") &&
        !window.includes(".first()") &&
        !window.includes(".unique()")
      ) {
        total++;
        perFile[name] = (perFile[name] ?? 0) + 1;
      }
    }
  }
  return { total, perFile };
}

const { total, perFile } = countOrgWideCollects();

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${total}\n`);
  console.log(`[collect-ratchet] wrote baseline: ${total}`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[collect-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`);
  process.exit(1);
}

if (total > baseline) {
  console.error(
    `[collect-ratchet] FAIL: org-wide .collect() scans rose to ${total} (baseline ${baseline}).\n` +
      `New unbounded org-wide reads are not allowed (R-9.8). Bound them (parent index, .take,\n` +
      `pagination, or convex/lib/pagination.ts helpers). Offenders by file:`,
  );
  for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${f}`);
  }
  process.exit(1);
}

if (total < baseline) {
  console.log(
    `[collect-ratchet] improved: ${total} < baseline ${baseline}. Lower the baseline: ` +
      `node scripts/collect-ratchet.mjs --write`,
  );
} else {
  console.log(`[collect-ratchet] OK: ${total} org-wide .collect() scans (baseline ${baseline}).`);
}
