import { createId } from "@paralleldrive/cuid2";
import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { buildFinanceLines } from "./lib/financeSnapshot";
import { recalcProjectTotals, orgDefaultTaxRate } from "./lib/recalc";
import { reserveProjectNumberCounter } from "./lib/projectNumberCounter";
import { renderProjectNumber, scopeKeyFor, type IncrementReset, type ProjectNumberDateParts } from "./lib/projectNumber";
import { resolveOrgInvoiceConfig } from "./lib/orgSettings";
import { computeDueDate } from "./lib/invoiceDates";
import { startOfDayInTimezone } from "./lib/quoteDates";
import { projectLiveRevision } from "./lib/quoteState";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Invoice write mutations (WS1 #940) — browser-direct, standard 4-guard shape.
 *
 * `createNative` builds a DRAFT invoice + its `invoiceLines` from the
 * project's CURRENT pricing (server-computed via `buildFinanceLines`, never
 * client-supplied money — R-9.3). `issueNative` assigns the invoice number
 * (the ONLY numbering moment — drafts stay unnumbered) using the SAME
 * project-number engine (convex/lib/projectNumber.ts, zero engine change),
 * namespaced under an "INV:<period>" scopeKey so the invoice counter never
 * collides with the project-number counter in the shared
 * `projectNumberSequences` table. `voidNative` marks an ISSUED invoice VOID
 * (immutable once issued — a correction is VOID + reissue, or a CREDIT
 * invoice via `createCreditNative`).
 *
 * Coding (xeroAccountCode/xeroTaxType) is intentionally NOT resolved here —
 * it's resolved server-side at PUSH time (src/server/xero.ts
 * pushInvoiceToXero, using convex/lib/xeroAccountCascade.ts) and snapshotted
 * onto invoiceLines then, so an issued invoice's coding never silently
 * changes when a model/kit/category mapping is edited later.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Any date a client may stamp on an invoice at issue — mirrors `DATE_BOUNDS` in
 *  `quotesWrites.ts` (≤ 2100-01-01), so a typo'd year can't mint a due date
 *  centuries out. */
const DATE_BOUNDS = { min: 0, max: 4_102_444_800_000 } as const;

function assertInvoiceFields(f: { notes?: string; voidReason?: string }): void {
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertStrLen(f.voidReason, "voidReason", { max: 1000 });
}

/** The client-input subset of issueNative's args, mirrored to Zod
 *  (`invoiceIssueSchema` in `src/lib/validations/invoice.ts`) — registered in
 *  `validationDrift.test.ts`. `id`/`orgId`/`autoNumber`/`actor`/`auditId`/`now`
 *  are issueNative's own structural args, not business fields. */
export const invoiceIssueFields = {
  invoiceDate: v.optional(v.number()),
  dueDate: v.optional(v.number()),
  notes: v.optional(v.string()),
};

/** The client-input subset of createNative's args (mirrors invoiceSchema in
 *  src/lib/validations/invoice.ts — registered in validationDrift.test.ts).
 *  id/organizationId/projectId/clientId are createNative's own top-level
 *  create-time args (like project/name/projectNumber on projectWriteFields),
 *  not part of this pair. */
