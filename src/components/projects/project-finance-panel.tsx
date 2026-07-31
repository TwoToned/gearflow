"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Trash2, UploadCloud, AlertCircle, AlertTriangle, Download, Eye, Send, Wallet } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { ProjectQuoteRail } from "@/components/projects/project-quote-rail";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { usePaymentWrites } from "@/hooks/use-payment-writes";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { useCanDo } from "@/lib/use-permissions";
import { pushInvoiceToXero } from "@/server/xero";
import { generateInvoiceArtifact } from "@/server/finance-documents";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { CanDo } from "@/components/auth/permission-gate";
import { IssueInvoiceDialog } from "@/components/projects/finance/issue-invoice-dialog";
import { CreateDepositInvoiceDialog } from "@/components/projects/finance/create-deposit-invoice-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { DeleteVoidInvoiceDialog } from "@/components/projects/finance/delete-void-invoice-dialog";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-method-labels";

interface ProjectFinancePanelProps {
  projectId: string;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}

const INVOICE_STATUS_BADGE: Record<string, "ok" | "warn" | "neutral" | "overbooked"> = {
  DRAFT: "neutral",
  ISSUED: "ok",
  VOID: "overbooked",
};

const PAYMENT_STATUS_BADGE: Record<string, "ok" | "warn"> = {
  PARTIALLY_PAID: "warn",
  PAID: "ok",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
};

/**
 * WS1 (#940), reworked by #986 — the project's Quotes & Invoices workflow.
 *
 * The quote half is now a REVISION RAIL over `projects.revision`
 * (`<ProjectQuoteRail>`): send the current revision (freezing its pricing and
 * capturing a snapshot), recall it, cut the next version, or record the client's
 * accept/decline. Sending does NOT email anyone — it records the send and
 * freezes the numbers.
 *
 * Invoices: create/issue/void per the client's payment profile, and (Xero-linked
 * orgs) push an issued invoice as a Xero draft. "Deposit not yet invoiced" nudge
 * chips are DERIVED (kind/status of existing invoices), not a stored flag —
 * there is no READY_TO_INVOICE project status.
 *
 * Both halves now carry a DOCUMENT action (#987): the stored, immutable artifact
 * for anything sent or issued, a watermarked preview for anything still a draft,
 * and an explicit retry when a render failed. Quote and Invoice are no longer in
 * the header's Documents ▾ — a client-facing finance document is never a fresh
 * render of live project state.
 *
 * Issuing goes through `<IssueInvoiceDialog>` (#989) — invoice date, due date
 * (defaulting to the org's `paymentTermsDays`), notes — instead of a bare
 * click, and the "advance to INVOICED?" follow-up is a `Dialog`, never
 * `window.confirm` (CLAUDE.md convention, DESIGN.md).
 */
