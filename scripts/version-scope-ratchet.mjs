#!/usr/bin/env node
/**
 * Version-scope guard ratchet (#1228, Project Versioning v2 Phase 2).
 *
 * Mirrors scripts/xtenant-bycuid-ratchet.mjs's shape for a sibling hazard: the
 * five "plan" tables (`projectCategories`, `projectGroups`, `projectLineItems`,
 * `projectServices`, `categorySlots`) can now hold rows for MULTIPLE versions
 * of the same project (Phase 1 added `versionId`/`lineageId`; Phase 2 deleted
 * `by_projectId` and made `by_versionId` the only project-scoped index on the
 * first four — see the schema.ts comment on each table). A read reached
 * through any OTHER index on one of these five tables risks silently mixing
 * a non-live version's rows into a live-only computation (or vice versa)
 * unless the surrounding code has actually reasoned about it.
 *
 * This is the static backstop, same heuristic philosophy as the by_cuid
 * ratchet (broad, not AST-precise — false negatives just become baseline
 * debt, never a false CI failure): the total count of "read of one of the
 * five tables through a non-version-scoped index, with no VERSION-SCOPE
 * marker anywhere in the enclosing top-level declaration" may not exceed the
 * committed baseline. New unmarked sites fail CI; existing ones get fixed
 * (converted to `liveRows`/`versionRows`, see convex/lib/versionScope.ts) or
 * marked down over time, lowering the baseline.
 *
 * ── The marker convention ──────────────────────────────────────────────────
 * A read that has been deliberately reasoned about and found safe (or that
 * intentionally spans every version on purpose) carries a comment containing
 * the literal string `VERSION-SCOPE` somewhere in the same top-level
 * declaration (function/const-arrow) as the read — e.g.:
 *
 *   // VERSION-SCOPE: all-versions — deleting the whole project cascades
 *   // every version's rows, not just the live one.
 *   const versions = await listProjectVersions(ctx, orgId, id);
 *
 * The marker doesn't have to say "all-versions" specifically — any reasoned
 * comment containing the token is accepted, the same way the by_cuid
 * ratchet's GUARD_INDICATOR accepts several different real guard shapes. Two
 * recognised reasons in practice: `all-versions` (a deliberate cross-version
 * scan) and a comment explaining why the index is safe despite not being in
 * the by_versionId family (e.g. `categorySlots`' PARENT_JOIN indexes, which
 * reach a version's rows only through an already version-scoped parent row —
 * see categorySlots' own schema.ts comment).
 *
 * ── Indexes that DON'T need a marker ───────────────────────────────────────
 * - `by_cuid` on any of the five tables: a point lookup by the row's OWN id
 *   is trivially version-safe (you already know exactly which row, and thus
 *   which version, you're reading — there's nothing to mix up).
 * - The `by_versionId` family on the four tables that have one
 *   (`by_versionId`, `by_versionId_lineageId`, and every renamed composite:
 *   `by_versionId_status`, `by_versionId_sortOrder`, `by_versionId_type`,
 *   `by_versionId_date`).
 *
 * `categorySlots` has NO `by_versionId` index at all (see its schema.ts
 * comment) — every read of it (other than by_cuid) needs a marker.
 *
 * Usage: node scripts/version-scope-ratchet.mjs [--write] [--list]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASELINE_FILE = ".version-scope-baseline";
const CONVEX_DIR = "convex";

/** The five tables this ratchet watches. */
const WATCHED_TABLES = new Set([
  "projectCategories",
  "projectGroups",
  "projectLineItems",
  "projectServices",
  "categorySlots",
]);

/** Indexes that never need a marker on ANY watched table — a point lookup by
 *  the row's own cuid can't mix versions. */
const ALWAYS_SAFE_INDEXES = new Set(["by_cuid"]);

/** The by_versionId family — safe without a marker ONLY on the four tables
 *  that actually have one (not categorySlots). */
const VERSION_FAMILY_INDEX = /^by_versionId(_|$)/;
const TABLES_WITH_VERSION_INDEX = new Set([
  "projectCategories",
  "projectGroups",
  "projectLineItems",
  "projectServices",
]);

const MARKER = /VERSION-SCOPE/;

