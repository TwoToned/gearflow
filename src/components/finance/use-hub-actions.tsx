"use client";
// use-client: dialogs, clipboard and writes (R-8.1.1)

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { ChaseDialog } from "@/components/finance/chase-dialog";
import { VoidInvoiceDialog } from "@/components/finance/void-invoice-dialog";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { downloadCsv } from "@/lib/download-csv";
import { invoiceChaseText, chaseSummary } from "@/lib/finance-chase";
import { MAX_FINANCE_BULK, bulkCapMessage, bulkToastTitle, runBulk, type BulkRow } from "@/lib/finance-bulk";
import { invoicesCsv, quotesCsv } from "@/lib/finance-export";
import type { InvoiceSource, QuoteSource } from "@/lib/list-views/finance";
import type { ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import { buildInvoiceHubActions, buildQuoteHubActions, invoiceHubBulk, quoteHubBulk } from "@/lib/row-actions/finance";
import { generateInvoiceArtifact, generateQuoteArtifact } from "@/server/finance-documents";
import { pushInvoiceToXero } from "@/server/xero";
import { useCanDo } from "@/lib/use-permissions";

/** What the viewer's role may do on the hub: an omitted handler is an ABSENT verb, and the existing write still gates server-side. */
function useHubGates() {
  return {
    publish: useCanDo("invoice", "publish"),
    issue: useCanDo("invoice", "issue"),
    recordPayment: useCanDo("invoice", "record_payment"),
    void_: useCanDo("invoice", "void"),
    delete_: useCanDo("invoice", "delete"),
    xeroPush: useCanDo("invoice", "xero_push"),
  };
}

const quoteName = (q: QuoteSource) => `${q.project?.projectNumber ?? "—"} v${q.version}`;
const invoiceName = (i: InvoiceSource) => i.invoiceNumber ?? "Draft invoice";
const toRow = <T extends { id: string }>(x: T, name: (t: T) => string): T & BulkRow => ({ ...x, name: name(x) });

/** The money in a chase text is present only when the row carries money (the server sent it). */
function quoteChase(q: QuoteSource, now: number): string {
  return chaseSummary(q.project?.projectNumber ?? "—", { version: q.version, sentAt: q.sentAt, validUntil: q.validUntil }, { subtotal: null, taxAmount: null, total: q.total ?? null }, now);
}
function invoiceChase(i: InvoiceSource): string {
  return invoiceChaseText(
    { invoiceNumber: i.invoiceNumber, projectNumber: i.project?.projectNumber ?? "—", issuedAt: i.issuedAt, dueDate: i.dueDate, overdueDays: i.overdueDays },
    { total: i.total ?? null, outstanding: i.outstanding ?? null },
  );
}

/**
 * The hub's row menus, bulk verbs and dialogs. Every write is an EXISTING one with its own gate (and its
 * documented Undo, or none): record payment, void, delete draft, mark accepted, acknowledge expired,
 * push to Xero, generate PDF. Chase is copy-only. Bulk verbs run those same writes row by row (capped at
 * 50), name what they skipped, and offer no Undo because none of them has an exact reverse.
 */
export function useHubActions(opts: { quotes: QuoteSource[]; invoices: InvoiceSource[]; xeroConnected: boolean; now: number; timeZone: string | null | undefined }) {
  const router = useRouter();
  const g = useHubGates();
  const quoteWrites = useQuoteWrites();
  const invoiceWrites = useInvoiceWrites();
  const [chase, setChase] = React.useState<{ text: string; count: number } | null>(null);
  const [accept, setAccept] = React.useState<{ id: string; version: number; expired: boolean } | null>(null);
  const [pay, setPay] = React.useState<{ id: string; number: string; balance: number } | null>(null);
  const [voidTarget, setVoidTarget] = React.useState<{ id: string; label: string } | null>(null);

  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  const generate = async (kind: "quote" | "invoice", id: string) => {
    try {
      const r = kind === "quote" ? await generateQuoteArtifact(id) : await generateInvoiceArtifact(id);
      toast.success(r.generated ? "PDF generated" : "That document already has its stored copy");
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't generate the PDF" });
    }
  };
  const acknowledge = async (id: string) => {
    try {
      await quoteWrites.acknowledgeExpired(id);
      toast.success("Expired quote acknowledged");
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't acknowledge that quote" });
    }
  };
  const pushXero = async (id: string, label: string) => {
    const r = await pushInvoiceToXero(id);
    if (r.ok) toast.success(`${label} pushed to Xero`);
    else toast.error(r.error);
  };
  const deleteDraft = async (id: string) => {
    try {
      await invoiceWrites.deleteDraft(id);
      toast.success("Draft deleted");
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't delete the draft" });
    }
  };
  const when = <F extends () => void | Promise<void>>(allowed: boolean, fn: F): F | undefined => (allowed ? fn : undefined);

  const quoteMenu = (q: QuoteSource): ActionMenuSpec =>
    buildQuoteHubActions(q, {
      onOpenJob: () => q.project && router.push(`/projects/${q.project.id}?tab=finance`),
      onOpenPdf: () => open(`/api/finance/quote/${q.id}/pdf`),
      onPreview: q.project ? () => open(`/api/documents/${q.project!.id}?type=quote&preview=1`) : undefined,
      onGeneratePdf: when(g.publish, () => generate("quote", q.id)),
      onAccept: when(g.publish, () => setAccept({ id: q.id, version: q.version, expired: q.status === "EXPIRED" })),
      onAcknowledge: when(g.publish, () => acknowledge(q.id)),
      onChase: () => setChase({ text: quoteChase(q, opts.now), count: 1 }),
    });

  const invoiceMenu = (i: InvoiceSource): ActionMenuSpec =>
    buildInvoiceHubActions(i, {
      onOpenJob: () => i.project && router.push(`/projects/${i.project.id}?tab=finance`),
      onOpenPdf: () => open(`/api/finance/invoice/${i.id}/pdf`),
      onPreview: i.project ? () => open(`/api/documents/${i.project!.id}?type=invoice&preview=1`) : undefined,
      onGeneratePdf: when(g.issue, () => generate("invoice", i.id)),
      onRecordPayment: when(g.recordPayment, () => setPay({ id: i.id, number: invoiceName(i), balance: i.outstanding ?? 0 })),
      onChase: () => setChase({ text: invoiceChase(i), count: 1 }),
      onPushXero: when(g.xeroPush && opts.xeroConnected, () => pushXero(i.id, invoiceName(i))),
      onVoid: when(g.void_, () => setVoidTarget({ id: i.id, label: invoiceName(i) })),
      onDeleteDraft: when(g.delete_, () => deleteDraft(i.id)),
    });

  // ── Bulk: the existing per-row write, row by row, ONE announcement, no Undo (none has an exact reverse) ──
  const bulkRun = async <R extends BulkRow>(rows: R[], verb: string, noun: string, eligible: (r: R) => string | null, run: (r: R) => Promise<void>) => {
    const cap = bulkCapMessage(rows.length);
    if (cap) {
      toast.error(cap);
      return;
    }
    const outcome = await runBulk(rows, eligible, run);
    announceListWrite({ title: bulkToastTitle(verb, noun, outcome), undoneTitle: "" });
  };

  const pickQuotes = (ids: string[]) => opts.quotes.filter((q) => ids.includes(q.id)).map((q) => toRow(q, quoteName));
  const pickInvoices = (ids: string[]) => opts.invoices.filter((i) => ids.includes(i.id)).map((i) => toRow(i, invoiceName));

  const quoteBulk = (ids: string[]): BulkAction[] =>
    quoteHubBulk({
      onChaseMany: () => {
        const rows = pickQuotes(ids).filter((q) => q.status === "SENT" || q.status === "EXPIRED");
        if (rows.length === 0) return void toast.error("Nothing selected can be chased: only sent or expired quotes.");
        setChase({ text: rows.map((q) => quoteChase(q, opts.now)).join("\n\n"), count: rows.length });
      },
      onAcknowledgeMany: when(g.publish, () =>
        bulkRun(pickQuotes(ids), "Acknowledged", "quote", (q) => (q.status === "EXPIRED" && !q.dismissed ? null : "not a fresh expired quote"), (q) => quoteWrites.acknowledgeExpired(q.id).then(() => undefined)),
      ),
      onExport: () => {
        const cap = bulkCapMessage(ids.length);
        if (cap) return void toast.error(cap);
        downloadCsv(quotesCsv(pickQuotes(ids), opts.timeZone), "quotes.csv");
      },
    });

  const invoiceBulk = (ids: string[]): BulkAction[] =>
    invoiceHubBulk({
      onChaseMany: () => {
        const rows = pickInvoices(ids).filter((i) => ["ISSUED", "PART_PAID", "OVERDUE"].includes(i.pill) && i.kind !== "CREDIT");
        if (rows.length === 0) return void toast.error("Nothing selected can be chased: only unpaid, issued invoices.");
        setChase({ text: rows.map(invoiceChase).join("\n\n"), count: rows.length });
      },
      onSyncXeroMany: when(g.xeroPush && opts.xeroConnected, () =>
        bulkRun(
          pickInvoices(ids),
          "Synced",
          "invoice",
          (i) => (i.xero && (i.xero.status === "NOT_SYNCED" || i.xero.status === "ERROR") ? null : "already in Xero or not issued"),
          async (i) => {
            const r = await pushInvoiceToXero(i.id);
            if (!r.ok) throw new Error(r.error);
          },
        ),
      ),
      onExport: () => {
        const cap = bulkCapMessage(ids.length);
        if (cap) return void toast.error(cap);
        downloadCsv(invoicesCsv(pickInvoices(ids), opts.timeZone), "invoices.csv");
      },
      onDeleteDraftsMany: when(g.delete_, () =>
        bulkRun(pickInvoices(ids), "Deleted", "draft", (i) => (i.pill === "DRAFT" ? null : "only a draft can be deleted"), (i) => invoiceWrites.deleteDraft(i.id)),
      ),
    });

  const dialogs = (
    <>
      <ChaseDialog text={chase?.text ?? null} count={chase?.count ?? 0} onOpenChange={(o) => !o && setChase(null)} />
      {accept ? (
        <AcceptQuoteDialog open onOpenChange={(o) => !o && setAccept(null)} quoteId={accept.id} version={accept.version} isExpired={accept.expired} onAccepted={() => setAccept(null)} />
      ) : null}
      {pay ? <RecordPaymentDialog open onOpenChange={(o) => !o && setPay(null)} invoiceId={pay.id} invoiceNumber={pay.number} balanceRemaining={pay.balance} onRecorded={() => setPay(null)} /> : null}
      <VoidInvoiceDialog target={voidTarget} onClose={() => setVoidTarget(null)} />
    </>
  );

  return { quoteMenu, invoiceMenu, quoteBulk, invoiceBulk, dialogs, bulkCap: MAX_FINANCE_BULK };
}
