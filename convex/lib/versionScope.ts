import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Project Versioning v2, Phase 2 (#1228, parent #1221,
 * docs/designs/project-versioning-v2.md §4.9) — the "deliberate breaking
 * change": `by_projectId` was DELETED from the five plan tables
 * (`projectCategories`, `projectGroups`, `projectLineItems`,
 * `projectServices` — `categorySlots` never had one, see its schema.ts
 * comment) and replaced with a `by_versionId` family
 * (`by_versionId`, `by_versionId_lineageId`, and every renamed
 * `by_versionId_*` composite). This module is the ONE place that resolves
 * "which version's rows do I read" so every call site funnels through the
 * same two decisions: live-only (`liveRows`) or an explicit version
 * (`versionRows`/`resolveVersionId`).
 *
 * ── Deploy-order dependency (read this before deploying) ──────────────────
 * Phase 1's backfill (`convex/backfillProjectVersions.ts`) has been run in
 * test/dev but, as of this phase, NOT against any real Convex deployment —
 * production `projects` rows have no `liveVersionId` and production
 * `projectCategories`/`projectGroups`/`projectLineItems`/`projectServices`
 * rows have no `versionId`. Every function in this module treats a missing
 * `liveVersionId` as a hard error (see `requireLiveVersionId`) rather than
 * silently reading zero rows, which would otherwise render as "every
 * project is empty" instead of a loud failure. **The backfill MUST be run
 * against production before (or atomically with) this schema/index change
 * goes live** — this is the same ordering constraint the §6 step 2
 * materialization mutation states explicitly
 * (`convex/projectVersionsWrites.ts`), applied one level up: the index
 * rename itself is downstream of the backfill, not just materialization.
 */

/** The four plan tables that got a `by_versionId` index in this phase.
 *  `categorySlots` is deliberately excluded — it has no `projectId`/
 *  `versionId` index of its own; see its schema.ts comment. */
export type VersionedTableName =
  | "projectCategories"
  | "projectGroups"
  | "projectLineItems"
  | "projectServices";

/**
 * Resolves `project`'s LIVE version id. Throws (never silently returns
 * undefined / empty) — see the deploy-order note above. Any live-only read
 * site should go through `liveRows` below rather than calling this
 * directly, unless it needs the id itself (e.g. to stamp a new child row).
 */
export function requireLiveVersionId(project: Doc<"projects">): string {
  if (!project.liveVersionId) {
    throw new ConvexError(
      `project ${project.id} has no liveVersionId — Phase 1's backfill ` +
        `(convex/backfillProjectVersions.ts) must run before Phase 2 ` +
        `version-scoped reads/writes can be deployed (#1228)`,
    );
  }
  return project.liveVersionId;
}

/**
 * LIVE-ONLY bucket (docs/designs/project-versioning-v2.md §4.9's three-way
 * classification): this table's rows for `project`'s LIVE version, via the
 * `by_versionId` index. The default choice for a read that has never had a
 * reason to look at a non-live version — the large majority of the 92
 * migrated call sites.
 */
export async function liveRows<T extends VersionedTableName>(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  table: T,
): Promise<Doc<T>[]> {
  const versionId = requireLiveVersionId(project);
  return ctx.db
    .query(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table name is generic over the 4 versioned tables, all sharing this index shape
    .withIndex("by_versionId" as any, (q: any) => q.eq("versionId", versionId))
    .collect();
}

/**
 * VERSION-AWARE bucket: this table's rows for an EXPLICIT version id, which
 * may or may not be the live one. Use once a `versionId` param has been
 * threaded through (a tab hook, a `*Native` mutation's optional param).
 */
export async function versionRows<T extends VersionedTableName>(
  ctx: QueryCtx | MutationCtx,
  table: T,
  versionId: string,
): Promise<Doc<T>[]> {
  return ctx.db
    .query(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see liveRows above
    .withIndex("by_versionId" as any, (q: any) => q.eq("versionId", versionId))
    .collect();
}

/**
 * Resolves an OPTIONAL caller-supplied `versionId` against `project`,
 * defaulting to the live version — the shared "optional versionId param"
 * shape every `*Native` mutation and tab hook on the five tables takes in
 * this phase (additive-only, per the stable-contract ratchet: a NEW
 * optional arg, never a removed/changed one).
 */
export function resolveVersionId(project: Doc<"projects">, versionId?: string): string {
  return versionId ?? requireLiveVersionId(project);
}