/** Matches `.query("<table>")` followed, within a bounded window (chained
 *  method calls, occasionally split across a couple of lines with a comment
 *  in between — same tolerance as the rest of this codebase's query chains),
 *  by `.withIndex("<index>"`. Non-greedy so it binds to the NEAREST
 *  `.withIndex` after the `.query`, matching how these chains are actually
 *  written. */
const QUERY_THEN_INDEX = /\.query\(\s*"(\w+)"\s*\)[\s\S]{0,300}?\.withIndex\(\s*"(\w+)"/g;

/** Start of a top-level declaration this ratchet treats as one "enclosing
 *  function" for marker-proximity purposes: an exported query/mutation
 *  object, a plain top-level function, or a top-level const arrow/async
 *  function. Broad on purpose (heuristic, not a parser) — a comment anywhere
 *  between one declaration start and the next counts as covering every
 *  violation in between. */
const DECL_START = /^(export\s+)?(default\s+)?(async\s+)?function\s+\w+|^export\s+const\s+\w+\s*=|^const\s+\w+\s*=\s*(async\s+)?[\(\w]/gm;

function listConvexFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated") continue;
      out.push(...listConvexFiles(path));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Declaration-start offsets in `source`, sorted ascending, with a sentinel
 *  0 and source.length at the ends so every position falls in some window. */
function declBoundaries(source) {
  const starts = new Set([0, source.length]);
  for (const m of source.matchAll(DECL_START)) starts.add(m.index);
  return [...starts].sort((a, b) => a - b);
}

/** The [start, end) window of the declaration containing `pos`. */
function windowFor(boundaries, pos) {
  let start = 0;
  for (const b of boundaries) {
    if (b > pos) break;
    start = b;
  }
  const end = boundaries.find((b) => b > pos) ?? boundaries[boundaries.length - 1];
  return [start, end];
}

let unmarked = 0;
const offenders = [];

for (const file of listConvexFiles(CONVEX_DIR)) {
  const source = readFileSync(file, "utf8");
  let hasCandidate = false;
  for (const table of WATCHED_TABLES) {
    if (source.includes(`"${table}"`)) { hasCandidate = true; break; }
  }
  if (!hasCandidate) continue;

  const boundaries = declBoundaries(source);

  for (const m of source.matchAll(QUERY_THEN_INDEX)) {
    const [, table, index] = m;
    if (!WATCHED_TABLES.has(table)) continue;
    if (ALWAYS_SAFE_INDEXES.has(index)) continue;
    if (TABLES_WITH_VERSION_INDEX.has(table) && VERSION_FAMILY_INDEX.test(index)) continue;

    const [start, end] = windowFor(boundaries, m.index);
    const enclosing = source.slice(start, end);
    if (MARKER.test(enclosing)) continue;

    unmarked += 1;
    const line = source.slice(0, m.index).split("\n").length;
    offenders.push(`${file}:${line}: ${table} via "${index}"`);
  }
}

if (process.argv.includes("--list")) {
  console.log(offenders.join("\n"));
  process.exit(0);
}

const baseline = Number(readFileSync(BASELINE_FILE, "utf8").trim() || "0");

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${unmarked}\n`);
  console.log(`[version-scope-ratchet] wrote baseline: ${unmarked}`);
  process.exit(0);
}

console.log(`[version-scope-ratchet] unmarked cross-version-risk reads: current=${unmarked} baseline=${baseline}`);

if (unmarked > baseline) {
  console.error(
    `❌ Unmarked version-scope-risk reads grew ${baseline} -> ${unmarked}. New offenders:\n` +
      offenders.slice(0, 30).join("\n") +
      `\nEither convert the read to liveRows()/versionRows() (convex/lib/versionScope.ts), ` +
      `or add a // VERSION-SCOPE: <reason> comment in the enclosing function if it's a ` +
      `deliberate all-versions scan or otherwise safe (e.g. a categorySlots PARENT_JOIN).`,
  );
  process.exit(1);
}
if (unmarked < baseline) {
  console.log(`✅ Unmarked version-scope-risk reads dropped ${baseline} -> ${unmarked}. Lock it in: node scripts/version-scope-ratchet.mjs --write`);
}
console.log("✅ ratchet holds.");
