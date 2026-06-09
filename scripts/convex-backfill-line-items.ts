/**
 * One-time (re-runnable) backfill: copy project_line_item from Prisma into Convex.
 *
 * Central-graph step 4 (Phase 3), dual-write INFRA-ONLY (composed only in the
 * equipment editor + PDF pipeline, which stay on Prisma — no reactive consumer).
 * Idempotent — skips rows already present (matched by cuid `id`). Maps Date -> ms,
 * Decimal -> number, null -> absent. Also the heal path. The self-reference
 * (parentLineItemId) is a plain v.string() in Convex, so no insertion ordering is
 * required. See src/lib/line-item-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-line-items.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = getConvexClient();
  let created = 0;
  let skipped = 0;

  const lineItems = await prisma.projectLineItem.findMany();
  for (const li of lineItems) {
    if (await convex.query(api.projectLineItems.getById, { id: li.id })) { skipped++; continue; }
    await convex.mutation(api.projectLineItems.create, toConvexDoc(li) as FunctionArgs<typeof api.projectLineItems.create>);
    created++;
  }

  console.log(`Line-item backfill complete: ${created} created, ${skipped} already present (${lineItems.length} line items).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
