"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { api } from "../../../../convex/_generated/api";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { usePaymentWrites } from "@/hooks/use-payment-writes";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { convexErrorMessage } from "@/lib/errors/convex-error-message";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CanDo } from "@/components/auth/permission-gate";
import { IssueInvoiceDialog } from "@/components/projects/finance/issue-invoice-dialog";
import { CreatePartialInvoiceDialog } from "@/components/projects/finance/create-partial-invoice-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { DeleteVoidInvoiceDialog } from "@/components/projects/finance/delete-void-invoice-dialog";
import { CreditNoteDialog } from "@/components/projects/finance/credit-note-dialog";
import { InvoiceRow, type InvoiceRowDoc } from "@/components/projects/finance/invoice-row";
import { clientDepositPercent, deriveInvoicingState, type InvoiceLike } from "@/lib/project-invoicing-state";

interface ProjectInvoiceLedgerProps {
  projectId: string;
  orgId: string | undefined;
  clientId?: string | null;
  projectStatus?: string | null;
  total: number | null;
}

/**
 * The Finance tab's INVOICE strip (WS1 #940, reworked by #986 and UX Phase 10).
 * Self-contained so the Overview tab's `InvoiceManagerDialog` embeds the SAME
 * component with zero logic duplication (POLICY.md R-3.1); it self-queries
 * `invoices`/`client` rather than depending on a parent.
 *
 * An "Invoice ▾" menu offers a partial balance (any % or $ slice, any number of
 * times) and a remaining-balance invoice whenever there's something left to
 * raise, in any order. Its availability is DERIVED (`deriveInvoicingState`), not
 * a stored flag.
 *
 * Draft creation stays ungated; ISSUING requires the quote at its linked
 * `sourceRevision` to be currently ACCEPTED — enforced server-side in
 * `issueNative`, surfaced here only as the mutation's error message. Issuing
 * goes through `<IssueInvoiceDialog>` (#989), and the "advance to INVOICED?"
 * follow-up is a `Dialog`, never `window.confirm`. Every DOCUMENT action (#987)
 * is the stored, immutable artifact for anything issued, a watermarked preview
 * for a draft, and an explicit retry when a render failed — never a fresh render
 * of live project state (see `invoice-row.tsx`). Rows are `InvoiceRow`s: one
 * status word (D56), `Issue…` / `Credit note…` / Void in ⋯.
 */