export const invoiceFields = {
  kind: enums.InvoiceKind,
  notes: v.optional(v.string()),
  dueDate: v.optional(v.number()),
  depositPercent: v.optional(v.number()),
  /** Fixed-$ alternative to depositPercent (#1055) — mutually exclusive with it.
   *  depositMode picks which one createNative reads; the other is ignored. */
  depositAmount: v.optional(v.number()),
  depositMode: v.optional(enums.InvoiceDepositMode),
};

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    clientId: v.string(),
    kind: enums.InvoiceKind,
    notes: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    /** % of the tax-inclusive total this DEPOSIT invoice represents — the
     *  client caller reads this off the client's paymentProfile
     *  (profileDepositPercent, default 25) and passes it through; re-validated
     *  as a plain 0-100 bound here (not re-derived — the profile can change
     *  between projects, so the invoice snapshots whatever % applied when it
     *  was created, same "snapshot, don't re-derive" rule as the money below). */
    depositPercent: v.optional(v.number()),
    depositAmount: v.optional(v.number()),
    depositMode: v.optional(enums.InvoiceDepositMode),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, now, ...fields } = args;
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "invoice", "create");
    const actor = await resolveActor(ctx, suppliedActor);
    assertInvoiceFields(fields);
    if (fields.depositPercent != null && (fields.depositPercent < 0 || fields.depositPercent > 100)) {
      throw new ConvexError({ code: "INVALID_FIELD", message: "depositPercent must be between 0 and 100." });
    }
    if (fields.depositAmount != null && fields.depositAmount <= 0) {
      throw new ConvexError({ code: "INVALID_FIELD", message: "depositAmount must be greater than 0." });
    }
    const depositMode = fields.depositMode ?? "%";

    await assertRefInOrg(ctx, "projects", fields.projectId, fields.organizationId);
    await assertRefInOrg(ctx, "clients", fields.clientId, fields.organizationId);
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", fields.projectId)).first();
    if (!project) throw new ConvexError("Project not found: " + fields.projectId);

    const dup = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", fields.id)).first();
    if (dup) throw new ConvexError("Invoice already exists");

    const projectTotal = Number(project.total) || 0;
    const projectSubtotal = Number(project.subtotal) || 0;
    const projectTax = Number(project.taxAmount) || 0;

    let subtotal = projectSubtotal;
    let taxAmount = projectTax;
    let total = projectTotal;
    if (fields.kind === "DEPOSIT" && depositMode === "$") {
      const priorTotal = await priorPartialTotal(ctx, fields.organizationId, fields.projectId);
      const remaining = round(Math.max(0, projectTotal - priorTotal));
      const amount = fields.depositAmount ?? 0;
      if (amount <= 0) {
        throw new ConvexError({ code: "INVALID_FIELD", message: "depositAmount is required when depositMode is \"$\"." });
      }
      if (amount > remaining) {
        throw new ConvexError({
          code: "INVALID_FIELD",
          message: `Deposit amount cannot exceed the remaining balance ($${remaining.toFixed(2)}).`,
        });
      }
      // Fixed-$ basis (#1055) — same proportional-GST-fraction split as the %
      // branch below, just against an operator-entered dollar figure instead of
      // a percentage of the tax-inclusive total. projectTotal is provably > 0
      // here (amount > 0 and amount <= remaining <= projectTotal were just
      // checked above), unlike the % branch below where pct can be set with no
      // equipment priced yet — so no zero-guard needed on this division.
      total = round(amount);
      taxAmount = round(total * (projectTax / projectTotal));
      subtotal = round(total - taxAmount);
    } else if (fields.kind === "DEPOSIT") {
      const priorTotal = await priorPartialTotal(ctx, fields.organizationId, fields.projectId);
      const remaining = round(Math.max(0, projectTotal - priorTotal));
      const pct = fields.depositPercent ?? 25;
      // Deposit basis: % of the tax-INCLUSIVE total (matches the pre-#940
      // display math in financial-summary.tsx). taxAmount is the GST fraction
      // of that deposit — shown on the deposit tax invoice as its own GST line.
      total = round(projectTotal * (pct / 100));
      // Multiple partials are allowed (no longer capped at one "deposit" per
      // project) — but their sum still can't exceed what the project is worth,
      // so this is bounded against what's LEFT, not the full total again.
      if (total > remaining + 0.01) {
        throw new ConvexError({
          code: "INVALID_FIELD",
          message: `This partial invoice ($${total.toFixed(2)}) would exceed the remaining balance ($${remaining.toFixed(2)}).`,
        });
      }
      taxAmount = projectTotal > 0 ? round(total * (projectTax / projectTotal)) : 0;
      subtotal = round(total - taxAmount);
    } else if (fields.kind === "BALANCE") {
      // Balance = total less every non-VOID DEPOSIT/BALANCE invoice already
      // raised on this project (server-computed — never trust a client-supplied
      // balance).
      const priorTotal = await priorPartialTotal(ctx, fields.organizationId, fields.projectId);
      total = round(Math.max(0, projectTotal - priorTotal));
      if (total <= 0.005) {
        throw new ConvexError({ code: "INVALID_STATE", message: "Nothing left to invoice on this project." });
      }
      taxAmount = projectTotal > 0 ? round(total * (projectTax / projectTotal)) : 0;
      subtotal = round(total - taxAmount);
    }
    // FULL and CREDIT keep the project's full totals as-is (CREDIT amounts are
    // negated by createCreditNative, not here).

    await ctx.db.insert("invoices", {
      id: fields.id,
      organizationId: fields.organizationId,
      projectId: fields.projectId,
      clientId: fields.clientId,
      kind: fields.kind,
      status: "DRAFT",
      invoiceNumber: undefined,
      dueDate: fields.dueDate,
      // #1080/#1097 — stamped once here, never updated by issueNative/voidNative.
      sourceRevision: projectLiveRevision(project),
      subtotal,
      taxAmount,
      total,
      depositPercent: fields.kind === "DEPOSIT" && depositMode === "%" ? (fields.depositPercent ?? 25) : undefined,
      depositMode: fields.kind === "DEPOSIT" ? depositMode : undefined,
      depositAmount: fields.kind === "DEPOSIT" && depositMode === "$" ? total : undefined,
      notes: fields.notes,
      xeroSyncStatus: "NOT_SYNCED",
      createdById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const lines = await buildFinanceLines(ctx, fields.projectId, fields.organizationId);
    // A DEPOSIT/BALANCE invoice doesn't carry the full equipment/service line
    // breakdown (the % is against the total, not itemised) — snapshot a
    // single summary line instead of the full FULL-invoice breakdown.
    const linesToWrite =
      fields.kind === "DEPOSIT" || fields.kind === "BALANCE"
        ? [
            {
              sourceType: "CUSTOM" as const,
              description:
                fields.kind === "DEPOSIT"
                  ? depositMode === "$"
                    ? `Deposit ($${total.toFixed(2)})`
                    : `Deposit (${fields.depositPercent ?? 25}% of project total)`
                  : "Balance due",
              quantity: 1,
              unitPrice: total,
              lineTotal: total,
            },
          ]
        : lines;

    for (let i = 0; i < linesToWrite.length; i++) {
      const line = linesToWrite[i]!;
      await ctx.db.insert("invoiceLines", {
        id: createId(),
        invoiceId: fields.id,
        sourceType: line.sourceType,
        sourceLineItemId: line.sourceLineItemId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        sortOrder: i,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "INVOICE_CREATED",
      entityType: "invoice",
      entityId: fields.id,
      entityName: `${fields.kind} invoice — ${project.name}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created ${fields.kind.toLowerCase()} invoice draft for ${project.name}`,
      projectId: fields.projectId,
      createdAt: now,
    });

    return { id: fields.id };
  },
});

