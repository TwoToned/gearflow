"use client";
// use-client: interactive — dialog state + Convex subscriptions (R-8.1.1)

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus, Wallet } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../../convex/_generated/api";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  deriveInvoicingState,
  INVOICING_HEADLINE_LABEL,
  type InvoiceLike,
  type InvoicingState,
} from "@/lib/project-invoicing-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { CanDo } from "@/components/auth/permission-gate";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreatePartialInvoiceDialog } from "@/components/projects/finance/create-partial-invoice-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { InvoiceManagerDialog } from "@/components/projects/finance/invoice-manager-dialog";
import { OverviewCardHeader, OverviewAmount, OverviewMetaList, OverviewActions } from "./card-parts";

interface InvoicingCardProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  projectStatus?: string | null;
  clientId?: string | null;
  total: number | null;
}

const HEADLINE_BADGE = {
  NOT_STARTED: "neutral",
  DRAFT: "neutral",
  AWAITING_PAYMENT: "warn",
  PARTIALLY_PAID: "warn",
  PAID_IN_FULL: "ok",
} as const;

/** Only the figures that mean something: a zero "Paid" row is noise, and
 *  "Not yet raised" is irrelevant once everything is on an invoice. */
function moneyRows(state: InvoicingState) {
  return [
    { label: "Invoiced to date", value: formatCurrency(state.invoicedTotal) },
    state.paidTotal > 0 && { label: "Paid", value: formatCurrency(state.paidTotal) },
    state.notYetInvoiced != null &&
      state.notYetInvoiced > 0.005 && {
        label: "Not yet raised",
        value: formatCurrency(state.notYetInvoiced),
      },
  ];
}

interface InvoicingView {
  state: InvoicingState;
  depositPercent: number;
  clientName: string | undefined;
}

/**
 * The card's inputs, resolved from the two reads. `null` while either is still
 * loading. `profileDepositPercent` (default 25) only seeds the partial-invoice
 * dialog's default % — it no longer gates which invoice actions are offered
 * (that rigidity was dropped; see project-invoicing-state.ts).
 */
function deriveInvoicingView(
  invoices: unknown[] | undefined,
  client: { profileDepositPercent?: unknown; name?: unknown } | null | undefined,
  total: number | null,
): InvoicingView | null {
  if (invoices === undefined || client === undefined) return null;
  const depositPercent = (client?.profileDepositPercent as number | undefined) ?? 25;
  return {
    state: deriveInvoicingState(invoices as InvoiceLike[], depositPercent, total),
    depositPercent,
    clientName: client?.name as string | undefined,
  };
}

/** Quotes and invoices are addressed to somebody — without a client there is
 *  no card to show, only the thing to fix. */
function NoClientPanel() {
  return (
    <Panel className="p-4">
      <OverviewAmount value={null} />
      <p className="mt-2 text-caption text-muted">Assign a client to this project to raise quotes and invoices.</p>
    </Panel>
  );
}

function LoadingPanel() {
  return (
    <Panel className="p-4">
      <p className="text-caption text-muted">Loading invoicing…</p>
    </Panel>
  );
}

function InvoicingCardBody({
  state,
  clientName,
  depositPercent,
}: {
  state: InvoicingState;
  clientName: string | undefined;
  depositPercent: number;
}) {
  const { latestIssued } = state;
  const nothingRaised = state.liveInvoices.length === 0;
  const terms = `${clientName ?? "This client"}'s partial invoices default to ${depositPercent}%.`;

  return (
    <div className="flex-1 px-4 py-3.5">
      <OverviewAmount
        // Nothing raised is not "$0.00 outstanding" — it's an unanswered
        // question, so the amount stays a faint em-dash until it means something.
        value={nothingRaised ? null : state.outstanding}
        suffix="outstanding"
        tone={state.headline === "PAID_IN_FULL" ? "ok" : "default"}
      />

      {nothingRaised ? (
        <p className="mt-3 text-caption text-muted">{terms} Nothing raised yet.</p>
      ) : (
        <OverviewMetaList rows={moneyRows(state)} />
      )}

      {latestIssued && <LastIssuedLine invoice={latestIssued} />}
    </div>
  );
}

