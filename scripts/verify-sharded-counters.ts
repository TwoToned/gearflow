/**
 * Parity check for the sharded dashboard counters (Phase 3, gate #3).
 *
 * For every org: reconcile (recomputes the six counters from source AND sets the
 * sharded counters to those absolute values) → then read them back through
 * `getByOrg` (which SUMS the shards). The sharded read must equal the source
 * recompute, proving the sharded write + read paths agree on real prod data.
 *
 * Run in the prod app container (the worktree service token isn't trusted by prod
 * Convex):
 *   docker exec <cid> sh -lc 'cd /app && npx tsx scripts/verify-sharded-counters.ts'
 */
import { getConvexClient } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../convex/_generated/api";

const FIELDS = [
  "activeAssets",
  "checkedOutAssets",
  "bulkQuantity",
  "activeProjects",
  "activeCrew",
  "pendingCrewOffers",
] as const;

async function main() {
  const convex = await getConvexClient();
  const now = Date.now();
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Checking ${orgs.length} organization(s).\n`);

  let bad = 0;
  for (const org of orgs) {
    const source = await convex.mutation(api.dashboardCounters.reconcile, { orgId: org.id, now });
    const read = (await convex.query(api.dashboardCounters.getByOrg, { orgId: org.id })) as
      | Record<string, number>
      | null;
    const mismatched = FIELDS.filter((f) => (read?.[f] ?? null) !== source[f]);
    const ok = read != null && mismatched.length === 0;
    if (!ok) bad++;
    const shardedView = read ? Object.fromEntries(FIELDS.map((f) => [f, read[f]])) : null;
    console.log(
      `${ok ? "OK " : "BAD"} ${org.name} (${org.id})\n    source recompute: ${JSON.stringify(source)}\n    sharded read    : ${JSON.stringify(shardedView)}${
        ok ? "" : `\n    MISMATCH fields : ${mismatched.join(", ")}`
      }`,
    );
  }

  console.log(
    bad === 0
      ? "\nPARITY OK: sharded read == source recompute for every org."
      : `\nPARITY FAIL: ${bad} org(s) mismatched.`,
  );
  await prisma.$disconnect();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
