import type { MutationCtx } from "../_generated/server";

/**
 * Sub-hire order-number counter RMW, extracted from the inline body of
 * orgSettings.reserveSubHireOrderNumber so browser-direct sub-hire create
 * mutations (PR-1+) can reserve an order number INSIDE their own transaction
 * instead of a SERVICE-gated round-trip. Atomic within the calling mutation
 * (Convex mutations are serializable → no read-modify-write race).
 *
 * BYTE-IDENTICAL to the former inline logic: read the org's `subHireOrderCounter`
 * from the orgSettings JSON blob, seed it to at least `floor` (cutover carry-
 * forward), increment by one, persist, and return the "SH-NNNN" (4-digit,
 * zero-padded) order number. orgSettings.reserveSubHireOrderNumber now delegates
 * here, so the still-server backfill path is unchanged.
 */

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function reserveSubHireOrderNumberCounter(
  ctx: MutationCtx,
  organizationId: string,
  now: number,
  floor?: number,
): Promise<{ orderNumber: string }> {
  const existing = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  const blob = existing?.settings ? safeParse(existing.settings) : {};
  const stored = (blob.subHireOrderCounter as number) || 0;
  const current = Math.max(stored, floor ?? 0);
  const next = current + 1;
  blob.subHireOrderCounter = next;
  const settings = JSON.stringify(blob);
  if (existing) {
    await ctx.db.patch(existing._id, { settings, updatedAt: now });
  } else {
    await ctx.db.insert("orgSettings", { organizationId, settings, createdAt: now, updatedAt: now });
  }
  return { orderNumber: `SH-${String(next).padStart(4, "0")}` };
}
