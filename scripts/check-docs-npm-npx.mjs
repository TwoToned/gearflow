#!/usr/bin/env node
/**
 * Docs npm/npx contradiction ratchet (POLICY.md R-5.3). This repo is pnpm-only
 * (CLAUDE.md, package.json, CI installs `--frozen-lockfile`), and Convex CLI usage
 * must go through `pnpm exec convex` (never `npx convex` — see CLAUDE.md). A stale
 * `npm run`/`npx` instruction in a doc silently misleads contributors.
 *
 * Same regex as `scripts/quarterly-sweep.sh` §5, but scoped to *new* lines only (a
 * diff against the merge-base) so this can be a blocking CI gate without requiring an
 * upfront full-repo cleanup of pre-existing docs. New contradictions are blocked;
 * existing ones stay tracked via the quarterly sweep.
 *
 * Usage: node scripts/check-docs-npm-npx.mjs [baseRef]
 */
import { execSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}

let range;
try {
  const mergeBase = git(`merge-base ${base} HEAD`).trim();
  range = `${mergeBase} HEAD`;
} catch {
  range = `${base} HEAD`;
}

const changedMdFiles = git(`diff --name-only ${range} -- '*.md'`)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/^(\.agents|\.claude|node_modules)\//.test(f));

const BAD = /\b(npm run|npx )\S/;
const ALLOW = /(never .?npm|not .?npx|pnpm|node_modules)/i;

const violations = [];
for (const file of changedMdFiles) {
  let diff;
  try {
    diff = git(`diff --unified=0 ${range} -- ${JSON.stringify(file)}`);
  } catch {
    continue; // file deleted or renamed away — nothing to check
  }
  const addedLines = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  for (const line of addedLines) {
    const text = line.slice(1);
    if (BAD.test(text) && !ALLOW.test(text)) {
      violations.push(`${file}: ${text.trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    "[docs-npm-npx] FAIL: new npm/npx reference(s) added to a doc on a pnpm-only repo (R-5.3).\n" +
      "Use `pnpm`/`pnpm run` and `pnpm exec convex` instead. Violations:\n" +
      violations.map((v) => `  ${v}`).join("\n"),
  );
  process.exit(1);
}
console.log("[docs-npm-npx] OK: no new npm/npx doc contradictions.");
