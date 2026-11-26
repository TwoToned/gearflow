/**
 * The org settings that name a gear category by id (UX Phase 14, 14b-5), so deleting one cannot leave a dangling id.
 *
 * `OrgSettings` (the JSON blob in `orgSettings.settings`, `src/lib/org-settings-types.ts`) stores exactly two such
 * references: `containerCategoryIds` (the categories whose assets can be packing containers, #1296) and the deprecated
 * `prepKitCategoryId` it superseded. No other settings key, and no other table, stores a gear `categories.id`:
 * `targetCategoryId` / `defaultTargetCategoryId` on sub-hires point at JOB categories (`projectCategories`), and the
 * `categoryId` on models and kits is moved by the delete itself. One check, shared by every category delete.
 *
 * It fails CLOSED: an absent or empty blob names nothing, but a NON-empty blob that can't be parsed, or whose shape is not
 * what the settings write (an object whose `containerCategoryIds` is a list of text and whose `prepKitCategoryId` is text),
 * refuses the delete (`SETTINGS_UNREADABLE`), because the references can't be ruled out.
 */
import { ConvexError } from "convex/values";
import type { DatabaseReader } from "../_generated/server";

const unreadable = () => new ConvexError({ code: "SETTINGS_UNREADABLE", message: "This organisation's settings can't be read, so it can't be checked whether this category is still in use. Fix the settings, then try again." });

/** The category ids the org's settings reference (none when the blob is absent or empty); throws `SETTINGS_UNREADABLE` when it can't be judged. */
export async function settingsCategoryRefs(ctx: { db: DatabaseReader }, orgId: string): Promise<string[]> {
  const row = await ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
  if (!row?.settings || row.settings.trim() === "") return [];
  let blob: unknown;
  try {
    blob = JSON.parse(row.settings);
  } catch {
    throw unreadable();
  }
  if (blob === null || typeof blob !== "object" || Array.isArray(blob)) throw unreadable();
  const { containerCategoryIds, prepKitCategoryId } = blob as { containerCategoryIds?: unknown; prepKitCategoryId?: unknown };
  if (containerCategoryIds !== undefined && (!Array.isArray(containerCategoryIds) || containerCategoryIds.some((x) => typeof x !== "string"))) throw unreadable();
  if (prepKitCategoryId !== undefined && typeof prepKitCategoryId !== "string") throw unreadable();
  return [...((containerCategoryIds as string[] | undefined) ?? []), ...(prepKitCategoryId ? [prepKitCategoryId as string] : [])].filter((x) => x.length > 0);
}

/** Refuses a delete of a category the org's settings still name (clear it in Settings first), or when they can't be read. */
export async function assertNotUsedBySettings(ctx: { db: DatabaseReader }, orgId: string, categoryId: string): Promise<void> {
  if ((await settingsCategoryRefs(ctx, orgId)).includes(categoryId)) {
    throw new ConvexError({ code: "USED_BY_SETTINGS", message: "This category is a packing-container category in Settings. Remove it there first, then delete it." });
  }
}
