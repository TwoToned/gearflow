/**
 * One-time (re-runnable) backfill: copy project (incl. templates) from Prisma
 * into Convex.
 *
 * Central-graph step 6 (Phase 3), dual-write INFRA-ONLY. Idempotent — skips rows
 * already present (matched by cuid `id`). Maps Date -> ms, Decimal -> number,
 * null -> absent. Also the heal path. See src/lib/project-mirror.ts and
 * FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-projects.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const projects = await prisma.project.findMany();
  for (const p of projects) {
    if (await convex.query(api.projects.getById, { id: p.id })) { skipped++; continue; }
    await convex.mutation(api.projects.create, toConvexDoc(p) as FunctionArgs<typeof api.projects.create>);
    created++;
  }

  console.log(`Project backfill complete: ${created} created, ${skipped} already present (${projects.length} projects).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
