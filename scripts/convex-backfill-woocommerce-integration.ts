/**
 * One-time backfill: copy WooCommerceIntegration rows from Prisma into Convex.
 *
 * Phase C HARD CUTOVER (wooCommerceIntegration was pure-Prisma — never dual-written,
 * so the Convex table is empty). MUST run in prod BEFORE the read-inversion deploys,
 * else existing integrations lose their config + webhookSecret (HMAC check breaks).
 * Idempotent — skips a row already present in Convex (matched by cuid `id`). Maps
 * Date -> Unix ms, null -> absent, JSON (`lastPayload`) passes through (see toConvexDoc).
 * One row per org. Run directly in the Coolify app container (env injected, no .env):
 *
 *   npx tsx scripts/convex-backfill-woocommerce-integration.ts
 *
 * Re-runnable safely. See FEATUREDOCS/54 and docs/designs/convex-domain-only-decommission.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CreateArgs = FunctionArgs<typeof api.wooCommerceIntegrations.create>;

async function main() {
  const convex = await getConvexClient();
  const rows = await prisma.wooCommerceIntegration.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${rows.length} woo_commerce_integration row(s) in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await convex.mutation(
      api.wooCommerceIntegrations.createIfMissing,
      toConvexDoc(r) as CreateArgs,
    );
    if (res.created) created++;
    else skipped++;
    console.log(`  + org ${r.organizationId} (${r.id})${r.webhookSecret ? " [secret]" : ""}`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
