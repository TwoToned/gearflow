import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireService, requireOrgReadFor } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import {
  resolveEquipmentAccountCode,
  resolveModelOrKitAccountCode,
  resolveServiceAccountCode,
  resolveTaxType,
  serviceAccountDefaultKeyForType,
  type ServiceAccountDefaultKey,
} from "./lib/xeroAccountCascade";

/**
 * Xero push-time coding resolution (WS1 #940) — service-only (called from
 * `src/server/xero.ts` pushInvoiceToXero). Resolving the account/tax cascade
 * needs several DB reads (invoiceLines -> their source line/service ->
 * model/kit/category -> the org's xeroIntegrations config); doing this in ONE
 * Convex query is a single round trip instead of N HTTP hops from the server
 * action, and keeps the actual resolution logic testable independent of the
 * Xero API client (the pure functions in xeroAccountCascade.ts do the real
 * work — this file is just the DB-read plumbing around them).
 *
 * NOTE (ambiguity resolved — see PR description): this rental-only app has no
 * live SALE line-item workflow yet (WS11/#950), so every equipment line here
 * resolves via the RENTAL side of the model cascade
 * (models.xeroRentalAccountCode) — resolveModelOrKitAccountCode's SALE branch
 * is unit-tested but unreachable from this caller until #950 lands.
 */

export interface ResolvedInvoiceLine {
  lineId: string;
  accountCode: string | null;
  taxType: string | null;
}

type Ctx = QueryCtx;

/** Resolve one EQUIPMENT invoice line's account/tax code — split out of
 *  resolveCodingForInvoice's handler purely to keep that function's
 *  complexity manageable (R-3.6); no behaviour change from having it inline. */
async function resolveEquipmentLineCode(
  ctx: Ctx,
  sourceLineItemId: string,
  orgId: string,
  orgDefaultCode: string | null,
  orgDefaultTaxType: string | null,
): Promise<{ accountCode: string | null; taxType: string | null }> {
  const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", sourceLineItemId)).first();
  if (!li || li.organizationId !== orgId) return { accountCode: null, taxType: null };

  const isKitParent = !!li.kitId && !li.isKitChild;
  let modelOrKitCode: string | null = null;
  if (isKitParent && li.kitId) {
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", li.kitId!)).first();
    modelOrKitCode = kit && kit.organizationId === orgId ? resolveModelOrKitAccountCode({ isKitParent: true, lineKind: "RENTAL", kitCode: kit.xeroAccountCode }) : null;
  } else if (li.modelId) {
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", li.modelId!)).first();
    modelOrKitCode = model && model.organizationId === orgId
      ? resolveModelOrKitAccountCode({ isKitParent: false, lineKind: "RENTAL", modelRentalCode: model.xeroRentalAccountCode, modelSaleCode: model.xeroSaleAccountCode })
      : null;
  }

  let categoryCode: string | null = null;
  if (li.categoryId) {
    const category = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", li.categoryId!)).first();
    categoryCode = category && category.organizationId === orgId ? (category.xeroAccountCode ?? null) : null;
  }

  return {
    accountCode: resolveEquipmentAccountCode({ lineOverride: li.xeroAccountCode, modelOrKitCode, categoryCode, orgDefaultCode }),
    taxType: resolveTaxType({ lineOverride: li.xeroTaxType, orgDefaultTaxType }),
  };
}

/** Resolve one GROUP invoice line's account/tax code — a priced group bills
 *  as its own line (financeSnapshot.ts). A group isn't a model/kit, so its
 *  cascade skips straight from the line override to its category default:
 *  group override -> category default -> org default. Reuses
 *  resolveEquipmentAccountCode with modelOrKitCode: null (level 2 always
 *  absent) rather than a bespoke 2-level function. */
async function resolveGroupLineCode(
  ctx: Ctx,
  sourceLineItemId: string,
  orgId: string,
  orgDefaultCode: string | null,
  orgDefaultTaxType: string | null,
): Promise<{ accountCode: string | null; taxType: string | null }> {
  const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", sourceLineItemId)).first();
  if (!group || group.organizationId !== orgId) return { accountCode: orgDefaultCode, taxType: orgDefaultTaxType };

  let categoryCode: string | null = null;
  if (group.categoryId) {
    const category = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", group.categoryId!)).first();
    categoryCode = category && category.organizationId === orgId ? (category.xeroAccountCode ?? null) : null;
  }

  return {
    accountCode: resolveEquipmentAccountCode({ lineOverride: group.xeroAccountCode, modelOrKitCode: null, categoryCode, orgDefaultCode }),
    taxType: resolveTaxType({ lineOverride: group.xeroTaxType, orgDefaultTaxType }),
  };
}

