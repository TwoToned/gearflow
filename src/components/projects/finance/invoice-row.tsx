"use client";

import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Download, Eye, UploadCloud, Wallet } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../../convex/_generated/api";
import { useCanDo } from "@/lib/use-permissions";
import { pushInvoiceToXero } from "@/server/xero";
import { generateInvoiceArtifact } from "@/server/finance-documents";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { invoiceStatusWord, invoiceDatesLine } from "@/lib/invoice-pill";
import { invoiceRowMenuActions } from "@/lib/row-actions/invoice-row";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-method-labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusWord } from "@/components/ui/status-word";
import { ActionMenu } from "@/components/ui/action-menu";
import { CanDo } from "@/components/auth/permission-gate";

/**
 * One invoice row on the Finance tab's Invoices strip (UX Phase 10, spec §8b):
 * ONE status word that folds payment in (D56), the date line, the Xero chip,
 * the document, `Record payment` / `Push to Xero` as row links, and a ⋯ that
 * carries `Issue…`, `Credit note…`, Void and the deletes. Payments list
 * beneath with `Void`.
 *
 * Documents are STORED bytes (#987): an issued invoice's PDF is rendered once
 * and re-downloaded; a draft's only document is the watermarked preview; a
 * failed render gets an explicit retry. Never a fresh render of live state.
 */

export interface InvoiceRowDoc {
  id: string;
  status: string;
  kind: string;
  invoiceNumber?: string;
  total: number;
  xeroSyncStatus?: string;
  lastSyncError?: string;
  /** The STORED document, rendered once at issue (#987). */
  pdfFileId?: string;
  issuedAt?: number;
  dueDate?: number;
  /** Derived from this invoice's non-voided `payments` rows (#1055). */
  amountPaid?: number;
  paymentStatus?: string;
  /** Set on a credit note: the invoice it credits. */
  creditForInvoiceId?: string;
}

interface PaymentRowDoc {
  id: string;
  amount: number;
  method: string;
  paidAt: number;
  reference?: string;
  voidedAt?: number;
}

export function InvoiceRow({
  invoice: inv,
  projectId,
  orgId,
  xeroLinked,
  now,
  hasCreditNote,
  onIssue,
  onCreditRequest,
  onDeleteDraft,
  onVoidRequest,
  onDeleteVoidRequest,
  onRecordPaymentRequest,
  onVoidPaymentRequest,
}: {
  invoice: InvoiceRowDoc;
  projectId: string;
  orgId?: string;
  xeroLinked: boolean;
  now: number;
  hasCreditNote: boolean;
  onIssue: () => void;
  onCreditRequest: () => void;
  onDeleteDraft: () => void;
  onVoidRequest: () => void;
  onDeleteVoidRequest: () => void;
  onRecordPaymentRequest: (balanceRemaining: number) => void;
  onVoidPaymentRequest: (paymentId: string, amount: number) => void;
}) {
  const canDelete = useCanDo("invoice", "delete");
  const canVoid = useCanDo("invoice", "void");
  const canIssue = useCanDo("invoice", "issue");
  const canCreate = useCanDo("invoice", "create");
  const canVoidPayment = useCanDo("invoice", "void_payment");
  const menuActions = invoiceRowMenuActions(
    inv,
    { canDelete, canVoid, canIssue, canCreate },
    { onIssue, onCreditRequest, onDeleteDraft, onVoidRequest, onDeleteVoidRequest },
    hasCreditNote,
  );

  // Payments only ever exist against an invoice that was at some point ISSUED
  // (paymentsWrites.ts recordNative requires it) — skip the query for a DRAFT.
  const payments = useAuthedQuery(
    api.payments.listForInvoice,
    orgId && inv.status !== "DRAFT" ? { orgId, invoiceId: inv.id } : "skip",
  ) as PaymentRowDoc[] | undefined;
  const livePayments = (payments ?? []).filter((p) => p.voidedAt == null);
  const amountPaid = inv.amountPaid ?? 0;
  const balanceRemaining = inv.total - amountPaid;
  const lastPaidAt = livePayments.reduce<number | null>((max, p) => (max == null || p.paidAt > max ? p.paidAt : max), null);
  const datesLine = invoiceDatesLine(inv, now, lastPaidAt, (ms) => formatDate(new Date(ms)));

  return (
    <li className="rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <div className="flex items-center justify-between gap-2">
        <InvoiceRowFacts inv={inv} now={now} datesLine={datesLine} balanceRemaining={balanceRemaining} />

        <div className="flex shrink-0 items-center gap-1.5">
          <InvoiceDocumentAction invoice={inv} projectId={projectId} />
          <InvoiceRowLinks
            status={inv.status}
            invoiceId={inv.id}
            xeroLinked={xeroLinked}
            xeroSyncStatus={inv.xeroSyncStatus}
            onRecordPaymentRequest={() => onRecordPaymentRequest(balanceRemaining)}
          />
          <ActionMenu spec={{ items: menuActions }} label={`${inv.invoiceNumber ?? inv.kind} actions`} />
        </div>
      </div>
      <InvoicePaymentsList payments={livePayments} canVoidPayment={canVoidPayment} onVoidPaymentRequest={onVoidPaymentRequest} />
    </li>
  );
}