export function ProjectInvoiceLedger({ projectId, orgId, clientId, projectStatus, total }: ProjectInvoiceLedgerProps) {
  const xeroLinked = useXeroLinked();
  const now = useStableNow();

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");

  const invoiceWrites = useInvoiceWrites();
  const paymentWrites = usePaymentWrites();
  const { updateStatus } = useNativeProjectStatus(orgId);

  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [issueTarget, setIssueTarget] = useState<{ id: string; kind: string; total: number } | null>(null);
  const [creditTarget, setCreditTarget] = useState<{ id: string; number: string; total: number } | null>(null);
  const [advanceOffer, setAdvanceOffer] = useState<{ invoiceNumber: string } | null>(null);
  const [partialDialogOpen, setPartialDialogOpen] = useState(false);
  const [recordPaymentTarget, setRecordPaymentTarget] = useState<{ id: string; number: string; balanceRemaining: number } | null>(null);
  const [paymentVoidTarget, setPaymentVoidTarget] = useState<{ id: string; amount: number } | null>(null);
  const [paymentVoidReason, setPaymentVoidReason] = useState("");
  const [deleteVoidTarget, setDeleteVoidTarget] = useState<{ id: string; label: string } | null>(null);

  if (!clientId) {
    return <p className="t-micro text-fg-4">Assign a client to this job to generate invoices.</p>;
  }
  if (invoices === undefined || client === undefined) {
    return <p className="t-micro text-fg-4">Loading…</p>;
  }

  const depositPercent = clientDepositPercent(client);

  // One derivation, shared with the Overview tab's invoicing card and the
  // tiles (R-3.1).
  const invoicingState = deriveInvoicingState(invoices as InvoiceLike[], depositPercent, total, now);
  const { partialStep, remainingStep } = invoicingState;

  async function createInvoice(kind: "FULL" | "BALANCE") {
    try {
      await invoiceWrites.create(projectId, clientId!, { kind });
      toast.success(`${kind} invoice draft created`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Failed to create invoice"));
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
      toast.error(convexErrorMessage(e, "Failed to update status"));
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
      toast.error(convexErrorMessage(e, "Failed to void invoice"));
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
      toast.error(convexErrorMessage(e, "Failed to void payment"));
    }
  }

  const rows = invoices as (InvoiceRowDoc & { projectId?: string })[];

  return (
    <div className="space-y-6">
      {/* Invoice menu — the SAME derivation the Overview tab's invoicing card
          reads (`deriveInvoicingState`, R-3.1). Both a partial and a
          remaining-balance invoice can be offered at once — no forced order. */}
      {(partialStep.kind !== "NONE" || remainingStep.kind !== "NONE") && (
        <div className="flex flex-wrap gap-2">
          <InvoiceMenuChip
            label="Not yet fully invoiced"
            partialAvailable={partialStep.kind === "DEPOSIT"}
            remainingAvailable={remainingStep.kind !== "NONE"}
            onPartial={() => setPartialDialogOpen(true)}
            onRemaining={() => remainingStep.kind !== "NONE" && void createInvoice(remainingStep.kind as "FULL" | "BALANCE")}
          />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="t-overline text-fg-3">Invoices</h3>
        {rows.length === 0 ? (
          <p className="t-micro text-fg-4">No invoices yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                projectId={projectId}
                orgId={orgId}
                xeroLinked={xeroLinked}
                now={now}
                hasCreditNote={rows.some((c) => c.kind === "CREDIT" && c.status !== "VOID" && c.creditForInvoiceId === inv.id)}
                onIssue={() => setIssueTarget({ id: inv.id, kind: inv.kind, total: inv.total })}
                onCreditRequest={() => setCreditTarget({ id: inv.id, number: inv.invoiceNumber ?? inv.id, total: inv.total })}
                onDeleteDraft={() =>
                  void invoiceWrites.deleteDraft(inv.id).then(() => toast.success("Draft deleted")).catch((e) => toast.error(convexErrorMessage(e, "Failed")))
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

      {creditTarget && (
        <CreditNoteDialog
          open={!!creditTarget}
          onOpenChange={(open) => !open && setCreditTarget(null)}
          invoiceId={creditTarget.id}
          invoiceNumber={creditTarget.number}
          total={creditTarget.total}
        />
      )}

      {/* Offered, not forced — a `Dialog`, never `window.confirm` (#989). */}
      <Dialog open={!!advanceOffer} onOpenChange={(open) => !open && setAdvanceOffer(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move this job to Invoiced?</DialogTitle>
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

      {partialDialogOpen && clientId && (
        <CreatePartialInvoiceDialog
          open={partialDialogOpen}
          onOpenChange={setPartialDialogOpen}
          projectId={projectId}
          clientId={clientId}
          defaultDepositPercent={depositPercent}
          projectTotal={total ?? 0}
          remainingAmount={invoicingState.notYetInvoiced ?? 0}
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

/** The nudge chip's menu — a partial (any % or $ slice, any number of times)
 *  and a remaining-balance invoice, offered independently since a project can
 *  carry several partials before the remainder is raised (no forced order). */
function InvoiceMenuChip({
  label,
  partialAvailable,
  remainingAvailable,
  onPartial,
  onRemaining,
}: {
  label: string;
  partialAvailable: boolean;
  remainingAvailable: boolean;
  onPartial: () => void;
  onRemaining: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn-soft px-3 py-1.5 text-caption text-warn">
      <span>{label}</span>
      <CanDo resource="invoice" action="create">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center font-semibold underline underline-offset-2">
              Invoice
              <ChevronDown className="ml-0.5 size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {partialAvailable && <DropdownMenuItem onClick={onPartial}>Partial balance…</DropdownMenuItem>}
            {remainingAvailable && <DropdownMenuItem onClick={onRemaining}>Remaining balance</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </CanDo>
    </div>
  );
}
