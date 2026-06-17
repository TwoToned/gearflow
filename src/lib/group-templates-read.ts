import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Group Templates domain (Phase A read-rewiring).
 *
 * Group templates are dual-written: every create/update/delete writes BOTH the
 * Prisma `group_template` row (the durable FK anchor — `group_template_item`
 * carries a required + Cascade FK to it) AND the Convex `groupTemplates` doc.
 * **Only the PARENT scalar fields live in Convex** — the mirror strips the nested
 * `items` relation before writing (see `src/server/group-templates.ts`). The child
 * `group_template_item` rows (with their `model`/`kit` joins) stay in Prisma and
 * are the Prisma terminus for this surface.
 *
 * `getGroupTemplates` is therefore a HYBRID read: the parent rows come from Convex
 * (filtered/sorted in JS, mappers below), and the `items` are attached from Prisma
 * exactly as the old `include` did. No Prisma fallback on a Convex parent miss — a
 * miss reads as an absent template (like a join against a deleted row); falling back
 * would hide mirror drift. See FEATUREDOCS/54.
 */

export type ConvexGroupTemplate = Doc<"groupTemplates">;

/** The parent group-template shape as the old Prisma read returned it (post-`serialize`):
 *  required scalars, `description` nullable, `createdAt`/`updatedAt` as `Date`. */
export type MappedGroupTemplate = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Map a Convex `groupTemplates` doc to the Prisma parent shape: strip the Convex
 * system fields (`_id`/`_creationTime`), coerce the optional `description` to
 * `null` when absent, and convert epoch-ms timestamps to `Date` (Prisma's
 * `serialize` keeps `Date` instances, so consumers expect `Date`, not numbers).
 */
export function mapGroupTemplate(doc: ConvexGroupTemplate): MappedGroupTemplate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _creationTime, ...rest } = doc;
  return {
    id: rest.id,
    organizationId: rest.organizationId,
    name: rest.name,
    description: rest.description ?? null,
    // createdAt/updatedAt are non-null in Prisma (@default(now()) / @updatedAt);
    // they are optional in Convex only because old mirrored rows may predate them.
    createdAt: rest.createdAt != null ? new Date(rest.createdAt) : new Date(0),
    updatedAt: rest.updatedAt != null ? new Date(rest.updatedAt) : new Date(0),
  };
}

/**
 * Replicates Prisma `orderBy: { name: "asc" }` over the mapped parent rows.
 * Pure + total-ordered: primary key is `name` (codepoint compare), tie-broken by
 * `id` so the result is deterministic even when two templates share a name (the
 * settings page re-sorts by `name.localeCompare` for display regardless).
 */
export function sortGroupTemplatesByName(
  rows: MappedGroupTemplate[],
): MappedGroupTemplate[] {
  return [...rows].sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** All of an org's group-template PARENT rows from Convex, mapped + name-sorted. */
export async function getGroupTemplateParents(
  orgId: string,
): Promise<MappedGroupTemplate[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.groupTemplates.list, { orgId }),
  );
  return sortGroupTemplatesByName(docs.map(mapGroupTemplate));
}

/**
 * A single group-template PARENT row from Convex by cuid, mapped — or `null` if
 * absent. Used as the org-guard for update/delete (Phase B write inversion
 * replaces the old Prisma `findUniqueOrThrow where:{id,organizationId}`). No
 * Prisma fallback: a miss reads as an absent template. The caller verifies
 * `organizationId` before mutating.
 */
export async function getGroupTemplateParentById(
  id: string,
): Promise<MappedGroupTemplate | null> {
  const doc = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.groupTemplates.getById, { id }),
  );
  return doc ? mapGroupTemplate(doc) : null;
}