/** The left side of the row: one status word, number, total, balance, Xero chip, dates. */
function InvoiceRowFacts({ inv, now, datesLine, balanceRemaining }: { inv: InvoiceRowDoc; now: number; datesLine: string; balanceRemaining: number }) {
  const showBalance = inv.status !== "DRAFT" && (inv.amountPaid ?? 0) > 0 && balanceRemaining > 0.005;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <StatusWord status={invoiceStatusWord(inv, now)} />
      <span className="font-medium text-fg">{inv.invoiceNumber ?? `${inv.kind} (draft)`}</span>
      <span className="tabular-nums text-fg-4">{formatCurrency(inv.total)}</span>
      {showBalance && <span className="text-caption text-fg-4">Balance {formatCurrency(balanceRemaining)}</span>}
      <InvoiceXeroSyncBadge status={inv.xeroSyncStatus} error={inv.lastSyncError} />
      {datesLine && <span className="text-caption text-muted">{datesLine}</span>}
    </div>
  );
}

/** The Xero sync status badge on an invoice row. */
function InvoiceXeroSyncBadge({ status, error }: { status?: string; error?: string }) {
  if (status === "SYNCED") return <Badge status="ok">Synced to Xero</Badge>;
  if (status === "ERROR") {
    return (
      <span className="flex items-center gap-1 text-destructive" title={error}>
        <AlertCircle className="h-3.5 w-3.5" /> Xero push failed
      </span>
    );
  }
  return null;
}

/** `Record payment` and `Push to Xero` stay on the row (owner ruling Q7); `Issue` moved to ⋯. */
function InvoiceRowLinks({
  status,
  invoiceId,
  xeroLinked,
  xeroSyncStatus,
  onRecordPaymentRequest,
}: {
  status: string;
  invoiceId: string;
  xeroLinked: boolean;
  xeroSyncStatus?: string;
  onRecordPaymentRequest: () => void;
}) {
  if (status !== "ISSUED") return null;
  return (
    <>
      <CanDo resource="invoice" action="record_payment">
        <Button type="button" variant="line" size="sm" onClick={onRecordPaymentRequest}>
          <Wallet className="h-3.5 w-3.5" /> Record payment
        </Button>
      </CanDo>
      {xeroLinked && (
        <CanDo resource="invoice" action="xero_push">
          <PushToXeroButton invoiceId={invoiceId} alreadySynced={xeroSyncStatus === "SYNCED"} />
        </CanDo>
      )}
    </>
  );
}

