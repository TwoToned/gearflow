// @vitest-environment node
import { describe, expect, test } from "vitest";
import { invoiceDatesLine, invoiceStatusWord } from "@/lib/invoice-pill";

const DAY = 86_400_000;
const DUE = Date.UTC(2026, 10, 10);
const ISSUED = Date.UTC(2026, 10, 1);
const fmt = (ms: number) => new Date(ms).toISOString().slice(5, 10);
const inv = { status: "ISSUED", kind: "FULL", paymentStatus: "UNPAID", dueDate: DUE, issuedAt: ISSUED };

describe("invoiceStatusWord", () => {
  test("one word, error intent when overdue even if part paid", () => {
    const w = invoiceStatusWord({ ...inv, paymentStatus: "PARTIALLY_PAID", amountPaid: 50 }, DUE + 3 * DAY);
    expect(w).toMatchObject({ label: "Overdue", intent: "error" });
  });
  test("part paid before due, paid when settled, void is an outline", () => {
    expect(invoiceStatusWord({ ...inv, paymentStatus: "PARTIALLY_PAID", amountPaid: 50 }, DUE - DAY).label).toBe("Part paid");
    expect(invoiceStatusWord({ ...inv, paymentStatus: "PAID" }, DUE + 9 * DAY)).toMatchObject({ label: "Paid", intent: "success" });
    expect(invoiceStatusWord({ ...inv, status: "VOID" }, DUE)).toMatchObject({ label: "Void", outline: true });
  });
});

describe("invoiceDatesLine", () => {
  test("issued / due while on time", () => {
    expect(invoiceDatesLine(inv, DUE - DAY, null, fmt)).toBe("issued 11-01 · due 11-10");
  });
  test("n days overdue once the due day is over", () => {
    expect(invoiceDatesLine(inv, DUE + DAY, null, fmt)).toBe("1 day overdue");
    expect(invoiceDatesLine(inv, DUE + 3 * DAY, null, fmt)).toBe("3 days overdue");
  });
  test("paid date when settled; nothing for a draft", () => {
    expect(invoiceDatesLine({ ...inv, paymentStatus: "PAID" }, DUE + 5 * DAY, DUE - 2 * DAY, fmt)).toBe("paid 11-08");
    expect(invoiceDatesLine({ ...inv, status: "DRAFT" }, DUE, null, fmt)).toBe("");
  });
});
