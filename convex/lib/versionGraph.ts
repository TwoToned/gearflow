import { createId } from "@paralleldrive/cuid2";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { versionRows, type VersionedTableName } from "./versionScope";

/**
 * `copyPlanGraph` — Project Versioning v2, Phase 3 (#1229, parent #1221).
 * The shared ROW-CLONING primitive behind BOTH `versions.createNative`
 * (this phase) and `projectVersionsWrites.materializeVersionRowsNative`
 * (#1228, Phase 2's §6 step 2 primitive) — one definition (R-3.1), not two
 * hand-maintained copies that could silently diverge on the FK-rewrite
 * rules. Both mutations need the exact same thing: give a `projectVersions`
 * row real, individually-queryable `by_versionId`-tagged rows of its own by
 * cloning another version's `projectCategories`/`projectGroups`/
 * `projectLineItems`/`projectServices` rows.
 *
 * Every cloned row gets a FRESH `id` but KEEPS the source row's `lineageId`
 * (falling back to the source row's own `id` if it predates lineage
 * tagging) — `by_versionId_lineageId` can then find "the same line" across
 * versions, which is exactly what `makeLiveNative`'s reality carry-over
 * (`convex/lib/versionReality.ts`) matches on. In-clone-set FK references
 * (`categoryId`/`groupId`/`parentLineItemId`) are rewritten through an
 * old-id→new-id map so a cloned child never points at a parent that only
 * exists in the source version. FK fields that name a row OUTSIDE this
 * 4-table clone set (modelId/assetId/kitId/subHireId/crewRoleId/…) are left
 * untouched — those name a different table's row entirely and aren't
 * per-version.
 *
 * Callers are responsible for validating the source/target version ids
 * belong to the right org/project, and (for a materialize-style caller) for
 * the "target already has rows" idempotency check — this function only
 * clones. `categorySlots` (ordering) is NOT cloned here — see
 * `materializeVersionRowsNative`'s own file comment for the tracked gap.
 */

export const VERSIONED_PLAN_TABLES: readonly VersionedTableName[] = [
  "projectCategories",
  "projectGroups",
  "projectLineItems",
  "projectServices",
];

const IN_CLONE_SET_FK_FIELDS = ["categoryId", "groupId", "parentLineItemId"] as const;

/**
 * Headroom under Convex's 8,192-doc/16MiB-per-transaction ceiling (#1229's
 * size-budget acceptance criterion): every cloned row is READ once (source)
 * and WRITTEN once (target) inside the SAME transaction as the caller's own
 * version-row insert, permission checks and audit-log write — a 2x-plus
 * multiplier on whatever this constant allows. Chosen well clear of half the
 * hard ceiling rather than tuned to the exact arithmetic, since the caller's
 * own bookkeeping writes add an unpredictable few docs on top.
 */
export const MAX_CLONABLE_PLAN_ROWS = 3000;

export async function copyPlanGraph(
  ctx: MutationCtx,
  args: { sourceVersionId: string; targetVersionId: string },
): Promise<{ materialized: number }> {
  const { sourceVersionId, targetVersionId } = args;
  const rowsByTable = await Promise.all(VERSIONED_PLAN_TABLES.map((t) => versionRows(ctx, t, sourceVersionId)));
  const total = rowsByTable.reduce((n, rows) => n + rows.length, 0);
  if (total > MAX_CLONABLE_PLAN_ROWS) {
    throw new ConvexError({
      code: "VERSION_TOO_LARGE",
      message:
        `This version has ${total} plan rows — too many to copy in one transaction ` +
        `(max ${MAX_CLONABLE_PLAN_ROWS}, well under Convex's 8,192-doc/16MiB transaction ceiling).`,
    });
  }

  // Two passes, because a clone must not leave a child pointing at a parent
  // id that only exists in the SOURCE version. Every row gets a fresh `id`
  // (pass 1), so `categoryId`/`groupId`/`parentLineItemId` have to be
  // rewritten through the old-id -> new-id map (pass 2).
  type SourceRow = Record<string, unknown> & {
    _id: unknown;
    _creationTime: unknown;
    id: string;
    versionId?: string;
    lineageId?: string;
  };

  const idMap = new Map<string, string>(); // old row id -> new (cloned) row id
  const toInsert: { table: VersionedTableName; doc: Record<string, unknown> }[] = [];

  for (let i = 0; i < VERSIONED_PLAN_TABLES.length; i++) {
    const table = VERSIONED_PLAN_TABLES[i];
    for (const row of rowsByTable[i]) {
      const source = row as unknown as SourceRow;
      const { _id, _creationTime, id, versionId, lineageId, ...rest } = source;
      void _id;
      void _creationTime;
      void versionId;
      const newId = createId();
      idMap.set(id, newId);
      toInsert.push({ table, doc: { ...rest, id: newId, versionId: targetVersionId, lineageId: lineageId ?? id } });
    }
  }

  let materialized = 0;
  for (const { table, doc } of toInsert) {
    for (const fk of IN_CLONE_SET_FK_FIELDS) {
      const oldRef = doc[fk];
      if (typeof oldRef === "string" && idMap.has(oldRef)) doc[fk] = idMap.get(oldRef);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table name is a loop variable over the 4 known versioned tables
    await ctx.db.insert(table as any, doc);
    materialized += 1;
  }

  return { materialized };
}
