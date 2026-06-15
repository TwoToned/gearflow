import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `project_line_item_unit` dual-write (Phase 6 decommission groundwork).
 *
 * Units are the fulfillment source of truth — one row per physical asset assigned
 * to a line. They are created AND deleted by the warehouse / check / fulfillment
 * paths (qty changes, accessory expand/collapse, returns), so unlike the
 * line-item spine (which never deletes via the status paths) the unit mirror must
 * be an AUTHORITATIVE per-line-item reconcile: upsert every Prisma unit, then
 * REMOVE any Convex unit whose Prisma row is gone.
 *
 * Wired through the line-item mirror: `upsertProjectLineItemsToConvex` and
 * `syncLineItemsToConvex` call `reconcileUnitsForLineItems` after re-reading the
 * affected line items, so every one of the ~50 post-commit mirror sites covers
 * units for free — no per-site threading.
 *
 * Always `ConvexError` on the Convex side; `createIfMissing` is idempotent. See
 * FEATUREDOCS/54 and the line-item-mirror sibling.
 */

/** Scalar columns the Convex unit create/update validators accept. */
const UNIT_SCALAR_KEYS = new Set([
  "id", "organizationId", "lineItemId", "ordinal", "assetId", "bulkAssetId",
  "parentUnitAssetId", "quantity", "returnedQuantity", "status", "prepStatus",
  "prepContainer", "checkedOutAt", "checkedOutById", "returnedAt", "returnedById",
  "returnCondition", "returnStatus", "returnNotes", "createdAt", "updatedAt",
]);

function stripUnit(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (UNIT_SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Authoritative reconcile of every unit under the given line items into Convex.
 * Upserts each Prisma unit (create-or-patch) and removes Convex units whose
 * Prisma row no longer exists. Scoped per lineItemId so a removed unit is caught.
 */
export async function reconcileUnitsForLineItems(
  lineItemIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(lineItemIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;

  const client = await getConvexClient();
  const desired = await prisma.projectLineItemUnit.findMany({
    where: { lineItemId: { in: ids } },
  });
  const desiredByLineItem = new Map<string, Record<string, unknown>[]>();
  for (const u of desired) {
    const arr = desiredByLineItem.get(u.lineItemId) ?? [];
    arr.push(u as unknown as Record<string, unknown>);
    desiredByLineItem.set(u.lineItemId, arr);
  }

  for (const lineItemId of ids) {
    const want = desiredByLineItem.get(lineItemId) ?? [];
    const wantIds = new Set(want.map((u) => u.id as string));

    // Current Convex units for this line item.
    const current = (await client.query(api.projectLineItemUnits.listByLineItem, {
      lineItemId,
    })) as Array<{ id: string }>;
    const currentIds = new Set(current.map((c) => c.id));

    // Upsert every desired unit.
    for (const row of want) {
      const doc = stripUnit(toConvexDoc(row));
      if (currentIds.has(row.id as string)) {
        const { id: _id, ...rest } = doc;
        await client.mutation(api.projectLineItemUnits.update, {
          id: row.id as string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          patch: rest as any,
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.mutation(api.projectLineItemUnits.createIfMissing, doc as any);
      }
    }

    // Remove Convex units whose Prisma row is gone.
    for (const c of current) {
      if (!wantIds.has(c.id)) {
        await client.mutation(api.projectLineItemUnits.remove, { id: c.id });
      }
    }
  }
}

/** Reconcile units for every line item of a project. */
export async function reconcileUnitsForProject(
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return;
  const lineItems = await prisma.projectLineItem.findMany({
    where: { projectId },
    select: { id: true },
  });
  await reconcileUnitsForLineItems(lineItems.map((li) => li.id));
}
