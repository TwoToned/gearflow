import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Kit cluster — `kit` (parent) + its member sub-tables `kit_serialized_item` and
 * `kit_bulk_item` — is DUAL-WRITTEN: every create/update/delete writes the Prisma
 * row (the durable FK anchor) AND mirrors to the matching Convex table. Prisma is
 * written first; the Convex payload is derived from the written row via
 * toConvexDoc so the two can't drift; the backfill doubles as the heal path.
 *
 * Dual-write (not hard cutover) because live inbound FKs from tables that stay in
 * Prisma cross the boundary: `kit_serialized_item` / `kit_bulk_item` / `kit_media`
 * / `kit_check_item` carry a **required + Cascade** FK to `kit`; `asset.kitId`,
 * `project_line_item.kitId`, `asset_scan_log.kitId`, `check_record.kitId`,
 * `maintenance_record.kitId`, `group_template_item.kitId` are nullable inbound
 * refs. Creating any of those against a net-new Convex-only kit would FK-fail. See
 * FEATUREDOCS/54.
 *
 * SCOPE: kit + the two member sub-tables only. `kit_media` (a *_media table —
 * composed via the Prisma mirror like every other media gallery, see
 * file-upload-mirror) and `kit_check_item` (a check-config join, not yet migrated)
 * stay Prisma-only, so kit delete's media/check-item cleanup needs no Convex
 * mirror. `customFieldValues` is Json (Convex v.any()).
 *
 * The clear-to-null caveat applies (toConvexDoc drops null→absent, and the Convex
 * patch validator is v.optional, which rejects null): clearing a kit's
 * categoryId/locationId/etc. is a no-op in Convex. Same accepted limitation as
 * every other dual-write domain (models, suppliers, …). Rare for kits; heals on
 * the next non-null write or a backfill run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

// ─── Kit (parent) ─────────────────────────────────────────────────────────────
export const mirrorKitCreate = (row: Record<string, unknown>) => create(api.kits.createIfMissing, row);
export const patchKitInConvex = (id: string, row: Record<string, unknown>) => patch(api.kits.update, id, row);
export const removeKitFromConvex = (id: string) => remove(api.kits.remove, id);

// ─── Kit serialized items ──────────────────────────────────────────────────────
export const mirrorKitSerializedItemCreate = (row: Record<string, unknown>) => create(api.kitSerializedItems.createIfMissing, row);
export const removeKitSerializedItemFromConvex = (id: string) => remove(api.kitSerializedItems.remove, id);

// ─── Kit bulk items ─────────────────────────────────────────────────────────────
export const mirrorKitBulkItemCreate = (row: Record<string, unknown>) => create(api.kitBulkItems.createIfMissing, row);
export const removeKitBulkItemFromConvex = (id: string) => remove(api.kitBulkItems.remove, id);

/**
 * Multi-row heal: re-read the given kit ids from Prisma (the fresh mirror) and
 * patch each into Convex. Used by the warehouse check-out / check-in / force-return
 * and project-cancel flows whose `$transaction`s mutate `kit.status` (and
 * `locationId`) across many kits at once — including nested kits. Call AFTER the
 * transaction commits (Convex is an out-of-transaction HTTP write). Unknown/empty
 * ids are skipped.
 */
export async function syncKitsToConvex(kitIds: Array<string | null | undefined>) {
  const unique = [...new Set(kitIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.kit.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await patchKitInConvex(row.id, row as unknown as Record<string, unknown>);
  }
}
