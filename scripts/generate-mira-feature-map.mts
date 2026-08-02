/**
 * Mira feature-map generator. Parses the FEATUREDOCS table in ARCHITECTURE.md
 * — the single source of truth for "what features exist in RVLT Flow" — into
 * a compact, LLM-prompt-ready string, so Mira's system prompt
 * (src/lib/mira/system-prompt.ts) never carries a hand-copied SECOND list
 * that can silently drift from the real one (POLICY.md R-3.1). Whoever adds a
 * new FEATUREDOCS row already updates ARCHITECTURE.md in the same PR (project
 * convention) — this generator is the only thing that has to also run.
 *
 * Usage:
 *   pnpm run mira:feature-map          # regenerate
 *   pnpm run mira:feature-map:check    # verify committed output is current (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "ARCHITECTURE.md");
const OUT = join(ROOT, "src/lib/mira/feature-map.generated.ts");

interface FeatureRow {
  num: string;
  title: string;
  covers: string;
}

// One row: `| 01 | [Title](./FEATUREDOCS/01-slug.md) | Covers text |`
const ROW_RE = /^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\([^)]+\)\s*\|\s*(.+?)\s*\|\s*$/;

/** Strip inline markdown noise a prompt doesn't need: backtick code spans
 *  (keep the text, drop the backticks), issue-number/decision parentheticals
 *  are left as-is (they're short and sometimes meaningfully anchor "why"). */
function plain(text: string): string {
  return text.replace(/`/g, "");
}

function parseFeatureTable(markdown: string): FeatureRow[] {
  const lines = markdown.split("\n");
  const headerIdx = lines.findIndex((l) => /^\|\s*#\s*\|\s*Document\s*\|\s*Covers\s*\|/.test(l));
  if (headerIdx === -1) {
    throw new Error("Could not find the FEATUREDOCS table header in ARCHITECTURE.md — has its shape changed?");
  }

  const rows: FeatureRow[] = [];
  // headerIdx + 1 is the `|---|---|---|` separator row; data starts after it.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]!;
    const match = ROW_RE.exec(line);
    if (!match) break; // table ends at the first non-matching line
    const [, num, title, covers] = match;
    rows.push({ num: num!, title: plain(title!), covers: plain(covers!) });
  }

  if (rows.length < 50) {
    // A generous floor, not the exact current count (which grows over time) —
    // catches "the regex silently matched nothing" without pinning a number
    // that needs bumping every time a feature doc is added.
    throw new Error(`Parsed only ${rows.length} FEATUREDOCS rows from ARCHITECTURE.md — expected 50+. Table shape may have changed.`);
  }

  return rows;
}

function formatFeatureMap(rows: FeatureRow[]): string {
  return rows.map((r) => `- ${r.title}: ${r.covers}`).join("\n");
}

function emit(rows: FeatureRow[]): string {
  const featureMap = formatFeatureMap(rows);
  return (
    "// GENERATED FILE — DO NOT EDIT.\n" +
    "// Run `pnpm run mira:feature-map` to regenerate; CI fails if this file is stale.\n" +
    "// Source of truth: ARCHITECTURE.md's FEATUREDOCS table.\n" +
    "// See scripts/generate-mira-feature-map.mts.\n" +
    "\n" +
    `export const MIRA_FEATURE_COUNT = ${rows.length};\n` +
    "\n" +
    "export const MIRA_FEATURE_MAP = " +
    JSON.stringify(featureMap) +
    ";\n"
  );
}

function runStalenessGate(path: string, contents: string): void {
  let existing: string;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = "";
  }
  if (existing !== contents) {
    console.error(`\n✖ Mira feature-map staleness gate failed. Out of date:\n  - ${path}\n\n  Run \`pnpm run mira:feature-map\` and commit the result.\n`);
    process.exit(1);
  }
}

function main(): void {
  const check = process.argv.includes("--check");
  const markdown = readFileSync(SOURCE, "utf8");
  const rows = parseFeatureTable(markdown);
  const contents = emit(rows);

  if (check) {
    runStalenessGate(OUT, contents);
    console.log(`✓ Mira feature map current — ${rows.length} features.`);
    return;
  }

  writeFileSync(OUT, contents);
  console.log(`✓ Wrote Mira feature map (${rows.length} features) to:\n  ${OUT}`);
}

main();
