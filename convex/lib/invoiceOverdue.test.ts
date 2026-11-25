// @vitest-environment node
import { describe, expect, test } from "vitest";
import { invoiceOutstanding, isInvoiceOverdue } from "./invoiceOverdue";

const DAY = 24 * 60 * 60 * 1000;
const DUE = Date.UTC(2026, 10, 10); // start of the due day
const issued = { status: "ISSUED" as const, kind: "FULL" as const, paymentStatus: "UNPAID" as const, dueDate: DUE };

describe("isInvoiceOverdue", () => {
  test("on time for the whole due day, overdue once it is over", () => {
    expect(isInvoiceOverdue(issued, DUE + DAY - 1)).toBe(false);
    expect(isInvoiceOverdue(issued, DUE + DAY)).toBe(true);
  });

  test("never for a settled invoice, a credit note, a draft or no due date", () => {
    const late = DUE + 5 * DAY;
    expect(isInvoiceOverdue({ ...issued, paymentStatus: "PAID" }, late)).toBe(false);
    expect(isInvoiceOverdue({ ...issued, kind: "CREDIT" }, late)).toBe(false);
    expect(isInvoiceOverdue({ ...issued, status: "DRAFT" }, late)).toBe(false);
    expect(isInvoiceOverdue({ ...issued, dueDate: undefined }, late)).toBe(false);
    expect(isInvoiceOverdue({ ...issued, paymentStatus: "PARTIALLY_PAID" }, late)).toBe(true);
  });
});

describe("invoiceOutstanding", () => {
  test("total less payments and credits, in cents, never negative", () => {
    expect(invoiceOutstanding({ total: 1000 })).toBe(1000);
    expect(invoiceOutstanding({ total: 1000, amountPaid: 333.333, xeroAmountCredited: 0.1 })).toBe(666.57);
    expect(invoiceOutstanding({ total: 1000, amountPaid: 1200 })).toBe(0);
  });
});

import { invoicePillState } from "./invoiceOverdue";

describe("invoicePillState (D56 precedence)", () => {
  const late = DUE + 5 * DAY;
  const early = DUE - DAY;
  test("Overdue outranks Part paid once past due; Part paid before", () => {
    const part = { ...issued, paymentStatus: "PARTIALLY_PAID" as const, amountPaid: 100 };
    expect(invoicePillState(part, late)).toBe("OVERDUE");
    expect(invoicePillState(part, early)).toBe("PART_PAID");
  });
  test("Paid outranks Overdue; Void, Credit and Draft outrank everything", () => {
    expect(invoicePillState({ ...issued, paymentStatus: "PAID" }, late)).toBe("PAID");
    expect(invoicePillState({ ...issued, status: "VOID" as never }, late)).toBe("VOID");
    expect(invoicePillState({ ...issued, kind: "CREDIT" }, late)).toBe("CREDIT");
    expect(invoicePillState({ ...issued, status: "DRAFT" }, late)).toBe("DRAFT");
  });
  test("a fresh issued invoice is Issued", () => {
    expect(invoicePillState(issued, early)).toBe("ISSUED");
  });
});
