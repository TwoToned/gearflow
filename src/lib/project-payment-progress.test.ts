import { describe, test, expect } from "vitest";
import { computePaymentProgress, type PaymentProgressInvoice, type PaymentProgressQuote } from "./project-payment-progress";

const fmt = {
  formatDate: (ms: number) => new Date(ms).toISOString().slice(0, 10),
  formatMoney: (n: number) => `$${n.toFixed(2)}`,
};

const quote = (o: Partial<PaymentProgressQuote> = {}): PaymentProgressQuote => ({
  effectiveStatus: "SENT",
  version: 1,
  ...o,
});
const invoice = (o: Partial<PaymentProgressInvoice> = {}): PaymentProgressInvoice => ({
  kind: "DEPOSIT",
  status: "ISSUED",
  total: 1000,
  ...o,
});

const states = (p: ReturnType<typeof computePaymentProgress>) => p.steps.map((s) => s.state);

describe("computePaymentProgress", () => {
  test("nothing yet — accepting is what we're waiting on", () => {
    const p = computePaymentProgress({ quotes: [quote()], invoices: [], ...fmt });
    expect(states(p)).toEqual(["current", "pending", "pending"]);
    expect(p.allSettled).toBe(false);
  });

  test("accepted, not invoiced — the invoice is what we're waiting on", () => {
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED", acceptedAt: Date.UTC(2026, 6, 21) })],
      invoices: [],
      ...fmt,
    });
    expect(states(p)).toEqual(["done", "current", "pending"]);
    expect(p.steps[0].detail).toBe("v1 · 2026-07-21");
  });

  test("accepted and invoiced — the money is what we're waiting on", () => {
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED" })],
      invoices: [invoice({ invoiceNumber: "INV-0042", total: 1650, paymentStatus: "UNPAID" })],
      ...fmt,
    });
    expect(states(p)).toEqual(["done", "done", "current"]);
    expect(p.steps[1].detail).toBe("INV-0042 · $1650.00");
    expect(p.steps[2].detail).toBe("$1650.00 outstanding");
    expect(p.outstanding).toBe(1650);
  });

  test("a partial payment is still 'waiting', and says how far along", () => {
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED" })],
      invoices: [invoice({ total: 1000, amountPaid: 400, paymentStatus: "PARTIALLY_PAID" })],
      ...fmt,
    });
    expect(states(p)).toEqual(["done", "done", "current"]);
    expect(p.steps[2].detail).toBe("$400.00 of $1000.00");
    expect(p.allSettled).toBe(false);
  });

  test("everything settled reads as done end to end", () => {
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED" })],
      invoices: [invoice({ total: 1000, amountPaid: 1000, paymentStatus: "PAID" })],
      ...fmt,
    });
    expect(states(p)).toEqual(["done", "done", "done"]);
    expect(p.allSettled).toBe(true);
    expect(p.outstanding).toBe(0);
  });

  test("a project with no invoice at all is never 'settled'", () => {
    // `every` over an empty list is true — the guard against that is the whole
    // reason `allSettled` checks `issued.length > 0` first.
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED" })],
      invoices: [],
      ...fmt,
    });
    expect(p.allSettled).toBe(false);
    expect(p.steps[2].detail).toBeNull();
  });

  test("DRAFT and VOID invoices don't count as sent", () => {
    const p = computePaymentProgress({
      quotes: [quote()],
      invoices: [invoice({ status: "DRAFT" }), invoice({ status: "VOID", paymentStatus: "PAID" })],
      ...fmt,
    });
    expect(p.steps[1].state).toBe("pending");
    expect(p.invoicedTotal).toBe(0);
    expect(p.allSettled).toBe(false);
  });

  test("several invoices roll up into one line", () => {
    const p = computePaymentProgress({
      quotes: [quote({ effectiveStatus: "ACCEPTED" })],
      invoices: [
        invoice({ total: 500, amountPaid: 500, paymentStatus: "PAID" }),
        invoice({ kind: "BALANCE", total: 1500, paymentStatus: "UNPAID" }),
      ],
      ...fmt,
    });
    expect(p.steps[1].detail).toBe("2 invoices · $2000.00");
    expect(p.outstanding).toBe(1500);
    expect(p.allSettled).toBe(false);
  });

  test("exactly one step is ever `current`", () => {
    const cases = [
      { quotes: [quote()], invoices: [] },
      { quotes: [quote({ effectiveStatus: "ACCEPTED" })], invoices: [] },
      { quotes: [quote({ effectiveStatus: "ACCEPTED" })], invoices: [invoice()] },
    ];
    for (const c of cases) {
      const p = computePaymentProgress({ ...c, ...fmt });
      expect(p.steps.filter((s) => s.state === "current")).toHaveLength(1);
    }
  });

  test("an invoice raised before any acceptance leaves 'accepted' behind, not current", () => {
    // Real shape: a full invoice sent with no quote step. The first UNDONE step
    // is still `accepted`, so the strip honestly shows what was skipped rather
    // than pretending the sequence was followed.
    const p = computePaymentProgress({ quotes: [], invoices: [invoice()], ...fmt });
    expect(states(p)).toEqual(["current", "done", "pending"]);
  });
});

// ─── CREDIT notes ──────────────────────────────────────────────────────────
// `createCreditNative` stores a credit's `total` as `-original.total`. Treating
// it as an ordinary invoice lit the "Invoice sent" step on a refund and — because
// `amountPaid >= total` is trivially true for a negative total — rendered
// nonsense like "$1,000.00 of $0.00".

describe("credit notes", () => {
  const compute = (a: { invoices: PaymentProgressInvoice[] }) =>
    computePaymentProgress({ quotes: [quote({ effectiveStatus: "ACCEPTED" })], invoices: a.invoices, ...fmt });
  const step = (p: ReturnType<typeof computePaymentProgress>, key: string) => p.steps.find((s) => s.key === key)!;
  const issued = (over: Partial<PaymentProgressInvoice> = {}): PaymentProgressInvoice => ({
    kind: "FULL", status: "ISSUED", paymentStatus: "UNPAID", total: 1000, amountPaid: 0, ...over,
  });

  test("a credit note is not an invoice sent", () => {
    const r = compute({ invoices: [issued({ kind: "CREDIT", total: -1000, paymentStatus: "PAID" })] });
    expect(step(r, "invoiced").state).not.toBe("done");
    expect(r.allSettled).toBe(false);
  });

  test("a credit reduces what is owed", () => {
    const r = compute({ invoices: [issued(), issued({ kind: "CREDIT", total: -400 })] });
    expect(r.invoicedTotal).toBe(600);
    expect(r.outstanding).toBe(600);
  });

  test("a credit that cancels the invoice settles the phase", () => {
    const r = compute({ invoices: [issued(), issued({ kind: "CREDIT", total: -1000 })] });
    expect(r.outstanding).toBe(0);
    expect(r.allSettled).toBe(true);
    expect(step(r, "paid").state).toBe("done");
  });

  test("a credit's own paymentStatus never settles the phase on its own", () => {
    const r = compute({
      invoices: [issued({ amountPaid: 0 }), issued({ kind: "CREDIT", total: -100, paymentStatus: "PAID", amountPaid: 500 })],
    });
    expect(r.paidTotal).toBe(0);
    expect(r.allSettled).toBe(false);
  });
});
