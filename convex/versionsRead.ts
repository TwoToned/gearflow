import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import { listProjectVersions } from "./lib/projectVersionState";
import { pickPlanFields } from "./lib/versionPlanFields";
import { loadTotalsBundle, computeTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { effectiveQuoteStatus, findQuoteForVersion, isLiveQuoteStatus, quoteLabel } from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the BROWSER-facing
 * reads over the real `projectVersions` table (Phase 1-3's `versions.ts`
 * verb set has no read side of its own). Two reads, split by weight:
 *
 * - `listForProject` — the lightweight summary list the header pill and the
 *   Versions panel both subscribe to (number/label/live/contentState/date).
 *   One query, two consumers (R-3.1) — neither surface runs its own list
 *   read.
 * - `getVersion` — a single version's PLAN FIELDS (`convex/lib/
 *   versionPlanFields.ts`'s `PLAN_FIELDS`, the SAME list `versions.
 *   createNative`/`makeLiveNative` read/write), for the client-side
 *   "composed object" (design §5 D32): when viewing a non-live version, the
 *   project-detail hook overlays these onto the live `projects` doc so every
 *   existing component reading `project.rentalStartDate` etc. keeps working
 *   unmodified. Mirrors `versions.createNative`'s own `isSourceLive` branch —
 *   a LIVE version's plan lives on `projects` itself (Phase 1 schema
 *   comment), never on its own `projectVersions` row.
 *
 * Both gated `requireOrgReadFor(orgId, "project")` (CLAUDE.md's agent rule
 * 3) rather than the resource-less `requireOrgPermission` — a version list/
 * read is exactly the kind of ordinary project-scoped read an agent token
 * should be able to make.
 */

const VERSION_SUMMARY = v.object({
  id: v.string(),
  number: v.number(),
  label: v.optional(v.string()),
  isLive: v.boolean(),
  contentState: v.union(v.literal("ready"), v.literal("missing")),
  createdAt: v.number(),
  createdById: v.string(),
  basedOnVersionId: v.optional(v.string()),
});

export const listForProject = query({
  args: { organizationId: v.string(), projectId: v.string() },
  returns: v.array(VERSION_SUMMARY),
  handler: async (ctx, { organizationId, projectId }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return [];

    const versions = await listProjectVersions(ctx, organizationId, projectId);
    return versions
      .map((version) => ({
        id: version.id,
        number: version.number,
        label: version.label,
        isLive: version.id === project.liveVersionId,
        contentState: version.contentState,
        createdAt: version.createdAt,
        createdById: version.createdById,
        basedOnVersionId: version.basedOnVersionId,
      }))
      .sort((a, b) => b.number - a.number);
  },
});

export const getVersion = query({
  args: { organizationId: v.string(), projectId: v.string(), versionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      number: v.number(),
      label: v.optional(v.string()),
      isLive: v.boolean(),
      contentState: v.union(v.literal("ready"), v.literal("missing")),
      createdAt: v.number(),
      createdById: v.string(),
      // The versioned PLAN FIELDS bag (`PLAN_FIELDS`) — heterogeneous
      // (strings/numbers/undefined), same `v.any()` shape this codebase
      // already uses for a snapshot entry's `data` (projectLocksRead.ts's
      // `ENTRY_RETURNS`). The one enumeration of WHICH fields is
      // `convex/lib/versionPlanFields.ts`; this validator doesn't repeat it.
      planFields: v.any(),
    }),
  ),
  handler: async (ctx, { organizationId, projectId, versionId }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return null;

    const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
    if (!version || version.organizationId !== organizationId || version.projectId !== projectId) return null;

    const isLive = version.id === project.liveVersionId;
    const planFields = pickPlanFields(isLive ? project : version);

    return {
      id: version.id,
      number: version.number,
      label: version.label,
      isLive,
      contentState: version.contentState,
      createdAt: version.createdAt,
      createdById: version.createdById,
      planFields,
    };
  },
});

/**
 * #1233 (Phase 6, parent #1221) — DRIFT detection: has this version's
 * content moved since its quote was sent? Compares the sent quote's OWN
 * frozen money snapshot (`quote.snapshot.total`, built once at send) against
 * this version's CURRENT live-computed total (`loadTotalsBundle`/
 * `computeTotals` targeted at `versionId` — the same version-aware totals
 * path `quotesWrites.buildQuoteSnapshot` uses, R-3.1: no second totals
 * computation).
 *
 * Deliberately narrow: this is the DETECTION signal `VersionStrip` surfaces
 * as a plain text line ("Quote total has moved +$1,240 since it was sent"),
 * NOT the line-item-level diff `diffSnapshotEntries`/`summarizeDrift`
 * (`src/lib/quote-drift.ts`) already renders elsewhere for the LIVE
 * version's own `projectSnapshots` capture — that mechanism is LIVE-ONLY by
 * construction (`projectSnapshots` never captures a non-live version's
 * rows) and isn't extended here. Full Compare-mode wiring (line-by-line,
 * side-by-side) is #1232, a separate, not-yet-built phase — this query is
 * the numeric signal only, with NO click target of its own.
 *
 * Returns `null` when this version has never had a quote sent (nothing to
 * drift against) — `VersionStrip` renders nothing in that case, same as any
 * other "no signal" state.
 */
export const quoteDriftForVersion = query({
  args: { organizationId: v.string(), projectId: v.string(), versionId: v.string(), now: v.optional(v.number()) },
  returns: v.union(
    v.null(),
    v.object({
      quoteId: v.string(),
      quoteLabel: v.string(),
      quoteStatus: v.string(),
      sentTotal: v.number(),
      currentTotal: v.number(),
      driftAmount: v.number(),
    }),
  ),
  handler: async (ctx, { organizationId, projectId, versionId, now }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return null;

    const quote = await findQuoteForVersion(ctx, organizationId, projectId, versionId);
    if (!quote) return null;
    // Only a quote the client currently holds (or held, since-expired) has a
    // meaningful "has this moved since I sent it" question — a DRAFT never
    // went out, a DECLINED/SUPERSEDED one is no longer the live conversation.
    const status = effectiveQuoteStatus(quote, now ?? Date.now());
    if (!isLiveQuoteStatus(status) && status !== "ACCEPTED") return null;

    const snapshot = quote.snapshot as { total?: number } | null | undefined;
    const sentTotal = Number(snapshot?.total) || 0;

    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    const bundle = await loadTotalsBundle(ctx, projectId, organizationId, orgDefaultTaxRate, versionId);
    const currentTotal = bundle ? computeTotals(bundle).total : sentTotal;

    return {
      quoteId: quote.id,
      quoteLabel: quoteLabel(project.projectNumber, quote.version),
      quoteStatus: status,
      sentTotal,
      currentTotal,
      driftAmount: Math.round((currentTotal - sentTotal) * 100) / 100,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: {
    summary: "List a project's versions (number, label, live, content state) for the version switcher/panel.",
    danger: "low",
    mcpTier: 2,
  },
  getVersion: {
    summary: "Read one project version's plan-field snapshot, for viewing a non-live version's dates/pricing terms.",
    danger: "low",
    mcpTier: 3,
  },
  quoteDriftForVersion: {
    summary: "Compare a version's sent-quote total against its current live-computed total (drift signal, no Compare-mode diff).",
    danger: "low",
    mcpTier: 3,
  },
};
