import type { MutationCtx } from "../_generated/server";

/**
 * The ONE place `locations.lastMovementAt` is written (UX Phase 14, D42, owner-approved
 * 2026-11-24). Every write that SETS, CHANGES or CLEARS the `locationId` of an asset, bulk
 * asset or kit records the move here, on BOTH the location it left and the one it entered.
 * `convex/locationMovementGuard.test.ts` discovers every such write in `convex/**` and fails
 * when one does not reach this module, so a new write path cannot skip it.
 *
 * What counts: a stock row's `locationId` field going from one value to another (including
 * absent -> a location on create or first placement, and a location -> absent). What does not:
 * deleting a row, or a job's own `locationId` (a venue, not a stock location).
 *
 * A write that moves many rows in one transaction uses a `LocationMovements` batch so each
 * location is patched once, not once per row.
 */

/** A `to` of `undefined` means "this write does not touch the field"; `null` means it cleared it. */
type Placement = string | null | undefined;

/** Pure: the location ids a single placement change touches (none when nothing changed). */
export function movedLocationIds(from: Placement, to: Placement): string[] {
  if (to === undefined) return [];
  const before = from ?? null;
  const after = to ?? null;
  if (before === after) return [];
  return [before, after].filter((id): id is string => id != null);
}

export class LocationMovements {
  private readonly ids = new Set<string>();

  /** Note that a row moved from `from` to `to` (`to` undefined = the write left its location alone). */
  record(from: Placement, to: Placement): this {
    for (const id of movedLocationIds(from, to)) this.ids.add(id);
    return this;
  }

  /** Stamp `lastMovementAt = now` on every location noted, org-checked (a foreign or missing id is skipped). */
  async flush(ctx: MutationCtx, orgId: string, now: number): Promise<void> {
    for (const id of this.ids) {
      const loc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!loc || loc.organizationId !== orgId) continue;
      // Monotonic: a replayed or out-of-order write never moves the stamp backwards.
      if ((loc.lastMovementAt ?? 0) >= now) continue;
      await ctx.db.patch(loc._id, { lastMovementAt: now });
    }
    this.ids.clear();
  }
}

/** One-row convenience: record the move and stamp straight away. */
export async function stampLocationMovement(ctx: MutationCtx, orgId: string, from: Placement, to: Placement, now: number): Promise<void> {
  await new LocationMovements().record(from, to).flush(ctx, orgId, now);
}
