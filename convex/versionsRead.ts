import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import { listProjectVersions } from "./lib/projectVersionState";
import { pickPlanFields } from "./lib/versionPlanFields";
import { PLAN_FIELDS, type PlanFieldName } from "./lib/versionPlanFields";
import { loadTotalsBundle, computeTotals, type TotalsBundle } from "./lib/recalc";
import { versionRows } from "./lib/versionScope";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { effectiveQuoteStatus, findQuoteForVersion, isLiveQuoteStatus, quoteLabel } from "./lib/quoteState";
import { classifyCompareRows, buildMoneyBridge, assertBridgeIntegrity, type CompareRow, type BridgeSegment } from "./lib/versionCompare";
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

// ─── Compare mode (#1232, Phase 5b, parent #1221, design §5.1 D46-D53) ────

/**
 * A comparison side is either a real `projectVersions` row (the general
 * "compare v3 to v4" case — the switcher's Compare menu item, the make-live
 * dialog reuse) or a sent quote's frozen MONEY snapshot (the drift-signal
 * entry point, `VersionStrip`'s "Quote total has moved..." line). The two
 * are NOT symmetric: a `quoteSnapshot` side carries only `quotes.snapshot`'s
 * four totals fields, never row-level data — see the file-level comment on
 * `loadQuoteSnapshotSide` below for why row-level drift-vs-current diffing
 * is deliberately NOT attempted (a real, documented scope limit, not an
 * oversight).
 */
const SIDE_REF = v.union(
  v.object({ kind: v.literal("version"), versionId: v.string() }),
  v.object({ kind: v.literal("quoteSnapshot"), quoteId: v.string() }),
);

const TOTALS_SUMMARY = v.object({
  subtotal: v.number(),
  discountAmount: v.number(),
  taxAmount: v.number(),
  total: v.number(),
});

const SIDE_SUMMARY = v.object({
  kind: v.union(v.literal("version"), v.literal("quoteSnapshot")),
  label: v.string(),
  versionId: v.optional(v.string()),
  versionNumber: v.optional(v.number()),
  quoteId: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  totals: TOTALS_SUMMARY,
});

const ROW_SNAPSHOT = v.object({
  id: v.string(),
  label: v.string(),
  quantity: v.union(v.number(), v.null()),
  unitPrice: v.union(v.number(), v.null()),
  discount: v.union(v.number(), v.null()),
  lineTotal: v.number(),
  categoryId: v.union(v.string(), v.null()),
  groupId: v.union(v.string(), v.null()),
  status: v.optional(v.string()),
});

const COMPARE_ROW = v.object({
  key: v.string(),
  kind: v.union(v.literal("line"), v.literal("group"), v.literal("service")),
  state: v.union(v.literal("unchanged"), v.literal("changed"), v.literal("added"), v.literal("removed"), v.literal("moved")),
  categoryLabel: v.optional(v.string()),
  movedFromCategoryLabel: v.optional(v.string()),
  alsoRepriced: v.optional(v.boolean()),
  a: v.union(v.null(), ROW_SNAPSHOT),
  b: v.union(v.null(), ROW_SNAPSHOT),
});

const BRIDGE_SEGMENT = v.object({
  key: v.string(),
  state: v.string(),
  label: v.string(),
  detail: v.optional(v.string()),
  amount: v.number(),
  rowKeys: v.array(v.string()),
});

/** Category id -> name, merged across however many `version` sides are in
 *  play (a `quoteSnapshot` side has no categories of its own). */
function categoryLabelResolver(categoryMaps: Map<string, string>[]): (id: string | null) => string | undefined {
  const merged = new Map<string, string>();
  for (const m of categoryMaps) for (const [k, val] of m) merged.set(k, val);
  return (id) => (id == null ? undefined : merged.get(id));
}

