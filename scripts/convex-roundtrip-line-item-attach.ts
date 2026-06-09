/**
 * Live round-trip for the Phase 6 supplier+model decommission: prove the
 * recursive Convex attach (`buildLineItemAttachMaps` + `attachLineItemTree`)
 * resolves real model / supplier / category data against the running backend,
 * matching what the dropped Prisma `include: { model, supplier }` joins returned.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-line-item-attach.ts
 *
 * Needs the Convex stack up + a reachable Better-Auth JWKS (service token auth).
 */
import { prisma } from "@/lib/prisma";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
} from "@/lib/line-item-tree-read";

async function main() {
  // Pick an org that actually has line items with a model FK.
  const sample = await prisma.projectLineItem.findFirst({
    where: { modelId: { not: null } },
    select: { organizationId: true },
  });
  if (!sample) {
    console.log("No line items with a modelId — nothing to verify.");
    return;
  }
  const orgId = sample.organizationId;
  console.log(`Org: ${orgId}`);

  const maps = await buildLineItemAttachMaps(orgId);
  console.log(
    `Convex maps: ${maps.models.size} models, ${maps.suppliers.size} suppliers, ${maps.categories.size} categories.`,
  );

  // Fetch a realistic tree the way the rewired reads now do — WITHOUT the
  // model/supplier joins, only the FKs — then attach.
  const rows = await prisma.projectLineItem.findMany({
    where: { organizationId: orgId, modelId: { not: null } },
    select: {
      id: true,
      modelId: true,
      supplierId: true,
      description: true,
      childLineItems: { select: { id: true, modelId: true, supplierId: true, description: true } },
    },
    take: 5,
  });

  const attached = attachLineItemTree(rows, maps);

  // Cross-check each attach against a direct Prisma join (the old behaviour).
  let modelMatches = 0;
  let modelMisses = 0;
  let supplierChecks = 0;
  for (const row of attached) {
    const prismaModel = row.modelId
      ? await prisma.model.findUnique({
          where: { id: row.modelId },
          include: { category: true },
        })
      : null;
    const okName = (prismaModel?.name ?? null) === (row.model?.name ?? null);
    const okCat = (prismaModel?.category?.name ?? null) === (row.model?.category?.name ?? null);
    if (row.model) modelMatches++;
    else modelMisses++;
    if (row.supplierId) {
      const prismaSup = await prisma.supplier.findUnique({ where: { id: row.supplierId } });
      const okSup = (prismaSup?.name ?? null) === (row.supplier?.name ?? null);
      supplierChecks++;
      console.log(
        `  ${row.id}: supplier P="${prismaSup?.name}" C="${row.supplier?.name}" ${okSup ? "OK" : "MISMATCH"}`,
      );
      if (!okSup) throw new Error(`supplier mismatch on ${row.id}`);
    }
    console.log(
      `  ${row.id}: model P="${prismaModel?.name}" C="${row.model?.name}" cat P="${prismaModel?.category?.name}" C="${row.model?.category?.name}" ${okName && okCat ? "OK" : "MISMATCH"}`,
    );
    if (!okName || !okCat) throw new Error(`model/category mismatch on ${row.id}`);
  }

  console.log(
    `\nRound-trip OK: ${modelMatches} models attached + Prisma-matched, ${modelMisses} misses (null), ${supplierChecks} suppliers checked.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
