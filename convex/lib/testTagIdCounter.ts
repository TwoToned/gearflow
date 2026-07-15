import type { MutationCtx } from "../_generated/server";

/**
 * Shared test-tag-id counter RMW, extracted from orgSettings.reserveTestTagIds so
 * browser-direct T&T-asset create mutations can reserve ids INSIDE their own
 * transaction. Atomic within the calling mutation (Convex mutations are
 * serializable). Reads/writes `testTag.counter` in the orgSettings JSON blob.
 */

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function reserveTestTagIdCounter(
  ctx: MutationCtx,
  organizationId: string,
  count: number,
  now: number,
): Promise<{ ids: string[] }> {
  const existing = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  const blob = existing?.settings ? safeParse(existing.settings) : {};
  const tt = (blob.testTag as Record<string, unknown>) || {};
  const prefix = (tt.prefix as string) || "TT";
  const digits = (tt.digits as number) || 4;
  const current = (tt.counter as number) || 0;
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}${String(current + i).padStart(digits, "0")}`);
  }
  blob.testTag = { ...tt, counter: current + count };
  const settings = JSON.stringify(blob);
  if (existing) {
    await ctx.db.patch(existing._id, { settings, updatedAt: now });
  } else {
    await ctx.db.insert("orgSettings", { organizationId, settings, createdAt: now, updatedAt: now });
  }
  return { ids };
}
