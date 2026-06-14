/**
 * One-time (re-runnable) backfill: copy the GroupTemplate table from Prisma into Convex.
 *
 * Group-templates domain (Phase 3). Idempotent — skips templates already present
 * in Convex (matched by cuid `id`). Only the PARENT template scalar fields live in
 * Convex; the child `group_template_item` rows (with their model/kit joins) stay in
 * Prisma and are composed by the server action. Maps Date -> Unix ms, null ->
 * absent. Also the heal path for the dual-write. Run after the Convex stack is up:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-group-templates.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type GroupTemplateCreateArgs = FunctionArgs<typeof api.groupTemplates.create>;

async function main() {
  const convex = (await getConvexClient());
  // No `include: items` — the Convex doc holds only the parent scalar fields.
  const templates = await prisma.groupTemplate.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${templates.length} group templates in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    const __res = await convex.mutation(api.groupTemplates.createIfMissing, toConvexDoc(t) as GroupTemplateCreateArgs);
    if (__res.created) created++; else skipped++;
    console.log(`  + ${t.name} (${t.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
