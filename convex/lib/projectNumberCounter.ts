import type { MutationCtx } from "../_generated/server";

/**
 * Project-number sequence counter RMW, extracted from the inline body of
 * projectNumberSequences.reserveNextNumber so browser-direct project create
 * mutations (createNative auto-number) can reserve the next sequence value INSIDE
 * their own transaction instead of a SERVICE-gated round-trip. Atomic within the
 * calling mutation — Convex mutations are serializable on the documents they
 * touch, so concurrent project creates conflict on the by_organizationId_scopeKey
 * read range and retry, never double-allocating.
 *
 * BYTE-IDENTICAL to the former inline logic in reserveNextNumber: the Convex
 * equivalent of the Postgres `INSERT … ON CONFLICT … value = value + 1 RETURNING
 * value`. `newRowId` is the cuid used only when the counter row is first created
 * (ignored if it already exists). Returns the new value.
 * projectNumberSequences.reserveNextNumber now delegates here, so the still-server
 * backfill path is unchanged.
 */
export async function reserveProjectNumberCounter(
  ctx: MutationCtx,
  organizationId: string,
  scopeKey: string,
  newRowId: string,
  now: number,
): Promise<number> {
  const existing = await ctx.db
    .query("projectNumberSequences")
    .withIndex("by_organizationId_scopeKey", (q) => q.eq("organizationId", organizationId).eq("scopeKey", scopeKey))
    .unique();
  if (existing) {
    const value = (existing.value ?? 0) + 1;
    await ctx.db.patch(existing._id, { value, updatedAt: now });
    return value;
  }
  await ctx.db.insert("projectNumberSequences", { id: newRowId, organizationId, scopeKey, value: 1, updatedAt: now });
  return 1;
}
