import { describe, it, expect } from "vitest";
import { toXeroInvoiceStateUpdates } from "./xero-payment-state";

describe("toXeroInvoiceStateUpdates", () => {
  it("maps Xero state onto the Flow invoice by Xero id, case-insensitively", () => {
    const out = toXeroInvoiceStateUpdates(
      [{ id: "I1", xeroInvoiceId: "ABC-1" }],
      [{ InvoiceID: "abc-1", Status: "PAID", AmountPaid: 1650, AmountCredited: 0, AmountDue: 0 }],
    );
    expect(out).toEqual([{ invoiceId: "I1", xeroStatus: "PAID", amountPaid: 1650, amountCredited: 0, amountDue: 0 }]);
  });

  it("skips invoices Xero didn't return and reads missing amounts as 0", () => {
    const out = toXeroInvoiceStateUpdates(
      [{ id: "I1", xeroInvoiceId: "a" }, { id: "I2", xeroInvoiceId: "gone" }],
      [{ InvoiceID: "a", Status: "AUTHORISED" }],
    );
    expect(out).toEqual([{ invoiceId: "I1", xeroStatus: "AUTHORISED", amountPaid: 0, amountCredited: 0, amountDue: 0 }]);
  });
});
