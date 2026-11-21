import { v, ConvexError, type Infer } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import { listProjectVersions } from "./lib/projectVersionState";
import { versionRows } from "./lib/versionScope";
import { loadTotalsBundle, computeTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { classifyCompareRows } from "./lib/versionCompare";
import { effectiveQuoteStatus, findQuoteForVersion } from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * UX Phase 8 (§7b.4) — two COUNTS-ONLY reads for the Versions tab and the
 * Make-live dialog. Both are advisory: the client fails OPEN on any error or
 * `undefined` (a preview must never block a real write — playbook §3.6).
 * Money and counts are derived on read from the same `computeTotals` /
 * `classifyCompareRows` the Compare sheet uses; nothing here is stored, and no
 * second diff or totals implementation exists (R-3.1).
 */

/** Per-version cap on units/lines examined, so the read stays bounded. */
const MAX_LINES_EXAMINED = 500;
const MAX_UNITS_PER_LINE = 500;
/** Versions that get row facts (newest first); older rows render without them. */
const MAX_VERSIONS_WITH_FACTS = 12;

/** The lines a packing plan is about: top-level equipment, not containers. */
function isPlannableLine(l: Doc<"projectLineItems">): boolean {
  return l.type === "EQUIPMENT" && !l.isKitChild && !l.isContainerLineItem && l.status !== "CANCELLED";
}

async function loadVersionInProject(ctx: QueryCtx, orgId: string, projectId: string, versionId: string) {
  const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
  if (!version || version.organizationId !== orgId || version.projectId !== projectId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Version not found." });
  }
  return version;
}

/** Non-cancelled units of a line (bounded), org-checked. */
async function liveUnits(ctx: QueryCtx, orgId: string, lineItemId: string) {
  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
    .take(MAX_UNITS_PER_LINE + 1);
  return { units: units.filter((u) => u.organizationId === orgId && u.status !== "CANCELLED"), capped: units.length > MAX_UNITS_PER_LINE };
}

/** Sum of ordered quantity per model over plannable lines, for a demand diff. */
function demandByModel(lines: Doc<"projectLineItems">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.modelId) m.set(l.modelId, (m.get(l.modelId) ?? 0) + (l.quantity ?? 0));
  return m;
}

function countModelsWithDemandChange(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const id of new Set([...a.keys(), ...b.keys()])) if ((a.get(id) ?? 0) !== (b.get(id) ?? 0)) n++;
  return n;
}

/** What carrying the outgoing version's physical reality onto the incoming one
 *  involves: lines with units, packed units, and lines with no incoming match. */
async function realityFootprint(
  ctx: QueryCtx,
  orgId: string,
  outgoing: Doc<"projectLineItems">[],
  incomingLineages: Set<string>,
) {
  let carriedLines = 0;
  let packedUnits = 0;
  let notOnIncoming = 0;
  let truncated = outgoing.length > MAX_LINES_EXAMINED;
  for (const line of outgoing.slice(0, MAX_LINES_EXAMINED)) {
    const { units, capped } = await liveUnits(ctx, orgId, line.id);
    truncated ||= capped;
    if (units.length === 0) continue;
    carriedLines++;
    packedUnits += units.filter((u) => u.containerId).length;
    if (!incomingLineages.has(line.lineageId ?? line.id)) notOnIncoming++;
  }
  return { carriedLines, packedUnits, notOnIncoming, truncated };
}

const MONEY_PAIR = v.object({ before: v.number(), after: v.number() });

/**
 * "What happens if vN goes live" — counts only. `null` when the version is
 * already live. Org- and project-checked at every global-index read.
 */
export const makeLivePreview = query({
  args: { organizationId: v.string(), projectId: v.string(), versionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      incomingNumber: v.number(),
      outgoingNumber: v.number(),
      lines: v.object({ incoming: v.number(), outgoing: v.number() }),
      carriedLines: v.number(),
      packedUnits: v.number(),
      notOnIncoming: v.number(),
      modelsWithDemandChange: v.number(),
      invoiceCount: v.number(),
      total: MONEY_PAIR,
      balance: MONEY_PAIR,
      truncated: v.boolean(),
    }),
  ),
  handler: async (ctx, { organizationId, projectId, versionId }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId || !project.liveVersionId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    if (versionId === project.liveVersionId) return null;
    const incoming = await loadVersionInProject(ctx, organizationId, projectId, versionId);
    const outgoing = await loadVersionInProject(ctx, organizationId, projectId, project.liveVersionId);

    const [inRows, outRows] = await Promise.all([
      versionRows(ctx, "projectLineItems", incoming.id),
      versionRows(ctx, "projectLineItems", outgoing.id),
    ]);
    const inLines = inRows.filter((l) => l.organizationId === organizationId && isPlannableLine(l));
    const outLines = outRows.filter((l) => l.organizationId === organizationId && isPlannableLine(l));
    const footprint = await realityFootprint(ctx, organizationId, outLines, new Set(inRows.map((l) => l.lineageId ?? l.id)));

    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    const [bundleIn, bundleOut] = await Promise.all([
      loadTotalsBundle(ctx, projectId, organizationId, taxRate, incoming.id),
      loadTotalsBundle(ctx, projectId, organizationId, taxRate, outgoing.id),
    ]);
    if (!bundleIn || !bundleOut) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    const totIn = computeTotals(bundleIn);
    const totOut = computeTotals(bundleOut);

    return {
      incomingNumber: incoming.number,
      outgoingNumber: outgoing.number,
      lines: { incoming: inLines.length, outgoing: outLines.length },
      carriedLines: footprint.carriedLines,
      packedUnits: footprint.packedUnits,
      notOnIncoming: footprint.notOnIncoming,
      modelsWithDemandChange: countModelsWithDemandChange(demandByModel(outLines), demandByModel(inLines)),
      // Invoices are project-level and stay as they are; the preview only says how many.
      invoiceCount: bundleOut.invoices.filter((i) => i.status !== "VOID").length,
      total: { before: totOut.total, after: totIn.total },
      balance: { before: totOut.total - totOut.invoicedTotal, after: totIn.total - totIn.invoicedTotal },
      truncated: footprint.truncated,
    };
  },
});