/** Resolve one SERVICE invoice line's account/tax code — same split-out rationale. */
async function resolveServiceLineCode(
  ctx: Ctx,
  sourceLineItemId: string,
  orgId: string,
  serviceDefaults: Partial<Record<ServiceAccountDefaultKey, string>>,
  orgDefaultCode: string | null,
  orgDefaultTaxType: string | null,
): Promise<{ accountCode: string | null; taxType: string | null }> {
  const svc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", sourceLineItemId)).first();
  if (!svc || svc.organizationId !== orgId) return { accountCode: null, taxType: null };
  const key = serviceAccountDefaultKeyForType(svc.type);
  return {
    accountCode: resolveServiceAccountCode({ lineOverride: svc.xeroAccountCode, serviceTypeDefault: serviceDefaults[key], orgDefaultCode }),
    taxType: resolveTaxType({ lineOverride: svc.xeroTaxType, orgDefaultTaxType }),
  };
}

/** Dispatch one invoice line to its source-type resolver (or the org default
 *  for CUSTOM lines, which have no backing entity to resolve coding from). */
async function resolveOneLine(
  ctx: Ctx,
  line: { sourceType: string; sourceLineItemId?: string },
  orgId: string,
  orgDefaultCode: string | null,
  orgDefaultTaxType: string | null,
  serviceDefaults: Partial<Record<ServiceAccountDefaultKey, string>>,
): Promise<{ accountCode: string | null; taxType: string | null }> {
  if (line.sourceType === "EQUIPMENT" && line.sourceLineItemId) {
    return resolveEquipmentLineCode(ctx, line.sourceLineItemId, orgId, orgDefaultCode, orgDefaultTaxType);
  }
  if (line.sourceType === "SERVICE" && line.sourceLineItemId) {
    return resolveServiceLineCode(ctx, line.sourceLineItemId, orgId, serviceDefaults, orgDefaultCode, orgDefaultTaxType);
  }
  if (line.sourceType === "GROUP" && line.sourceLineItemId) {
    return resolveGroupLineCode(ctx, line.sourceLineItemId, orgId, orgDefaultCode, orgDefaultTaxType);
  }
  // CUSTOM (deposit/balance/credit summary lines — no backing entity) — org default only.
  return { accountCode: orgDefaultCode, taxType: orgDefaultTaxType };
}

export const resolveCodingForInvoice = query({
  args: { invoiceId: v.string(), orgId: v.string() },
  returns: v.object({
    lines: v.array(v.object({ lineId: v.string(), accountCode: v.union(v.string(), v.null()), taxType: v.union(v.string(), v.null()) })),
    /** Non-null when a line's resolved TaxType implies a materially different
     *  total than Flow's own project-rate math — surfaced on the push preview,
     *  never silently divergent (spec requirement). */
    varianceNote: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { invoiceId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "invoice"); // Phase 5 domain slice (#1001)

    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
    if (!invoice || invoice.organizationId !== orgId) {
      throw new ConvexError("Invoice not found: " + invoiceId);
    }
    const integration = await ctx.db.query("xeroIntegrations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).unique();
    const orgDefaultCode = integration?.defaultAccountCode ?? null;
    const orgDefaultTaxType = integration?.defaultTaxType ?? null;
    const serviceDefaults = (integration?.serviceAccountDefaults ?? {}) as Partial<Record<ServiceAccountDefaultKey, string>>;

    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId)).collect();

    const resolved: ResolvedInvoiceLine[] = [];
    let taxImpliedTotal = 0;
    let flowTotal = 0;

    for (const line of lines) {
      flowTotal += line.lineTotal;
      const { accountCode, taxType } = await resolveOneLine(ctx, line, orgId, orgDefaultCode, orgDefaultTaxType, serviceDefaults);
      resolved.push({ lineId: line.id, accountCode, taxType });

      // Rough variance signal: a line whose resolved TaxType differs from the
      // org default implies a different effective rate than Flow's uniform
      // project-rate math baked the total with. We don't have the Xero tax
      // rate's numeric % cached per-line here (only the code) — the real %
      // comparison happens client-side against cachedTaxRates on the push
      // preview; this just flags WHICH lines diverge for that UI to show.
      if (taxType && orgDefaultTaxType && taxType !== orgDefaultTaxType) {
        taxImpliedTotal += 1;
      }
    }

    const varianceNote =
      taxImpliedTotal > 0
        ? `${taxImpliedTotal} line(s) use a Xero tax type that differs from the org default GST mapping — verify the totals still match Flow's project-rate math before approving in Xero.`
        : null;

    void flowTotal;
    return { lines: resolved, varianceNote };
  },
});