function LastIssuedLine({ invoice }: { invoice: InvoiceLike }) {
  return (
    <p className="mt-3 text-caption text-faint">
      Last: <span className="font-mono text-ink-2">{invoice.invoiceNumber ?? "—"}</span>{" "}
      {invoice.kind.toLowerCase()} issued {invoice.issuedAt ? formatDate(new Date(invoice.issuedAt)) : "—"}
    </p>
  );
}

/** Raise the next invoice as a DRAFT. Issuing it stays a separate, deliberate
 *  step in the Finance tab — creating and issuing are not the same decision,
 *  and issuing is what assigns the permanent invoice number. */
async function createInvoiceDraft(
  invoiceWrites: ReturnType<typeof useInvoiceWrites>,
  projectId: string,
  clientId: string,
  kind: "FULL" | "BALANCE",
): Promise<void> {
  try {
    await invoiceWrites.create(projectId, clientId, { kind });
    toast.success(`${kind === "FULL" ? "Invoice" : "Balance invoice"} draft created`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Failed to create invoice");
  }
}

function payTargetFor(inv: InvoiceLike): PayTarget {
  return {
    id: inv.id,
    number: inv.invoiceNumber ?? "",
    balanceRemaining: inv.total - (inv.amountPaid ?? 0),
  };
}

/** The invoice menu (partial / remaining balance), plus a payment to record if
 *  one is outstanding. Both actions can be available at once — a project can
 *  carry several partial invoices before the remaining balance is raised, in
 *  any order (#1061 redesign — no more forced deposit-then-balance sequence). */
function InvoicingActions({
  partialStep,
  remainingStep,
  unpaidIssued,
  hasInvoices,
  onCreatePartial,
  onCreateInvoice,
  onRecordPayment,
  onManage,
}: {
  partialStep: InvoicingState["partialStep"];
  remainingStep: InvoicingState["remainingStep"];
  unpaidIssued: InvoiceLike | undefined;
  hasInvoices: boolean;
  onCreatePartial: () => void;
  onCreateInvoice: (kind: "FULL" | "BALANCE") => void;
  onRecordPayment: (inv: InvoiceLike) => void;
  onManage: () => void;
}) {
  return (
    <OverviewActions>
      <CanDo resource="invoice" action="create">
        {partialStep.kind === "NONE" && remainingStep.kind === "NONE" ? (
          hasInvoices && <span className="text-caption text-faint">{partialStep.reason}</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-7">
                <Plus className="mr-1 size-3" />
                Invoice
                <ChevronDown className="ml-1 size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {partialStep.kind === "DEPOSIT" && (
                <DropdownMenuItem onClick={onCreatePartial}>Partial balance…</DropdownMenuItem>
              )}
              {remainingStep.kind !== "NONE" && (
                <DropdownMenuItem onClick={() => onCreateInvoice(remainingStep.kind as "FULL" | "BALANCE")}>
                  Remaining balance
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CanDo>
      {unpaidIssued && (
        <CanDo resource="invoice" action="update">
          <Button variant="line" size="sm" className="h-7" onClick={() => onRecordPayment(unpaidIssued)}>
            <Wallet className="mr-1 size-3" />
            Record payment
          </Button>
        </CanDo>
      )}
      <Button variant="line" size="sm" className="h-7" onClick={onManage}>
        All invoices
      </Button>
    </OverviewActions>
  );
}

/**
 * Where this project's invoicing stands, on the Overview tab (#1061).
 *
 * The headline is what's OUTSTANDING (issued and unpaid), not the invoice
 * total — the number a PM actually chases. What hasn't been raised yet is a
 * separate row, because "not invoiced" and "invoiced but unpaid" are different
 * problems with different fixes.
 *
 * The available actions come from `deriveInvoicingState`, the same rule the
 * Finance tab's invoice menu reads (R-3.1) — a partial (any % or $ slice) and
 * a remaining-balance invoice are both offered any time there's something
 * left, in any order, any number of partials. "All invoices" opens the
 * `InvoiceManagerDialog` (the SAME `<ProjectInvoiceLedger>` the Finance tab
 * embeds) for issuing, voiding, crediting, Xero pushes and the full list —
 * no need to leave Overview for the rest of the workflow.
 */
export function InvoicingCard({ projectId, orgId, projectNumber, projectStatus, clientId, total }: InvoicingCardProps) {
  const [partialOpen, setPartialOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ id: string; number: string; balanceRemaining: number } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");
  const invoiceWrites = useInvoiceWrites();

  if (!clientId) return <NoClientPanel />;
  const view = deriveInvoicingView(invoices, client, total);
  if (!view) return <LoadingPanel />;

  const { state, depositPercent, clientName } = view;
  const { partialStep, remainingStep } = state;

  return (
    <Panel className="flex flex-col p-0">
      <OverviewCardHeader
        title="Invoicing"
        badge={<Badge status={HEADLINE_BADGE[state.headline]}>{INVOICING_HEADLINE_LABEL[state.headline]}</Badge>}
      />

      <InvoicingCardBody state={state} clientName={clientName} depositPercent={depositPercent} />

      <InvoicingActions
        partialStep={partialStep}
        remainingStep={remainingStep}
        unpaidIssued={state.firstUnpaidIssued ?? undefined}
        hasInvoices={state.liveInvoices.length > 0}
        onCreatePartial={() => setPartialOpen(true)}
        onCreateInvoice={(kind) => void createInvoiceDraft(invoiceWrites, projectId, clientId, kind)}
        onRecordPayment={(inv) => setPayTarget(payTargetFor(inv))}
        onManage={() => setManageOpen(true)}
      />

      <InvoicingDialogs
        projectId={projectId}
        clientId={clientId}
        depositPercent={depositPercent}
        total={total}
        remainingAmount={state.notYetInvoiced ?? 0}
        partialOpen={partialOpen}
        onPartialOpenChange={setPartialOpen}
        payTarget={payTarget}
        onPayTargetChange={setPayTarget}
      />

      <InvoiceManagerDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        projectId={projectId}
        orgId={orgId}
        projectNumber={projectNumber}
        clientId={clientId}
        projectStatus={projectStatus}
        total={total}
      />
    </Panel>
  );
}

interface PayTarget {
  id: string;
  number: string;
  balanceRemaining: number;
}

function InvoicingDialogs({
  projectId,
  clientId,
  depositPercent,
  total,
  remainingAmount,
  partialOpen,
  onPartialOpenChange,
  payTarget,
  onPayTargetChange,
}: {
  projectId: string;
  clientId: string;
  depositPercent: number;
  total: number | null;
  remainingAmount: number;
  partialOpen: boolean;
  onPartialOpenChange: (open: boolean) => void;
  payTarget: PayTarget | null;
  onPayTargetChange: (target: PayTarget | null) => void;
}) {
  return (
    <>
      {partialOpen && (
        <CreatePartialInvoiceDialog
          open={partialOpen}
          onOpenChange={onPartialOpenChange}
          projectId={projectId}
          clientId={clientId}
          defaultDepositPercent={depositPercent}
          projectTotal={total ?? 0}
          remainingAmount={remainingAmount}
        />
      )}
      {payTarget && (
        <RecordPaymentDialog
          open={!!payTarget}
          onOpenChange={(open) => !open && onPayTargetChange(null)}
          invoiceId={payTarget.id}
          invoiceNumber={payTarget.number}
          balanceRemaining={payTarget.balanceRemaining}
          onRecorded={() => onPayTargetChange(null)}
        />
      )}
    </>
  );
}
