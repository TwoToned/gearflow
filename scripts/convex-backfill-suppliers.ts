/**
 * One-time (re-runnable) backfill: copy the Supplier table from Prisma into Convex.
 *
 * Suppliers domain (Phase 3). Idempotent — skips suppliers already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal -> number, null
 * -> absent (see toConvexDoc). Also the heal path for the dual-write: if a
 * server-action Convex write ever fails after its Prisma write, re-running this
 * mirrors the missing rows. Run after the Convex stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-suppliers.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type SupplierCreateArgs = FunctionArgs<typeof api.suppliers.create>;

async function main() {
  const convex = (await getConvexClient());
  const suppliers = await prisma.supplier.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${suppliers.length} suppliers in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const s of suppliers) {
    const __res = await convex.mutation(api.suppliers.createIfMissing, toConvexDoc(s) as SupplierCreateArgs);
    if (__res.created) created++; else skipped++;
    console.log(`  + ${s.name} (${s.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
