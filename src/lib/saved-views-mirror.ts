import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `savedTableView` dual-write (Phase 4 — reactive). Per-user table column/filter
 * presets. Mirrored so a user editing their views in one tab sees them in
 * another, and the saved-view dropdowns refresh live.
 *
 * The create + setDefault paths flip the single-default-per-(user,table)
 * invariant via a Prisma updateMany, so after those writes we re-sync ALL of the
 * user's views for that table (a small bounded set) rather than just the touched
 * row — otherwise the Convex copy shows a stale 2nd default.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on the
 * convex-backfill-saved-views run. See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "user", "organization", "_count",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function upsert(row: Record<string, unknown>) {
  const convex = await getConvexClient();
  const id = row.id as string;
  const existing = await convex.query(api.savedTableViews.getById, { id });
  if (existing) {
    const { id: _id, ...rest } = toConvexDoc(strip(row));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await convex.mutation(api.savedTableViews.update, { id, patch: rest } as any);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await convex.mutation(api.savedTableViews.create, toConvexDoc(strip(row)) as any);
  }
}

export const mirrorSavedViewUpsert = (row: Record<string, unknown>) => upsert(row);

export async function removeSavedViewFromConvex(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.savedTableViews.remove, { id } as any);
}

/**
 * Re-sync every saved view for a (user, table) pair. Used after create/setDefault
 * which unset the previous default via updateMany — keeps the Convex copy's
 * single-default invariant correct.
 */
export async function syncUserTableViewsToConvex(
  organizationId: string,
  userId: string,
  tableId: string,
) {
  const rows = await prisma.savedTableView.findMany({
    where: { organizationId, userId, tableId },
  });
  for (const r of rows) await upsert(r as unknown as Record<string, unknown>);
}