export const issueNative = mutation({
  returns: v.object({ id: v.string(), invoiceNumber: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    autoNumber: v.object({
      format: v.string(),
      reset: v.union(v.literal("NONE"), v.literal("YEARLY"), v.literal("MONTHLY"), v.literal("DAILY")),
      padding: v.number(),
      parts: v.object({ year: v.number(), month: v.number(), day: v.number() }),
    }),
    /** User-chosen date printed on the PDF (#989). Defaults to today client-side
     *  (`invoiceIssueSchema`) and to `now` here when omitted entirely; normalised
     *  to the org's calendar day, same as a quote's `quoteDate`. */
    invoiceDate: v.optional(v.number()),
    /** Defaults to `invoiceDate + OrgDocumentSettings.paymentTermsDays` when
     *  omitted — closes the "every invoice issued has no due date" bug (#985):
     *  the panel used to call `issue(id)` with no date argument at all. */
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, autoNumber, invoiceDate, dueDate, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "issue");
    const actor = await resolveActor(ctx, suppliedActor);

    assertNumRange(invoiceDate, "invoiceDate", DATE_BOUNDS);
    assertNumRange(dueDate, "dueDate", DATE_BOUNDS);
    assertStrLen(notes, "notes", { max: 2000 });

    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Invoice not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (doc.status !== "DRAFT") {
      throw new ConvexError({ code: "INVALID_STATE", message: `Invoice is ${doc.status}, only a DRAFT invoice can be issued.` });
    }

    const invoiceNumber = await allocateInvoiceNumber(ctx, orgId, autoNumber, now);

    const config = await resolveOrgInvoiceConfig(ctx, orgId);
    const stampedInvoiceDate = startOfDayInTimezone(invoiceDate ?? now, config.timezone);
    const stampedDueDate =
      dueDate != null
        ? startOfDayInTimezone(dueDate, config.timezone)
        : computeDueDate(stampedInvoiceDate, config.paymentTermsDays, config.timezone);

    await ctx.db.patch(doc._id, {
      status: "ISSUED",
      invoiceNumber,
      issuedAt: now,
      issuedById: actor.userId,
      invoiceDate: stampedInvoiceDate,
      dueDate: stampedDueDate,
      notes: notes ?? doc.notes,
      updatedAt: now,
    });

    // Derived depositPaid/invoicedTotal only change on an ISSUED/VOID
    // transition — recompute now rather than waiting for an unrelated
    // line-item write to happen to touch this project next.
    const taxRate = await orgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, doc.projectId, orgId, taxRate, now);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "INVOICE_ISSUED",
      entityType: "invoice",
      entityId: id,
      entityName: invoiceNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Issued invoice ${invoiceNumber}`,
      projectId: doc.projectId,
      createdAt: now,
    });

    return { id, invoiceNumber };
  },
});

/** Reserve + render the next invoice number, retrying past any rendered-code
 *  clash (identical shape to projectWrites.ts createNative's auto-number
 *  loop) — the counter is serializable so concurrent issues never double-
 *  allocate, and the org-scoped clash-guard is belt-and-braces on top. */
async function allocateInvoiceNumber(
  ctx: Parameters<typeof reserveProjectNumberCounter>[0],
  orgId: string,
  autoNumber: { format: string; reset: IncrementReset; padding: number; parts: ProjectNumberDateParts },
  now: number,
): Promise<string> {
  const scopeKey = "INV:" + scopeKeyFor(autoNumber.reset, autoNumber.parts);
  for (let attempt = 0; attempt < 50; attempt++) {
    const sequence = await reserveProjectNumberCounter(ctx, orgId, scopeKey, createId(), now);
    const candidate = renderProjectNumber(autoNumber.format, { parts: autoNumber.parts, sequence, padding: autoNumber.padding });
    const clash = await ctx.db
      .query("invoices")
      .withIndex("by_organizationId_invoiceNumber", (q) => q.eq("organizationId", orgId).eq("invoiceNumber", candidate))
      .unique();
    if (!clash) return candidate;
  }
  throw new ConvexError("Could not generate a unique invoice number");
}

export const voidNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    reason: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, reason, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "void");
    const actor = await resolveActor(ctx, suppliedActor);
    assertStrLen(reason, "reason", { min: 1, max: 1000 });

    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Invoice not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (doc.status !== "ISSUED") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Only an ISSUED invoice can be voided." });
    }

    await ctx.db.patch(doc._id, { status: "VOID", voidedAt: now, voidedById: actor.userId, voidReason: reason, updatedAt: now });

    const taxRate = await orgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, doc.projectId, orgId, taxRate, now);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "INVOICE_VOIDED",
      entityType: "invoice",
      entityId: id,
      entityName: doc.invoiceNumber ?? id,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Voided invoice ${doc.invoiceNumber ?? id}`,
      metadata: { reason },
      projectId: doc.projectId,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * DELETE VOID (#1055) — the invoice-side counterpart to quotesWrites.ts
 * `deleteRecalledNative` ("recall-then-delete", #1029): the one deliberate,
 * accepted-risk reversal of "a client-facing finance PDF is never deleted",
 * mirrored here rather than reinvented.
 *
 * Reachable only from `status === "VOID"` — VOID is only ever reached from
 * ISSUED (`voidNative` above), so a VOID row is inherently "this was actually
 * issued", unlike a quote's DRAFT (which can mean either "never sent" or
 * "recalled from sent") — no separate two-step recall is needed here.
 *
 * Gated on the ordinary `invoice:delete` permission (owner + admin — same
 * audience `deleteDraftNative` already uses), not a stricter owner-only bar
 * like quotes' `requireQuoteOwnerOnly`. Requires a server-validated typed
 * confirmation (`confirmLabel` must equal the invoice number exactly) and
 * refuses to proceed while the invoice has any non-voided `payments` row — the
 * operator must void those first; nothing about a payment is ever silently
 * cascaded away. The audit entry is written FIRST (it's the only record left
 * once this returns), and this actually erases the stored PDF via
 * `ctx.storage.delete`, not just unlinks it.
 *
 * No `recalcProjectTotals` call needed: a VOID invoice was never counted in
 * `depositPaid`/`invoicedTotal` (those only sum ISSUED), so deleting it
 * changes nothing there. No numbering-counter rollback either — unlike a
 * quote's revision counter, invoice numbers are never reused.
 */
/** Everything `deleteVoidNative` must confirm before it starts writing — split
 *  out so the handler reads as a straight line (R-3.6, same reasoning as
 *  quotesWrites.ts's `assertRecalledDeletable`). Order matters: org match,
 *  then state, then the typed confirmation last — so a caller fixing one
 *  rejection at a time sees the real blocker first. Returns the label the
 *  confirmation (and the audit entry) is keyed on. */
function assertVoidDeletable(doc: Doc<"invoices">, orgId: string, confirmLabel: string): string {
  if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
  if (doc.status !== "VOID") {
    throw new ConvexError({ code: "INVALID_STATE", message: "Only a VOID invoice can be permanently deleted." });
  }
  const label = doc.invoiceNumber ?? doc.id;
  if (confirmLabel !== label) {
    throw new ConvexError({
      code: "CONFIRMATION_MISMATCH",
      message: `Type "${label}" exactly to confirm — this permanently deletes a document the client may already hold.`,
    });
  }
  return label;
}

/** Refuses if the invoice has any non-voided `payments` row — nothing about a
 *  payment is ever silently cascaded away by an invoice delete (§ user
 *  decision on #1055). Split out alongside `assertVoidDeletable` for the same
 *  R-3.6 reason. */
async function assertNoLivePayments(ctx: MutationCtx, orgId: string, invoiceId: string): Promise<void> {
  // Bounded by invoiceId (R-9.8) — see paymentsWrites.ts recomputeInvoicePaymentState.
  const livePayments = await ctx.db
    .query("payments")
    .withIndex("by_organizationId_invoiceId", (q) => q.eq("organizationId", orgId).eq("invoiceId", invoiceId))
    .take(500);
  const nonVoidCount = livePayments.filter((p) => p.voidedAt == null).length;
  if (nonVoidCount > 0) {
    throw new ConvexError({
      code: "INVOICE_HAS_PAYMENTS",
      message: `This invoice has ${nonVoidCount} payment(s) recorded against it — void them first.`,
    });
  }
}

export const deleteVoidNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    /** Must exactly match the invoice's number (or id, if somehow unnumbered). */
    confirmLabel: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, confirmLabel, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "delete");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Invoice not found: " + id);
    const label = assertVoidDeletable(doc, orgId, confirmLabel);
    await assertNoLivePayments(ctx, orgId, id);

    const erasedArtifactIds = doc.pdfFileId ? [doc.pdfFileId] : [];

    // Audit FIRST — this is the only record left once the row and its
    // artifact are gone.
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "invoice",
      entityId: id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Permanently deleted voided invoice ${label}`,
      details: { invoiceNumber: doc.invoiceNumber, kind: doc.kind, total: doc.total, voidReason: doc.voidReason },
      metadata: { erasedArtifactIds },
      projectId: doc.projectId,
      createdAt: now,
    });

    for (const storageId of erasedArtifactIds) {
      try {
        await ctx.storage.delete(storageId as Id<"_storage">);
      } catch {
        // Already gone — genuine erase, not a retry-safe attach, so a missing
        // blob is not an error condition.
      }
    }

    // Bounded by invoiceId (R-9.8) — an invoice's own line count is small and fixed.
    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", id)).take(500);
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(doc._id);

    return { id };
  },
});

export const deleteDraftNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "delete");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Invoice not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (doc.status !== "DRAFT") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Only a DRAFT invoice can be deleted — void an issued one instead." });
    }

    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", id)).collect();
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(doc._id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "INVOICE_DELETED",
      entityType: "invoice",
      entityId: id,
      entityName: `${doc.kind} invoice draft`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted ${doc.kind.toLowerCase()} invoice draft`,
      projectId: doc.projectId,
      createdAt: now,
    });

    return { id };
  },
});