async function loadVersionSide(
  ctx: QueryCtx,
  organizationId: string,
  projectId: string,
  versionId: string,
  orgDefaultTaxRate: number | null,
): Promise<{ bundle: TotalsBundle; version: Doc<"projectVersions">; categoryNames: Map<string, string> }> {
  const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
  if (!version || version.organizationId !== organizationId || version.projectId !== projectId) {
    throw new ConvexError(`compareVersions: version not found or cross-org/project: ${versionId}`);
  }
  const bundle = await loadTotalsBundle(ctx, projectId, organizationId, orgDefaultTaxRate, versionId);
  if (!bundle) throw new ConvexError("compareVersions: project not found");
  const categories = await versionRows(ctx, "projectCategories", versionId);
  return { bundle, version, categoryNames: new Map(categories.map((c) => [c.id, c.name])) };
}

/**
 * The `quoteSnapshot` side — the drift entry point (`VersionStrip`'s "Quote
 * total has moved..." line, D53). `quotes.snapshot` (`buildQuoteSnapshot`,
 * `convex/quotesWrites.ts`) freezes only the four TOTALS fields
 * (subtotal/discountAmount/taxAmount/total), never a per-row breakdown.
 *
 * Deliberately NOT reconstructed from `projectSnapshots`/
 * `projectSnapshotEntries` (the older, `reason: "QUOTE_SENT"` capture
 * `sendNative` also writes): that mechanism captures the LIVE version's rows
 * at send time (`collectCurrentEntries`'s own comment: "captures/restores
 * the project's CURRENT LIVE plan only"), regardless of which version the
 * quote actually targeted (#1233 Phase 6 made sending a NON-live version's
 * quote possible). For a quote sent while its own version wasn't live, that
 * capture would silently describe a DIFFERENT version's rows — a wrong,
 * misleading row-level diff is worse than no row-level diff. So this side
 * carries totals only, and `compareVersions` renders it as a single
 * bridge segment (the whole delta, unattributed to individual rows) rather
 * than guessing.
 */
async function loadQuoteSnapshotSide(
  ctx: QueryCtx,
  organizationId: string,
  projectId: string,
  quoteId: string,
): Promise<{ quote: Doc<"quotes">; totals: { subtotal: number; discountAmount: number; taxAmount: number; total: number } }> {
  const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", quoteId)).first();
  if (!quote || quote.organizationId !== organizationId || quote.projectId !== projectId) {
    throw new ConvexError(`compareVersions: quote not found or cross-org/project: ${quoteId}`);
  }
  const snap = (quote.snapshot ?? {}) as { subtotal?: number; discountAmount?: number; taxAmount?: number; total?: number };
  return {
    quote,
    totals: {
      subtotal: Number(snap.subtotal) || 0,
      discountAmount: Number(snap.discountAmount) || 0,
      taxAmount: Number(snap.taxAmount) || 0,
      total: Number(snap.total) || 0,
    },
  };
}

function stateLabel(state: string): string {
  switch (state) {
    case "added": return "Added";
    case "removed": return "Removed";
    case "changed": return "Repriced";
    case "moved": return "Moved";
    case "planField": return "Plan change";
    default: return state;
  }
}

const PLAN_FIELD_DISPLAY_NAME: Partial<Record<PlanFieldName, string>> = {
  discountPercent: "Discount",
  taxRate: "Tax rate",
  clientId: "Client",
};

function pluralLines(n: number): string {
  return `${n} line${n === 1 ? "" : "s"}`;
}

function planFieldSegmentLabel(seg: BridgeSegment): { label: string; detail?: string } {
  const name = seg.planField ? (PLAN_FIELD_DISPLAY_NAME[seg.planField as PlanFieldName] ?? seg.planField) : "Plan change";
  return { label: name, detail: "plan field" };
}

function serviceSegmentLabel(seg: BridgeSegment): { label: string; detail?: string } {
  return { label: `Labour — ${stateLabel(seg.state)}`, detail: pluralLines(seg.rowKeys.length) };
}

