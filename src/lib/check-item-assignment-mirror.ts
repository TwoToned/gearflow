import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * The check-item ASSIGNMENT join tables — `model_check_item` (which check items a
 * model's assets get during warehouse prep / return) and `kit_check_item`
 * (kit-level checks) — are DUAL-WRITTEN: every create / delete / reorder writes
 * the Prisma row (the durable FK anchor — both carry a required + Cascade FK to
 * `check_item` and to `model` / `kit`) AND mirrors to the matching Convex table.
 * Prisma is written first; the Convex payload is derived from the written row so
 * the two can't drift; the idempotent backfill is the heal path.
 *
 * These are config-ish, low-churn tables. Mirroring them lets the warehouse
 * line-item-tree reads source `model._count.modelCheckItems` /
 * `kit._count.kitCheckItems` off the Convex mirror (Phase 6 decommission) instead
 * of a Prisma `groupBy` / relation `_count`, and makes the model / kit "Checks"
 * tabs reactive. See FEATUREDOCS/54.
 *
 * Several call sites hold the Prisma row WITH relation includes
 * (`checkItem` / `model` / `kit`); the `*Doc` extractors below pull ONLY the
 * scalar columns so the strict Convex create validator never sees a nested
 * relation object (toConvexDoc would otherwise pass it straight through and the
 * mutation would reject the unexpected field).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryRef = FunctionReference<"query", "public", any, any>;
type Row = Record<string, unknown>;

/** Scalar-only projection of a `model_check_item` row (strips relation includes). */
function modelCheckItemDoc(row: Row): Row {
  return {
    id: row.id,
    organizationId: row.organizationId,
    modelId: row.modelId,
    checkItemId: row.checkItemId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

/** Scalar-only projection of a `kit_check_item` row (strips relation includes). */
function kitCheckItemDoc(row: Row): Row {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kitId: row.kitId,
    checkItemId: row.checkItemId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

async function createIn(fn: AnyRef, doc: Row) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(doc) as any);
}

async function patchIn(fn: AnyRef, id: string, doc: Row) {
  const { id: _id, ...rest } = toConvexDoc(doc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

/**
 * Tolerant remove: the durable Prisma delete already committed, so a missing
 * Convex mirror row (a row that predates dual-write and hasn't been backfilled,
 * or whose create failed earlier) must NOT surface as a user-facing error. The
 * generated Convex `remove` throws "<table> not found: <id>" in that case; swallow
 * exactly that. Matches the `removeSafe` pattern in crew-scheduling-mirror.
 */
async function removeIn(fn: AnyRef, id: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (await getConvexClient()).mutation(fn, { id } as any);
  } catch (e) {
    if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
  }
}

/** Create-or-patch one row into Convex (heals rows that predate dual-write). */
async function upsertIn(
  createFn: AnyRef,
  updateFn: AnyRef,
  getByIdFn: AnyQueryRef,
  id: string,
  doc: Row,
) {
  const convex = await getConvexClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await convex.query(getByIdFn, { id } as any);
  if (existing) await patchIn(updateFn, id, doc);
  else await createIn(createFn, doc);
}

// ─── model_check_item ──────────────────────────────────────────────────────────

export const mirrorModelCheckItemCreate = (row: Row) =>
  createIn(api.modelCheckItems.create, modelCheckItemDoc(row));

export const removeModelCheckItemFromConvex = (id: string) =>
  removeIn(api.modelCheckItems.remove, id);

/**
 * Multi-row heal: re-read every `model_check_item` row for the given models from
 * Prisma (the fresh mirror) and upsert each into Convex. Used by the reorder
 * (`updateMany` of `sortOrder`) and the bulk-assign (`createMany`, which returns
 * no ids) write paths. Call AFTER the Prisma write commits.
 */
export async function syncModelCheckItemsForModels(modelIds: Array<string | null | undefined>) {
  const unique = [...new Set(modelIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.modelCheckItem.findMany({ where: { modelId: { in: unique } } });
  for (const row of rows as unknown as Row[]) {
    await upsertIn(
      api.modelCheckItems.create,
      api.modelCheckItems.update,
      api.modelCheckItems.getById,
      row.id as string,
      modelCheckItemDoc(row),
    );
  }
}

// ─── kit_check_item ──────────────────────────────────────────────────────────

export const mirrorKitCheckItemCreate = (row: Row) =>
  createIn(api.kitCheckItems.create, kitCheckItemDoc(row));

export const removeKitCheckItemFromConvex = (id: string) =>
  removeIn(api.kitCheckItems.remove, id);

/**
 * Multi-row heal for one kit's check items: re-read from Prisma and upsert each
 * into Convex. Used by the kit-level reorder (`updateMany` of `sortOrder`). Call
 * AFTER the Prisma write commits.
 */
export async function syncKitCheckItemsForKit(kitId: string) {
  const rows = await prisma.kitCheckItem.findMany({ where: { kitId } });
  for (const row of rows as unknown as Row[]) {
    await upsertIn(
      api.kitCheckItems.create,
      api.kitCheckItems.update,
      api.kitCheckItems.getById,
      row.id as string,
      kitCheckItemDoc(row),
    );
  }
}
