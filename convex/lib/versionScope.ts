import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pickPlanFields } from "./versionPlanFields";

/**
 * #1221 follow-up (closes Phase 5's "Equipment write-side gap" note,
 * FEATUREDOCS/76) — the WRITE-side counterpart to `resolveVersionId` above.
 * Every CREATE mutation on the four versioned plan tables (plus
 * `categorySlots`' owning-category create) used to hard-code
 * `versionId: requireLiveVersionId(project)`, so a new row could only ever
 * land on the live version — even while the caller was viewing and editing a
 * non-live one. This resolves the SAME "optional versionId, default live"
 * shape Phase 2 established for reads, but a write can corrupt state in a way
 * a read cannot (a line stamped onto a foreign version is a live, persisted
 * IDOR-shaped bug, not just a wrong response), so a supplied `versionId` is
 * ALWAYS validated against `project` before being trusted — never just
 * defaulted through like `resolveVersionId` does for reads (see FEATUREDOCS/76
 * Phase 2 "What's deferred" for why reads still don't do this).
 */
export async function resolveWriteVersionId(
  ctx: MutationCtx,
  project: Doc<"projects">,
  versionId?: string,
): Promise<string> {
  if (versionId == null) return requireLiveVersionId(project);
  const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
  if (!version || version.organizationId !== project.organizationId || version.projectId !== project.id) {
    throw new ConvexError(`resolveWriteVersionId: version not found or cross-org/project: ${versionId}`);
  }
  if (version.contentState !== "ready") {
    throw new ConvexError({
      code: "VERSION_NOT_READY",
      message: `Version ${version.number} has no captured content — new rows can't be added to it.`,
    });
  }
  return versionId;
}

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
 * Convenience for a write call site that only has `projectId`/`orgId` in
 * scope (no `Doc<"projects">` already loaded) and needs the live version id
 * to stamp onto a NEW row it's about to insert into one of the four tables.
 * Org-checks the same way every other `by_cuid` lookup in this codebase must
 * (`by_cuid` is global). Throws (via `requireLiveVersionId`) if the project
 * is missing/cross-org/un-backfilled — see the deploy-order note above.
 */
export async function resolveLiveVersionIdForProject(
  ctx: QueryCtx | MutationCtx,
  projectId: string,
  orgId: string,
): Promise<string> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) {
    throw new ConvexError(`resolveLiveVersionIdForProject: project not found or cross-org: ${projectId}`);
  }
  return requireLiveVersionId(project);
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

/**
 * #1233 (Phase 6, "Project versioning v2") — the read-time counterpart to
 * `versions.makeLiveNative`'s plan-field swap: a `projects` doc SHAPED as if
 * `targetVersionId` were live, for any read that needs to price/date a
 * SPECIFIC version rather than always the live one (`loadTotalsBundle`,
 * `buildFinanceLines`). Mirrors `src/lib/project-version-compose.ts`'s
 * `composeProjectWithVersion` (the client-side "composed object"), but
 * server-side and against the REAL `projectVersions` row rather than the
 * already-resolved `getVersion` query response — same overlay semantics
 * (`pickPlanFields` always includes every key, even as an explicit
 * `undefined`, so a version that doesn't set a field CLEARS it rather than
 * leaking the live project's value — see that module's own comment).
 *
 * A no-op (returns `project` unchanged, no extra read) when `targetVersionId`
 * IS the live version — the overwhelming majority of calls — so this never
 * adds a round trip to the live-only path.
 */
export async function resolveEffectiveProjectForVersion(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  targetVersionId: string,
): Promise<Doc<"projects">> {
  if (targetVersionId === project.liveVersionId) return project;
  const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", targetVersionId)).first();
  if (!version || version.organizationId !== project.organizationId || version.projectId !== project.id) {
    throw new ConvexError(`resolveEffectiveProjectForVersion: version not found or cross-org/project: ${targetVersionId}`);
  }
  return { ...project, ...pickPlanFields(version) };
}