function categorySegmentLabel(seg: BridgeSegment, categoryLabel: (id: string | null) => string | undefined, rowsByKey: Map<string, CompareRow>): { label: string; detail?: string } {
  const cat = categoryLabel(seg.categoryId) ?? "Uncategorized";
  const rows = seg.rowKeys.map((k) => rowsByKey.get(k)).filter((r): r is CompareRow => !!r);
  const singleLabel = rows.length === 1 ? (rows[0].b?.label ?? rows[0].a?.label) : undefined;
  return {
    label: singleLabel ?? `${cat} — ${stateLabel(seg.state)}`,
    detail: `${cat} · ${stateLabel(seg.state).toLowerCase()} · ${pluralLines(seg.rowKeys.length)}`,
  };
}

function formatSegment(seg: BridgeSegment, categoryLabel: (id: string | null) => string | undefined, rowsByKey: Map<string, CompareRow>): { label: string; detail?: string } {
  if (seg.state === "planField") return planFieldSegmentLabel(seg);
  if (seg.kind === "service") return serviceSegmentLabel(seg);
  return categorySegmentLabel(seg, categoryLabel, rowsByKey);
}

/**
 * The single new Convex read Phase 5b adds. SERVER-SIDE by deliberate
 * choice (see FEATUREDOCS/78's Phase 5b section for the full justification):
 * the exactness invariant (`sum(segments) === totalB - totalA`) is only
 * provable against the SAME `computeTotals`/`loadTotalsBundle` this query
 * already runs server-side for every other totals path in this codebase —
 * shipping the row data to the client and re-deriving totals there would be
 * a second, unproven copy of that arithmetic (R-3.1), and `total` genuinely
 * needs full line-item data for BOTH sides plus org-checked reads
 * (`by_cuid`/`by_versionId` are global indexes) that a browser client has no
 * business doing twice. One round trip, one place the exactness proof lives.
 */
