/**
 * One-time (re-runnable) backfill: copy the BrandTemplate table from Prisma into Convex.
 *
 * Brand-templates domain (Phase 3). Idempotent — skips templates already present
 * in Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent;
 * headerSettings/footerSettings are already JSON *strings* in Prisma so they pass
 * straight through to Convex `v.string()`. Also the heal path for the dual-write.
 * Run after the Convex stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-brand-templates.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type BrandTemplateCreateArgs = FunctionArgs<typeof api.brandTemplates.create>;

async function main() {
  const convex = getConvexClient();
  const templates = await prisma.brandTemplate.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${templates.length} brand templates in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    const existing = await convex.query(api.brandTemplates.getById, { id: t.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.brandTemplates.create, toConvexDoc(t) as BrandTemplateCreateArgs);
    created++;
    console.log(`  + ${t.name} (${t.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
