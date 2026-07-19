#!/usr/bin/env node
/**
 * Bundle-size regression gate (POLICY.md R-8.1.5 / T-8). Makes the bundle budget
 * BLOCKING: measures the gzipped First Load JS of the app's entry route (`/`, the
 * login page — the one route every unauthenticated visitor pays for) and fails CI if
 * it grows past the committed baseline by more than the headroom. The old
 * `.size-limit.json` summed EVERY chunk (all routes) which just grows as routes are
 * added — not a first-load budget; this measures exactly the chunks the entry HTML
 * loads.
 *
 * 5% headroom absorbs normal chunk-hashing churn while still catching real regressions
 * (a heavy import dragged onto the shared/entry path). Run after `next build`.
 *
 * Usage: node scripts/bundle-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BASELINE_FILE = ".bundle-baseline";
const HEADROOM = 1.05; // +5%
const HTML = ".next/server/app/index.html";

if (!existsSync(HTML)) {
  console.error(`[bundle-ratchet] ${HTML} not found — run \`next build\` first.`);
  process.exit(2);
}

const html = readFileSync(HTML, "utf8");
const chunks = [
  ...new Set([...html.matchAll(/\/_next\/static\/chunks\/([^"']+\.js)/g)].map((m) => m[1])),
];
let bytes = 0;
for (const c of chunks) {
  const p = `.next/static/chunks/${c}`;
  if (existsSync(p)) bytes += gzipSync(readFileSync(p)).length;
}
const kb = Math.round(bytes / 1024);

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${kb}\n`);
  console.log(`[bundle-ratchet] wrote baseline: ${kb} KB (entry-route First Load JS, gzip)`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[bundle-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`);
  process.exit(1);
}

const ceiling = Math.round(baseline * HEADROOM);
if (kb > ceiling) {
  console.error(
    `[bundle-ratchet] FAIL: entry-route First Load JS is ${kb} KB, over the ${ceiling} KB ` +
      `ceiling (baseline ${baseline} KB + 5%). A heavy dependency likely landed on the shared/` +
      `entry path — code-split it (next/dynamic) or trim it. If the growth is intended, ` +
      `re-baseline: node scripts/bundle-ratchet.mjs --write.`,
  );
  process.exit(1);
}
if (kb < baseline) {
  console.log(
    `[bundle-ratchet] improved: ${kb} KB < baseline ${baseline} KB. Lower it: ` +
      `node scripts/bundle-ratchet.mjs --write`,
  );
} else {
  console.log(`[bundle-ratchet] OK: entry-route First Load JS ${kb} KB (baseline ${baseline} KB, ceiling ${ceiling} KB).`);
}
