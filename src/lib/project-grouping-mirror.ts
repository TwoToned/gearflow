import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Project grouping substructure — `project_category` + `project_group` — is
 * DUAL-WRITTEN **infra-only**: every create/update/delete writes the Prisma row
 * (the durable FK anchor) AND mirrors to the matching Convex table. There is NO
 * Phase 4 for these — they are composed only inside the cross-domain equipment
 * editor (project ↔ line_item ↔ category ↔ group ↔ category_slot ↔ sub_hire_group,
 * read together as the equipment tab's mixed-ordered list), which stays on the
 * always-fresh Prisma mirror. The mirror exists so a future reactive consumer
 * (and the eventual decommission) sees a complete Convex graph. See FEATUREDOCS/54.
 *
 * Dual-write (not hard cutover): `category_slot` carries a required+Cascade FK to
 * project_category and a nullable+Cascade FK to project_group; project_line_item /
 * sub_hire* carry nullable refs. A Convex-only cutover would FK-fail.
 *
 * SCOPE: project_category + project_group only. `category_slot` (the cross-type
 * ordering layer) stays Prisma-only — it is read as part of the equipment
 * composition that never goes reactive in this step. Its writes live in
 * category-slots.ts; only the project_category/project_group rows those writes
 * touch are mirrored here.
 *
 * The grouping writes span 6 files (project-categories, project-groups,
 * category-slots, line-items, group-templates, and the projects.ts duplication
 * tx), so this uses the generic mirror-core pattern. The clear-to-null caveat
 * applies (toConvexDoc drops null→absent): clearing a group's categoryId→null
 * (moving it to the Uncategorized zone, or a category delete that SetNulls its
 * groups) is a no-op in Convex — see syncProjectGroupsToConvex, which re-reads and
 * still drops null. Tolerable because the substructure has no reactive consumer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id } as any);
}

// ─── Project categories ────────────────────────────────────────────────────────
export const mirrorProjectCategoryCreate = (row: Record<string, unknown>) => create(api.projectCategories.create, row);
export const patchProjectCategoryInConvex = (id: string, row: Record<string, unknown>) => patch(api.projectCategories.update, id, row);
export const removeProjectCategoryFromConvex = (id: string) => remove(api.projectCategories.remove, id);

// ─── Project groups ────────────────────────────────────────────────────────────
export const mirrorProjectGroupCreate = (row: Record<string, unknown>) => create(api.projectGroups.create, row);
export const patchProjectGroupInConvex = (id: string, row: Record<string, unknown>) => patch(api.projectGroups.update, id, row);
export const removeProjectGroupFromConvex = (id: string) => remove(api.projectGroups.remove, id);

/** Multi-row heal: re-read project_group rows from Prisma and patch each into
 *  Convex. For reorder/split/merge/move `$transaction`s that touch many groups
 *  (sortOrder / categoryId). Call AFTER commit; skips unknown/empty ids; strips
 *  relations by selecting scalars only. */
export async function syncProjectGroupsToConvex(groupIds: Array<string | null | undefined>) {
  const unique = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.projectGroup.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await patchProjectGroupInConvex(row.id, row as unknown as Record<string, unknown>);
  }
}

/** Multi-row heal for project_category rows (reorder sortOrder). */
export async function syncProjectCategoriesToConvex(categoryIds: Array<string | null | undefined>) {
  const unique = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.projectCategory.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await patchProjectCategoryInConvex(row.id, row as unknown as Record<string, unknown>);
  }
}