export const compareVersions = query({
  args: { organizationId: v.string(), projectId: v.string(), a: SIDE_REF, b: SIDE_REF },
  returns: v.object({
    a: SIDE_SUMMARY,
    b: SIDE_SUMMARY,
    /** `null` when either side is a `quoteSnapshot` — no per-row data to
     *  diff (see `loadQuoteSnapshotSide`'s comment). */
    rows: v.union(v.null(), v.array(COMPARE_ROW)),
    bridge: v.object({ totalA: v.number(), totalB: v.number(), segments: v.array(BRIDGE_SEGMENT) }),
    /** Non-money PLAN FIELDS that differ (dates, notes, client contact, …) —
     *  informational only; they never move `total` (see
     *  `convex/lib/versionCompare.ts`'s header), so they carry no bridge
     *  segment of their own. `null` when either side is a `quoteSnapshot`
     *  (no version row on that side to diff plan fields against). */
    planFieldChanges: v.union(v.null(), v.array(v.object({ field: v.string(), aValue: v.any(), bValue: v.any() }))),
  }),
  handler: async (ctx, { organizationId, projectId, a, b }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) {
      throw new ConvexError("compareVersions: project not found");
    }
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);

    if (a.kind === "version" && b.kind === "version") {
      const [sideA, sideB] = await Promise.all([
        loadVersionSide(ctx, organizationId, projectId, a.versionId, orgDefaultTaxRate),
        loadVersionSide(ctx, organizationId, projectId, b.versionId, orgDefaultTaxRate),
      ]);
      const rows = classifyCompareRows(sideA.bundle, sideB.bundle);
      const bridge = buildMoneyBridge(sideA.bundle, sideB.bundle, rows);
      assertBridgeIntegrity(bridge); // fail loudly rather than render a bridge that doesn't sum

      const catLabel = categoryLabelResolver([sideA.categoryNames, sideB.categoryNames]);
      const rowsByKey = new Map(rows.map((r) => [r.key, r]));

      const planFieldChanges = PLAN_FIELDS.filter((field) => {
        const aVal = (sideA.bundle.project as Record<string, unknown>)[field];
        const bVal = (sideB.bundle.project as Record<string, unknown>)[field];
        return (aVal ?? null) !== (bVal ?? null);
      }).map((field) => ({
        field,
        aValue: (sideA.bundle.project as Record<string, unknown>)[field] ?? null,
        bValue: (sideB.bundle.project as Record<string, unknown>)[field] ?? null,
      }));

      const totalsOf = (bundle: TotalsBundle) => {
        const t = computeTotals(bundle);
        return { subtotal: t.subtotal, discountAmount: t.discountAmount, taxAmount: t.taxAmount, total: t.total };
      };

      return {
        a: {
          kind: "version" as const,
          label: `v${sideA.version.number}${sideA.version.label ? ` · ${sideA.version.label}` : ""}`,
          versionId: sideA.version.id,
          versionNumber: sideA.version.number,
          totals: totalsOf(sideA.bundle),
        },
        b: {
          kind: "version" as const,
          label: `v${sideB.version.number}${sideB.version.label ? ` · ${sideB.version.label}` : ""}`,
          versionId: sideB.version.id,
          versionNumber: sideB.version.number,
          totals: totalsOf(sideB.bundle),
        },
        rows: rows.map((r) => ({
          key: r.key,
          kind: r.kind,
          state: r.state,
          categoryLabel: r.kind === "service" ? "Labour" : catLabel(r.b?.categoryId ?? r.a?.categoryId ?? null),
          movedFromCategoryLabel: r.movedFromCategoryId !== undefined ? (catLabel(r.movedFromCategoryId) ?? "Uncategorized") : undefined,
          alsoRepriced: r.alsoRepriced,
          a: r.a,
          b: r.b,
        })),
        bridge: {
          totalA: bridge.totalA,
          totalB: bridge.totalB,
          segments: bridge.segments.map((seg) => ({
            key: seg.key,
            state: seg.state,
            ...formatSegment(seg, catLabel, rowsByKey),
            amount: seg.amount,
            rowKeys: seg.rowKeys,
          })),
        },
        planFieldChanges,
      };
    }

    // At least one side is a `quoteSnapshot` — the drift entry point.
    // Degraded, totals-only comparison (see `loadQuoteSnapshotSide`).
    const resolveSide = async (side: typeof a) => {
      if (side.kind === "version") {
        const s = await loadVersionSide(ctx, organizationId, projectId, side.versionId, orgDefaultTaxRate);
        return {
          summary: {
            kind: "version" as const,
            label: `v${s.version.number}${s.version.label ? ` · ${s.version.label}` : ""}`,
            versionId: s.version.id,
            versionNumber: s.version.number,
            totals: computeTotals(s.bundle),
          },
        };
      }
      const s = await loadQuoteSnapshotSide(ctx, organizationId, projectId, side.quoteId);
      return {
        summary: {
          kind: "quoteSnapshot" as const,
          label: quoteLabel(project.projectNumber, s.quote.version),
          quoteId: s.quote.id,
          sentAt: s.quote.sentAt,
          totals: s.totals,
        },
      };
    };
    const [sideA, sideB] = await Promise.all([resolveSide(a), resolveSide(b)]);
    const totalA = sideA.summary.totals.total;
    const totalB = sideB.summary.totals.total;
    const delta = Math.round((totalB - totalA) * 100) / 100;

    return {
      a: { ...sideA.summary, totals: { subtotal: sideA.summary.totals.subtotal, discountAmount: sideA.summary.totals.discountAmount, taxAmount: sideA.summary.totals.taxAmount, total: sideA.summary.totals.total } },
      b: { ...sideB.summary, totals: { subtotal: sideB.summary.totals.subtotal, discountAmount: sideB.summary.totals.discountAmount, taxAmount: sideB.summary.totals.taxAmount, total: sideB.summary.totals.total } },
      rows: null,
      bridge: {
        totalA,
        totalB,
        segments:
          delta === 0
            ? []
            : [{ key: "since-sent", state: "snapshotOnly", label: `Since ${sideA.summary.kind === "quoteSnapshot" ? sideA.summary.label : sideB.summary.label} was sent`, detail: "row-level breakdown isn't available for a sent snapshot", amount: delta, rowKeys: [] }],
      },
      planFieldChanges: null,
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
  compareVersions: {
    summary: "Row-level diff + exact money bridge between two project versions (or a sent quote's snapshot and a version), for Compare mode.",
    danger: "low",
    mcpTier: 3,
  },
};
