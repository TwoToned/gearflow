import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import { versionRows } from "./lib/versionScope";
import { copyPlanGraph, VERSIONED_PLAN_TABLES } from "./lib/versionGraph";

/**
 * Project version mutations — Phase 2 (#1228) of "Project versioning v2"
 * (parent #1221). Phase 1/Phase 2's OLDER `projects.revision`/`liveRevision`
 * + `projectSnapshots` JSON-blob machinery this file used to also house
 * (`saveVersionNative`/`promoteRevisionNative`, #1080/#1085/#1089) was
 * DELETED in Phase 3 (#1229) — replaced by the real `projectVersions`-table
 * verb set in `convex/versions.ts` (`createNative`/`makeLiveNative`/
 * `setLabelNative`/`deleteNative`). See FEATUREDOCS/76's Phase 3 section for
 * what changed and why. `LABEL_BOUNDS` below outlives that deletion — it's a
 * plain shared bound, not part of the deleted mutation's behaviour, and both
 * `quotesWrites.setQuoteLabelNative` and `convex/versions.ts` still import it
 * (R-3.1: one "optional internal label, ≤60 chars" bound, not two).
 *
 * What remains in this file is Phase 2's §6 step 2 primitive,
 * `materializeVersionRowsNative` — see its own section comment below.
 */

/** Mirrors `quoteSetLabelSchema`'s bound in `src/lib/validations/quote.ts` —
 *  the client Zod parse is UX only and bypassable by any caller with a valid
 *  session hitting the mutation directly (FEATUREDOCS/54). Shared (R-3.1) by
 *  `quotesWrites.setQuoteLabelNative` and `convex/versions.ts`'s
 *  `createNative`/`setLabelNative` — one "optional internal label, ≤60
 *  chars" bound, not three hand-maintained copies. */
export const LABEL_BOUNDS = { max: 60 } as const;

// ────────────────────────────────────────────────────────────────────────────
// §6 step 2 MATERIALIZATION (#1228, Phase 2 of "Project versioning v2").
// This is the NEW `projectVersions` table's own row-level mechanism
// (FEATUREDOCS/76): giving a non-live `projectVersions` row REAL,
// individually-queryable `by_versionId`-tagged plan rows of its own, rather
// than a JSON blob (the OLDER "Project Version Switcher" program,
// FEATUREDOCS/70, that used to live above this comment in this same file —
// deleted in Phase 3, #1229, see the file header).
//
// The actual row-cloning is `copyPlanGraph` (`convex/lib/versionGraph.ts`,
// Phase 3) — factored out so `convex/versions.ts`'s `createNative` can share
// it (R-3.1: one clone implementation, not two). This mutation stays
// SERVICE-only (no UI calls it directly — a later phase may build one) and
// keeps its own validation/idempotency shape, which `copyPlanGraph` doesn't
// know about (it only clones; see its own file comment).
//
// ── DEPLOY-ORDER CONSTRAINT (read before wiring this up to anything) ──────
// This mutation reads and writes EXCLUSIVELY through the `by_versionId`
// index family (`versionRows`, `convex/lib/versionScope.ts`) — it has no
// `by_projectId` fallback of any kind. It is therefore only correct to CALL
// (not just deploy — call) once:
//   1. Phase 1's backfill (`convex/backfillProjectVersions.ts`) has actually
//      run against the target deployment, so every existing project has a
//      `liveVersionId` and every existing row has a `versionId`; AND
//   2. The Phase 2 schema (this same commit: `by_projectId` deleted,
//      `by_versionId` added on the 4 plan tables) is the live schema.
// Both conditions hold by construction for THIS codebase the moment it's
// deployed (the backfill predates this phase per CLAUDE.md/the file-level
// comment on `versionScope.ts`, and this mutation ships in the same commit
// as the index rename) — but they are NOT independently re-verified at
// call time beyond the ordinary `requireLiveVersionId` throw every other
// Phase 2 read/write already gets. **This ordering has been validated only
// against convex-test fixtures in this sandbox, never against a real Convex
// deployment** (no live deployment was available to this session) — the
// first real call against production should be treated as the actual proof,
// not this test suite alone.
//
// SAFETY properties this mutation enforces (all mechanically checked, not
// just documented):
//   - Never targets the project's OWN live version (its rows already exist
//     by definition — materializing over them would duplicate every lineage).
//   - Refuses to run if the target version ALREADY has any rows in any of
//     the 4 tables (no accidental double-materialize / silent duplication;
//     unlike CLAUDE.md's `createIfMissing` convention for a single mirrored
//     row, a multi-row clone has no natural idempotent merge, so this is an
//     explicit check-then-refuse rather than an upsert).
//   - Every cloned row gets a FRESH `id` but keeps the SOURCE row's
//     `lineageId` (falling back to the source row's own `id` if it predates
//     lineage tagging) — the same "a duplicate starts its own physical row
//     but keeps the logical thread" rule `projectWrites.ts`'s
//     `duplicateNative` uses for `versionId`, mirrored here for `lineageId`
//     instead (a *duplicate* project wants a fresh lineage per row; THIS
//     materialize is cloning the SAME project's plan into a sibling
//     version, so the whole point is to let `by_versionId_lineageId` find
//     "this same line across versions" — the opposite choice, deliberately).
//   - Org- and project-checked on every `by_cuid`-resolved id it touches
//     (`by_cuid` is global — R-8.4.3), same discipline as every other write
//     in this codebase.
//
// `VERSIONED_PLAN_TABLES` now lives in `convex/lib/versionGraph.ts` (imported
// above) — shared with `copyPlanGraph` and `convex/versions.ts`'s
// `deleteNative`, rather than redeclared here (R-3.1).

