/**
 * The org settings that name a gear category by id (UX Phase 14, 14b-5), so deleting one cannot leave a dangling id.
 *
 * `OrgSettings` (the JSON blob in `orgSettings.settings`, `src/lib/org-settings-types.ts`) stores exactly two such
 * references: `containerCategoryIds` (the categories whose assets can be packing containers, #1296) and the deprecated
 * `prepKitCategoryId` it superseded. No other settings key, and no other table, stores a gear `categories.id`:
 * `targetCategoryId` / `defaultTargetCategoryId` on sub-hires point at JOB categories (`projectCategories`), and the
 * `categoryId` on models and kits is moved by the delete itself. One check, shared by every category delete.
 */
import { ConvexError } from "convex/values";
import type { DatabaseReader } from "../_generated/server";

/** The category ids the org's settings reference, or an empty list when none are set (or the blob is unreadable). */
export async function settingsCategoryRefs(ctx: { db: DatabaseReader }, orgId: string): Promise<string[]> {
  const row = await ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
  if (!row?.settings) return [];
  try {
    const blob = JSON.parse(row.settings) as { containerCategoryIds?: unknown; prepKitCategoryId?: unknown };
    const ids = Array.isArray(blob.containerCategoryIds) ? blob.containerCategoryIds : [];
    return [...ids, blob.prepKitCategoryId].filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/** Refuses a delete of a category the org's settings still name (clear it in Settings first). */
export async function assertNotUsedBySettings(ctx: { db: DatabaseReader }, orgId: string, categoryId: string): Promise<void> {
  if ((await settingsCategoryRefs(ctx, orgId)).includes(categoryId)) {
    throw new ConvexError({ code: "USED_BY_SETTINGS", message: "This category is a packing-container category in Settings. Remove it there first, then delete it." });
  }
}
