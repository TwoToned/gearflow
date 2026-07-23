#!/usr/bin/env node
/**
 * Circular-dependency ratchet (POLICY.md R-3.5). `pnpm run depcruise` uses
 * `--ignore-known` against `.dependency-cruiser-known-violations.json`, which only
 * fails on a genuinely NEW cycle — it never shrinks, so it can't reach R-3.5's
 * evidence bar of "zero cycle/boundary violations" on its own (see #730). Like the
 * Knip ratchet, this makes the TOTAL cycle count effectively BLOCKING: it may not
 * exceed the committed baseline. A regression fails CI; as the tangle is burned
 * down, lower the baseline. It never lets the count grow back.
 *
 * Usage: node scripts/depcruise-ratchet.mjs [--write]
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = ".depcruise-baseline";

let raw = "";
try {
  // depcruise exits non-zero when it finds error-severity violations — capture
  // stdout regardless. No --ignore-known: this must see the TRUE current count.
  raw = execSync(
    "pnpm exec depcruise src convex --config .dependency-cruiser.cjs --output-type json",
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
} catch (e) {
  raw = e.stdout ?? "";
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error("[depcruise-ratchet] could not parse depcruise JSON output — did it run?\n" + raw.slice(0, 500));
  process.exit(2);
}

const violations = report?.summary?.violations ?? [];
const cycles = violations.filter((v) => v.rule?.severity === "error");
const total = cycles.length;

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${total}\n`);
  console.log(`[depcruise-ratchet] wrote baseline: ${total}`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[depcruise-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`);
  process.exit(1);
}

if (total > baseline) {
  console.error(
    `[depcruise-ratchet] FAIL: circular-dependency violations rose to ${total} (baseline ${baseline}).\n` +
      `Break the new cycle (extract a shared types module, invert the dependency), or if it's a\n` +
      `false positive fix the dependency-cruiser config. Violations:\n` +
      cycles.map((v) => `  ${v.from} -> ${v.to}`).join("\n"),
  );
  process.exit(1);
}

if (total < baseline) {
  console.log(
    `[depcruise-ratchet] improved: ${total} < baseline ${baseline}. Lower it: node scripts/depcruise-ratchet.mjs --write`,
  );
} else {
  console.log(`[depcruise-ratchet] OK: ${total} circular-dependency violations (baseline ${baseline}).`);
}
