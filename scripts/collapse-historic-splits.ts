/**
 * Collapse historic split-sibling lines specifically.
 *
 * Pre-cutover, `splitLineItem` produced a distinctive shape we can
 * spot with high confidence and consolidate:
 *
 *   - ONE "priced parent" row: quantity > 0, unitPrice non-null,
 *     no assetId, lineTotal populated (the original commercial line)
 *   - N "child" rows: quantity = 1, unitPrice null OR 0, assetId set,
 *     lineTotal null OR 0 (peeled off by splitLineItem)
 *   - All rows share the same projectId, modelId, type, kitId,
 *     isKitChild, parentLineItemId, groupId/categoryId, supplier
 *     fields, isOptional, description, notes
 *
 * This script merges them by moving each child's assetId onto a
 * ProjectLineItemUnit attached to the canonical (priced) row, then
 * cancelling the child. The canonical's quantity stays — it already
 * accounted for the whole line; the children were qty=1 each and
 * their total was the canonical's qty.
 *
 * This is intentionally a *narrower* migration than
 * collapse-split-siblings.ts (which uses a strict full-equivalence
 * key and refuses anything divergent). Use this one for cleaning
 * historic split shrapnel; use the other for re-collapsing rows that
 * were duplicated commercially-identically.
 *
 * Dry-run by default. `--apply` to write. `--project <id>` to scope.
 *
 * Idempotent: re-running finds nothing to do.
 *
 * Usage:
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts                 # dry-run all
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts --project <id>  # one project
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts --apply         # writes
 */

import { prisma } from "../src/lib/prisma";
import { syncLineItemRollup } from "../src/server/line-item-fulfillment";
import { nextOrdinal } from "../src/lib/line-item-units";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projIdx = args.indexOf("--project");
const projectFilter = projIdx >= 0 ? args[projIdx + 1] : undefined;
const runId = `historic-${new Date().toISOString().replace(/[:.]/g, "-")}`;

interface CandidateRow {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  parentLineItemId: string | null;
  quantity: number;
  unitPrice: { toString(): string } | null;
  lineTotal: { toString(): string } | null;
  discount: { toString(): string } | null;
  status: string;
  prepStatus: string | null;
  sortOrder: number;
  description: string | null;
  notes: string | null;
  groupId: string | null;
  categoryId: string | null;
  groupName: string | null;
  supplierId: string | null;
  subHireId: string | null;
  subHireItemId: string | null;
  subHireGroupId: string | null;
  isOptional: boolean;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  createdAt: Date;
}

/** Order-level fields children must share with their canonical. */
function orderLevelKey(r: CandidateRow): string {
  return JSON.stringify({
    projectId: r.projectId,
    type: r.type,
    modelId: r.modelId,
    kitId: r.kitId,
    isKitChild: r.isKitChild,
    parentLineItemId: r.parentLineItemId,
    groupId: r.groupId,
    categoryId: r.categoryId,
    groupName: r.groupName,
    supplierId: r.supplierId,
    subHireId: r.subHireId,
    subHireItemId: r.subHireItemId,
    subHireGroupId: r.subHireGroupId,
    isOptional: r.isOptional,
    isContainerLineItem: r.isContainerLineItem,
    isCustomItem: r.isCustomItem,
    description: r.description,
    notes: r.notes,
  });
}

/** A row is "priced parent shaped": quantity > 1, unitPrice set, no assetId. */
function looksLikePricedParent(r: CandidateRow): boolean {
  const priceNum = r.unitPrice ? Number(r.unitPrice.toString()) : 0;
  return r.quantity >= 1 && priceNum > 0 && !r.assetId && !r.bulkAssetId;
}

/** A row is "split child shaped": qty=1, unitPrice 0/null, assetId set. */
function looksLikeSplitChild(r: CandidateRow): boolean {
  const priceNum = r.unitPrice ? Number(r.unitPrice.toString()) : 0;
  return r.quantity === 1 && priceNum === 0 && !!r.assetId && !r.isKitChild;
}

