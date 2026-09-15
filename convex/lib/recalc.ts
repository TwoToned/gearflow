import type { MutationCtx } from "../_generated/server";
import { applyProjectAllocation } from "./allocation";
import { deriveBillingSummary } from "./billingDerivation";

/**
 * In-mutation project-totals recalculation (Phase 5, Option A — write-latency fix).
 *
 * A BYTE-FOR-BYTE port of src/server/line-items.ts `recalculateProjectTotals`, moved
 * inside the native write mutations so a line-item write is ONE backend-local Convex
 * round-trip instead of ~5 server→Convex-Cloud HTTP hops (the 6–12s write tail). All
 * inputs are Convex-native (groups/lines/services/assignments/sub-hires) EXCEPT the
 * org default tax rate — that lives in Postgres (`organization.defaultTaxRate`, no
 * Convex mirror writer), so the caller passes it (authoritative) as `orgDefaultTaxRate`.
 *
 * A convex-test (writeParity / recalcParity) proves this produces the same totals as
 * the server-side function for the same inputs — the money gate.
 */

const round = (v: number): number => Math.round(v * 100) / 100;
const num = (v: unknown): number => (v != null ? Number(v) : 0);

/** First value > 0 in priority order — the "resolved unit cost" chain (WS11
 *  #950): a null/0 value is skipped, never treated as a real $0 cost. */
function firstPositive(...vals: (number | null | undefined)[]): number {
  for (const v of vals) {
    const n = num(v);
    if (n > 0) return n;
  }
  return 0;
}

/**
 * WS11 (#950) — sum of `unitCost × quantity` across this project's non-cancelled,
 * non-optional SALE lines, where `unitCost` is the first positive value in
 * `asset.purchasePrice -> model.defaultPurchasePrice -> bulkAsset.purchasePricePerUnit
 * -> model.replacementCost` (spec-mandated chain order). Reads are batched:
 * one lookup per distinct referenced model/asset/bulkAsset, not per line.
 */
type SaleCostLine = {
  type?: string | null;
  status?: string | null;
  isOptional?: boolean | null;
  modelId?: string | null;
  assetId?: string | null;
  bulkAssetId?: string | null;
  quantity?: number | null;
};

/** Batch-fetch + dedupe the models/assets/bulkAssets a set of SALE lines
 *  reference — one lookup per distinct id, not per line. Split out of
 *  `computeSaleCostTotal` to keep its own cyclomatic complexity down. */
