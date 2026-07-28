import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";
import {
  effectiveQuoteStatus,
  isLiveQuoteStatus,
  listProjectQuotes,
  projectRevision,
  requireProjectInOrg,
} from "./lib/quoteState";

/**
 * Read-only queries for the `quotes` table (WS1 #940, reworked by #986).
 *
 * Every row is returned with a DERIVED `effectiveStatus`, because `EXPIRED` is
 * never stored — `validUntil < now && SENT` is resolved on read (no cron, no
 * clock skew, no stale row). Consumers MUST branch on `effectiveStatus`, not on
 * the raw `status` column, which can still read `PUBLISHED` on any row the
 * backfill hasn't reached.
 *
 * `now` is a client-supplied argument rather than `Date.now()` because a Convex
 * query must be deterministic to stay reactively cacheable — the same reason
 * every `*Native` mutation takes one. Omitting it yields the stored statuses
 * with no expiry applied.
 *
 * The previous `listForProject` read `by_projectId` (a GLOBAL index) with no org
 * re-check; `listProjectQuotes` filters by `organizationId` (R-8.4.3).
 */

export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, projectId, now }) => {
    await requireOrgRead(ctx, orgId);
    const at = now ?? 0;
    const quotes = await listProjectQuotes(ctx, orgId, projectId);
    return quotes
      .map((q) => ({ ...q, effectiveStatus: effectiveQuoteStatus(q, at) }))
      .sort((a, b) => b.version - a.version);
  },
});

/**
 * The project's revision state in one round trip: the current revision number,
 * the open draft (if any) and the revision the client is currently holding.
 * Backs the Finance tab's lock strip and, in Phase C (#988), the quote input to
 * `resolveLockTier`.
 */
export const revisionStateForProject = query({
  args: { orgId: v.string(), projectId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, projectId, now }) => {
    await requireOrgRead(ctx, orgId);
    const at = now ?? 0;
    const project = await requireProjectInOrg(ctx, projectId, orgId);
    const revision = projectRevision(project);
    const quotes = await listProjectQuotes(ctx, orgId, projectId);

    const withStatus = quotes.map((q) => ({ quote: q, status: effectiveQuoteStatus(q, at) }));
    const draft = withStatus.find((r) => r.status === "DRAFT" && r.quote.version === revision);
    const live = withStatus.find((r) => isLiveQuoteStatus(r.status));

    return {
      revision,
      hasAcceptedQuote: withStatus.some((r) => r.status === "ACCEPTED"),
      draftQuoteId: draft?.quote.id ?? null,
      liveQuote: live
        ? {
            id: live.quote.id,
            version: live.quote.version,
            status: live.status,
            sentAt: live.quote.sentAt ?? live.quote.publishedAt ?? null,
            validUntil: live.quote.validUntil ?? null,
            snapshotId: live.quote.snapshotId ?? null,
          }
        : null,
    };
  },
});
