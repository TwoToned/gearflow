import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `maintenanceRecord` dual-write (Phase 4 — reactive). The maintenance list +
 * detail pages subscribe to the Convex mirror so a new repair, a status
 * change, or a completion shows up live in every tab.
 *
 * SCOPE: only the maintenanceRecord row (scalars) is mirrored. The
 * `maintenanceRecordAssets` join table stays Prisma — the record's `updatedAt`
 * already bumps whenever its asset links change (Prisma writes the parent on the
 * nested create/deleteMany), so the record row is a sufficient cross-tab refresh
 * signal, and the server-action read still owns the asset/model join for display.
 * Asset photos live in `maintenanceRecordMedia`, mirrored by media-mirror.ts.
 *
 * Written from the maintenance server actions (and the damage create path, which
 * spawns a linked repair record) — NOT from any test-driven core module.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on the
 * convex-backfill-maintenance run. See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "assets", "kit", "project", "reportedBy", "assignedTo",
  "organization", "damageEvents", "media", "_count",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(strip(row)) as any);
}
async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(strip(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}
async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

export const mirrorMaintenanceCreate = (row: Record<string, unknown>) => create(api.maintenanceRecords.createIfMissing, row);
export const patchMaintenanceInConvex = (id: string, row: Record<string, unknown>) => patch(api.maintenanceRecords.update, id, row);
export const removeMaintenanceFromConvex = (id: string) => remove(api.maintenanceRecords.remove, id);

/**
 * Re-read a maintenance record from Prisma (scalars only) and create-or-patch it
 * into Convex. Used by the damage create path, which spawns a linked repair
 * record it doesn't return in full. Idempotent.
 */
export async function syncMaintenanceToConvex(id: string | null | undefined) {
  if (!id) return;
  const row = await prisma.maintenanceRecord.findUnique({ where: { id } });
  if (!row) return;
  const existing = await (await getConvexClient()).query(api.maintenanceRecords.getById, { id });
  if (existing) await patchMaintenanceInConvex(id, row as unknown as Record<string, unknown>);
  else await mirrorMaintenanceCreate(row as unknown as Record<string, unknown>);
}
