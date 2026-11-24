import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { LocationMovements } from "./locationMovement";
import { collectCapped } from "./pagination";

/**
 * `Move contents…` (UX Phase 14, Locations bulk verb): move everything stored at some locations to
 * another one. The forward write returns what it moved (and what it skipped, by reason); its exact
 * Undo reads the forward audit row and puts back only the rows still exactly where the move left them.
 *
 * What moves: assets, bulk-asset lines and kits whose `locationId` is a selected location. What does
 * not (named in the toast, never silent): units that are out on a job (CHECKED_OUT / RESERVED), kit
 * members and accessories (they travel with their kit / parent), kits that are out, and bulk lines
 * with some quantity out.
 */

export type MovedTable = "assets" | "bulkAssets" | "kits";

export interface MovedRow {
  table: MovedTable;
  id: string;
  from: string;
}

export type SkipReason = "out on a job" | "in a kit" | "an accessory" | "partly out";

export interface MovePlan {
  rows: { table: MovedTable; doc: Doc<"assets"> | Doc<"bulkAssets"> | Doc<"kits"> }[];
  skipped: Record<string, number>;
}

/** Most rows one move may touch: keeps the audit row (and the Undo) bounded. */
export const MAX_MOVE_ROWS = 500;

/** Pure: why a row cannot move now, or null when it can. */
type Movable = { status?: string | null; kitId?: string | null; parentAssetId?: string | null; totalQuantity?: number | null; availableQuantity?: number | null };

const outStatus = (s: string | null | undefined, ...out: string[]) => (out.includes(s ?? "") ? "out on a job" : null);

const WHY_NOT: Record<MovedTable, (d: Movable) => SkipReason | null> = {
  assets: (d) => (d.kitId ? "in a kit" : d.parentAssetId ? "an accessory" : outStatus(d.status, "CHECKED_OUT", "RESERVED")),
  kits: (d) => outStatus(d.status, "CHECKED_OUT"),
  bulkAssets: (d) => ((d.availableQuantity ?? d.totalQuantity ?? 0) < (d.totalQuantity ?? 0) ? "partly out" : null),
};

export function whyNotMovable(table: MovedTable, doc: Movable): SkipReason | null {
  return WHY_NOT[table](doc);
}

/** What is stored at the given locations (GLOBAL `by_locationId` indexes, org re-checked on every row). */
export async function planMove(ctx: MutationCtx, orgId: string, fromIds: readonly string[]): Promise<MovePlan> {
  const plan: MovePlan = { rows: [], skipped: {} };
  const skip = (why: SkipReason) => void (plan.skipped[why] = (plan.skipped[why] ?? 0) + 1);
  for (const locationId of fromIds) {
    const [assets, bulk, kits] = await Promise.all([
      collectCapped(ctx.db.query("assets").withIndex("by_locationId", (q) => q.eq("locationId", locationId)), MAX_MOVE_ROWS + 1),
      collectCapped(ctx.db.query("bulkAssets").withIndex("by_locationId", (q) => q.eq("locationId", locationId)), MAX_MOVE_ROWS + 1),
      collectCapped(ctx.db.query("kits").withIndex("by_locationId", (q) => q.eq("locationId", locationId)), MAX_MOVE_ROWS + 1),
    ]);
    const tagged = [
      ...assets.rows.map((doc) => ({ table: "assets" as const, doc })),
      ...bulk.rows.map((doc) => ({ table: "bulkAssets" as const, doc })),
      ...kits.rows.map((doc) => ({ table: "kits" as const, doc })),
    ].filter((r) => r.doc.organizationId === orgId && r.doc.isActive !== false);
    for (const r of tagged) {
      const why = whyNotMovable(r.table, r.doc as never);
      if (why) skip(why);
      else plan.rows.push(r);
    }
    if (plan.rows.length > MAX_MOVE_ROWS) throw new ConvexError(`Too many items to move at once (max ${MAX_MOVE_ROWS}). Move them in smaller batches.`);
  }
  return plan;
}

/** Patch every planned row to `toId` and stamp both ends once. Returns what moved, for the audit row. */
export async function applyMove(ctx: MutationCtx, orgId: string, plan: MovePlan, toId: string, now: number): Promise<MovedRow[]> {
  const moves = new LocationMovements();
  const moved: MovedRow[] = [];
  for (const { table, doc } of plan.rows) {
    const from = doc.locationId;
    if (!from) continue;
    await ctx.db.patch(doc._id as never, { locationId: toId, updatedAt: now } as never);
    moves.record(from, toId);
    moved.push({ table, id: doc.id, from });
  }
  await moves.flush(ctx, orgId, now);
  return moved;
}

/**
 * Put back the rows still exactly where the forward move left them (at `toId`, `updatedAt` = the
 * forward `now`). Anything touched since is left alone and counted. Stamps both ends.
 */
export async function undoMove(ctx: MutationCtx, orgId: string, moved: readonly MovedRow[], toId: string, forwardNow: number, now: number): Promise<{ restored: number; left: number }> {
  const moves = new LocationMovements();
  let restored = 0;
  for (const m of moved) {
    const doc = await ctx.db.query(m.table).withIndex("by_cuid", (q) => q.eq("id", m.id)).first();
    if (!doc || doc.organizationId !== orgId || doc.locationId !== toId || doc.updatedAt !== forwardNow) continue;
    await ctx.db.patch(doc._id as never, { locationId: m.from, updatedAt: now } as never);
    moves.record(toId, m.from);
    restored++;
  }
  await moves.flush(ctx, orgId, now);
  return { restored, left: moved.length - restored };
}
