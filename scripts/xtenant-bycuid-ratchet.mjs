#!/usr/bin/env node
/**
 * Cross-tenant by_cuid guard ratchet (#1076, A6 — the Phase A gate).
 *
 * `by_cuid` is a GLOBAL Convex index (CLAUDE.md's "Never regenerate
 * convex/schema.ts" note) — any `.withIndex("by_cuid", ...)` read can return a
 * row belonging to an organization the caller isn't a member of unless the
 * enclosing function also org-checks the result (or the caller's own orgId,
 * for a create-time dup-guard). ~1,500 such reads exist across convex/*.ts;
 * xtenantHardening.test.ts + xtenantExhaustive.test.ts prove the guard holds
 * for a representative + registry-driven sample, but a genuinely new call
 * site can still be added without either. This is the static backstop: like
 * the any-ratchet and complexity-ratchet, the total count of by_cuid reads
 * with NO org-check indicator anywhere in their enclosing top-level Convex
 * function may not exceed the committed baseline. New unguarded sites fail
 * CI; as existing ones are verified/fixed, lower the baseline.
 *
 * A "guard indicator" is intentionally broad (a heuristic, not an AST-precise
 * check) — false negatives (a real guard the scan doesn't recognise) just
 * become baseline debt, never a false CI failure, because the ratchet only
 * blocks GROWTH past the committed count. Tightening the heuristic is safe at
 * any time; loosening it requires re-baselining with justification.
 *
 * Usage: node scripts/xtenant-bycuid-ratchet.mjs [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASELINE_FILE = ".xtenant-bycuid-baseline";
const CONVEX_DIR = "convex";

/** Broad on purpose (a heuristic, not an AST-precise check) — matches the
 *  shared helpers (`requireOrgReadFor`, `requireService`, ...) AND file-local
 *  wrappers around them (e.g. `savedTableViews.ts`'s `requireOrgSelfReadDoc`),
 *  plus an inline `organizationId` equality/inequality check. */
const GUARD_INDICATOR = /\brequire\w*(?:Org|Self|Service|Agent)\w*\(|organizationId\s*(?:!==|===)/;

/** Top-level PUBLIC Convex function definitions: `export const NAME = query({
 *  ... });` (or mutation). Deliberately excludes internalQuery/internalMutation/
 *  internalAction/action — an `internal*` function is reachable only from
 *  first-party Convex code in the same deployment (ctx.runQuery/ctx.runAction),
 *  never directly by a user/agent/session identity, so it sits outside the
 *  cross-tenant trust boundary this ratchet is about; a caller-side org-scoping
 *  bug in whatever first-party code invokes it is a different, narrower risk
 *  this static scan can't see (it would need to analyse every call site).
 *  Matched by brace-depth so a function's FULL body is captured regardless of
 *  where inside it a guard call or a by_cuid read sits. */
const FN_START = /export const \w+ = (?:query|mutation)\(\{/g;

function findFunctionBlocks(source) {
  const blocks = [];
  let match;
  while ((match = FN_START.exec(source))) {
    const openBraceIdx = match.index + match[0].length - 1;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(match.index, i));
  }
  return blocks;
}

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

let unguarded = 0;
const offenders = [];

for (const file of listConvexFiles(CONVEX_DIR)) {
  const source = readFileSync(file, "utf8");
  if (!source.includes('withIndex("by_cuid"')) continue;

  for (const block of findFunctionBlocks(source)) {
    if (!block.includes('withIndex("by_cuid"')) continue;
    const guarded = GUARD_INDICATOR.test(block);
    if (!guarded) {
      unguarded += 1;
      const fnName = /export const (\w+)/.exec(block)?.[1] ?? "?";
      offenders.push(`${file}: ${fnName}`);
    }
  }
}

const baseline = Number(readFileSync(BASELINE_FILE, "utf8").trim() || "0");

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, `${unguarded}\n`);
  console.log(`[xtenant-bycuid-ratchet] wrote baseline: ${unguarded}`);
  process.exit(0);
}

console.log(`[xtenant-bycuid-ratchet] unguarded by_cuid reads: current=${unguarded} baseline=${baseline}`);

if (unguarded > baseline) {
  console.error(
    `❌ Unguarded by_cuid reads grew ${baseline} -> ${unguarded}. New offenders:\n` +
      offenders.slice(0, 20).join("\n") +
      `\nAdd an org check (requireOrgReadDocFor / requireOrgReadFor / an explicit ` +
      `organizationId comparison) to the new function(s), or if it's a false ` +
      `positive (the guard lives in a caller), raise the baseline with justification.`,
  );
  process.exit(1);
}
if (unguarded < baseline) {
  console.log(`✅ Unguarded by_cuid reads dropped ${baseline} -> ${unguarded}. Lock it in: node scripts/xtenant-bycuid-ratchet.mjs --write`);
}
console.log("✅ ratchet holds.");
