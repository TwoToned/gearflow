/**
 * Phase-3 DoD benchmark: CSV bulk-asset-import throughput.
 *
 * Measures importAssetsCSV (src/server/csv.ts) wall-clock at 50/200/500/1000 rows
 * per call, at 1/4/8 concurrent import calls, against a dedicated throwaway model.
 * Every asset it creates is deleted again immediately after each measurement point
 * (never left sitting in the org) — the throwaway model is deleted at the end.
 *
 * Runs importAssetsCSV for real (through requirePermission("asset","import") via
 * runWithActor, exactly like an API-key caller would), so this measures the actual
 * code path, not a synthetic approximation.
 *
 * Usage: pnpm tsx --env-file=.env --env-file=.env.local scripts/benchmark-csv-import.ts
 */
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { runWithActor } from "@/lib/request-actor";
import { importAssetsCSV } from "@/server/csv";
import { api } from "../convex/_generated/api";

// Round 1 (RUN_ID qx9303n8) already measured rows=50 at concurrency=1/4/8 with
// ~530ms/row in every case — concurrency doesn't change per-row throughput (no
// contention/speedup). This round fills in the still-unmeasured single-call
// row-count curve, plus one larger-scale concurrency check to confirm the
// no-speedup trend holds at volume. Kept lean (not the full 4×3 cross-product)
// because the constant per-row rate already answers the concurrency question —
// see scripts/benchmark-csv-import.ts git history / the report for round 1's data.
const MATRIX: Array<{ rowCount: number; concurrency: number }> = [
  { rowCount: 200, concurrency: 1 },
  { rowCount: 500, concurrency: 1 },
  { rowCount: 1000, concurrency: 1 },
  { rowCount: 500, concurrency: 4 },
];
const RUN_ID = createId().slice(0, 8);

function buildCsv(rowCount: number, modelName: string, tagPrefix: string): string {
  const lines = ["assetTag,modelName,status,condition"];
  for (let i = 0; i < rowCount; i++) {
    lines.push(`${tagPrefix}-${i},${modelName},AVAILABLE,GOOD`);
  }
  return lines.join("\n");
}

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("No organization found.");
  const owner = await prisma.member.findFirst({ where: { organizationId: org.id, role: "owner" }, include: { user: true } });
  if (!owner) throw new Error("No owner member found.");
  const actor = { organizationId: org.id, userId: owner.userId, userName: owner.user?.name ?? "Benchmark", actorType: "session" as const };
  console.log(`Org: ${org.name} (${org.id}) — actor: ${owner.user?.email}`);

  // getConvexClient() is called FRESH before every mutation/query below (never a
  // cached reference held across the loop) — the service token has a ~5-6min TTL
  // and round 1 died mid-run from exactly this (InvalidAuthHeader: token expired).
  const modelId = createId();
  const modelName = `BENCH-MODEL-${RUN_ID}`;
  await (await getConvexClient()).mutation(api.models.createIfMissing, {
    id: modelId,
    organizationId: org.id,
    name: modelName,
    assetType: "SERIALIZED",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  console.log(`Seeded throwaway model ${modelName} (${modelId})`);

  type Row = { rowCount: number; concurrency: number; ms: number; created: number; errors: number };
  const results: Row[] = [];

  for (const { rowCount, concurrency } of MATRIX) {
    const tagPrefix = `BENCH-${RUN_ID}-${rowCount}x${concurrency}`;
    const csvs = Array.from({ length: concurrency }, (_, c) => buildCsv(rowCount, modelName, `${tagPrefix}-${c}`));

    const start = performance.now();
    const outcomes = await Promise.all(
      csvs.map((csv) => runWithActor(actor, () => importAssetsCSV(csv))),
    );
    const ms = performance.now() - start;

    const created = outcomes.reduce((s, o) => s + o.created, 0);
    const errors = outcomes.reduce((s, o) => s + o.errors.length, 0);
    results.push({ rowCount, concurrency, ms, created, errors });
    console.log(
      `rows=${rowCount} concurrency=${concurrency} → ${ms.toFixed(0)}ms, created=${created}, errors=${errors}` +
        (errors > 0 ? ` (sample: ${JSON.stringify(outcomes.find((o) => o.errors.length)?.errors[0])})` : ""),
    );

    // Clean up immediately — never leave benchmark rows sitting in the org.
    const listConvex = await getConvexClient();
    const created_assets = await listConvex.query(api.assets.list, { orgId: org.id });
    const toDelete = created_assets.filter((a: { assetTag: string; id: string }) => a.assetTag.startsWith(tagPrefix));
    for (const a of toDelete as { id: string }[]) {
      await (await getConvexClient()).mutation(api.assets.remove, { id: a.id });
    }
    console.log(`  cleaned up ${toDelete.length} assets`);
  }

  await (await getConvexClient()).mutation(api.models.remove, { id: modelId });
  console.log(`Cleaned up model ${modelName}.`);

  console.log("\n=== Results ===");
  console.log("rows\tconcurrency\tms\tms/row\tcreated\terrors");
  for (const r of results) {
    console.log(`${r.rowCount}\t${r.concurrency}\t${r.ms.toFixed(0)}\t${(r.ms / (r.rowCount * r.concurrency)).toFixed(2)}\t${r.created}\t${r.errors}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
