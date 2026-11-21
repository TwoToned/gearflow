"use client";
// use-client: interactive — dialog state + Convex subscriptions (R-8.1.1)

import { useState } from "react";
import { toast } from "sonner";

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
import { CanDo } from "@/components/auth/permission-gate";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreatePartialInvoiceDialog } from "@/components/projects/finance/create-partial-invoice-dialog";
import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";
import { InvoiceManagerDialog } from "@/components/projects/finance/invoice-manager-dialog";
import { OverviewLabel, OverviewLine, OverviewLinks, OverviewTextButton } from "./overview-parts";

interface InvoicingLineProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  projectStatus?: string | null;
  clientId?: string | null;
  total: number | null;
  onOpenFinance: () => void;
}

const money = (n: number) => formatCurrency(n, undefined, { cents: false });

interface InvoicingView {
  state: InvoicingState;
  depositPercent: number;
  clientName: string | undefined;
}

/**
 * The line's inputs, resolved from the two reads. `null` while either is still
 * loading. `profileDepositPercent` (default 25) only seeds the partial-invoice
 * dialog's default % — it does not gate which invoice actions are offered.
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

/**
 * The derivation's own words (UX Phase 7 renders EXACTLY what
 * `deriveInvoicingState` says; merging it with `computePaymentProgress` and
 * adding `Deposit paid` is Phase 10's): the headline label, then the figures
 * that mean something — outstanding, invoiced, paid.
 */
export function invoicingStateWords(view: InvoicingView): { line: string; detail: string | null } {
  const { state, clientName, depositPercent } = view;
  const headline = INVOICING_HEADLINE_LABEL[state.headline];
  if (state.liveInvoices.length === 0) {
    return { line: "Nothing invoiced yet", detail: `${clientName ?? "This client"}'s partial invoices default to ${depositPercent}%` };
  }
  const figures = [`${money(state.invoicedTotal)} invoiced`, state.paidTotal > 0 ? `${money(state.paidTotal)} paid` : null];
  const outstanding = state.outstanding > 0.005 ? `${money(state.outstanding)} outstanding` : null;
  return { line: [headline, outstanding].filter(Boolean).join(" · "), detail: figures.filter(Boolean).join(" · ") };
}

