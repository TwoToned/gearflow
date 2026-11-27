import { describe, expect, test } from "vitest";

import { clientDepositPercent, depositDueForJob, deriveInvoicingState, type InvoiceLike } from "./invoicingState";

/**
 * The Finance hub's `Deposit due` and the job page's invoicing card must be the SAME rule (R-3.1): the
 * hub derives it from `deriveInvoicingState` itself, and the client's `paymentProfile` does not gate it
 * (the old org-board rule required DEPOSIT_BALANCE; the job page stopped honouring that).
 */
const inv = (over: Partial<InvoiceLike>): InvoiceLike => ({ id: "i", kind: "FULL", status: "ISSUED", total: 100, ...over });

const CASES: { name: string; invoices: InvoiceLike[]; total: number | null }[] = [
  { name: "nothing invoiced", invoices: [], total: 1000 },
  { name: "no job total", invoices: [], total: null },
  { name: "a draft exists", invoices: [inv({ status: "DRAFT", kind: "DEPOSIT" })], total: 1000 },
  { name: "a deposit issued, more to raise", invoices: [inv({ kind: "DEPOSIT", total: 300 })], total: 1000 },
  { name: "fully invoiced", invoices: [inv({ total: 1000 })], total: 1000 },
  { name: "only a void", invoices: [inv({ status: "VOID", total: 1000 })], total: 1000 },
  { name: "paid in full", invoices: [inv({ total: 1000, paymentStatus: "PAID", amountPaid: 1000 })], total: 1000 },
];

describe("the hub's Deposit due is the job page's rule", () => {
  test.each(CASES)("$name", ({ invoices, total }) => {
    const hub = depositDueForJob(invoices, null, total);
    const page = deriveInvoicingState(invoices, hub.percent, total);
    expect(hub.due).toBe(page.headline === "NOT_STARTED" && page.partialStep.kind === "DEPOSIT");
  });

  test("the client's payment profile does not gate it; it only supplies the default %", () => {
    const profiles = [null, {}, { paymentProfile: "FULL_UPFRONT" }, { paymentProfile: "DEPOSIT_BALANCE", profileDepositPercent: 30 }] as { profileDepositPercent?: unknown }[];
    const results = profiles.map((c) => depositDueForJob([], c, 2000));
    expect(results.every((r) => r.due)).toBe(true);
    expect(results.map((r) => r.percent)).toEqual([25, 25, 25, 30]);
    expect(results.map((r) => r.amount)).toEqual([500, 500, 500, 600]);
    expect(clientDepositPercent({ profileDepositPercent: 30 })).toBe(30);
  });

  test("a job with any live invoice is not a deposit still due; an unknown total is not due", () => {
    expect(depositDueForJob([inv({ status: "DRAFT" })], null, 1000).due).toBe(false);
    expect(depositDueForJob([], null, null).due).toBe(false);
    expect(depositDueForJob([], null, 0).due).toBe(false);
  });
});