interface Group {
  key: string;
  canonical: CandidateRow;
  children: CandidateRow[];
}

async function main() {
  console.log("Collapse historic split-siblings (narrow mode)");
  console.log("─".repeat(60));
  console.log(`Mode:    ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (projectFilter) console.log(`Project: ${projectFilter}`);
  console.log(`Run id:  ${runId}`);
  console.log();

  const rows = (await prisma.projectLineItem.findMany({
    where: {
      ...(projectFilter ? { projectId: projectFilter } : {}),
      type: "EQUIPMENT",
      isKitChild: false,
      // Skip already-cancelled rows
      NOT: { AND: [{ status: "CANCELLED" }, { quantity: 0 }] },
    },
    orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  })) as unknown as CandidateRow[];

  // Bucket by order-level key.
  const byKey = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    const k = orderLevelKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }

  const groups: Group[] = [];
  const flagged: { key: string; reason: string; rows: CandidateRow[] }[] = [];
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const parents = bucket.filter(looksLikePricedParent);
    const children = bucket.filter(looksLikeSplitChild);
    const others = bucket.filter(
      (r) => !looksLikePricedParent(r) && !looksLikeSplitChild(r),
    );
    if (parents.length === 0 || children.length === 0) continue;
    if (parents.length > 1) {
      flagged.push({
        key,
        reason: `${parents.length} priced parents (ambiguous canonical)`,
        rows: bucket,
      });
      continue;
    }
    if (others.length > 0) {
      flagged.push({
        key,
        reason: `${others.length} row(s) that aren't priced-parent or split-child shape`,
        rows: bucket,
      });
      continue;
    }
    // Sanity: total child qty should be ≤ parent qty (children are
    // peeled-off slices of the parent). If sum exceeds, something
    // funky happened — flag it.
    const childQtySum = children.reduce((n, c) => n + c.quantity, 0);
    if (childQtySum > parents[0].quantity) {
      flagged.push({
        key,
        reason: `child qty sum (${childQtySum}) > parent qty (${parents[0].quantity})`,
        rows: bucket,
      });
      continue;
    }
    groups.push({ key, canonical: parents[0], children });
  }

  console.log(`Candidate buckets: ${byKey.size}`);
  console.log(`Mergeable groups:  ${groups.length}`);
  console.log(`Flagged:           ${flagged.length}`);
  console.log();

  if (flagged.length > 0) {
    console.log("Flagged groups (NOT merged):");
    for (const g of flagged) {
      console.log(`  - ${g.reason}`);
      for (const r of g.rows) {
        const price = r.unitPrice ? r.unitPrice.toString() : "null";
        const asset = r.assetId ? "asset" : r.bulkAssetId ? "bulk" : "none";
        console.log(`      ${r.id} qty=${r.quantity} unitPrice=${price} ${asset} status=${r.status}`);
      }
    }
    console.log();
  }

  // Project / model display for the action log.
  const projectIds = [...new Set(groups.map((g) => g.canonical.projectId))];
  const modelIds = [...new Set(groups.map((g) => g.canonical.modelId).filter(Boolean) as string[])];
  const [projects, models] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, projectNumber: true, name: true } })
      : [],
    modelIds.length
      ? prisma.model.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const projById = new Map(projects.map((p) => [p.id, p]));
  const modelById = new Map(models.map((m) => [m.id, m]));

  let touched = 0;
  let unitsMoved = 0;
  let checkRecordsRepointed = 0;
  let damageEventsRepointed = 0;

  for (const g of groups) {
    const proj = projById.get(g.canonical.projectId);
    const model = g.canonical.modelId ? modelById.get(g.canonical.modelId) : null;
    console.log(
      `  ${apply ? "MERGE" : "PLAN "}  ${proj?.projectNumber ?? "?"}  ${model?.name ?? "?"}  canonical=${g.canonical.id} qty=${g.canonical.quantity}  merging ${g.children.length} child(ren)`,
    );
    for (const c of g.children) {
      console.log(`         ← ${c.id} qty=${c.quantity} asset=${c.assetId}`);
    }
    if (apply) {
      await mergeGroup(g);
      touched += g.children.length;
      unitsMoved += g.children.length;
    }
  }

  console.log();
  console.log("Summary");
  console.log("─".repeat(60));
  console.log(`  Mergeable groups:        ${groups.length}`);
  console.log(`  Flagged groups:          ${flagged.length}`);
  console.log(`  Children ${apply ? "merged" : "would merge"}: ${apply ? touched : groups.reduce((n, g) => n + g.children.length, 0)}`);
  if (apply) {
    console.log(`  Units moved:             ${unitsMoved}`);
    console.log(`  CheckRecords repointed:  ${checkRecordsRepointed}`);
    console.log(`  DamageEvents repointed:  ${damageEventsRepointed}`);
  } else {
    console.log();
    console.log("Re-run with --apply to execute.");
  }

  async function mergeGroup(g: Group) {
    await prisma.$transaction(async (tx) => {
      const canonicalUnits = await tx.projectLineItemUnit.findMany({
        where: { lineItemId: g.canonical.id },
        select: { ordinal: true },
      });
      const used = new Set(canonicalUnits.map((u) => u.ordinal));

      for (const child of g.children) {
        // Each split child has assetId set + quantity=1 — make a unit
        // on the canonical with that assetId. Reuse if there's already
        // one (defensive vs re-runs).
        const existingUnit = await tx.projectLineItemUnit.findUnique({
          where: {
            lineItemId_assetId: {
              lineItemId: g.canonical.id,
              assetId: child.assetId!,
            },
          },
          select: { id: true },
        });
        let unitId: string;
        if (existingUnit) {
          unitId = existingUnit.id;
        } else {
          // Find a free ordinal.
          let ord = nextOrdinal([...used].map((o) => ({ ordinal: o })));
          while (used.has(ord)) ord += 1;
          used.add(ord);
          // Inherit the child's per-unit state (so a deployed split
          // becomes a deployed unit; a returned split becomes a
          // returned unit). Safe defaults if the child was just
          // CONFIRMED.
          const status = child.status;
          const unit = await tx.projectLineItemUnit.create({
            data: {
              organizationId: child.organizationId,
              lineItemId: g.canonical.id,
              ordinal: ord,
              assetId: child.assetId,
              quantity: 1,
              status: status === "PREPPED" || status === "QUOTED"
                ? "CONFIRMED"
                : (status as "CONFIRMED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED"),
              prepStatus: child.prepStatus as "PENDING" | "PULLED" | "FLAGGED_FAULTY" | "FLAGGED_TT_OVERDUE" | "PACKED" | null,
            },
            select: { id: true },
          });
          unitId = unit.id;
        }

        // Repoint CheckRecord rows that point at the split.
        const cr = await tx.checkRecord.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id, lineItemUnitId: unitId },
        });
        checkRecordsRepointed += cr.count;

        // Repoint DamageEvent rows.
        const de = await tx.damageEvent.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id, lineItemUnitId: unitId },
        });
        damageEventsRepointed += de.count;

        // ProjectService 1:1 (if any).
        await tx.projectService.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id },
        });

        // Audit row — same table as the strict collapse migration.
        await tx.lineItemMergeMap.create({
          data: {
            organizationId: child.organizationId,
            oldLineItemId: child.id,
            canonicalLineItemId: g.canonical.id,
            movedUnitId: unitId,
            checkRecordsRepointed: cr.count,
            damageEventsRepointed: de.count,
            notes: `${runId} | historic-splits | parent qty=${g.canonical.quantity} child qty=${child.quantity}`,
          },
        });

        // Deactivate the split.
        await tx.projectLineItem.update({
          where: { id: child.id },
          data: {
            assetId: null,
            bulkAssetId: null,
            quantity: 0,
            status: "CANCELLED",
            notes: `[merged into ${g.canonical.id} on ${new Date().toISOString()} (${runId})]`,
          },
        });
      }

      // No quantity change to canonical — its quantity already
      // represented the whole line. Just recompute rollup.
      await syncLineItemRollup(tx, g.canonical.id);
    });
  }
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
