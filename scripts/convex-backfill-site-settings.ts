/**
 * One-time backfill: copy the SiteSettings singleton from Prisma into Convex.
 *
 * Phase C cutover (SiteSettings → Convex-only). Idempotent — skips the row if
 * already present in Convex (matched by cuid `id`). Maps Date -> Unix ms, null
 * -> absent (see toConvexDoc). There is at most one row (platform-global
 * singleton). Run directly in the Coolify app container (env injected, no .env):
 *
 *   npx tsx scripts/convex-backfill-site-settings.ts
 *
 * Re-runnable safely. See FEATUREDOCS/54 and docs/designs/convex-domain-only-decommission.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type SiteSettingsCreateArgs = FunctionArgs<typeof api.siteSettings.create>;

async function main() {
  const convex = await getConvexClient();
  const rows = await prisma.siteSettings.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${rows.length} site_settings row(s) in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const s of rows) {
    const res = await convex.mutation(
      api.siteSettings.createIfMissing,
      toConvexDoc(s) as SiteSettingsCreateArgs,
    );
    if (res.created) created++;
    else skipped++;
    console.log(`  + ${s.platformName} (${s.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
