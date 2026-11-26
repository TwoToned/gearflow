/**
 * Loads a model's OWN category (org-checked: `by_cuid` is global) for `effectiveTestDefaults`
 * (`categoryTestDefaults.ts`). One category read per model; a model with no category, or whose category belongs to
 * another org, has none.
 */
import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

export async function categoryOfModel(ctx: { db: DatabaseReader }, orgId: string, model: { categoryId?: string | null }): Promise<Doc<"categories"> | null> {
  if (!model.categoryId) return null;
  const categoryId = model.categoryId;
  const cat = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", categoryId)).first();
  return cat && cat.organizationId === orgId ? cat : null;
}

/** Every category of the org by id (a small per-org tree), for batch paths that resolve many models. */
export async function orgCategoriesById(ctx: { db: DatabaseReader }, orgId: string): Promise<Map<string, Doc<"categories">>> {
  const cats = await ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: categories is a small bounded per-org tree — see docs/exceptions.md R-8.3.3
  return new Map(cats.map((c) => [c.id, c]));
}