export const applyXeroPushResultNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    invoiceId: v.string(),
    orgId: v.string(),
    xeroInvoiceId: v.string(),
    resolvedLines: v.array(v.object({ lineId: v.string(), accountCode: v.union(v.string(), v.null()), taxType: v.union(v.string(), v.null()) })),
    now: v.number(),
  },
  handler: async (ctx, { invoiceId, orgId, xeroInvoiceId, resolvedLines, now }) => {
    await requireService(ctx);
    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
    if (!invoice || invoice.organizationId !== orgId) throw new ConvexError("Invoice not found: " + invoiceId);

    await ctx.db.patch(invoice._id, { xeroInvoiceId, xeroSyncStatus: "SYNCED", lastSyncError: undefined, updatedAt: now });

    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId)).collect();
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const r of resolvedLines) {
      const line = byId.get(r.lineId);
      if (!line) continue;
      await ctx.db.patch(line._id, { xeroAccountCode: r.accountCode ?? undefined, xeroTaxType: r.taxType ?? undefined });
    }

    return { id: invoiceId };
  },
});

export const markXeroPushFailedNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { invoiceId: v.string(), orgId: v.string(), error: v.string(), now: v.number() },
  handler: async (ctx, { invoiceId, orgId, error, now }) => {
    await requireService(ctx);
    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
    if (!invoice || invoice.organizationId !== orgId) throw new ConvexError("Invoice not found: " + invoiceId);
    await ctx.db.patch(invoice._id, { xeroSyncStatus: "ERROR", lastSyncError: error, updatedAt: now });
    return { id: invoiceId };
  },
});

/** Best-effort activity-log write for a Xero push, callable from the server
 *  action after either a success or a caught failure. `updated` distinguishes
 *  a re-push (the invoice already had a `xeroInvoiceId` — the same Xero
 *  invoice was edited in place) from the first push (a new Xero invoice was
 *  created), so the activity feed reads correctly either way. */
export const logXeroPushActivity = mutation({
  args: {
    organizationId: v.string(),
    invoiceId: v.string(),
    invoiceLabel: v.string(),
    success: v.boolean(),
    updated: v.optional(v.boolean()),
    detail: v.optional(v.string()),
    actorUserId: v.string(),
    actorUserName: v.string(),
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, invoiceId, invoiceLabel, success, updated, detail, actorUserId, actorUserName, auditId, now }) => {
    await requireService(ctx);
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "UPDATE",
      entityType: "invoice",
      entityId: invoiceId,
      entityName: invoiceLabel,
      userId: actorUserId,
      userName: actorUserName,
      summary: success
        ? updated
          ? `Updated ${invoiceLabel} in Xero`
          : `Pushed ${invoiceLabel} to Xero as a draft invoice`
        : `Xero push failed for ${invoiceLabel}${detail ? `: ${detail}` : ""}`,
      createdAt: now,
    });
  },
});

/**
 * Agent-op annotations (Phase 5, #1001). `resolveCodingForInvoice` widened —
 * returns only account codes / tax types / a variance note, no credentials.
 * The three mutations are untouched (out of this triage's scope; still
 * requireService-only).
 */
export const agentOps: AgentOpsAnnotations = {
  resolveCodingForInvoice: { summary: "Resolve Xero account/tax coding for one invoice's lines (push preview).", danger: "low", mcpTier: 3 },
};
