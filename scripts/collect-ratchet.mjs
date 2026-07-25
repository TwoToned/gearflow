#!/usr/bin/env node
/**
 * Unbounded-read ratchet (POLICY.md R-9.8). Tracks three things:
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
 *  3. UNREGISTERED MARKERS — every `r9.8-ok` comment in `convex/**\/*.ts`, whether or
 *     not it sits on a hazard-shape line, split into "registered" (the comment points
 *     at `docs/exceptions.md` AND that file's source filename is actually named in
 *     `docs/exceptions.md`) vs "bare" (no exceptions.md pointer, or a pointer that
 *     doesn't resolve to a real row). Round-4 audit (#901): `collect-ratchet.mjs`'s
 *     old "0 unjustified" result only proved a marker string was *present* near the
 *     query, not that it was backed by a real, owned, dated §15 exception — 211 of
 *     225 markers turned out to be bare. Ratcheted on its own baseline
 *     (`.collect-ratchet-unregistered-baseline`) so that gap can't silently regrow
 *     while the hazard-shape metric reads a deceptive 0.
 *
 * Like the any-ratchet and dependency-cruiser baselines, all three numbers are
 * RATCHETS: none may exceed its committed baseline. New unbounded `.collect()`s fail
 * CI; as existing ones are bounded/paginated or genuinely registered, lower the
 * baseline. Hazard-shape analysis never blocks legitimately-bounded reads (by parent
 * id, single-doc lookups, aggregations that need the full set) — only the org-wide
 * and whole-table full scans.
 *
 * JUSTIFICATION MARKER: a hazard-shape read that legitimately needs the whole set (an
 * aggregation, or a small bounded-by-domain/platform-scale table) is exempted by
 * putting `r9.8-ok` in a comment on/near the query (on the matched line itself, or
 * the line just above it), e.g. `// r9.8-ok: aggregation over one project` or
 * `// r9.8-ok: see docs/exceptions.md R-8.3.3 <slug>`. A bare marker with no owner/
 * expiry does NOT satisfy R-15.1 on its own (#860/#861/#901) — anything long-lived
 * enough to matter belongs in docs/exceptions.md too; the comment is a pointer to
 * that entry, not the exception itself. The hazard-shape ratchet counts only
 * UNJUSTIFIED hazard-shape collects — closing #625/#740/#860 means driving that to 0
 * (every org-wide or whole-table collect is either bounded/paginated or
 * marked+registered). The unregistered-marker ratchet (metric 3, #901) counts markers
 * that aren't *actually* registered regardless of hazard shape — closing it means
 * every `r9.8-ok` either becomes a real docs/exceptions.md row or gets converted to a
 * bounded read.
 *
 * ACCOUNTABILITY LOG (#901): raising `.collect-ratchet-full-baseline` via `--write`
 * requires `--reason "<text>"` and is appended to `docs/collect-ratchet-log.md` — round
 * 4's finding was that a baseline bump (665→671) was framed as remediation with no
 * durable record of *why* the ceiling moved. Baseline decreases are logged too (no
 * `--reason` required — a drop is self-evidently real progress).
 *
 * Usage: node scripts/collect-ratchet.mjs [--write] [--reason "why the full baseline moved"]
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const CONVEX_DIR = "convex";
// convex/_generated is machine-generated (R-0.5 categorical carve-out) — never scanned.
const EXCLUDED_DIRS = new Set(["_generated"]);
const BASELINE_FILE = ".collect-ratchet-baseline";
const FULL_BASELINE_FILE = ".collect-ratchet-full-baseline";
const UNREGISTERED_BASELINE_FILE = ".collect-ratchet-unregistered-baseline";
const EXCEPTIONS_FILE = "docs/exceptions.md";
const LOG_FILE = "docs/collect-ratchet-log.md";
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

// A marker is "registered" only if its comment points at docs/exceptions.md AND
// that file actually names the source file the marker sits in — a bare inline
// reason (or a pointer to exceptions.md that doesn't correspond to a real row for
// this file) doesn't satisfy R-15.1 (#901).
function isMarkerRegistered(line, sourceFileName, exceptionsText) {
  const idx = line.indexOf(MARKER);
  const comment = line.slice(idx);
  if (!comment.includes("docs/exceptions.md")) return false;
  return exceptionsText.includes(basename(sourceFileName));
}

function readFileIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function countCollects() {
  const exceptionsText = readFileIfExists(EXCEPTIONS_FILE) ?? "";
  let fullCount = 0;
  let hazardTotal = 0;
  let unjustified = 0;
  let totalMarkers = 0;
  let unregisteredMarkers = 0;
  const perFile = {};
  const perFileUnregistered = {};
  for (const path of listSourceFiles(CONVEX_DIR)) {
    const name = relative(CONVEX_DIR, path);
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(".collect()")) fullCount++;

      if (lines[i].includes(MARKER)) {
        totalMarkers++;
        if (!isMarkerRegistered(lines[i], name, exceptionsText)) {
          unregisteredMarkers++;
          perFileUnregistered[name] = (perFileUnregistered[name] ?? 0) + 1;
        }
      }

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
  return { fullCount, hazardTotal, unjustified, perFile, totalMarkers, unregisteredMarkers, perFileUnregistered };
}

const { fullCount, hazardTotal, unjustified, perFile, totalMarkers, unregisteredMarkers, perFileUnregistered } = countCollects();

function readReason() {
  const idx = process.argv.indexOf("--reason");
  return idx === -1 ? null : (process.argv[idx + 1] ?? null);
}

function logBaselineChange(oldValue, newValue, reason) {
  // Atomic create-if-missing: "wx" fails with EEXIST if the file is already there
  // instead of a separate existsSync check-then-writeFileSync race (CodeQL
  // js/file-system-race).
  try {
    writeFileSync(
      LOG_FILE,
      "# Collect-ratchet full-baseline change log\n\n" +
        "Append-only audit trail for `.collect-ratchet-full-baseline` (POLICY.md R-9.8, #901).\n" +
        "Every raise must carry a `--reason`; decreases are logged automatically as real\n" +
        "remediation — the point is to make \"scope widened, ceiling raised\" visually\n" +
        "distinct from \"debt paid down\" instead of both looking like the same baseline commit.\n\n" +
        "| Date | Old | New | Delta | Reason |\n|------|-----|-----|-------|--------|\n",
      { flag: "wx" },
    );
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const date = new Date().toISOString().slice(0, 10);
  const delta = newValue - oldValue;
  const sign = delta > 0 ? "+" : "";
  const reasonText = reason ?? "(decrease — existing collects bounded/paginated)";
  appendFileSync(LOG_FILE, `| ${date} | ${oldValue} | ${newValue} | ${sign}${delta} | ${reasonText} |\n`);
}

if (process.argv.includes("--write")) {
  const priorFullBaselineText = readFileIfExists(FULL_BASELINE_FILE);
  const priorFullBaseline = priorFullBaselineText === null ? null : parseInt(priorFullBaselineText.trim(), 10);
  const reason = readReason();
  if (priorFullBaseline !== null && fullCount > priorFullBaseline && !reason) {
    console.error(
      `[collect-ratchet] REFUSED: --write would raise the full-count baseline ${priorFullBaseline} → ${fullCount} ` +
        `with no --reason (#901 — silent baseline raises are not remediation). Re-run with\n` +
        `  node scripts/collect-ratchet.mjs --write --reason "<why the ceiling is moving up>"\n` +
        `so it lands in ${LOG_FILE}.`,
    );
    process.exit(1);
  }
  writeFileSync(BASELINE_FILE, `${unjustified}\n`);
  writeFileSync(FULL_BASELINE_FILE, `${fullCount}\n`);
  writeFileSync(UNREGISTERED_BASELINE_FILE, `${unregisteredMarkers}\n`);
  if (priorFullBaseline !== null && priorFullBaseline !== fullCount) {
    logBaselineChange(priorFullBaseline, fullCount, reason);
  }
  console.log(
    `[collect-ratchet] wrote baselines: ${unjustified} unjustified (of ${hazardTotal} hazard-shape), ` +
      `${fullCount} full non-test .collect() count, ${unregisteredMarkers} unregistered markers (of ${totalMarkers} total)`,
  );
  process.exit(0);
}

let baseline;
let fullBaseline;
let unregisteredBaseline;
try {
  baseline = parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10);
  fullBaseline = parseInt(readFileSync(FULL_BASELINE_FILE, "utf8").trim(), 10);
  unregisteredBaseline = parseInt(readFileSync(UNREGISTERED_BASELINE_FILE, "utf8").trim(), 10);
} catch {
  console.error(
    `[collect-ratchet] missing ${BASELINE_FILE}, ${FULL_BASELINE_FILE}, or ${UNREGISTERED_BASELINE_FILE} — run with --write to seed them.`,
  );
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

if (unregisteredMarkers > unregisteredBaseline) {
  failed = true;
  console.error(
    `[collect-ratchet] FAIL: unregistered "${MARKER}" markers rose to ${unregisteredMarkers} ` +
      `(baseline ${unregisteredBaseline}, of ${totalMarkers} total markers). A marker is only\n` +
      `"registered" when it points at docs/exceptions.md AND that file actually names the\n` +
      `source file (R-15.1 — #901). New bare "r9.8-ok: <reason>" comments with no\n` +
      `docs/exceptions.md row are not valid exceptions. Offenders by file:`,
  );
  for (const [f, n] of Object.entries(perFileUnregistered).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${f}`);
  }
} else if (unregisteredMarkers < unregisteredBaseline) {
  console.log(
    `[collect-ratchet] improved: ${unregisteredMarkers} unregistered markers < baseline ${unregisteredBaseline} ` +
      `(of ${totalMarkers} total). Lower the baseline: node scripts/collect-ratchet.mjs --write`,
  );
} else {
  console.log(
    `[collect-ratchet] OK: ${unregisteredMarkers} unregistered "${MARKER}" markers ` +
      `(baseline ${unregisteredBaseline}, of ${totalMarkers} total). Target: 0.`,
  );
}

if (failed) process.exit(1);
