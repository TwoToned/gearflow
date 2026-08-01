import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import {
  effectiveQuoteStatus,
  listProjectQuotes,
  projectLiveRevision,
} from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Phase 3 (#1080/#1093) — the version SWITCHER's list read. Entry-level
 * projection (mapping a snapshot's entries into the tab DTOs) reuses the
 * existing `projectLocksRead.snapshotEntries`/`currentEntries` queries
 * unchanged (both already org-checked, #990) via the shared pure mapper in
 * `src/lib/project-version-projection.ts` — this file only adds the ONE new
 * read the switcher needs: the per-revision list (state, date, total).
 */

const VERSION_ITEM = v.object({
  revision: v.number(),
  quoteId: v.string(),
  status: v.union(
    v.literal("DRAFT"),
    v.literal("SENT"),
    v.literal("ACCEPTED"),
    v.literal("DECLINED"),
    v.literal("SUPERSEDED"),
    v.literal("EXPIRED"),
  ),
  isLive: v.boolean(),
  label: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  acceptedAt: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  snapshotId: v.optional(v.string()),
  // Mirrors `projectSnapshots.reason` (convex/schema.ts) — kept in lockstep the
  // same way `projectLocksRead.listSnapshots`'s union is, since this is a second
  // reader of the same field (R-3.1: one closed union value, two places it's
  // re-declared for the Convex validator, never a silently-widened `v.string()`).
  snapshotReason: v.optional(
    v.union(
      v.literal("CONFIRMED"),
      v.literal("COMPLETED"),
      v.literal("UNLOCK"),
      v.literal("QUOTE_SENT"),
      v.literal("VERSION_SAVED"),
      v.literal("PRE_PROMOTE"),
    ),
  ),
  hasSnapshot: v.boolean(),
  // The live revision's total comes straight off the (always-fresh) project
  // row; a non-live revision's total is read off its snapshot's `project`
  // entry — `null` when there's no snapshot to read it from (a pre-versioning
  // revision, or a same-tick race the switcher shouldn't ever actually hit).
  total: v.union(v.number(), v.null()),
});

type SnapshotReason = "CONFIRMED" | "COMPLETED" | "UNLOCK" | "QUOTE_SENT" | "VERSION_SAVED" | "PRE_PROMOTE";

interface VersionItem {
  revision: number;
  quoteId: string;
  status: ReturnType<typeof effectiveQuoteStatus>;
  isLive: boolean;
  label?: string;
  sentAt?: number;
  acceptedAt?: number;
  createdAt?: number;
  snapshotId?: string;
  snapshotReason?: SnapshotReason;
  hasSnapshot: boolean;
  total: number | null;
}

export const listVersions = query({
  args: { projectId: v.string(), orgId: v.string(), now: v.optional(v.number()) },
  returns: v.array(VERSION_ITEM),
  handler: async (ctx, { projectId, orgId, now }): Promise<VersionItem[]> => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return [];

    const liveRevision = projectLiveRevision(project);
    const at = now ?? 0;
    const quotes = await listProjectQuotes(ctx, orgId, projectId);

    const out: VersionItem[] = [];
    for (const q of quotes) {
      const isLive = q.version === liveRevision;
      let total: number | null = isLive ? (typeof project.total === "number" ? project.total : null) : null;
      let snapshotReason: SnapshotReason | undefined;

      if (q.snapshotId) {
        // Org-check the parent snapshot row before trusting anything off it —
        // same "snapshotId alone doesn't prove tenancy" rule as
        // `projectLocksRead.snapshotEntries` (R-8.4.3).
        const snapshot = await ctx.db.query("projectSnapshots").withIndex("by_cuid", (e) => e.eq("id", q.snapshotId as string)).first();
        if (snapshot && snapshot.organizationId === orgId) {
          snapshotReason = snapshot.reason;
          if (!isLive) {
            const projectEntry = await ctx.db
              .query("projectSnapshotEntries")
              .withIndex("by_snapshotId_entityType", (e) => e.eq("snapshotId", q.snapshotId as string).eq("entityType", "project"))
              .first();
            if (projectEntry && projectEntry.organizationId === orgId) {
              const data = projectEntry.data as Record<string, unknown>;
              total = typeof data.total === "number" ? data.total : null;
            }
          }
        }
      }

      out.push({
        revision: q.version,
        quoteId: q.id,
        status: effectiveQuoteStatus(q, at),
        isLive,
        label: q.label,
        sentAt: q.sentAt ?? q.publishedAt,
        acceptedAt: q.acceptedAt,
        createdAt: q.createdAt,
        snapshotId: q.snapshotId,
        snapshotReason,
        hasSnapshot: q.snapshotId != null,
        total,
      });
    }

    return out.sort((a, b) => b.revision - a.revision);
  },
});

export const agentOps: AgentOpsAnnotations = {
  listVersions: { summary: "List a project's versions with state, date and total for the switcher.", danger: "low", mcpTier: 1 },
};
