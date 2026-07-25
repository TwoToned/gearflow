#!/usr/bin/env node
/**
 * Unbounded-read ratchet (POLICY.md R-9.8). Counts two hazard categories, both
 * `.collect()`ed without an upper bound as data grows:
 *
 *  A. ORG-WIDE — a query narrowed only by an `by_organizationId*` index, i.e.
 *     "read every row for this org" on a growable table.
 *  B. NO-INDEX — a query with no `.withIndex(...)` at all, i.e. "read every row in
 *     the table" platform-wide. Strictly broader/riskier than (A): not even
 *     narrowed to one org. (#740 — the original org-index-only check covered only
 *     a narrow slice of the repo's non-test `.collect()` calls; this was the first
 *     widening called for there. Other non-org, non-pure-scan `.collect()`s — e.g.
 *     narrowed by a compound org index's second key, or by a parent id — stay out
 *     of the GATE below: those are bounded-by-domain reads, not the R-9.8 hazard,
 *     and flagging them needs case-by-case review this pattern-match can't do.)
 *
 * Like the any-ratchet and dependency-cruiser baselines, this is a RATCHET: the
 * combined count may not exceed the committed baseline. New unbounded `.collect()`s
 * fail CI; as existing ones are bounded/paginated, lower the baseline. It never
 * blocks legitimately-bounded reads (by parent id, single-doc lookups, aggregations
 * that need the full set) — only the org-wide and whole-table full scans.
 *
 * JUSTIFICATION MARKER: a read that legitimately needs the whole set (an
 * aggregation, or a small bounded-by-domain/platform-scale table) is exempted by
 * putting `r9.8-ok` in a comment on/near the query (on the matched line itself, or
 * the line just above it), e.g. `// r9.8-ok: aggregation over one project` or
 * `// r9.8-ok: small platform-wide table`. The ratchet counts only UNJUSTIFIED
 * collects — closing #625/#740 means driving that to 0 (every org-wide or
 * whole-table collect is either bounded/paginated or marked).
 *
 * #825 (2026-07-23 audit): the remediation for #740 narrowed what this script even
 * LOOKS at down to the 222 category-A/B matches, out of 665 total non-test
 * `.collect()` calls repo-wide — every audit since then reported progress "of 222",
 * silently hiding the other 443 the pattern-match doesn't examine (some genuinely
 * bounded, some org-scoped-and-growable via a compound index this heuristic can't
 * safely flag without false positives). The GATE stays scoped to categories A/B —
 * widening it to every `.collect()` would flag legitimately-bounded parent-id/
 * single-doc reads and break CI for no safety gain — but `totalCollectCalls` below
 * is now tracked and reported alongside every result so an audit can see genuine
 * repo-wide movement (e.g. reservationConflicts.ts/crewDashboard.ts's #825 fixes
 * REMOVED org-wide collects while ADDING several small bounded ones — total went up
 * even though real unbounded-scan risk went down; the two numbers answer different
 * questions and both are now visible, instead of one masquerading as the other).
 *
 * Usage: node scripts/collect-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CONVEX_DIR = "convex";
const BASELINE_FILE = ".collect-ratchet-baseline";
const MARKER = "r9.8-ok";
// `_generated` is Convex-authored scaffolding, not hand-written app code — excluded
// from both counts. Everything else under convex/ (including lib/) is in scope: the
// original non-recursive walk here silently missed convex/lib/*.ts's own `.collect()`
// calls, part of the ratchet-scope narrowing #825 flagged.
const SKIP_DIRS = new Set(["_generated"]);

/** All non-test `.ts` files under `dir`, recursing into subdirectories (skipping SKIP_DIRS). */
function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function isJustified(lines, i) {
  // Justification must be line-precise — on the matched line itself or the line
  // immediately above it. (Not the whole window: in a dense Promise.all a marker on
  // one collect would leak onto adjacent unrelated reads.)
  return lines[i].includes(MARKER) || (i > 0 && lines[i - 1].includes(MARKER));
}

function countUnboundedCollects() {
  let total = 0;
  let unjustified = 0;
  let totalCollectCalls = 0;
  const perFile = {};
  for (const path of listTsFiles(CONVEX_DIR)) {
    const name = relative(CONVEX_DIR, path);
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Honest repo-wide denominator (#825): every `.collect()` call, regardless of
      // shape — not just the category A/B hazard pattern the GATE below reasons
      // about. A line with two `.collect()` calls (rare, but happens in a ternary)
      // counts both.
      const perLineCollects = lines[i].match(/\.collect\(\)/g);
      if (perLineCollects) totalCollectCalls += perLineCollects.length;

      // Category A — only the PURE org index (`by_organizationId"`, exact) is an
      // unbounded org-wide scan. A compound `by_organizationId_x` index is narrowed
      // by that second key (one asset / one status / …) by design — bounded, not
      // the R-9.8 hazard — so it isn't matched here. Matching the exact index name
      // (not a prefix) also avoids the false positive where the `.eq().eq()` chain
      // sits on a continuation line.
      const isOrgWide = /withIndex\("by_organizationId"/.test(lines[i]);
      // Category B — a literal-table-name query with no `.withIndex(` anywhere in
      // the window before its `.collect()`. Dynamic table names (`query(table)`)
      // are intentionally not matched — the ratchet only reasons about literal
      // strings it can grep.
      const queryMatch = !isOrgWide && /ctx\.db\.query\("[a-zA-Z0-9_]+"\)/.test(lines[i]);
      if (!isOrgWide && !queryMatch) continue;

      const window = lines.slice(i, i + 4).join("\n");
      if (queryMatch && window.includes(".withIndex(")) continue; // indexed — out of scope for category B

      if (
        window.includes(".collect()") &&
        !window.includes(".take(") &&
        !window.includes(".first()") &&
        !window.includes(".unique()")
      ) {
        total++;
        if (!isJustified(lines, i)) {
          unjustified++;
          perFile[name] = (perFile[name] ?? 0) + 1;
        }
      }
    }
  }
  return { total, unjustified, totalCollectCalls, perFile };
}

const { total, unjustified, totalCollectCalls, perFile } = countUnboundedCollects();
const totalsSuffix = `of ${total} org-wide/whole-table shape, ${totalCollectCalls} total .collect() calls repo-wide`;

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${unjustified}\n`);
  console.log(`[collect-ratchet] wrote baseline: ${unjustified} unjustified (${totalsSuffix})`);
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
    `[collect-ratchet] FAIL: unjustified unbounded .collect() scans rose to ${unjustified} ` +
      `(baseline ${baseline}, ${totalsSuffix}).\n` +
      `New unbounded reads are not allowed (R-9.8). Bound them (parent index, .take,\n` +
      `pagination via convex/lib/pagination.ts), or if the full org/table set is genuinely\n` +
      `needed add a "r9.8-ok: <reason>" comment. Offenders by file:`,
  );
  for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${f}`);
  }
  process.exit(1);
}

if (unjustified < baseline) {
  console.log(`[collect-ratchet] improved: ${unjustified} unjustified < baseline ${baseline} (${totalsSuffix}). Lower the baseline: node scripts/collect-ratchet.mjs --write`);
} else {
  console.log(`[collect-ratchet] OK: ${unjustified} unjustified unbounded .collect() scans (baseline ${baseline}, ${totalsSuffix}). Target: 0.`);
}
