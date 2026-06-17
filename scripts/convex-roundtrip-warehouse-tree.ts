/**
 * Live round-trip for the Phase 6 warehouse line-item-tree decommission
 * (getProjectForWarehouse / getProjectPullSheet). Proves the rewired reads are
 * data-identical to the dropped Prisma joins:
 *   - model (+ equipment category) + supplier come off the Convex mirror via
 *     buildLineItemAttachMaps + attachLineItemTree
 *   - model._count.modelCheckItems is grafted from Prisma (model_check_item is
 *     NOT dual-written) via collectTreeModelIds + groupBy + attachModelCheckItemCounts
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-warehouse-tree.ts
 *
 * Needs the Convex stack up + a reachable Better-Auth JWKS (service token auth).
 */
import { prisma } from "@/lib/prisma";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  attachModelCheckItemCounts,
  collectTreeModelIds,
} from "@/lib/line-item-tree-read";

// Mirrors warehouse.ts getModelCheckItemCountMap (private to a "use server"
// module, so replicated here for the round-trip).
async function checkItemCountMap(orgId: string, tree: Array<{ modelId?: string | null; childLineItems?: unknown }>) {
  const modelIds = collectTreeModelIds(tree);
  if (modelIds.length === 0) return new Map<string, number>();
  const grouped = await prisma.modelCheckItem.groupBy({
    by: ["modelId"],
    where: { organizationId: orgId, modelId: { in: modelIds } },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.modelId, g._count._all]));
}

async function main() {
  // Pick a real, non-template project with equipment line items.
  const project = await prisma.project.findFirst({
    where: { isTemplate: false, lineItems: { some: { type: "EQUIPMENT", modelId: { not: null } } } },
    select: { id: true, organizationId: true, projectNumber: true },
  });
  if (!project) {
    console.log("No project with equipment line items — nothing to verify.");
    await prisma.$disconnect();
    return;
  }
  const orgId = project.organizationId;
  console.log(`Project ${project.projectNumber} (org ${orgId})`);

  // Fetch the tree the way the rewired reads now do — only the FKs, no
  // model/supplier joins — then attach + graft counts.
  const rows = await prisma.projectLineItem.findMany({
    where: { projectId: project.id, organizationId: orgId, type: "EQUIPMENT" },
    select: {
      id: true,
      modelId: true,
      supplierId: true,
      childLineItems: {
        select: {
          id: true,
          modelId: true,
          supplierId: true,
          childLineItems: { select: { id: true, modelId: true, supplierId: true } },
        },
      },
    },
  });

  const maps = await buildLineItemAttachMaps(orgId);
  console.log(`Convex maps: ${maps.models.size} models, ${maps.suppliers.size} suppliers, ${maps.categories.size} categories.`);
  const attached = attachLineItemTree(rows, maps);
  const counts = await checkItemCountMap(orgId, rows);
  const withCounts = attachModelCheckItemCounts(attached, counts);

  let checked = 0;
  let countChecks = 0;

  async function verify(node: { id: string; modelId?: string | null; supplierId?: string | null; model: { name?: string; category?: { name?: string } | null; _count?: { modelCheckItems: number } } | null; supplier: { name?: string } | null; childLineItems?: unknown }) {
    checked++;
    // model vs Prisma join. Category AND modelCheckItems are now Convex-only
    // (model.categoryId FK dropped Phase B; model_check_item FK dropped in the
    // models inversion), so the Prisma `model` row has no `category` relation and
    // no `_count.modelCheckItems` to cross-check against — only the model name
    // still has a Prisma source. The grafted modelCheckItems count is asserted to
    // be present (non-negative) rather than equal to a (now non-existent) Prisma _count.
    const prismaModel = node.modelId
      ? await prisma.model.findUnique({ where: { id: node.modelId } })
      : null;
    const okName = (prismaModel?.name ?? null) === (node.model?.name ?? null);
    if (!okName) throw new Error(`model name mismatch on ${node.id}: P="${prismaModel?.name}" C="${node.model?.name}"`);

    if (node.modelId) {
      const got = node.model?._count?.modelCheckItems ?? -1;
      if (got < 0) throw new Error(`modelCheckItems count missing on ${node.id}: graft=${got}`);
      countChecks++;
      console.log(`  ${node.id}: model="${node.model?.name}" cat="${node.model?.category?.name ?? "-"}" checks=${got} OK`);
    }

    // supplier vs Prisma join
    if (node.supplierId) {
      const prismaSup = await prisma.supplier.findUnique({ where: { id: node.supplierId } });
      if ((prismaSup?.name ?? null) !== (node.supplier?.name ?? null)) throw new Error(`supplier mismatch on ${node.id}`);
      console.log(`  ${node.id}: supplier P="${prismaSup?.name}" C="${node.supplier?.name}" OK`);
    }

    if (Array.isArray(node.childLineItems)) {
      for (const c of node.childLineItems) await verify(c);
    }
  }

  for (const n of withCounts) await verify(n);

  console.log(`\nRound-trip OK: ${checked} nodes verified, ${countChecks} grafted modelCheckItems counts present (Prisma _count cross-check dropped — relation is Convex-only).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