async function loadSaleCostRefs(ctx: MutationCtx, saleLines: SaleCostLine[]) {
  const modelIds = [...new Set(saleLines.map((li) => li.modelId).filter((v): v is string => !!v))];
  const assetIds = [...new Set(saleLines.map((li) => li.assetId).filter((v): v is string => !!v))];
  const bulkAssetIds = [...new Set(saleLines.map((li) => li.bulkAssetId).filter((v): v is string => !!v))];

  const [modelDocs, assetDocs, bulkAssetDocs] = await Promise.all([
    Promise.all(modelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
    Promise.all(assetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
    Promise.all(bulkAssetIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
  ]);
  return {
    modelById: new Map(modelDocs.filter((m): m is NonNullable<typeof m> => !!m).map((m) => [m.id, m])),
    assetById: new Map(assetDocs.filter((a): a is NonNullable<typeof a> => !!a).map((a) => [a.id, a])),
    bulkAssetById: new Map(bulkAssetDocs.filter((b): b is NonNullable<typeof b> => !!b).map((b) => [b.id, b])),
  };
}

const isCostedSaleLine = (li: SaleCostLine): boolean =>
  li.type === "SALE" && li.status !== "CANCELLED" && !li.isOptional;

/** One line's `unitCost × quantity` — split out of `computeSaleCostTotal` to
 *  keep its own cyclomatic complexity down. */
function saleLineCost(
  li: SaleCostLine,
  refs: Awaited<ReturnType<typeof loadSaleCostRefs>>,
): number {
  const asset = li.assetId ? refs.assetById.get(li.assetId) : undefined;
  const model = li.modelId ? refs.modelById.get(li.modelId) : undefined;
  const bulkAsset = li.bulkAssetId ? refs.bulkAssetById.get(li.bulkAssetId) : undefined;
  const unitCost = firstPositive(asset?.purchasePrice, model?.defaultPurchasePrice, bulkAsset?.purchasePricePerUnit, model?.replacementCost);
  return unitCost * Math.max(1, li.quantity ?? 1);
}

async function computeSaleCostTotal(ctx: MutationCtx, projectLines: SaleCostLine[]): Promise<number> {
  const saleLines = projectLines.filter(isCostedSaleLine);
  if (saleLines.length === 0) return 0;

  const refs = await loadSaleCostRefs(ctx, saleLines);
  return saleLines.reduce((total, li) => total + saleLineCost(li, refs), 0);
}

/** Org default tax rate from the orgSettings mirror (Postgres-authoritative). Shared by
 *  every native write mutation that needs it for recalcProjectTotals (project-services,
 *  crew-assignments, line-items) — one lookup, not a copy per write file. */
export async function orgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

// ─── T3 (#1091, docs/designs/tax-model.md §3) — tax contribution grouping ───
// Split out of recalcProjectTotals to keep its own cyclomatic complexity down
// (R-3.6). Each predicate below mirrors ONE of the exact filters already used
// for groupRevenue/standaloneRevenue/subHireGroupedRevenue/saleRevenue above —
// kept in sync deliberately, same byte-for-byte discipline as the rest of this
// file — so `Σ contributions.amount` reproduces `subtotal`.

type TaxableLine = {
  groupId?: string | null;
  subHireId?: string | null;
  isOptional?: boolean | null;
  isKitChild?: boolean | null;
  status?: string | null;
  type?: string | null;
  isCustomItem?: boolean | null;
  lineTotal?: number | null;
  taxRate?: number | null;
};
type TaxableGroup = { id: string; price?: number | null; quantity?: number | null; discount?: number | null };
type TaxContribution = { rate: number; amount: number };

const isActiveLine = (li: TaxableLine): boolean =>
  !li.isOptional && !li.isKitChild && li.status !== "CANCELLED";

const isGroupCustomExtra = (li: TaxableLine, groupId: string): boolean =>
  li.groupId === groupId && li.isCustomItem === true && isActiveLine(li);

const isStandaloneNonSale = (li: TaxableLine): boolean =>
  li.groupId == null && li.type !== "SALE" && isActiveLine(li);

const isGroupedSubHire = (li: TaxableLine): boolean =>
  li.groupId != null && li.subHireId != null && isActiveLine(li);

const isStandaloneSale = (li: TaxableLine): boolean =>
  li.groupId == null && li.type === "SALE" && isActiveLine(li);

/** One taxable-base contribution per revenue-bearing unit (§3.2). A priced
 *  group's bundle is one lump at the fallback rate (no per-group override
 *  exists, §3.4); its custom-item extras (unpriced groups only) get their
 *  own line's resolved rate. */
function buildTaxContributions(
  groups: TaxableGroup[],
  projectLines: TaxableLine[],
  resolveLineRate: (li: TaxableLine) => number,
  fallbackRate: number,
  serviceRevenue: number,
): TaxContribution[] {
  const contributions: TaxContribution[] = [];
  const contribute = (rate: number, amount: number): void => {
    if (amount !== 0) contributions.push({ rate, amount });
  };
  for (const g of groups) {
    const bundlePrice = num(g.price);
    if (bundlePrice > 0) {
      contribute(fallbackRate, Math.max(0, bundlePrice * (g.quantity ?? 0) - num(g.discount)));
    } else {
      for (const li of projectLines) {
        if (isGroupCustomExtra(li, g.id)) contribute(resolveLineRate(li), num(li.lineTotal));
      }
    }
  }
  for (const li of projectLines) {
    if (isStandaloneNonSale(li)) contribute(resolveLineRate(li), num(li.lineTotal));
    if (isGroupedSubHire(li)) contribute(resolveLineRate(li), num(li.lineTotal));
    if (isStandaloneSale(li)) contribute(resolveLineRate(li), num(li.lineTotal));
  }
  contribute(fallbackRate, serviceRevenue);
  return contributions;
}

/** §2.3/§5 status + amount resolution: EXEMPT (client flag) short-circuits
 *  everything; UNSET means nothing was configured ANYWHERE in the cascade
 *  (not even an explicit 0%); otherwise COMPUTED distributes the
 *  already-rounded taxableAmount proportionally by each contribution's share
 *  of subtotal, so a single-rate project reproduces the pre-T3 flat
 *  computation to the cent (the equivalence gate, recalc.test.ts). */
function computeTaxOutcome(params: {
  isExempt: boolean;
  anyRateConfigured: boolean;
  contributions: TaxContribution[];
  subtotal: number;
  taxableAmount: number;
}): { taxAmount: number; taxStatus: "EXEMPT" | "UNSET" | "COMPUTED"; breakdown: TaxContribution[] } {
  const { isExempt, anyRateConfigured, contributions, subtotal, taxableAmount } = params;
  if (isExempt) return { taxAmount: 0, taxStatus: "EXEMPT", breakdown: [] };
  if (!anyRateConfigured) return { taxAmount: 0, taxStatus: "UNSET", breakdown: [] };

  const discountFactor = subtotal > 0 ? taxableAmount / subtotal : 1;
  const baseByRate = new Map<number, number>();
  for (const c of contributions) {
    baseByRate.set(c.rate, (baseByRate.get(c.rate) ?? 0) + c.amount * discountFactor);
  }
  let taxAmount = 0;
  const breakdown: TaxContribution[] = [];
  for (const rate of [...baseByRate.keys()].sort((a, b) => b - a)) {
    const groupTax = round(baseByRate.get(rate)! * (rate / 100));
    taxAmount = round(taxAmount + groupTax);
    breakdown.push({ rate, amount: groupTax });
  }
  return { taxAmount, taxStatus: "COMPUTED", breakdown };
}

export async function recalcProjectTotals(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
  orgDefaultTaxRate: number | null,
  now: number,
): Promise<void> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  // Project gone (e.g. a delete that also removed it) — nothing to recalc.
  if (!project || project.organizationId !== orgId) return;

  const [groups, projectLines, allServices, assignments, allSubHires] = await Promise.all([
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  // 1. Equipment revenue from groups. A priced group's flat price is the WHOLE
  // total for everything inside it — custom items included — so they are NOT added
  // on top. Only when a group has no flat price do its custom items bill on their
  // own (a group used purely as an organiser), otherwise they'd vanish from the
  // invoice. Grouped GEAR never bills its own lineTotal either way.
  const groupRevenue = groups.reduce((sum, g) => {
    const bundlePrice = num(g.price);
    const customExtras =
      bundlePrice > 0
        ? 0
        : projectLines
            .filter(
              (li) =>
                li.groupId === g.id &&
                li.isCustomItem === true &&
                !li.isOptional &&
                !li.isKitChild &&
                li.status !== "CANCELLED",
            )
            .reduce((s, li) => s + num(li.lineTotal), 0);
    // Discount is a flat $ amount off the bundle total (#883) — same shape as
    // projectLineItems.discount, subtracted once (not per-unit), clamped at 0.
    const bundleTotal = Math.max(0, bundlePrice * (g.quantity ?? 0) - num(g.discount));
    return sum + bundleTotal + customExtras;
  }, 0);

  // 2. Standalone (ungrouped) line items — includes ungrouped custom items.
  // WS11 (#950) — SALE lines are excluded here: they roll into their own
  // `saleRevenue` bucket (2c below) so the P&L can report rental vs sale
  // revenue separately. A SALE line INSIDE a priced group still rides the
  // group's bundle price (1 above, unaffected) — the "no separate Sales
  // bucket" spec decision is a PDF/badge-only distinction, not a revenue one.
  const standaloneRevenue = projectLines
    .filter(
      (li) =>
        li.groupId == null && !li.isOptional && !li.isKitChild && li.status !== "CANCELLED" && li.type !== "SALE",
    )
    .reduce((sum, li) => sum + num(li.lineTotal), 0);

  // 2b. Sub-hire line items placed INTO a project group. A sub-hire carries its
  // OWN client charge, independent of the host group's bundle price — but the
  // group revenue in (1) only counts isCustomItem extras (and a priced group
  // zeroes them entirely), so a grouped sub-hire's charge would silently vanish.
  // Count each grouped sub-hire line's charge individually, mirroring how the
  // SAME line bills when ungrouped in (2). Kit-style children (isKitChild) are
  // excluded to avoid double-counting against their group parent's charge — the
  // identical exclusion (2) applies to ungrouped sub-hire groups. Kept
  // byte-for-byte in sync with src/server/line-items.ts.
  const subHireGroupedRevenue = projectLines
    .filter(
      (li) =>
        li.groupId != null &&
        li.subHireId != null &&
        !li.isOptional &&
        !li.isKitChild &&
        li.status !== "CANCELLED",
    )
    .reduce((sum, li) => sum + num(li.lineTotal), 0);

  const equipmentRevenue = round(groupRevenue + standaloneRevenue + subHireGroupedRevenue);

  // 2c. WS11 (#950) — sale revenue: standalone (ungrouped) SALE lines bill
  // individually into their own bucket, mirroring standaloneRevenue's shape
  // exactly (same filter, just `type === "SALE"` instead of excluded).
  const saleRevenue = round(
    projectLines
      .filter(
        (li) =>
          li.groupId == null && !li.isOptional && !li.isKitChild && li.status !== "CANCELLED" && li.type === "SALE",
      )
      .reduce((sum, li) => sum + num(li.lineTotal), 0),
  );

  // 2d. WS11 (#950) — sale COGS: the resolved unit-cost chain (asset.purchasePrice
  // -> model.defaultPurchasePrice -> bulkAsset.purchasePricePerUnit ->
  // model.replacementCost) times quantity, summed across this project's
  // non-cancelled, non-optional SALE lines — the cost row that makes sale
  // margin visible in the P&L panel (projectCosts.ts). Reads are batched +
  // deduplicated (one per referenced model/asset/bulkAsset), mirroring
  // applyProjectAllocation's model-read pattern below.
  const saleCostTotal = round(await computeSaleCostTotal(ctx, projectLines));

  // 3. Service financials (this project's non-CANCELLED rows).
  const services = allServices.filter(
    (s) => s.organizationId === orgId && s.status !== "CANCELLED",
  );
  const serviceCostTotal = round(services.reduce((sum, s) => sum + num(s.costTotal), 0));
  // Billable iff it has an actual charge — `lineTotal` is null/0 until a unitPrice
  // is typed or a crew charge rate auto-prices it, so a plain unconditional sum
  // already excludes an unpriced service (num() reads it as 0). No separate
  // "show on documents" gate (superseded — a priced service always bills).
  const serviceRevenue = round(services.reduce((sum, s) => sum + num(s.lineTotal), 0));

  // 4. Labour costs from crew assignments NOT already linked to a service — a
  // service-linked assignment's cost is rolled into its service's costTotal instead
  // (convex/lib/serviceCost.ts recalcServiceCostFromCrew, folded into serviceCostTotal
  // just above), so counting it again here would double it in `margin`. Only
  // standalone assignments (no serviceId — legacy or added outside any service) land
  // in labourCostTotal. See FEATUREDOCS/31 Rate Cascade / issue #796.
  const labourCostTotal = round(
    assignments.filter((a) => a.serviceId == null).reduce((sum, a) => sum + num(a.estimatedCost), 0),
  );

  // 5. Sub-hire costs (exclude CANCELLED/DRAFT).
  const subHires = allSubHires.filter((sh) => sh.status !== "CANCELLED" && sh.status !== "DRAFT");
  const subHireCostTotal = round(subHires.reduce((sum, sh) => sum + num(sh.totalCost), 0));

  // 6. Totals (equipment + billable services + WS11 #950 sale revenue).
  const subtotal = round(equipmentRevenue + serviceRevenue + saleRevenue);
  const discountPercent = num(project.discountPercent);
  const discountAmount = round(subtotal * (discountPercent / 100));
  const taxableAmount = round(subtotal - discountAmount);

  // T3 (#1091, docs/designs/tax-model.md §2) — an exempt client's projects
  // produce zero tax regardless of any project/line rate: a hard
  // short-circuit, never layered against the per-line/per-project resolution
  // below. `by_cuid` is global — org-checked like every other cross-table
  // lookup in this file.
  const client = project.clientId
    ? await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", project.clientId!)).first()
    : null;
  const isExempt = !!(client && client.organizationId === orgId && client.taxExempt);

  // §3.1 — per-line rate resolution: this line's own override wins, else the
  // project's rate, else the org default, else zero. No hardcoded fallback
  // rate (#1088) — a US org ships with no default tax rate by design (there
  // is no national rate), and nothing configured anywhere must produce zero
  // tax, not an invented Australian GST rate.
  const resolveLineRate = (li: { taxRate?: number | null }): number => {
    if (li.taxRate != null) return Number(li.taxRate);
    if (project.taxRate != null) return Number(project.taxRate);
    if (orgDefaultTaxRate != null) return Number(orgDefaultTaxRate);
    return 0;
  };
  // Groups and services have no rate field of their own (out of scope,
  // §3.4) — both always fall through to the project/org rate.
  const fallbackRate = resolveLineRate({ taxRate: null });

  const contributions = buildTaxContributions(groups, projectLines, resolveLineRate, fallbackRate, serviceRevenue);

  // "Nothing was ever configured anywhere in the cascade" — the ONLY
  // condition for UNSET (§2.3/§5). A project/org rate of an explicit 0, or a
  // line explicitly overridden to 0%, is a deliberate choice (COMPUTED),
  // not an absence.
  const anyRateConfigured =
    project.taxRate != null || orgDefaultTaxRate != null || projectLines.some((li) => li.taxRate != null);

  const { taxAmount, taxStatus, breakdown } = computeTaxOutcome({
    isExempt,
    anyRateConfigured,
    contributions,
    subtotal,
    taxableAmount,
  });
  const taxBreakdown = JSON.stringify(breakdown);

  const total = round(taxableAmount + taxAmount);
  // WS11 (#950) — saleCostTotal joins the cost side so a sale's margin (sale
  // price minus its COGS) is visible, same as every other cost bucket here.
  const margin = round(total - (serviceCostTotal + labourCostTotal + subHireCostTotal + saleCostTotal));

  // 6b. WS1 (#940) — depositPaid/invoicedTotal are DERIVED from this project's
  // own invoices (never hand-typed — see the schema.ts field comment).
  // Only ISSUED invoices count (a DRAFT hasn't been sent to the client yet;
  // VOID never happened) — invoicedTotal sums every ISSUED invoice's `total`
  // (DEPOSIT + BALANCE + FULL + CREDIT, so an issued credit correctly nets
  // the figure down); depositPaid is the DEPOSIT-kind subset. "Paid" here
  // means "invoiced" (Flow has no payment-collection signal in phase 1 — Xero
  // owns that; the phase-2 payment-status poll, once built, would separately
  // gate this on paymentStatus === "PAID" rather than presence).
  const invoices = await ctx.db.query("invoices").withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId)).collect();
  const issuedInvoices = invoices.filter((inv) => inv.status === "ISSUED");
  const invoicedTotal = round(issuedInvoices.reduce((sum, inv) => sum + num(inv.total), 0));
  const depositPaid = round(
    issuedInvoices.filter((inv) => inv.kind === "DEPOSIT").reduce((sum, inv) => sum + num(inv.total), 0),
  );

  await ctx.db.patch(project._id, {
    equipmentRevenue,
    saleRevenue,
    saleCostTotal,
    serviceCostTotal,
    labourCostTotal,
    subHireCostTotal,
    subtotal,
    discountAmount,
    taxAmount,
    taxBreakdown,
    taxStatus,
    total,
    margin,
    depositPaid,
    invoicedTotal,
    updatedAt: now,
  });

  // 7. Push the revenue we just booked down onto the gear that earned it, so
  // per-model ROI is answerable. Deliberately hung off recalc rather than given
  // its own trigger list: every line-item / group / service / sub-hire write in
  // the app already funnels through here, so there is no write path that can
  // forget to allocate. Reuses the groups/lines already read above; line patches
  // are diffed, so an edit that moves no allocation costs no writes.
  // See convex/lib/allocation.ts + docs/revenue-allocation-design.md.
  // #943: allocation's weekly-vs-daily rate-scale choice now reads the project's
  // DERIVED billing weeks (rentalStartDate/rentalEndDate, or the manual override)
  // instead of the retired `defaultRentalPeriod` field — same "> 0 means weekly
  // scale" role the old `rentalPeriod === "WEEKLY"` check played.
  const billingSummary = deriveBillingSummary({
    rentalStartMs: project.rentalStartDate,
    rentalEndMs: project.rentalEndDate,
    weeksOverride: project.billingWeeksOverride,
    daysOverride: project.billingDaysOverride,
  });
  await applyProjectAllocation(ctx, {
    projectId,
    orgId,
    billingWeeks: billingSummary.weeks,
    // Allocate what was BILLED, not what was listed: the project discount above
    // never reached the group/line prices the allocation pass reads.
    discountPercent,
    groups,
    lines: projectLines,
    now,
  });
}
