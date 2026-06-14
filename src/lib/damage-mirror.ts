import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `damageEvent` dual-write (Phase 4 — reactive). The damage list + detail pages
 * subscribe to the Convex mirror so a damage report / status change / charge-back
 * shows up live in every tab. The mirror is written from the damage server
 * actions (NOT from damage-core.ts — that module is driven directly by the
 * integration tests, which must stay Convex-free).
 *
 * Photos live in the `damageEventMedia` table, mirrored separately by
 * media-mirror.ts; this mirror only carries the scalar damage row (incl. the
 * legacy `photos: string[]` column).
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on the
 * convex-backfill-damage run. See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "asset", "bulkAsset", "project", "createdBy", "lineItem",
  "maintenanceRecord", "organization", "media", "_count",
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

export const mirrorDamageCreate = (row: Record<string, unknown>) => create(api.damageEvents.create, row);
export const patchDamageInConvex = (id: string, row: Record<string, unknown>) => patch(api.damageEvents.update, id, row);
export const removeDamageFromConvex = (id: string) => remove(api.damageEvents.remove, id);

/** Re-read a damage event from Prisma (scalars only) and patch it into Convex. */
export async function syncDamageToConvex(id: string | null | undefined) {
  if (!id) return;
  const row = await prisma.damageEvent.findUnique({ where: { id } });
  if (row) await patchDamageInConvex(row.id, row as unknown as Record<string, unknown>);
}
