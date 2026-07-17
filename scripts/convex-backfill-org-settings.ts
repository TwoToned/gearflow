/**
 * One-time (re-runnable) backfill: copy per-org BUSINESS settings off the Better
 * Auth `organization` row into the Convex `orgSettings` table (Phase 1 inversion).
 *
 * Source columns: `metadata` (the OrgSettings JSON blob), `defaultTaxRate`,
 * `apiKillSwitchAt`. Denormalises `icalToken` ONLY when the feed is enabled (so
 * the by_icalToken lookup means "valid + live"). Idempotent — `createIfMissing`
 * skips orgs already present (matched by organizationId), so this is both the
 * initial load AND a heal path. Run BEFORE the inverted reads go live in prod:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-org-settings.ts
 *
 * See FEATUREDOCS/54.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, metadata: true, defaultTaxRate: true, apiKillSwitchAt: true, createdAt: true },
  });
  console.log(`Found ${orgs.length} organizations in Prisma.`);

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    // Derive the denormalised iCal token from the blob (enabled feeds only).
    let icalToken: string | undefined;
    if (org.metadata) {
      try {
        const blob = JSON.parse(org.metadata) as { icalToken?: string; icalEnabled?: boolean };
        if (blob.icalEnabled && blob.icalToken) icalToken = blob.icalToken;
      } catch {
        // corrupt blob — copy the string verbatim, skip token derivation
      }
    }

    // Re-fetch per mutation so a long run keeps a fresh (auto-refreshed) token.
    const convex = await getConvexClient();
    const res = await convex.mutation(api.orgSettings.createIfMissing, {
      organizationId: org.id,
      settings: org.metadata ?? undefined,
      defaultTaxRate: org.defaultTaxRate != null ? Number(org.defaultTaxRate) : undefined,
      apiKillSwitchAt: org.apiKillSwitchAt != null ? org.apiKillSwitchAt.getTime() : undefined,
      icalToken,
      createdAt: org.createdAt?.getTime(),
      updatedAt: Date.now(),
    });
    if (res.created) created++;
    else skipped++;
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
