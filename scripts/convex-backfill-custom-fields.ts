/**
 * One-time (re-runnable) backfill: copy the CustomFieldDefinition table from
 * Prisma into Convex.
 *
 * Custom-fields domain (Phase 3). Idempotent — skips definitions already present
 * in Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent. Also the
 * heal path for the dual-write. Run after the Convex stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-custom-fields.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CustomFieldCreateArgs = FunctionArgs<typeof api.customFieldDefinitions.create>;

async function main() {
  const convex = getConvexClient();
  const defs = await prisma.customFieldDefinition.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${defs.length} custom field definitions in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const d of defs) {
    const existing = await convex.query(api.customFieldDefinitions.getById, { id: d.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.customFieldDefinitions.create, toConvexDoc(d) as CustomFieldCreateArgs);
    created++;
    console.log(`  + ${d.label} (${d.entityType}/${d.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
