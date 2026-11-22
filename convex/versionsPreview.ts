import { v, ConvexError, type Infer } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import { listProjectVersions } from "./lib/projectVersionState";
import { isPackedUnit } from "./lib/packedUnit";
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

/**
 * Read budgets. Convex caps a query at 16,384 documents read, so the caps below
 * are on the TOTAL examined across the whole query (not per line or per
 * version), and every cap that bites sets `truncated` (or leaves a figure
 * `null`) rather than guessing. Each version's own totals bundle is read with
 * `loadTotalsBundle` (lines, groups, services, ...), so the versions-with-facts
 * count and the line budget are kept well under the ceiling together.
 */
const MAX_UNITS_EXAMINED = 2000;
const MAX_LINES_EXAMINED = 500;
/** Lines across every bundle `versionRowFacts` loads; the next version is skipped once spent. */
const MAX_BUNDLE_LINES = 2500;
/** Versions that get row facts (newest first); older rows render without them. */
const MAX_VERSIONS_WITH_FACTS = 6;
/** Of those, how many also get `plannedCount` (it reads units); the rest show `null`. */
const MAX_VERSIONS_WITH_PLANNED = 3;

/** A running allowance of documents one query may still read; `truncated` once it bites. */
class ReadBudget {
  truncated = false;
  constructor(public left: number) {}
  /** Reserve up to `want`; returns how many were granted (0 = spent). */
  take(want: number): number {
    const got = Math.max(0, Math.min(want, this.left));
    this.left -= got;
    if (got < want) this.truncated = true;
    return got;
  }
}

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

/** Non-cancelled units of a line, org-checked, drawn from the query's unit
 *  budget. `complete: false` means the budget ran out before this line's units
 *  were all read (so the caller must not treat the result as the whole truth). */
async function liveUnits(ctx: QueryCtx, orgId: string, lineItemId: string, budget: ReadBudget) {
  const granted = budget.take(1); // a line with no units still costs one probe
  if (granted === 0) return { units: [], complete: false };
  const room = budget.left + 1;
  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
    .take(room + 1);
  const complete = units.length <= room;
  budget.take(Math.min(units.length, room));
  if (!complete) budget.truncated = true;
  return { units: units.slice(0, room).filter((u) => u.organizationId === orgId && u.status !== "CANCELLED"), complete };
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
  budget: ReadBudget,
) {
  let carriedLines = 0;
  let packedUnits = 0;
  let notOnIncoming = 0;
  if (outgoing.length > MAX_LINES_EXAMINED) budget.truncated = true;
  for (const line of outgoing.slice(0, MAX_LINES_EXAMINED)) {
    const { units, complete } = await liveUnits(ctx, orgId, line.id, budget);
    if (!complete && units.length === 0) break; // budget spent: every count above is a floor, `truncated` says so
    if (units.length === 0) continue;
    carriedLines++;
    packedUnits += units.filter(isPackedUnit).length;
    if (!incomingLineages.has(line.lineageId ?? line.id)) notOnIncoming++;
  }
  return { carriedLines, packedUnits, notOnIncoming };
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

    // ONE read of each version's lines (the totals bundle already carries them), not
    // a second `versionRows` pass over the same documents.
    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    const [bundleIn, bundleOut] = await Promise.all([
      loadTotalsBundle(ctx, projectId, organizationId, taxRate, incoming.id),
      loadTotalsBundle(ctx, projectId, organizationId, taxRate, outgoing.id),
    ]);
    if (!bundleIn || !bundleOut) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    const inRows = bundleIn.projectLines.filter((l) => l.organizationId === organizationId);
    const outRows = bundleOut.projectLines.filter((l) => l.organizationId === organizationId);
    const inLines = inRows.filter(isPlannableLine);
    const outLines = outRows.filter(isPlannableLine);
    const budget = new ReadBudget(MAX_UNITS_EXAMINED);
    const footprint = await realityFootprint(ctx, organizationId, outLines, new Set(inRows.map((l) => l.lineageId ?? l.id)), budget);
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
      truncated: budget.truncated,
    };
  },
});

/** A line counts as planned when the PM planned it into a case, or any of its
 *  units is already physically in one (packed wins: `resolvePackingStatus`). */
async function isPlannedOrPacked(
  ctx: QueryCtx,
  orgId: string,
  line: Doc<"projectLineItems">,
  budget: ReadBudget,
): Promise<boolean | null> {
  if (line.plannedContainerId) return true; // no read needed
  const { units, complete } = await liveUnits(ctx, orgId, line.id, budget);
  if (units.some(isPackedUnit)) return true;
  return complete ? false : null; // not packed in what we could read, but we couldn't read it all
}

/** Planned-or-packed lines, or `null` when the read budget ran out or the job has
 *  more lines than we examine (an honest "unknown", never a guessed number). */
async function plannedCount(ctx: QueryCtx, orgId: string, lines: Doc<"projectLineItems">[], budget: ReadBudget): Promise<number | null> {
  if (lines.length > MAX_LINES_EXAMINED) {
    budget.truncated = true;
    return null;
  }
  let n = 0;
  for (const l of lines) {
    const planned = await isPlannedOrPacked(ctx, orgId, l, budget);
    if (planned === null) return null;
    if (planned) n++;
  }
  return n;
}

const ROW_FACTS = v.object({
  versionId: v.string(),
  lineCount: v.number(),
  /** `null` = not counted (a version beyond the newest few, or the read budget ran out). */
  plannedCount: v.union(v.number(), v.null()),
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
    const candidates = all.slice(0, MAX_VERSIONS_WITH_FACTS).filter((ver) => ver.contentState === "ready");
    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);

    // Load bundles ONE AT A TIME against a shared line budget, so a large job
    // stops after a version or two instead of reading past Convex's limit.
    const lineBudget = new ReadBudget(MAX_BUNDLE_LINES);
    const unitBudget = new ReadBudget(MAX_UNITS_EXAMINED);
    const versions: typeof candidates = [];
    const bundles: NonNullable<Awaited<ReturnType<typeof loadTotalsBundle>>>[] = [];
    for (const ver of candidates) {
      if (lineBudget.left <= 0) {
        lineBudget.truncated = true;
        break;
      }
      const bundle = await loadTotalsBundle(ctx, projectId, organizationId, taxRate, ver.id);
      if (!bundle) continue;
      lineBudget.take(bundle.projectLines.length);
      versions.push(ver);
      bundles.push(bundle);
    }

    const rows: RowFacts[] = [];
    for (let i = 0; i < versions.length; i++) {
      const bundle = bundles[i];
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
        plannedCount: i < MAX_VERSIONS_WITH_PLANNED ? await plannedCount(ctx, organizationId, lines, unitBudget) : null,
        total,
        quoteStatus: quote ? effectiveQuoteStatus(quote, now ?? Date.now()) : null,
        diff,
      });
    }
    // `truncated` = any version lacks full facts: older ones beyond the cap, a
    // version skipped when the line budget ran out, or a `plannedCount` we couldn't
    // finish (the planned count is skipped for all but the newest few by design,
    // which is why a long list is always "truncated").
    const truncated = all.length > MAX_VERSIONS_WITH_FACTS || lineBudget.truncated || unitBudget.truncated || rows.some((r) => r.plannedCount === null);
    return { rows, truncated };
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