/** A CREDIT invoice negates an already-ISSUED invoice's total — its own
 *  document type in Xero terms (ACCRECCREDIT), created DRAFT like any other
 *  invoice (the same issueNative numbering path applies to it later). */
export const createCreditNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    creditForInvoiceId: v.string(),
    notes: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, creditForInvoiceId, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "create");
    const actor = await resolveActor(ctx, suppliedActor);
    assertInvoiceFields({ notes });

    await assertRefInOrg(ctx, "invoices", creditForInvoiceId, orgId);
    const original = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", creditForInvoiceId)).first();
    if (!original) throw new ConvexError("Invoice not found: " + creditForInvoiceId);
    if (original.status !== "ISSUED") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Can only credit an ISSUED invoice." });
    }

    const dup = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError("Invoice already exists");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", original.projectId)).first();
    if (!project) throw new ConvexError("Project not found: " + original.projectId);

    await ctx.db.insert("invoices", {
      id,
      organizationId: orgId,
      projectId: original.projectId,
      clientId: original.clientId,
      kind: "CREDIT",
      status: "DRAFT",
      subtotal: -original.subtotal,
      taxAmount: -original.taxAmount,
      total: -original.total,
      notes,
      creditForInvoiceId,
      // #1080/#1097 — the version live when the CREDIT was cut, not the
      // original invoice's `sourceRevision` (a credit is its own act, possibly
      // issued long after a promote moved the project's live version).
      sourceRevision: projectLiveRevision(project),
      xeroSyncStatus: "NOT_SYNCED",
      createdById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("invoiceLines", {
      id: createId(),
      invoiceId: id,
      sourceType: "CUSTOM",
      description: `Credit for invoice ${original.invoiceNumber ?? creditForInvoiceId}`,
      quantity: 1,
      unitPrice: -original.total,
      lineTotal: -original.total,
      sortOrder: 0,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "INVOICE_CREDIT_CREATED",
      entityType: "invoice",
      entityId: id,
      entityName: `Credit for ${original.invoiceNumber ?? creditForInvoiceId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created credit invoice for ${original.invoiceNumber ?? creditForInvoiceId}`,
      projectId: original.projectId,
      createdAt: now,
    });

    return { id };
  },
});

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Total of every non-VOID DEPOSIT/BALANCE invoice already raised on this
 *  project — the basis for "how much is left to invoice" that both a new
 *  partial's own bound and the next remaining-balance invoice's total read.
 *  FULL isn't counted (it's the one-shot "whole project" invoice, never mixed
 *  with partials) and neither is CREDIT (a correction against an
 *  already-issued invoice, not fresh billing). */
async function priorPartialTotal(ctx: MutationCtx, organizationId: string, projectId: string): Promise<number> {
  const existing = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", organizationId).eq("projectId", projectId))
    .collect();
  return existing
    .filter((inv) => (inv.kind === "DEPOSIT" || inv.kind === "BALANCE") && inv.status !== "VOID")
    .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
}

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // Creates a DRAFT credit note (negates an ISSUED invoice) — real but
  // recoverable while it stays a draft, same tier as createNative.
  createCreditNative: { danger: "medium" },
  createNative: { danger: "medium" },
  // Delete = high (§9) even though it's scoped to DRAFT-only invoices —
  // deletion is deletion.
  deleteDraftNative: { danger: "high" },
  // Genuinely irreversible — erases stored PDF bytes a client may already
  // hold, not just unlinks them (mirrors quotesWrites.ts deleteRecalledNative).
  deleteVoidNative: { danger: "high" },
  // Financial issue (§9) — assigns the invoice number and moves DRAFT → ISSUED,
  // the immutable-once-issued moment.
  issueNative: { danger: "high" },
  // Financial void (§9).
  voidNative: { danger: "high" },
};
