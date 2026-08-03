import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { getOpenUnlockSession, isHardLockOverrideAllowed, resolveLockTier } from "./lib/projectLocks";
import { getAuthContext } from "./lib/auth";
import { collectCurrentEntries } from "./lib/projectSnapshots";
import { effectiveQuoteStatus, findQuoteAtRevision, projectLiveRevision, projectRevision } from "./lib/quoteState";

const ENTRY_RETURNS = v.array(
  v.object({
    entityType: v.union(
      v.literal("project"),
      v.literal("category"),
      v.literal("group"),
      v.literal("lineItem"),
      v.literal("service"),
      v.literal("crewAssignment"),
      v.literal("subHire"),
      v.literal("subHireItem"),
      v.literal("subHireGroup"),
      v.literal("categorySlot"),
    ),
    entityId: v.string(),
    data: v.any(),
  }),
);

/**
 * BROWSER-facing reads for the #957 lifecycle-lock program: the project's
 * current tier + open unlock session (for the banner/lock icons), and the
 * snapshot/version list + a single snapshot's entries (for the Versions/diff
 * UI, #792). Gated on `project:read` — same permission the rest of the
 * project-detail composites use.
 */

export const status = query({
  args: {
    projectId: v.string(),
    orgId: v.string(),
    // Optional (like `quotes.ts`'s reads) — a Convex query must be deterministic
    // to stay reactively cacheable, so `now` is client-supplied rather than
    // `Date.now()`. Only used to resolve a real EXPIRED for display; omitting it
    // still resolves the correct TIER (#988's lock escalation treats SENT and
    // EXPIRED identically — see `quoteState.ts#currentRevisionQuoteStatus`).
    now: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      tier: v.union(v.literal("OPEN"), v.literal("FINANCE_LOCKED"), v.literal("JUSTIFY"), v.literal("HARD_LOCKED")),
      // #988 — why `tier` is what it is, so the UI can explain itself and offer
      // the right exit (Create quote v(N+1) / Recall vs. the existing unlock
      // session flow) instead of a bare "locked".
      reason: v.union(v.literal("STATUS"), v.literal("QUOTE_SENT")),
      // #988 — the shared revision counter + the current revision's quote state,
      // so Phase E can render one coherent banner from this single query instead
      // of a second round trip.
      revision: v.number(),
      // #1080/#1100 — the LIVE revision (`projectLiveRevision`), separate from
      // `revision` (the allocator) once a promote has moved them apart. The
      // QUOTE_SENT escalation below is resolved against THIS number, not
      // `revision` — see `assertLifecycleGuard`'s matching fix.
      liveRevision: v.number(),
      quoteState: v.union(
        v.null(),
        v.literal("DRAFT"),
        v.literal("SENT"),
        v.literal("ACCEPTED"),
        v.literal("DECLINED"),
        v.literal("SUPERSEDED"),
        v.literal("EXPIRED"),
      ),
      canOverrideHardLock: v.boolean(),
      openSession: v.union(
        v.null(),
        v.object({
          id: v.string(),
          scope: v.union(v.literal("FINANCIAL"), v.literal("FULL")),
          justification: v.string(),
          openedBy: v.string(),
          openedByName: v.optional(v.string()),
          openedAt: v.number(),
          // #990 (Phase E) — the UNLOCK snapshot this session opened against,
          // so the client can diff it against `currentEntries` before Save &
          // relock / Discard (finance-workflow-ux.md §7.2 "committing blind is
          // the one thing that turns an audit trail into noise").
          snapshotId: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { projectId, orgId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return null;

    const revision = projectRevision(project);
    const liveRevision = projectLiveRevision(project);
    // The QUOTE_SENT escalation is about the LIVE revision's quote — not the
    // allocator's high-water mark, which a promote can leave ahead of it.
    const currentQuote = await findQuoteAtRevision(ctx, orgId, projectId, liveRevision);
    const quoteState = currentQuote ? effectiveQuoteStatus(currentQuote, now ?? 0) : null;
    const { tier, reason } = resolveLockTier({ status: project.status, quoteState });
    const session = await getOpenUnlockSession(ctx, orgId, projectId);

    const auth = await getAuthContext(ctx);
    const canOverrideHardLock =
      auth?.kind === "service" ||
      (auth?.kind === "user" && (await isHardLockOverrideAllowed(ctx, orgId, projectId, auth.userId)));

    return {
      tier,
      reason,
      revision,
      liveRevision,
      quoteState,
      canOverrideHardLock,
      openSession: session
        ? {
            id: session.id,
            scope: session.scope,
            justification: session.justification,
            openedBy: session.openedBy,
            openedByName: session.openedByName,
            openedAt: session.openedAt,
            snapshotId: session.snapshotId,
          }
        : null,
    };
  },
});

export const listSnapshots = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      // QUOTE_SENT (#986) — a snapshot taken when a quote revision was sent.
      // VERSION_SAVED/PRE_PROMOTE (#1085) — the same "carries `revision`" shape,
      // taken by an explicit Save version, by `newVersionNative` capturing the
      // revision it moves past, and (Phase 2) by a promote's auto-capture. This
      // union MUST stay in lockstep with `projectSnapshots.reason` in
      // convex/schema.ts — a reason absent here throws at read time the moment
      // any project has one (this query's `returns` validator is closed).
      reason: v.union(
        v.literal("CONFIRMED"),
        v.literal("COMPLETED"),
        v.literal("UNLOCK"),
        v.literal("QUOTE_SENT"),
        v.literal("VERSION_SAVED"),
        v.literal("PRE_PROMOTE"),
      ),
      revision: v.optional(v.number()),
      takenAt: v.number(),
      takenBy: v.string(),
      takenByName: v.optional(v.string()),
      statusFrom: v.optional(v.string()),
      statusTo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const rows = (
      await ctx.db.query("projectSnapshots").withIndex("by_projectId_takenAt", (q) => q.eq("projectId", projectId)).collect()
    ).filter((s) => s.organizationId === orgId);
    return rows
      .sort((a, b) => b.takenAt - a.takenAt)
      .map((s) => ({
        id: s.id,
        reason: s.reason,
        revision: s.revision,
        takenAt: s.takenAt,
        takenBy: s.takenBy,
        takenByName: s.takenByName,
        statusFrom: s.statusFrom,
        statusTo: s.statusTo,
      }));
  },
});

export const snapshotEntries = query({
  args: { snapshotId: v.string(), orgId: v.string() },
  returns: ENTRY_RETURNS,
  handler: async (ctx, { snapshotId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    // Org-check the parent snapshot row first — snapshotId alone doesn't prove
    // tenancy (by_snapshotId on projectSnapshotEntries is not itself org-scoped).
    const snapshot = await ctx.db.query("projectSnapshots").withIndex("by_cuid", (q) => q.eq("id", snapshotId)).first();
    if (!snapshot || snapshot.organizationId !== orgId) return [];
    const entries = (
      await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshotId)).collect()
    ).filter((e) => e.organizationId === orgId);
    return entries.map((e) => ({ entityType: e.entityType, entityId: e.entityId, data: e.data }));
  },
});

/** Read-only "current" state in the same entry shape as a snapshot — lets the
 *  Versions UI diff snapshot↔current through the identical code path as
 *  snapshot↔snapshot (src/lib/project-snapshot-diff.ts). */
export const currentEntries = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: ENTRY_RETURNS,
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return [];
    return collectCurrentEntries(ctx, orgId, project);
  },
});