/** Validates the request and resolves `{project, targetVersion, sourceId}` —
 *  split out of the mutation body purely to keep the handler itself under
 *  the max-lines-per-function ratchet (R-3.6). Every throw here mirrors the
 *  handler doc's own error message text 1:1 — nothing behavioural moved,
 *  only the lines. */
async function resolveMaterializeTargets(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; targetVersionId: string; sourceVersionId?: string },
): Promise<{ project: Doc<"projects">; targetVersion: Doc<"projectVersions">; sourceId: string }> {
  const { organizationId, projectId, targetVersionId, sourceVersionId } = args;

  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== organizationId) {
    throw new ConvexError(`materializeVersionRowsNative: project not found or cross-org: ${projectId}`);
  }

  const targetVersion = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", targetVersionId)).first();
  if (!targetVersion || targetVersion.organizationId !== organizationId || targetVersion.projectId !== projectId) {
    throw new ConvexError(`materializeVersionRowsNative: target version not found or cross-org/project: ${targetVersionId}`);
  }
  if (targetVersionId === project.liveVersionId) {
    throw new ConvexError("materializeVersionRowsNative: refusing to materialize the LIVE version — its rows already exist by definition.");
  }

  // Idempotency / duplication guard — see the file-level comment above.
  const existingByTable = await Promise.all(VERSIONED_PLAN_TABLES.map((t) => versionRows(ctx, t, targetVersionId)));
  if (existingByTable.some((rows) => rows.length > 0)) {
    throw new ConvexError(
      `materializeVersionRowsNative: version ${targetVersionId} already has plan rows — refusing to double-materialize.`,
    );
  }

  const sourceId = sourceVersionId ?? project.liveVersionId;
  if (!sourceId) {
    throw new ConvexError(
      "materializeVersionRowsNative: project has no liveVersionId to materialize from — Phase 1's backfill must run first (#1228).",
    );
  }
  if (sourceId !== project.liveVersionId) {
    const sourceVersion = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", sourceId)).first();
    if (!sourceVersion || sourceVersion.organizationId !== organizationId || sourceVersion.projectId !== projectId) {
      throw new ConvexError(`materializeVersionRowsNative: source version not found or cross-org/project: ${sourceId}`);
    }
  }

  return { project, targetVersion, sourceId };
}

export const materializeVersionRowsNative = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    /** The (non-live) version to populate with real rows. */
    targetVersionId: v.string(),
    /** Clone FROM this version's rows. Defaults to the project's current
     *  live version — the common case ("branch a new version off what's
     *  live right now"). */
    sourceVersionId: v.optional(v.string()),
  },
  handler: async (ctx: MutationCtx, { organizationId, projectId, targetVersionId, sourceVersionId }) => {
    await requireService(ctx);

    const { targetVersion, sourceId } = await resolveMaterializeTargets(ctx, {
      organizationId, projectId, targetVersionId, sourceVersionId,
    });

    // The clone itself — FK rewrite, lineage preservation, fresh ids — is
    // `copyPlanGraph` (`convex/lib/versionGraph.ts`, Phase 3, shared with
    // `convex/versions.ts`'s `createNative`). NOTE: `categorySlots`
    // (ordering within a category/group) is NOT cloned by it — it has no
    // `versionId` of its own (schema.ts's PARENT_JOIN comment) and would
    // need its own oldId->newId FK rewrite (`projectCategoryId`/
    // `projectGroupId`/`lineItemId`) plus per-row `subHireGroupId`/
    // `lineItemId` handling this internal-only, no-UI primitive doesn't yet
    // need. A materialized version is therefore correct on MEMBERSHIP (every
    // category/group/line/service exists, with valid in-version parent/
    // group/category FKs) but starts with NO recorded slot order — callers
    // that need slot ordering on a materialized non-live version must extend
    // this before relying on it.
    const { materialized } = await copyPlanGraph(ctx, { sourceVersionId: sourceId, targetVersionId });

    await ctx.db.patch(targetVersion._id, { contentState: "ready" });
    return { materialized };
  },
});
