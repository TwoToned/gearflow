#!/usr/bin/env node
/**
 * Cyclomatic-complexity ratchet (POLICY.md R-3.6). `complexity` is warn-only in
 * eslint.config.mjs — 656 existing violations make promoting it straight to
 * `error` a repo-wide rewrite, not a lint fix. Like the any-ratchet,
 * dependency-cruiser, collect-ratchet, and knip-ratchet baselines, this makes
 * it effectively BLOCKING via a ratchet instead: the total violation count may
 * not exceed the committed baseline. New over-complexity fails CI; as
 * functions are simplified, lower the baseline. It never lets the count grow.
 *
 * Usage: node scripts/complexity-ratchet.mjs [--write]
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = ".complexity-ratchet-baseline";

let raw;
try {
  // ESLint exits non-zero on any warning-level finding here since we force
  // just the one rule to "warn" and read its own count — capture stdout
  // regardless of exit code.
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
    "[complexity-ratchet] could not parse ESLint JSON output — did it run?\n" +
      raw.slice(0, 500),
  );
  process.exit(2);
}

const total = results.reduce(
  (sum, file) =>
    sum + file.messages.filter((m) => m.ruleId === "complexity").length,
  0,
);

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${total}\n`);
  console.log(`[complexity-ratchet] wrote baseline: ${total}`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(
    `[complexity-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`,
  );
  process.exit(1);
}

if (total > baseline) {
  console.error(
    `[complexity-ratchet] FAIL: complexity violations rose to ${total} (baseline ${baseline}).\n` +
      "Simplify the new/changed function(s) below 10 branches (R-3.6), or if truly\n" +
      "unavoidable, register a dated §15 exception in docs/exceptions.md instead of\n" +
      "raising the baseline.",
  );
  process.exit(1);
}

if (total < baseline) {
  console.log(
    `[complexity-ratchet] improved: ${total} < baseline ${baseline}. Lower it: node scripts/complexity-ratchet.mjs --write`,
  );
} else {
  console.log(`[complexity-ratchet] OK: ${total} complexity violations (baseline ${baseline}).`);
}