/** A line counts as planned when the PM planned it into a case, or any of its
 *  units is already physically in one (packed wins: `resolvePackingStatus`). */
async function isPlannedOrPacked(ctx: QueryCtx, orgId: string, line: Doc<"projectLineItems">): Promise<boolean> {
  if (line.plannedContainerId) return true;
  const { units } = await liveUnits(ctx, orgId, line.id);
  return units.some((u) => u.containerId);
}

async function plannedCount(ctx: QueryCtx, orgId: string, lines: Doc<"projectLineItems">[]): Promise<number> {
  let n = 0;
  for (const l of lines.slice(0, MAX_LINES_EXAMINED)) if (await isPlannedOrPacked(ctx, orgId, l)) n++;
  return n;
}

const ROW_FACTS = v.object({
  versionId: v.string(),
  lineCount: v.number(),
  plannedCount: v.number(),
  total: v.number(),
  /** The version's own quote, if any (derived status; `EXPIRED` is computed). */
  quoteStatus: v.union(v.string(), v.null()),
  /** Diff vs the next-older listed version; `null` for the oldest listed. */
  diff: v.union(
    v.null(),
    v.object({
      vsNumber: v.number(),
      added: v.number(),
      removed: v.number(),
      changed: v.number(),
      totalDelta: v.number(),
    }),
  ),
});

type RowFacts = Infer<typeof ROW_FACTS>;

/**
 * The Versions tab's per-row facts and its derived diff line against the
 * previous version (`vs v2: +2 lines · −1 line · 3 lines changed · +$1,970`).
 * Newest `MAX_VERSIONS_WITH_FACTS` versions only (filtered by org+project in
 * the index, ordered, THEN capped), `truncated` says older ones have no facts.
 */
export const versionRowFacts = query({
  args: { organizationId: v.string(), projectId: v.string(), now: v.optional(v.number()) },
  returns: v.object({ rows: v.array(ROW_FACTS), truncated: v.boolean() }),
  handler: async (ctx, { organizationId, projectId, now }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return { rows: [], truncated: false };

    const all = (await listProjectVersions(ctx, organizationId, projectId)).sort((a, b) => b.number - a.number);
    const versions = all.slice(0, MAX_VERSIONS_WITH_FACTS).filter((ver) => ver.contentState === "ready");
    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    const bundles = await Promise.all(versions.map((ver) => loadTotalsBundle(ctx, projectId, organizationId, taxRate, ver.id)));

    const rows: RowFacts[] = [];
    for (let i = 0; i < versions.length; i++) {
      const bundle = bundles[i];
      if (!bundle) continue;
      const ver = versions[i];
      const lines = bundle.projectLines.filter((l) => l.organizationId === organizationId && isPlannableLine(l));
      const quote = await findQuoteForVersion(ctx, organizationId, projectId, ver.id);
      const total = computeTotals(bundle).total;
      const prevBundle = bundles[i + 1];
      let diff: RowFacts["diff"] = null;
      if (prevBundle) {
        const states = classifyCompareRows(prevBundle, bundle).filter((r) => r.kind === "line");
        const count = (s: string) => states.filter((r) => r.state === s).length;
        diff = {
          vsNumber: versions[i + 1].number,
          added: count("added"),
          removed: count("removed"),
          changed: count("changed") + count("moved"),
          totalDelta: Math.round((total - computeTotals(prevBundle).total) * 100) / 100,
        };
      }
      rows.push({
        versionId: ver.id,
        lineCount: lines.length,
        plannedCount: await plannedCount(ctx, organizationId, lines),
        total,
        quoteStatus: quote ? effectiveQuoteStatus(quote, now ?? Date.now()) : null,
        diff,
      });
    }
    return { rows, truncated: all.length > MAX_VERSIONS_WITH_FACTS };
  },
});

export const agentOps: AgentOpsAnnotations = {
  makeLivePreview: {
    summary: "Counts-only preview of making a version live: lines, packed units carried, models whose demand changes, invoices, quote total and balance before and after.",
    danger: "low",
    mcpTier: 3,
  },
  versionRowFacts: {
    summary: "Per-version facts for the Versions tab: line and planned counts, total, quote status, and a derived diff against the previous version.",
    danger: "low",
    mcpTier: 3,
  },
};
