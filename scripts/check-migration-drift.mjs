#!/usr/bin/env node
/**
 * Migration drift gate (POLICY.md R-8.3.1). The Postgres schema is authoritative
 * (prisma/schema.prisma); every change to it MUST ship with a migration so the schema
 * and the migration history can't silently diverge. This gate fails a PR that edits
 * prisma/schema.prisma without adding a migration under prisma/migrations/.
 *
 * (A full `prisma migrate diff` replay isn't usable here: early tables were created via
 * `db push` and never captured, so the history isn't replayable from zero — repairing
 * that needs the prod schema. This gate stops NEW drift regardless.)
 *
 * Escape hatch: put `[skip-migration-check]` in the PR's latest commit message for a
 * deliberate non-datamodel edit (e.g. a comment).
 *
 * Usage: node scripts/check-migration-drift.mjs [baseRef]
 */
import { execSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

let range;
try {
  const mergeBase = git(`merge-base ${base} HEAD`);
  range = `${mergeBase} HEAD`;
} catch {
  range = `${base} HEAD`;
}
const changed = git(`diff --name-only ${range}`).split("\n").filter(Boolean);

const schemaChanged = changed.some((f) => f === "prisma/schema.prisma");
const migrationAdded = changed.some((f) => /^prisma\/migrations\/.+\/migration\.sql$/.test(f));

if (schemaChanged && !migrationAdded) {
  const lastMsg = git("log -1 --format=%B");
  if (lastMsg.includes("[skip-migration-check]")) {
    console.log("[migration-drift] schema.prisma changed but [skip-migration-check] set — OK.");
    process.exit(0);
  }
  console.error(
    "[migration-drift] FAIL: prisma/schema.prisma changed without a migration (R-8.3.1).\n" +
      "Run `pnpm exec prisma migrate dev --name <change>` and commit the generated migration,\n" +
      "or add `[skip-migration-check]` to the commit message for a non-datamodel edit.",
  );
  process.exit(1);
}
console.log("[migration-drift] OK: no schema change, or a migration accompanies it.");
