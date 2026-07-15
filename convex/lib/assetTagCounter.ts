import type { MutationCtx } from "../_generated/server";

/**
 * Keystone #1 — the shared asset-tag counter RMW, extracted from
 * orgSettings.reserveAssetTags so browser-direct create mutations (bulk-assets,
 * assets, kits) can reserve tags INSIDE their own transaction instead of a
 * SERVICE-gated round-trip. Atomic within the calling mutation (Convex mutations
 * are serializable → no read-modify-write race).
 *
 * Reads/writes the org's `assetTagCounter` in the orgSettings JSON blob and
 * returns the N newly-reserved tags (prefix + zero-padded number). Callers that
 * only need to ADVANCE the counter (bulk-asset create uses a form-supplied tag)
 * ignore the return.
 */

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function reserveAssetTagCounter(
  ctx: MutationCtx,
  organizationId: string,
  count: number,
  now: number,
): Promise<{ tags: string[] }> {
  const existing = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  const blob = existing?.settings ? safeParse(existing.settings) : {};
  const prefix = (blob.assetTagPrefix as string) || "ASSET";
  const digits = (blob.assetTagDigits as number) || 4;
  const current = (blob.assetTagCounter as number) || 0;
  const tags: string[] = [];
  for (let i = 1; i <= count; i++) {
    tags.push(`${prefix}${String(current + i).padStart(digits, "0")}`);
  }
  blob.assetTagCounter = current + count;
  const settings = JSON.stringify(blob);
  if (existing) {
    await ctx.db.patch(existing._id, { settings, updatedAt: now });
  } else {
    await ctx.db.insert("orgSettings", { organizationId, settings, createdAt: now, updatedAt: now });
  }
  return { tags };
}
