import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `project_line_item` — the equipment-tab spine — is DUAL-WRITTEN **infra-only**:
 * there is NO Phase 4. Line items are composed only inside the cross-domain
 * equipment editor (the mixed-ordered category/group/sub-hire list) and the PDF
 * pipeline, both of which stay on Prisma reads. The mirror keeps the Convex graph
 * complete for the eventual decommission. See FEATUREDOCS/54.
 *
 * Dual-write (not hard cutover): `project_line_item_unit` carries a
 * required+Cascade FK, the table self-references (parent/child + kit children,
 * Cascade), and project_service / check_record / damage_event carry nullable refs.
 *
 * Strategy — the spine is written from ~17 files / ~80 sites, most of them
 * status mutations inside warehouse / check / fulfillment `$transaction`s. Rather
 * than thread touched ids through every helper, the status-mutation paths call
 * `upsertProjectLineItemsToConvex(projectId)` AFTER commit: a project has only a
 * handful of line items, so re-reading them all and create-or-patching each is
 * cheap, captures scan-time accessory/kit EXPANSIONS (new rows) as well as status
 * flips, and can't miss a site. The pure CRUD paths (line-items.ts) use the
 * explicit create/patch/remove helpers. Deletes are never produced by the
 * status paths, so the upsert sweep needs no delete handling — explicit removes
 * cover the CRUD + cascade-delete sites.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent): clearing
 * groupId/categoryId/parentLineItemId etc. to null is a no-op in Convex. Tolerable
 * for this consumer-less mirror; heals on a backfill run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryRef = FunctionReference<"query", "public", any, any>;

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

export const mirrorLineItemCreate = (row: Record<string, unknown>) => create(api.projectLineItems.create, row);
export const patchLineItemInConvex = (id: string, row: Record<string, unknown>) => patch(api.projectLineItems.update, id, row);
export const removeLineItemFromConvex = (id: string) => remove(api.projectLineItems.remove, id);

/** Relation keys a line-item read may include — stripped before mirroring so the
 *  Convex create/update arg validators (scalars only) don't reject extra fields. */
const LINE_ITEM_RELATION_KEYS = new Set([
  "model", "asset", "bulkAsset", "kit", "supplier", "category", "group",
  "parentLineItem", "childLineItems", "units", "project", "subHire",
  "subHireItem", "subHireGroup", "checkRecords", "damageEvents",
]);

/** Strip the nested relations a line-item read may include before mirroring. */
function stripLineItemRelations(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!LINE_ITEM_RELATION_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a freshly written line item (strips any included relations). */
export const mirrorLineItemRow = (row: Record<string, unknown>) =>
  mirrorLineItemCreate(stripLineItemRelations(row));

async function upsertOne(row: Record<string, unknown>) {
  const id = row.id as string;
  const existing = await getConvexClient().query(
    api.projectLineItems.getById as AnyQueryRef,
    { id },
  );
  if (existing) await patchLineItemInConvex(id, stripLineItemRelations(row));
  else await mirrorLineItemCreate(stripLineItemRelations(row));
}

/**
 * Upsert every line item of a project into Convex. The workhorse for the
 * warehouse / check / fulfillment / bulk-checkin `$transaction`s — call AFTER
 * commit with the project id. Captures status flips AND scan-time row expansions
 * (accessories, kit children). Does not delete; status paths never delete rows.
 */
export async function upsertProjectLineItemsToConvex(projectId: string | null | undefined) {
  if (!projectId) return;
  const rows = await prisma.projectLineItem.findMany({ where: { projectId } });
  for (const row of rows) {
    await upsertOne(row as unknown as Record<string, unknown>);
  }
}

/** Upsert specific line items by id (for non-project-scoped multi-row writes). */
export async function syncLineItemsToConvex(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.projectLineItem.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await upsertOne(row as unknown as Record<string, unknown>);
  }
}
