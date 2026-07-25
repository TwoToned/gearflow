#!/usr/bin/env node
/**
 * Docs npm/npx contradiction ratchet (POLICY.md R-5.3). This repo is pnpm-only
 * (CLAUDE.md, package.json, CI installs `--frozen-lockfile`), and Convex CLI usage
 * must go through `pnpm exec convex` (never `npx convex` — see CLAUDE.md). A stale
 * `npm run`/`npx` instruction in a doc silently misleads contributors.
 *
 * Same regex as `scripts/quarterly-sweep.sh` §5. Scans every tracked *.md file on
 * every run (not diff-scoped) — a diff-scoped check only catches *new* lines, so
 * pre-existing contradictions stayed structurally invisible to it and recurred
 * across three audit rounds (#731, #820, #856). Excludes tool-scratch dirs and
 * directories that are an intentionally-frozen historical record (an audit report
 * or archived/shipped design doc quoting a past command isn't a live instruction).
 *
 * Usage: node scripts/check-docs-npm-npx.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// execFileSync (argv array, no shell) — never interpolated into a shell string,
// so it can't inject shell metacharacters.
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}

const EXCLUDE = /^(\.agents|\.claude|\.hermes|node_modules|docs\/audits|docs\/designs\/archive)\//;

const mdFiles = git(["ls-files", "--end-of-options", "*.md"])
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDE.test(f));

const BAD = /\b(npm run|npx )\S/;
const ALLOW = /(never .?npm|not .?npx|pnpm|node_modules)/i;

const violations = [];
for (const file of mdFiles) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    continue; // file deleted/renamed since ls-files snapshot — nothing to check
  }
  lines.forEach((text, i) => {
    if (BAD.test(text) && !ALLOW.test(text)) {
      violations.push(`${file}:${i + 1}: ${text.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    "[docs-npm-npx] FAIL: npm/npx reference(s) found in a doc on a pnpm-only repo (R-5.3).\n" +
      "Use `pnpm`/`pnpm run`, `pnpm exec <tool>` (repo-local), or `pnpm dlx <tool>` (one-off) instead. Violations:\n" +
      violations.map((v) => `  ${v}`).join("\n"),
  );
  process.exit(1);
}
console.log(`[docs-npm-npx] OK: no npm/npx doc contradictions across ${mdFiles.length} files.`);