/** The next step under the state: what is left to raise, or the last invoice out. */
export function invoicingNextWords(state: InvoicingState): string | null {
  const parts: string[] = [];
  if (state.notYetInvoiced != null && state.notYetInvoiced > 0.005 && state.liveInvoices.length > 0) {
    parts.push(`${money(state.notYetInvoiced)} not yet raised`);
  }
  const last = state.latestIssued;
  if (last) {
    const issued = last.issuedAt ? ` issued ${formatDate(new Date(last.issuedAt))}` : "";
    parts.push(`Last: ${last.invoiceNumber ?? "—"} ${last.kind.toLowerCase()}${issued}`);
  }
  return parts.length ? parts.join(" · ") : null;
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

interface PayTarget {
  id: string;
  number: string;
  balanceRemaining: number;
}

function payTargetFor(inv: InvoiceLike): PayTarget {
  return { id: inv.id, number: inv.invoiceNumber ?? "", balanceRemaining: inv.total - (inv.amountPaid ?? 0) };
}

/** `+ Invoice ▾` (partial / remaining balance), shown only while something is left to raise. */
function InvoiceMenu({
  state,
  onCreatePartial,
  onCreateInvoice,
}: {
  state: InvoicingState;
  onCreatePartial: () => void;
  onCreateInvoice: (kind: "FULL" | "BALANCE") => void;
}) {
  const { partialStep, remainingStep } = state;
  if (partialStep.kind === "NONE" && remainingStep.kind === "NONE") return null;
  return (
    <CanDo resource="invoice" action="create">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <OverviewTextButton>+ Invoice ▾</OverviewTextButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {partialStep.kind === "DEPOSIT" && <DropdownMenuItem onClick={onCreatePartial}>Partial balance…</DropdownMenuItem>}
          {remainingStep.kind !== "NONE" && (
            <DropdownMenuItem onClick={() => onCreateInvoice(remainingStep.kind as "FULL" | "BALANCE")}>Remaining balance</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </CanDo>
  );
}

function InvoicingBody({ view, onCreatePartial, onCreateInvoice, onRecordPayment, onManage, onOpenFinance }: {
  view: InvoicingView;
  onCreatePartial: () => void;
  onCreateInvoice: (kind: "FULL" | "BALANCE") => void;
  onRecordPayment: (inv: InvoiceLike) => void;
  onManage: () => void;
  onOpenFinance: () => void;
}) {
  const words = invoicingStateWords(view);
  const next = invoicingNextWords(view.state);
  const unpaid = view.state.firstUnpaidIssued;
  return (
    <>
      <OverviewLine>
        {words.line}
        {words.detail ? <span className="text-muted"> · {words.detail}</span> : null}
      </OverviewLine>
      {next ? <OverviewLine muted>{next}</OverviewLine> : null}
      <OverviewLinks>
        <InvoiceMenu state={view.state} onCreatePartial={onCreatePartial} onCreateInvoice={onCreateInvoice} />
        {unpaid ? (
          <CanDo resource="invoice" action="update">
            <OverviewTextButton onClick={() => onRecordPayment(unpaid)}>Record payment</OverviewTextButton>
          </CanDo>
        ) : null}
        <OverviewTextButton onClick={onManage}>All invoices</OverviewTextButton>
        <OverviewTextButton onClick={onOpenFinance}>Finance ›</OverviewTextButton>
      </OverviewLinks>
    </>
  );
}

/**
 * The Overview's invoicing line (spec §6b, UX Phase 7; was the #1061
 * Invoicing card). Quotes and invoices are addressed to somebody, so without a
 * client it says what to fix. The actions come from `deriveInvoicingState`,
 * the same rule the Finance tab's invoice menu reads (R-3.1). `All invoices`
 * opens the `InvoiceManagerDialog` (the SAME `<ProjectInvoiceLedger>` the
 * Finance tab embeds) for issuing, voiding, crediting and Xero pushes.
 */
export function InvoicingMoneyLine({ projectId, orgId, projectNumber, projectStatus, clientId, total, onOpenFinance }: InvoicingLineProps) {
  const [partialOpen, setPartialOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");
  const invoiceWrites = useInvoiceWrites();

  const view = clientId ? deriveInvoicingView(invoices, client, total) : null;

  return (
    <div className="min-w-0">
      <OverviewLabel>Invoicing</OverviewLabel>
      {!clientId ? (
        <OverviewLine muted>Assign a client to this job to raise quotes and invoices.</OverviewLine>
      ) : !view ? (
        <OverviewLine muted>Loading invoicing…</OverviewLine>
      ) : (
        <>
          <InvoicingBody
            view={view}
            onCreatePartial={() => setPartialOpen(true)}
            onCreateInvoice={(kind) => void createInvoiceDraft(invoiceWrites, projectId, clientId, kind)}
            onRecordPayment={(inv) => setPayTarget(payTargetFor(inv))}
            onManage={() => setManageOpen(true)}
            onOpenFinance={onOpenFinance}
          />
          {partialOpen && (
            <CreatePartialInvoiceDialog
              open={partialOpen}
              onOpenChange={setPartialOpen}
              projectId={projectId}
              clientId={clientId}
              defaultDepositPercent={view.depositPercent}
              projectTotal={total ?? 0}
              remainingAmount={view.state.notYetInvoiced ?? 0}
            />
          )}
          {payTarget && (
            <RecordPaymentDialog
              open
              onOpenChange={(open) => !open && setPayTarget(null)}
              invoiceId={payTarget.id}
              invoiceNumber={payTarget.number}
              balanceRemaining={payTarget.balanceRemaining}
              onRecorded={() => setPayTarget(null)}
            />
          )}
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
        </>
      )}
    </div>
  );
}
