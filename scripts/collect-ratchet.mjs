#!/usr/bin/env node
/**
 * Unbounded-read ratchet (POLICY.md R-9.8). Tracks two things:
 *
 *  1. FULL COUNT — every non-test `.collect()` in `convex/**\/*.ts`, no shape analysis.
 *     This is the number the audits report (665 at round 3, unchanged across three
 *     consecutive rounds — #860). Ratcheted on its own baseline
 *     (`.collect-ratchet-full-baseline`) so the *aggregate* count is visible and
 *     blocking, not just the narrow hazard subset below — #860's own complaint was
 *     that the ratchet-scope was too narrow to show real progress.
 *
 *  2. HAZARD SHAPES — two categories, both `.collect()`ed without an upper bound as
 *     data grows:
 *       A. ORG-WIDE — a query narrowed only by an `by_organizationId*` index, i.e.
 *          "read every row for this org" on a growable table.
 *       B. NO-INDEX — a query with no `.withIndex(...)` at all, i.e. "read every row
 *          in the table" platform-wide. Strictly broader/riskier than (A): not even
 *          narrowed to one org.
 *     Other non-org, non-pure-scan `.collect()`s — e.g. narrowed by a compound org
 *     index's second key, or by a parent id — stay out of scope for category
 *     analysis: those are bounded-by-domain reads, not the R-9.8 hazard, and flagging
 *     them needs case-by-case review this pattern-match can't do. They still count
 *     toward the FULL COUNT above.
 *
 * Like the any-ratchet and dependency-cruiser baselines, both numbers are RATCHETS:
 * neither may exceed its committed baseline. New unbounded `.collect()`s fail CI; as
 * existing ones are bounded/paginated, lower the baseline. Hazard-shape analysis never
 * blocks legitimately-bounded reads (by parent id, single-doc lookups, aggregations
 * that need the full set) — only the org-wide and whole-table full scans.
 *
 * JUSTIFICATION MARKER: a hazard-shape read that legitimately needs the whole set (an
 * aggregation, or a small bounded-by-domain/platform-scale table) is exempted by
 * putting `r9.8-ok` in a comment on/near the query (on the matched line itself, or
 * the line just above it), e.g. `// r9.8-ok: aggregation over one project` or
 * `// r9.8-ok: see docs/exceptions.md R-8.3.3 <slug>`. A bare marker with no owner/
 * expiry does NOT satisfy R-15.1 on its own (#860/#861) — anything long-lived enough
 * to matter belongs in docs/exceptions.md too; the comment is a pointer to that entry,
 * not the exception itself. The ratchet counts only UNJUSTIFIED hazard-shape collects
 * — closing #625/#740/#860 means driving that to 0 (every org-wide or whole-table
 * collect is either bounded/paginated or marked+registered).
 *
 * Usage: node scripts/collect-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CONVEX_DIR = "convex";
// convex/_generated is machine-generated (R-0.5 categorical carve-out) — never scanned.
const EXCLUDED_DIRS = new Set(["_generated"]);
const BASELINE_FILE = ".collect-ratchet-baseline";
const FULL_BASELINE_FILE = ".collect-ratchet-full-baseline";
const MARKER = "r9.8-ok";

function isJustified(lines, i) {
  // Justification must be line-precise — on the matched line itself or the line
  // immediately above it. (Not the whole window: in a dense Promise.all a marker on
  // one collect would leak onto adjacent unrelated reads.)
  return lines[i].includes(MARKER) || (i > 0 && lines[i - 1].includes(MARKER));
}

// Recursively list every non-test `.ts` file under `dir` (convex/lib, convex/crons,
// etc. included — the previous version of this script only read the top-level convex/
// directory via a flat readdirSync, silently missing convex/lib/**.ts and understating
// the real repo-wide count the hygiene audits report — #860's own complaint).
function listSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function countCollects() {
  let fullCount = 0;
  let hazardTotal = 0;
  let unjustified = 0;
  const perFile = {};
  for (const path of listSourceFiles(CONVEX_DIR)) {
    const name = relative(CONVEX_DIR, path);
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(".collect()")) fullCount++;

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
        hazardTotal++;
        if (!isJustified(lines, i)) {
          unjustified++;
          perFile[name] = (perFile[name] ?? 0) + 1;
        }
      }
    }
  }
  return { fullCount, hazardTotal, unjustified, perFile };
}

const { fullCount, hazardTotal, unjustified, perFile } = countCollects();

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${unjustified}\n`);
  writeFileSync(FULL_BASELINE_FILE, `${fullCount}\n`);
  console.log(`[collect-ratchet] wrote baselines: ${unjustified} unjustified (of ${hazardTotal} hazard-shape), ${fullCount} full non-test .collect() count`);
  process.exit(0);
}

let baseline;
let fullBaseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
  fullBaseline = parseInt(readFileSync(FULL_BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(`[collect-ratchet] missing ${BASELINE_FILE} or ${FULL_BASELINE_FILE} — run with --write to seed them.`);
  process.exit(1);
}

let failed = false;

if (unjustified > baseline) {
  failed = true;
  console.error(
    `[collect-ratchet] FAIL: unjustified unbounded .collect() scans rose to ${unjustified} ` +
      `(baseline ${baseline}, of ${hazardTotal} org-wide/whole-table total).\n` +
      `New unbounded reads are not allowed (R-9.8). Bound them (parent index, .take,\n` +
      `pagination via convex/lib/pagination.ts), or if the full org/table set is genuinely\n` +
      `needed add a "r9.8-ok: <reason>" comment AND register it in docs/exceptions.md\n` +
      `(R-15.1 — a bare comment with no owner/expiry is not a valid exception). Offenders by file:`,
  );
  for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${f}`);
  }
} else if (unjustified < baseline) {
  console.log(
    `[collect-ratchet] improved: ${unjustified} unjustified < baseline ${baseline} ` +
      `(of ${hazardTotal} org-wide/whole-table). Lower the baseline: node scripts/collect-ratchet.mjs --write`,
  );
} else {
  console.log(
    `[collect-ratchet] OK: ${unjustified} unjustified unbounded .collect() scans ` +
      `(baseline ${baseline}, of ${hazardTotal} org-wide/whole-table total). Target: 0.`,
  );
}

if (fullCount > fullBaseline) {
  failed = true;
  console.error(
    `[collect-ratchet] FAIL: full non-test .collect() count rose to ${fullCount} ` +
      `(baseline ${fullBaseline}). This is the whole-repo count the hygiene audits track (#860) —\n` +
      `every new .collect() call in convex/**/*.ts counts against it, hazard-shaped or not,\n` +
      `so the aggregate can't quietly regrow while individual hazard fixes land. Prefer\n` +
      `.paginate()/.take()/an indexed narrowing over a new .collect(); if it's unavoidable,\n` +
      `lower some other .collect() first or get a deliberate baseline bump reviewed.`,
  );
} else if (fullCount < fullBaseline) {
  console.log(
    `[collect-ratchet] improved: full .collect() count ${fullCount} < baseline ${fullBaseline}. ` +
      `Lower the baseline: node scripts/collect-ratchet.mjs --write`,
  );
} else {
  console.log(`[collect-ratchet] OK: full .collect() count ${fullCount} (baseline ${fullBaseline}).`);
}

if (failed) process.exit(1);
