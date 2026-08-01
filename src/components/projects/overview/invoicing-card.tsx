"use client";
// use-client: interactive — dialog state + Convex subscriptions (R-8.1.1)

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Wallet } from "lucide-react";

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
import { CreateDepositInvoiceDialog } from "@/components/projects/finance/create-deposit-invoice-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { OverviewCardHeader, OverviewAmount, OverviewMetaList, OverviewActions } from "./card-parts";

interface InvoicingCardProps {
  projectId: string;
  orgId: string | undefined;
  clientId?: string | null;
  total: number | null;
  onOpenLedger: () => void;
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
  paymentProfile: string;
  depositPercent: number;
  clientName: string | undefined;
}

/**
 * The card's inputs, resolved from the two reads. `null` while either is still
 * loading. The profile defaults mirror `project-finance-panel.tsx`'s — a client
 * with no stated profile is invoiced in full, and 25% is the deposit default.
 */
function deriveInvoicingView(
  invoices: unknown[] | undefined,
  client: { paymentProfile?: unknown; profileDepositPercent?: unknown; name?: unknown } | null | undefined,
  total: number | null,
): InvoicingView | null {
  if (invoices === undefined || client === undefined) return null;
  const paymentProfile = (client?.paymentProfile as string | undefined) ?? "FULL_UPFRONT";
  const depositPercent = (client?.profileDepositPercent as number | undefined) ?? 25;
  return {
    state: deriveInvoicingState(invoices as InvoiceLike[], paymentProfile, depositPercent, total),
    paymentProfile,
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
  paymentProfile,
  depositPercent,
}: {
  state: InvoicingState;
  clientName: string | undefined;
  paymentProfile: string;
  depositPercent: number;
}) {
  const { latestIssued } = state;
  const nothingRaised = state.liveInvoices.length === 0;
  const terms =
    paymentProfile === "DEPOSIT_BALANCE"
      ? `${clientName ?? "This client"} is on ${depositPercent}% deposit terms.`
      : `${clientName ?? "This client"} is invoiced in full.`;

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

/** The next invoice to raise, plus a payment to record if one is outstanding. */
function InvoicingActions({
  nextStep,
  unpaidIssued,
  hasInvoices,
  onCreateDeposit,
  onCreateInvoice,
  onRecordPayment,
  onOpenLedger,
}: {
  nextStep: InvoicingState["nextStep"];
  unpaidIssued: InvoiceLike | undefined;
  hasInvoices: boolean;
  onCreateDeposit: () => void;
  onCreateInvoice: (kind: "FULL" | "BALANCE") => void;
  onRecordPayment: (inv: InvoiceLike) => void;
  onOpenLedger: () => void;
}) {
  return (
    <OverviewActions>
      <CanDo resource="invoice" action="create">
        {nextStep.kind === "DEPOSIT" && (
          <Button size="sm" className="h-7" onClick={onCreateDeposit}>
            <Plus className="mr-1 size-3" />
            {nextStep.label}
          </Button>
        )}
        {(nextStep.kind === "BALANCE" || nextStep.kind === "FULL") && (
          <Button size="sm" className="h-7" onClick={() => onCreateInvoice(nextStep.kind)}>
            <Plus className="mr-1 size-3" />
            {nextStep.label}
          </Button>
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
      <Button variant="line" size="sm" className="h-7" onClick={onOpenLedger}>
        All invoices
      </Button>
      {/* A dead button teaches nothing — when there's no next invoice to raise,
          say why instead of showing a disabled control. */}
      {nextStep.kind === "NONE" && hasInvoices && (
        <span className="text-caption text-faint">{nextStep.reason}</span>
      )}
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
 * The next step comes from `deriveInvoicingState`, the same rule the Finance
 * tab's nudge chips read (R-3.1) — deposit before balance, one full invoice
 * otherwise. Issuing, voiding, crediting, Xero pushes and the full invoice
 * list stay in the Finance tab.
 */
export function InvoicingCard({ projectId, orgId, clientId, total, onOpenLedger }: InvoicingCardProps) {
  const [depositOpen, setDepositOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ id: string; number: string; balanceRemaining: number } | null>(null);

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");
  const invoiceWrites = useInvoiceWrites();

  if (!clientId) return <NoClientPanel />;
  const view = deriveInvoicingView(invoices, client, total);
  if (!view) return <LoadingPanel />;

  const { state, paymentProfile, depositPercent, clientName } = view;
  const { nextStep } = state;

  return (
    <Panel className="flex flex-col p-0">
      <OverviewCardHeader
        title="Invoicing"
        badge={<Badge status={HEADLINE_BADGE[state.headline]}>{INVOICING_HEADLINE_LABEL[state.headline]}</Badge>}
      />

      <InvoicingCardBody
        state={state}
        clientName={clientName}
        paymentProfile={paymentProfile}
        depositPercent={depositPercent}
      />

      <InvoicingActions
        nextStep={nextStep}
        unpaidIssued={state.firstUnpaidIssued ?? undefined}
        hasInvoices={state.liveInvoices.length > 0}
        onCreateDeposit={() => setDepositOpen(true)}
        onCreateInvoice={(kind) => void createInvoiceDraft(invoiceWrites, projectId, clientId, kind)}
        onRecordPayment={(inv) => setPayTarget(payTargetFor(inv))}
        onOpenLedger={onOpenLedger}
      />

      <InvoicingDialogs
        projectId={projectId}
        clientId={clientId}
        depositPercent={depositPercent}
        total={total}
        depositOpen={depositOpen}
        onDepositOpenChange={setDepositOpen}
        payTarget={payTarget}
        onPayTargetChange={setPayTarget}
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
  depositOpen,
  onDepositOpenChange,
  payTarget,
  onPayTargetChange,
}: {
  projectId: string;
  clientId: string;
  depositPercent: number;
  total: number | null;
  depositOpen: boolean;
  onDepositOpenChange: (open: boolean) => void;
  payTarget: PayTarget | null;
  onPayTargetChange: (target: PayTarget | null) => void;
}) {
  return (
    <>
      {depositOpen && (
        <CreateDepositInvoiceDialog
          open={depositOpen}
          onOpenChange={onDepositOpenChange}
          projectId={projectId}
          clientId={clientId}
          defaultDepositPercent={depositPercent}
          projectTotal={total ?? 0}
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
