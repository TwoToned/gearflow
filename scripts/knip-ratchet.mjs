#!/usr/bin/env node
/**
 * Dead-code ratchet (POLICY.md R-4.2). Knip's full burn-down is large (unused files +
 * exports + types + duplicates), and blindly deleting everything it flags risks removing
 * dynamically-referenced or false-positive symbols. So — like the any-ratchet,
 * dependency-cruiser, and collect-ratchet baselines — this makes Knip effectively
 * BLOCKING via a ratchet: the total issue count may not exceed the committed baseline.
 * New dead code fails CI; as the burn-down is cleared, lower the baseline. It never lets
 * the number grow.
 *
 * Usage: node scripts/knip-ratchet.mjs [--write]
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = ".knip-baseline";

let output = "";
try {
  // Knip exits non-zero when it finds issues — capture stdout regardless.
  output = execSync("pnpm exec knip", { encoding: "utf8" });
} catch (e) {
  output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
}

// Sum every section-header count, e.g. "Unused files (19)", "Unused exports (316)".
const counts = [...output.matchAll(/\((\d+)\)\s*$/gm)].map((m) => parseInt(m[1], 10));
const total = counts.reduce((a, b) => a + b, 0);

if (!counts.length && !/No .*issues|✂/i.test(output)) {
  console.error("[knip-ratchet] could not parse Knip output — did it run?\n" + output.slice(0, 500));
  process.exit(2);
}

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${total}\n`);
  console.log(`[knip-ratchet] wrote baseline: ${total}`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[knip-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`);
  process.exit(1);
}

if (total > baseline) {
  console.error(
    `[knip-ratchet] FAIL: dead-code issues rose to ${total} (baseline ${baseline}).\n` +
      `Remove the new unused file/export/dependency (R-4.2), or if it's a false positive\n` +
      `add it to the knip config ignore. Knip report:\n` +
      output.split("\n").filter((l) => /\(\d+\)\s*$/.test(l)).join("\n"),
  );
  process.exit(1);
}

if (total < baseline) {
  console.log(
    `[knip-ratchet] improved: ${total} < baseline ${baseline}. Lower it: node scripts/knip-ratchet.mjs --write`,
  );
} else {
  console.log(`[knip-ratchet] OK: ${total} dead-code issues (baseline ${baseline}).`);
}
