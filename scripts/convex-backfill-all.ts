/**
 * Run every Prisma→Convex backfill in dependency order. The one command for a
 * prod data migration (replaces ~30 manual runs).
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-all.ts
 *
 * Each backfill is idempotent (skip-if-present / upsert), so this is safe to
 * re-run — and re-running is the heal path for the deploy-window gap (rows
 * written between enabling the dual-write and finishing the backfill). On a clean
 * second run every script should report "0 created"; that all-zeros pass is the
 * informal parity signal (the hard gate is scripts/convex-parity-check.ts).
 *
 * Order note: Convex stores FKs as plain strings (no referential enforcement) and
 * every backfill is idempotent, so ordering is for log readability, not
 * correctness. Reference/config first, then the central graph, then transactional
 * data, then media + the availability org-stamp last.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { existsSync } from "node:fs";

// Backfill script basenames (under scripts/), in run order.
const ORDER: string[] = [
  // reference / config
  "clients",
  "suppliers",
  "locations",
  "models",
  "categories",
  "check-items",
  "check-item-assignments",
  "custom-fields",
  "test-profiles",
  "brand-templates",
  "group-templates",
  "section-presets",
  "templates",
  "file-upload",
  // crew roster + scheduling
  "crew",
  "crew-scheduling",
  // central graph
  "projects",
  "project-grouping",
  "project-subtables",
  "line-items",
  "line-item-units",
  "asset",
  "asset-bulk-children",
  "kit",
  // Phase 6 sub-table dual-write tables (accessory joins, supplier rates,
  // T&T + event tables). Idempotent like the rest; run after their parents.
  "model-bulk-accessories",
  "supplier-model-rates",
  "test-tag-assets",
  "test-tag-records",
  "sub-test-records",
  "asset-scan-logs",
  "check-records",
  // transactional
  "sub-hires",
  "maintenance",
  "warehouse-close",
  "saved-views",
  // media + denormalized stamps last
  "media",
  "crew-availability-org",
];

function main() {
  const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
  const results: Array<{ name: string; ok: boolean; ms: number }> = [];

  // Only pass --env-file flags for files that actually exist (Coolify injects
  // env vars directly and has no .env file — the flag causes node to exit 9).
  const cwd = process.cwd();
  const envFileArgs = [".env", ".env.local"]
    .filter((f) => existsSync(path.join(cwd, f)))
    .flatMap((f) => [`--env-file=${f}`]);

  for (const name of ORDER) {
    const file = path.join(scriptsDir, `convex-backfill-${name}.ts`);
    console.log(`\n── backfill: ${name} ──`);
    const started = Date.now();
    const res = spawnSync(
      "npx",
      ["tsx", ...envFileArgs, file],
      { stdio: "inherit", env: process.env },
    );
    const ms = Date.now() - started;
    const ok = res.status === 0;
    results.push({ name, ok, ms });
    if (!ok) console.error(`  ✗ ${name} exited ${res.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(48));
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(26)} ${r.ms}ms`);
  }
  console.log("=".repeat(48));
  console.log(`${results.length} backfills, ${failed.length} failed.`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.name).join(", "));
    console.log("Backfills are idempotent — fix the cause and re-run; completed ones skip.");
  }
  process.exit(failed.length ? 1 : 0);
}

main();
