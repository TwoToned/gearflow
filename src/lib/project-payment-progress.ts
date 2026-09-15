/**
 * The money phase, DERIVED (#1236).
 *
 * `AWAITING_PAYMENT` is one project status covering the whole agreed-but-unpaid
 * phase. The finer sub-state a human actually wants to see — *"accepted, invoice
 * out, still unpaid"* — is **not** stored anywhere, because every part of it is
 * already a fact on a row that owns it:
 *
 * | Sub-step | Where the truth lives |
 * |---|---|
 * | Accepted | `quotes.status === "ACCEPTED"` (via `effectiveQuoteStatus`) |
 * | Invoice sent | an `invoices` row at `status: "ISSUED"` |
 * | Paid | `invoices.paymentStatus`, itself derived from `payments` by `paymentsWrites` |
 *
 * Copying any of those onto the project would be a second source of truth for
 * whether the client's money has landed — the same defect CLAUDE.md records for
 * discount percentages and category subtotals (R-3.1). So this module computes
 * the three steps on read, and nothing writes them.
 *
 * Pure and dependency-free so the strip, a test, and any future server-side
 * consumer share one definition.
 */

/** A step is `done` (it happened), `current` (what we're waiting on) or `pending`. */
export type PaymentStepState = "done" | "current" | "pending";

export type PaymentStepKey = "accepted" | "invoiced" | "paid";

export interface PaymentStep {
  key: PaymentStepKey;
  label: string;
  /** Short supporting fact — a date, an invoice number, an amount. Null when unknown. */
  detail: string | null;
  state: PaymentStepState;
}

/** The subset of a quote row this reads. `effectiveStatus` (never the stored
 *  `status`) — see CLAUDE.md, "Quote status is DERIVED". */
export interface PaymentProgressQuote {
  effectiveStatus: string;
  version: number;
  acceptedAt?: number | null;
}

/** The subset of an invoice row this reads. */
export interface PaymentProgressInvoice {
  kind: string;
  status: string;
  paymentStatus?: string | null;
  invoiceNumber?: string | null;
  total: number;
  amountPaid?: number | null;
  issuedAt?: number | null;
}

export interface PaymentProgress {
  steps: PaymentStep[];
  /** Total across non-VOID ISSUED invoices. */
  invoicedTotal: number;
  /** Total recorded against them. */
  paidTotal: number;
  /** `invoicedTotal - paidTotal`, floored at 0. */
  outstanding: number;
  /** True once every issued invoice is settled — the `PAYMENT_SETTLED` condition
   *  as a human reads it. (The server fires on the ONE invoice a payment just
   *  settled; this is the whole-project view the strip renders.) */
  allSettled: boolean;
}

/** A finance document that still counts — issued and not voided. */
function isLiveIssued(inv: PaymentProgressInvoice): boolean {
  return inv.status === "ISSUED";
}

/**
 * Compute the three sub-steps and the money position for a project's money phase.
 *
 * `formatDate` / `formatMoney` are injected rather than imported so this module
 * stays free of the locale stack (`formatters.ts` needs an org config the caller
 * already has) — and so a test can assert on the step shape without asserting on
 * a date format.
 */
export function computePaymentProgress(input: {
  quotes: readonly PaymentProgressQuote[];
  invoices: readonly PaymentProgressInvoice[];
  formatDate: (ms: number) => string;
  formatMoney: (amount: number) => string;
}): PaymentProgress {
  const { quotes, invoices, formatDate, formatMoney } = input;

  const accepted = quotes.find((q) => q.effectiveStatus === "ACCEPTED") ?? null;
  const issued = invoices.filter(isLiveIssued);
  const invoicedTotal = issued.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const paidTotal = issued.reduce((sum, i) => sum + (Number(i.amountPaid) || 0), 0);
  const outstanding = Math.max(0, round2(invoicedTotal - paidTotal));
  // `issued.length > 0` matters: a project with no invoice at all is not "settled",
  // it simply hasn't been billed — `every` over an empty list would say otherwise.
  const allSettled = issued.length > 0 && issued.every((i) => i.paymentStatus === "PAID");

  // The first step that hasn't happened is what we're waiting on; everything
  // after it is pending. Computed as one pass so two steps can never both read
  // as `current`.
  const done: Record<PaymentStepKey, boolean> = {
    accepted: accepted != null,
    invoiced: issued.length > 0,
    paid: allSettled,
  };
  let currentTaken = false;
  const stateFor = (key: PaymentStepKey): PaymentStepState => {
    if (done[key]) return "done";
    if (!currentTaken) {
      currentTaken = true;
      return "current";
    }
    return "pending";
  };

  const acceptedDetail =
    accepted?.acceptedAt != null ? `v${accepted.version} · ${formatDate(accepted.acceptedAt)}` : null;

  const issuedDetail = (() => {
    if (issued.length === 0) return null;
    if (issued.length === 1) {
      const only = issued[0];
      const number = only.invoiceNumber ?? null;
      const amount = formatMoney(Number(only.total) || 0);
      return number ? `${number} · ${amount}` : amount;
    }
    return `${issued.length} invoices · ${formatMoney(round2(invoicedTotal))}`;
  })();

  const paidDetail = (() => {
    if (issued.length === 0) return null;
    if (allSettled) return formatMoney(round2(paidTotal));
    if (paidTotal > 0) return `${formatMoney(round2(paidTotal))} of ${formatMoney(round2(invoicedTotal))}`;
    return `${formatMoney(outstanding)} outstanding`;
  })();

  return {
    steps: [
      { key: "accepted", label: "Quote accepted", detail: acceptedDetail, state: stateFor("accepted") },
      { key: "invoiced", label: "Invoice sent", detail: issuedDetail, state: stateFor("invoiced") },
      { key: "paid", label: "Paid", detail: paidDetail, state: stateFor("paid") },
    ],
    invoicedTotal: round2(invoicedTotal),
    paidTotal: round2(paidTotal),
    outstanding,
    allSettled,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