export function ProjectFinancePanel({ projectId, projectNumber, clientId, projectStatus, subtotal, taxAmount, total }: ProjectFinancePanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const xeroLinked = useXeroLinked();

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");

  const invoiceWrites = useInvoiceWrites();
  const paymentWrites = usePaymentWrites();
  const { updateStatus } = useNativeProjectStatus(orgId);

  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [issueTarget, setIssueTarget] = useState<{ id: string; kind: string; total: number } | null>(null);
  const [advanceOffer, setAdvanceOffer] = useState<{ invoiceNumber: string } | null>(null);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [recordPaymentTarget, setRecordPaymentTarget] = useState<{ id: string; number: string; balanceRemaining: number } | null>(null);
  const [paymentVoidTarget, setPaymentVoidTarget] = useState<{ id: string; amount: number } | null>(null);
  const [paymentVoidReason, setPaymentVoidReason] = useState("");
  const [deleteVoidTarget, setDeleteVoidTarget] = useState<{ id: string; label: string } | null>(null);

  if (!clientId) {
    return <p className="t-micro text-fg-4">Assign a client to this project to generate quotes and invoices.</p>;
  }
  if (invoices === undefined || client === undefined) {
    return <p className="t-micro text-fg-4">Loading…</p>;
  }

  const paymentProfile = (client?.paymentProfile as string | undefined) ?? "FULL_UPFRONT";
  const depositPercent = (client?.profileDepositPercent as number | undefined) ?? 25;

  const nonVoidInvoices = invoices.filter((inv) => inv.status !== "VOID");
  const hasDeposit = nonVoidInvoices.some((inv) => inv.kind === "DEPOSIT");
  const hasBalance = nonVoidInvoices.some((inv) => inv.kind === "BALANCE");
  const hasFull = nonVoidInvoices.some((inv) => inv.kind === "FULL");
  const depositIssued = nonVoidInvoices.some((inv) => inv.kind === "DEPOSIT" && inv.status === "ISSUED");

  async function createInvoice(kind: "FULL" | "BALANCE") {
    try {
      await invoiceWrites.create(projectId, clientId!, { kind });
      toast.success(`${kind} invoice draft created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invoice");
    }
  }

  /** UI chain (not a nested mutation) — offer to advance the project once a
   *  BALANCE/FULL invoice is issued (spec: "issuing offers to advance status").
   *  Offered via a `Dialog`, never forced and never `window.confirm`. */
  function offerAdvanceIfEligible(invoiceId: string, invoiceNumber: string) {
    const invoice = invoices?.find((i) => i.id === invoiceId);
    if (
      (invoice?.kind === "BALANCE" || invoice?.kind === "FULL") &&
      projectStatus &&
      projectStatus !== "INVOICED" &&
      projectStatus !== "COMPLETED"
    ) {
      setAdvanceOffer({ invoiceNumber });
    }
  }

  async function confirmAdvanceToInvoiced() {
    try {
      await updateStatus(projectId, "INVOICED");
      toast.success("Moved to Invoiced");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setAdvanceOffer(null);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    try {
      await invoiceWrites.void(voidTarget.id, voidReason);
      toast.success(`Voided ${voidTarget.number}`);
      setVoidTarget(null);
      setVoidReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to void invoice");
    }
  }

  async function confirmVoidPayment() {
    if (!paymentVoidTarget) return;
    try {
      await paymentWrites.void(paymentVoidTarget.id, paymentVoidReason);
      toast.success("Payment voided");
      setPaymentVoidTarget(null);
      setPaymentVoidReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to void payment");
    }
  }

  return (
    <div className="space-y-6">
      {/* Quote revisions (#986, #989) */}
      <ProjectQuoteRail
        projectId={projectId}
        orgId={orgId}
        projectNumber={projectNumber}
        clientId={clientId}
        projectStatus={projectStatus}
        subtotal={subtotal}
        taxAmount={taxAmount}
        total={total}
      />

      {/* Nudge chips */}
      {paymentProfile === "DEPOSIT_BALANCE" ? (
        <div className="flex flex-wrap gap-2">
          {!hasDeposit && (
            <NudgeChip label={`Deposit not yet invoiced (${depositPercent}%)`} action="Create deposit invoice" onAction={() => setDepositDialogOpen(true)} />
          )}
          {depositIssued && !hasBalance && (
            <NudgeChip label="Balance not yet invoiced" action="Create balance invoice" onAction={() => void createInvoice("BALANCE")} />
          )}
        </div>
      ) : (
        !hasFull && (
          <div className="flex flex-wrap gap-2">
            <NudgeChip label="Not yet invoiced" action="Create invoice" onAction={() => void createInvoice("FULL")} />
          </div>
        )
      )}

      {/* Invoices list */}
      <div className="space-y-2">
        <h3 className="t-overline text-fg-3">Invoices</h3>
        {invoices.length === 0 ? (
          <p className="t-micro text-fg-4">No invoices yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                projectId={projectId}
                orgId={orgId}
                xeroLinked={xeroLinked}
                onIssue={() => setIssueTarget({ id: inv.id, kind: inv.kind, total: inv.total })}
                onDeleteDraft={() =>
                  void invoiceWrites.deleteDraft(inv.id).then(() => toast.success("Draft deleted")).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                }
                onVoidRequest={() => setVoidTarget({ id: inv.id, number: inv.invoiceNumber ?? inv.id })}
                onDeleteVoidRequest={() => setDeleteVoidTarget({ id: inv.id, label: inv.invoiceNumber ?? inv.id })}
                onRecordPaymentRequest={(balanceRemaining) =>
                  setRecordPaymentTarget({ id: inv.id, number: inv.invoiceNumber ?? inv.id, balanceRemaining })
                }
                onVoidPaymentRequest={(paymentId, amount) => setPaymentVoidTarget({ id: paymentId, amount })}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voidTarget?.number}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Why is this invoice being voided?"
            rows={3}
          />
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button type="button" disabled={voidReason.trim().length === 0} onClick={() => void confirmVoid()}>Void invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {issueTarget && (
        <IssueInvoiceDialog
          open={!!issueTarget}
          onOpenChange={(open) => !open && setIssueTarget(null)}
          projectId={projectId}
          invoiceId={issueTarget.id}
          invoiceKind={issueTarget.kind}
          total={issueTarget.total}
          onIssued={(invoiceNumber) => offerAdvanceIfEligible(issueTarget.id, invoiceNumber)}
        />
      )}

      {/* Offered, not forced — a `Dialog`, never `window.confirm` (#989). */}
      <Dialog open={!!advanceOffer} onOpenChange={(open) => !open && setAdvanceOffer(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move this project to Invoiced?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-fg-4">
            {advanceOffer?.invoiceNumber} has been issued. This project can move to Invoiced whenever you&rsquo;re ready — it&rsquo;s not required.
          </p>
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => setAdvanceOffer(null)}>Not yet</Button>
            <Button type="button" onClick={() => void confirmAdvanceToInvoiced()}>Move to Invoiced</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {depositDialogOpen && clientId && (
        <CreateDepositInvoiceDialog
          open={depositDialogOpen}
          onOpenChange={setDepositDialogOpen}
          projectId={projectId}
          clientId={clientId}
          defaultDepositPercent={depositPercent}
          projectTotal={total ?? 0}
        />
      )}

      {recordPaymentTarget && (
        <RecordPaymentDialog
          open={!!recordPaymentTarget}
          onOpenChange={(open) => !open && setRecordPaymentTarget(null)}
          invoiceId={recordPaymentTarget.id}
          invoiceNumber={recordPaymentTarget.number}
          balanceRemaining={recordPaymentTarget.balanceRemaining}
        />
      )}

      <Dialog open={!!paymentVoidTarget} onOpenChange={(open) => !open && setPaymentVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {paymentVoidTarget ? formatCurrency(paymentVoidTarget.amount) : ""} payment</DialogTitle>
          </DialogHeader>
          <Textarea
            value={paymentVoidReason}
            onChange={(e) => setPaymentVoidReason(e.target.value)}
            placeholder="Why is this payment being voided?"
            rows={3}
          />
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => setPaymentVoidTarget(null)}>Cancel</Button>
            <Button type="button" disabled={paymentVoidReason.trim().length === 0} onClick={() => void confirmVoidPayment()}>Void payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteVoidTarget && (
        <DeleteVoidInvoiceDialog
          open={!!deleteVoidTarget}
          onOpenChange={(open) => !open && setDeleteVoidTarget(null)}
          invoiceId={deleteVoidTarget.id}
          label={deleteVoidTarget.label}
        />
      )}
    </div>
  );
}

interface InvoiceRowDoc {
  id: string;
  status: string;
  kind: string;
  invoiceNumber?: string;
  total: number;
  xeroSyncStatus?: string;
  lastSyncError?: string;
  /** The STORED document, rendered once at issue (#987). Null on a draft, and
   *  on an issued invoice whose render failed — hence the retry. */
  pdfFileId?: string;
  issuedAt?: number;
  /** Derived from this invoice's non-voided `payments` rows (#1055) — patched
   *  by paymentsWrites.ts, never hand-typed here. Absent = 0/UNPAID. */
  amountPaid?: number;
  paymentStatus?: string;
}

interface PaymentRowDoc {
  id: string;
  amount: number;
  method: string;
  paidAt: number;
  reference?: string;
  voidedAt?: number;
}

/** The overflow-menu cluster for an invoice row — Delete draft / Void /
 *  Delete permanently. `canDelete`/`canVoid` mirror the `<CanDo>` gates these
 *  replaced; still UX only, the server re-checks `invoice:delete`/
 *  `invoice:void` unconditionally. */
export function invoiceRowMenuActions(
  inv: InvoiceRowDoc,
  perms: { canDelete: boolean; canVoid: boolean },
  handlers: { onDeleteDraft: () => void; onVoidRequest: () => void; onDeleteVoidRequest: () => void },
): RowAction[] {
  const actions: RowAction[] = [];
  if (inv.status === "DRAFT" && perms.canDelete) {
    actions.push({ key: "delete-draft", label: "Delete draft", icon: Trash2, onClick: handlers.onDeleteDraft, destructive: true });
  }
  if (inv.status === "ISSUED" && perms.canVoid) {
    actions.push({ key: "void", label: "Void invoice", icon: Ban, onClick: handlers.onVoidRequest, destructive: true });
  }
  if (inv.status === "VOID" && perms.canDelete) {
    actions.push({ key: "delete-void", label: "Delete permanently", icon: Trash2, onClick: handlers.onDeleteVoidRequest, destructive: true });
  }
  return actions;
}

function InvoiceRow({
  invoice: inv,
  projectId,
  orgId,
  xeroLinked,
  onIssue,
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
  onIssue: () => void;
  onDeleteDraft: () => void;
  onVoidRequest: () => void;
  onDeleteVoidRequest: () => void;
  onRecordPaymentRequest: (balanceRemaining: number) => void;
  onVoidPaymentRequest: (paymentId: string, amount: number) => void;
}) {
  // Document + at most one visible "primary" action (Issue on a draft, Push
  // to Xero on an unsynced issued invoice) — everything else (Void, Delete
  // draft/permanently) collapses into the overflow menu (#1038) instead of a
  // row of pill buttons. Mirrors QuoteRowActions' consolidation in
  // project-quote-rail.tsx.
  const canDelete = useCanDo("invoice", "delete");
  const canVoid = useCanDo("invoice", "void");
  const canVoidPayment = useCanDo("invoice", "void_payment");
  const menuActions = invoiceRowMenuActions(inv, { canDelete, canVoid }, { onDeleteDraft, onVoidRequest, onDeleteVoidRequest });

  // Payments only ever exist against an invoice that was at some point ISSUED
  // (paymentsWrites.ts recordNative requires it) — skip the query for a DRAFT.
  const payments = useAuthedQuery(
    api.payments.listForInvoice,
    orgId && inv.status !== "DRAFT" ? { orgId, invoiceId: inv.id } : "skip",
  ) as PaymentRowDoc[] | undefined;
  const livePayments = (payments ?? []).filter((p) => p.voidedAt == null);
  const amountPaid = inv.amountPaid ?? 0;
  const balanceRemaining = inv.total - amountPaid;

  return (
    <li className="rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Badge status={INVOICE_STATUS_BADGE[inv.status] ?? "neutral"}>{inv.status}</Badge>
          <span className="font-medium text-fg">{inv.invoiceNumber ?? `${inv.kind} (draft)`}</span>
          <span className="text-fg-4">{formatCurrency(inv.total)}</span>
          {inv.status !== "DRAFT" && amountPaid > 0 && (
            <>
              <Badge status={PAYMENT_STATUS_BADGE[inv.paymentStatus ?? ""] ?? "warn"}>
                {PAYMENT_STATUS_LABEL[inv.paymentStatus ?? ""] ?? "Partially paid"}
              </Badge>
              <span className="text-fg-4">Balance {formatCurrency(balanceRemaining)}</span>
            </>
          )}
          {inv.xeroSyncStatus === "SYNCED" && <Badge status="ok">Synced to Xero</Badge>}
          {inv.xeroSyncStatus === "ERROR" && (
            <span className="flex items-center gap-1 text-destructive" title={inv.lastSyncError}>
              <AlertCircle className="h-3.5 w-3.5" /> Xero push failed
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <InvoiceDocumentAction invoice={inv} projectId={projectId} />
          {inv.status === "DRAFT" && (
            <CanDo resource="invoice" action="issue">
              <Button type="button" variant="line" size="sm" onClick={onIssue}>
                <Send className="h-3.5 w-3.5" /> Issue
              </Button>
            </CanDo>
          )}
          {inv.status === "ISSUED" && (
            <CanDo resource="invoice" action="record_payment">
              <Button type="button" variant="line" size="sm" onClick={() => onRecordPaymentRequest(balanceRemaining)}>
                <Wallet className="h-3.5 w-3.5" /> Record payment
              </Button>
            </CanDo>
          )}
          {xeroLinked && inv.status === "ISSUED" && (
            <CanDo resource="invoice" action="xero_push">
              <PushToXeroButton invoiceId={inv.id} alreadySynced={inv.xeroSyncStatus === "SYNCED"} />
            </CanDo>
          )}
          <RowActionsMenu actions={menuActions} label={`${inv.invoiceNumber ?? inv.kind} actions`} />
        </div>
      </div>

      {livePayments.length > 0 && (
        <ul className="mt-1.5 space-y-1 border-t border-line pt-1.5">
          {livePayments.map((p) => (
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
      )}
    </li>
  );
}

/**
 * The document side of an invoice (#987). An ISSUED invoice's PDF is rendered
 * once and stored, so re-downloading it can never produce a different document
 * from the one the client was sent — the row was already immutable, this is what
 * carries that past the database boundary. A VOIDed invoice keeps its document.
 *
 * A DRAFT has none by design: its amounts are still mutable, so the only
 * document it can produce is the watermarked preview.
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

  // A draft's only document is the watermarked preview — the one place a
  // client-facing finance PDF is still rendered from live state, and it says
  // "NOT SENT" on every page.
  if (inv.issuedAt == null) {
    return (
      <Button variant="line" size="sm" asChild>
        <a href={`/api/documents/${projectId}?type=invoice&preview=1`} target="_blank" rel="noopener noreferrer">
          <Eye className="h-3.5 w-3.5" /> Preview
        </a>
      </Button>
    );
  }

  return (
    <CanDo resource="invoice" action="issue">
      <Button
        type="button"
        variant="line"
        size="sm"
        loading={retry.isPending}
        onClick={() => retry.mutate(undefined)}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-warn" /> Document missing — generate
      </Button>
    </CanDo>
  );
}

function NudgeChip({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn-soft px-3 py-1.5 text-caption text-warn">
      <span>{label}</span>
      <CanDo resource="invoice" action="create">
        <button type="button" onClick={onAction} className="font-semibold underline underline-offset-2">
          {action}
        </button>
      </CanDo>
    </div>
  );
}

/**
 * `alreadySynced` only picks the IDLE label/toast wording — pushInvoiceToXero
 * itself decides create-vs-update from the invoice's own `xeroInvoiceId`
 * (whichever this button's prop reflects, since both read the same row), so
 * they can never disagree. A synced invoice keeps showing this button
 * (rather than disappearing once `xeroSyncStatus === "SYNCED"`, as it used
 * to) so a Flow-side correction — a fixed line description, a corrected
 * account/tax coding — has a way back into the SAME Xero invoice instead of
 * requiring a manual edit there.
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
    // pushInvoiceToXero never throws — it always resolves to { ok, ... } so its
    // failure message survives Next's production Server Action redaction. This
    // stays only as a last-resort net for a genuinely unexpected framework error.
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button type="button" variant={alreadySynced ? "line" : "primary"} size="sm" loading={pushMutation.isPending} onClick={() => pushMutation.mutate(undefined)}>
      <UploadCloud className="h-3.5 w-3.5" /> {alreadySynced ? "Update in Xero" : "Push to Xero"}
    </Button>
  );
}
