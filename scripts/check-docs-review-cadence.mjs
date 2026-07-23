#!/usr/bin/env node
/**
 * Critical-doc review-cadence gate (POLICY.md R-5.5 / T-14: "critical docs
 * (architecture, onboarding, runbooks) reviewed at least quarterly").
 *
 * Reads the `Owner: ... · Last reviewed: YYYY-MM-DD` header from each critical doc
 * and fails if the review date is more than one quarter (91 days) stale. Run from
 * the Quarterly Sweep workflow (.github/workflows/quarterly-sweep.yml) — a process
 * budget (R-9.1), not a per-PR CI gate, since staleness accrues with wall-clock
 * time rather than any single diff.
 *
 * Usage: node scripts/check-docs-review-cadence.mjs
 */
import { readFileSync } from "node:fs";

const QUARTER_DAYS = 91;

const CRITICAL_DOCS = [
  "README.md",
  "CLAUDE.md",
  "ARCHITECTURE.md",
  "docs/convex-backup-restore-runbook.md",
  "docs/convex-observability-runbook.md",
];

const HEADER_RE = /Owner:.*?Last reviewed:\s*(\d{4}-\d{2}-\d{2})/i;

const today = new Date();

const stale = [];
const missing = [];

for (const file of CRITICAL_DOCS) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    missing.push(`${file}: file not found`);
    continue;
  }
  const match = text.match(HEADER_RE);
  if (!match) {
    missing.push(`${file}: no "Owner: ... · Last reviewed: YYYY-MM-DD" header found`);
    continue;
  }
  const reviewed = new Date(`${match[1]}T00:00:00Z`);
  const ageDays = Math.floor((today.getTime() - reviewed.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays > QUARTER_DAYS) {
    stale.push(`${file}: last reviewed ${match[1]} (${ageDays} days ago, > ${QUARTER_DAYS}-day quarterly cadence)`);
  }
}

if (missing.length > 0 || stale.length > 0) {
  console.error("[docs-review-cadence] FAIL: critical docs violate the quarterly review cadence (R-5.5 / T-14).");
  for (const m of missing) console.error(`  MISSING HEADER: ${m}`);
  for (const s of stale) console.error(`  STALE: ${s}`);
  console.error("Update the doc's `Owner: ... · Last reviewed: YYYY-MM-DD` header after reviewing it.");
  process.exit(1);
}
console.log(`[docs-review-cadence] OK: all ${CRITICAL_DOCS.length} critical docs reviewed within the last ${QUARTER_DAYS} days.`);
