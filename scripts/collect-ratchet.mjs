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
 * JUSTIFICATION MARKER: a read that legitimately needs the whole per-org set (an
 * aggregation, or a small bounded-by-domain set) is exempted by putting `r9.8-ok`
 * in a comment on/near the query (within the same withIndex→.collect() window, or
 * the line just above it), e.g. `// r9.8-ok: aggregation over one project`. The
 * ratchet counts only UNJUSTIFIED org-wide collects — closing #625 means driving
 * that to 0 (every org-wide collect is either bounded/paginated or marked).
 *
 * Usage: node scripts/collect-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONVEX_DIR = "convex";
const BASELINE_FILE = ".collect-ratchet-baseline";
const MARKER = "r9.8-ok";

function countOrgWideCollects() {
  let total = 0;
  let unjustified = 0;
  const perFile = {};
  for (const name of readdirSync(CONVEX_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const lines = readFileSync(join(CONVEX_DIR, name), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Only the PURE org index (`by_organizationId"`, exact) is an unbounded org-wide
      // scan. A compound `by_organizationId_x` index is narrowed by that second key
      // (one asset / one status / …) by design — bounded, not the R-9.8 hazard — so it
      // isn't matched here. Matching the exact index name (not a prefix) also avoids the
      // false positive where the `.eq().eq()` chain sits on a continuation line.
      if (!/withIndex\("by_organizationId"/.test(lines[i])) continue;
      const window = lines.slice(i, i + 4).join("\n");
      if (
        window.includes(".collect()") &&
        !window.includes(".take(") &&
        !window.includes(".first()") &&
        !window.includes(".unique()")
      ) {
        total++;
        // Justification must be line-precise — on the withIndex line itself or the line
        // immediately above it. (Not the whole window: in a dense Promise.all a marker on
        // one collect would leak onto adjacent unrelated reads.)
        const justified =
          lines[i].includes(MARKER) || (i > 0 && lines[i - 1].includes(MARKER));
        if (!justified) {
          unjustified++;
          perFile[name] = (perFile[name] ?? 0) + 1;
        }
      }
    }
  }
  return { total, unjustified, perFile };
}

const { total, unjustified, perFile } = countOrgWideCollects();

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${unjustified}\n`);
  console.log(`[collect-ratchet] wrote baseline: ${unjustified} unjustified (of ${total} org-wide)`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[collect-ratchet] missing ${BASELINE_FILE} — run with --write to seed it.`);
  process.exit(1);
}

if (unjustified > baseline) {
  console.error(
    `[collect-ratchet] FAIL: unjustified org-wide .collect() scans rose to ${unjustified} ` +
      `(baseline ${baseline}, of ${total} org-wide total).\n` +
      `New unbounded org-wide reads are not allowed (R-9.8). Bound them (parent index, .take,\n` +
      `pagination via convex/lib/pagination.ts), or if the full per-org set is genuinely\n` +
      `needed add a "r9.8-ok: <reason>" comment. Offenders by file:`,
  );
  for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${f}`);
  }
  process.exit(1);
}

if (unjustified < baseline) {
  console.log(
    `[collect-ratchet] improved: ${unjustified} unjustified < baseline ${baseline} ` +
      `(of ${total} org-wide). Lower the baseline: node scripts/collect-ratchet.mjs --write`,
  );
} else {
  console.log(
    `[collect-ratchet] OK: ${unjustified} unjustified org-wide .collect() scans ` +
      `(baseline ${baseline}, of ${total} org-wide total). Target: 0.`,
  );
}
