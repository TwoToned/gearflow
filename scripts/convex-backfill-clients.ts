/**
 * One-time backfill: copy the Client table from Prisma into Convex.
 *
 * Phase 3 pilot (Clients domain). Idempotent — skips clients already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal -> number, null
 * -> absent (see toConvexDoc). Run after `docker compose -f
 * docker-compose.convex.yml up -d` and a schema deploy:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-clients.ts
 *
 * Re-runnable safely. See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type ClientCreateArgs = FunctionArgs<typeof api.clients.create>;

async function main() {
  const convex = (await getConvexClient());
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${clients.length} clients in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const c of clients) {
    const existing = await convex.query(api.clients.getById, { id: c.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.clients.create, toConvexDoc(c) as ClientCreateArgs);
    created++;
    console.log(`  + ${c.name} (${c.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