/** The always-visible payments list under an invoice row. */
function InvoicePaymentsList({
  payments,
  canVoidPayment,
  onVoidPaymentRequest,
}: {
  payments: PaymentRowDoc[];
  canVoidPayment: boolean;
  onVoidPaymentRequest: (paymentId: string, amount: number) => void;
}) {
  if (payments.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1 border-t border-line pt-1.5">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 text-caption text-fg-4">
          <span>
            {formatCurrency(p.amount)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method} · {formatDate(new Date(p.paidAt))}
            {p.reference ? ` · ${p.reference}` : ""}
          </span>
          {canVoidPayment && (
            <button
              type="button"
              onClick={() => onVoidPaymentRequest(p.id, p.amount)}
              className="shrink-0 underline underline-offset-2 hover:text-fg"
            >
              Void
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The document side of an invoice (#987). An ISSUED invoice's PDF is rendered
 * once and stored, so re-downloading it can never produce a different document
 * from the one the client was sent. A VOIDed invoice keeps its document. A DRAFT
 * has none by design: its only document is the watermarked preview.
 */
function InvoiceDocumentAction({ invoice: inv, projectId }: { invoice: InvoiceRowDoc; projectId: string }) {
  const retry = useServerMutation({
    mutationFn: () => generateInvoiceArtifact(inv.id),
    onSuccess: () => toast.success("Generated the invoice document"),
    onError: (e) => toast.error(e.message),
  });

  if (inv.pdfFileId) {
    return (
      <Button variant="line" size="sm" asChild>
        <a href={`/api/finance/invoice/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer">
          <Download className="h-3.5 w-3.5" /> Document
        </a>
      </Button>
    );
  }

  // The one place a client-facing finance PDF is still rendered from live state,
  // and it says "NOT SENT" on every page. `invoiceId` matters: without it the
  // preview showed the live PROJECT total regardless of this invoice's own kind.
  if (inv.issuedAt == null) {
    // A voided never-issued draft has no document and nothing to preview.
    if (inv.status === "VOID") return null;
    return (
      <Button variant="line" size="sm" asChild>
        <a href={`/api/documents/${projectId}?type=invoice&preview=1&invoiceId=${inv.id}`} target="_blank" rel="noopener noreferrer">
          <Eye className="h-3.5 w-3.5" /> Preview
        </a>
      </Button>
    );
  }

  return (
    <CanDo resource="invoice" action="issue">
      <Button type="button" variant="line" size="sm" loading={retry.isPending} onClick={() => retry.mutate(undefined)}>
        <AlertTriangle className="h-3.5 w-3.5 text-warn" /> Document missing — generate
      </Button>
    </CanDo>
  );
}

/**
 * `alreadySynced` only picks the IDLE label/toast wording — pushInvoiceToXero
 * decides create-vs-update from the invoice's own `xeroInvoiceId`. A synced
 * invoice keeps the button so a Flow-side correction has a way back into the
 * SAME Xero invoice.
 */
function PushToXeroButton({ invoiceId, alreadySynced }: { invoiceId: string; alreadySynced: boolean }) {
  const pushMutation = useServerMutation({
    mutationFn: () => pushInvoiceToXero(invoiceId),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.updated) {
        toast.success("Updated in Xero");
      } else {
        toast.success(r.autoCreatedContact ? "Pushed to Xero (new contact created)" : "Pushed to Xero");
      }
      if (r.varianceNote) toast.warning(r.varianceNote);
    },
    // pushInvoiceToXero never throws — it resolves to { ok, ... } so its failure
    // message survives Next's production Server Action redaction.
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button type="button" variant={alreadySynced ? "line" : "primary"} size="sm" loading={pushMutation.isPending} onClick={() => pushMutation.mutate(undefined)}>
      <UploadCloud className="h-3.5 w-3.5" /> {alreadySynced ? "Update in Xero" : "Push to Xero"}
    </Button>
  );
}
