import { describe, expect, test } from "vitest";
import { inInvoiceSegment, inQuoteSegment, invoiceSortValue, monthStartUtc, quoteSortValue, type InvoiceHubRow, type QuoteHubRow } from "./financeHubFacts";

const q = { id: "q", version: 1, status: "SENT", dismissed: false, sentAt: 1, validUntil: 2, daysLeft: 1, hasPdf: false, project: null, total: 5000 } as QuoteHubRow;
const i = { id: "i", invoiceNumber: "INV-1", kind: "FULL", depositPercent: null, pill: "ISSUED", pillLabel: "Issued", issuedAt: 1, dueDate: 2, overdueDays: null, hasPdf: false, xero: null, project: null, total: 110, outstanding: 110 } as InvoiceHubRow;

describe("a hidden money column is never a sort key (it sorts as blank)", () => {
  test("total is null to the comparator when the caller can't see money, whatever the row carries", () => {
    expect(quoteSortValue(q, "total", false)).toBeNull();
    expect(invoiceSortValue(i, "total", false)).toBeNull();
    expect(quoteSortValue(q, "total", true)).toBe(5000);
    expect(invoiceSortValue(i, "total", true)).toBe(110);
  });
});

describe("segments", () => {
  test("an expired quote past its 7 days is under All only; declined and superseded are opt-in", () => {
    expect(inQuoteSegment({ status: "EXPIRED", dismissed: true }, "expired", false)).toBe(false);
    expect(inQuoteSegment({ status: "EXPIRED", dismissed: true }, "all", false)).toBe(true);
    expect(inQuoteSegment({ status: "DECLINED", dismissed: false }, "all", false)).toBe(false);
    expect(inQuoteSegment({ status: "SUPERSEDED", dismissed: false }, "all", true)).toBe(true);
  });
  test("Part paid and Issued are both the Issued segment; Overdue is its own (D56 lives in the pill)", () => {
    expect(inInvoiceSegment({ pill: "PART_PAID" }, "issued", false)).toBe(true);
    expect(inInvoiceSegment({ pill: "OVERDUE" }, "issued", false)).toBe(false);
    expect(inInvoiceSegment({ pill: "OVERDUE" }, "overdue", false)).toBe(true);
    expect(inInvoiceSegment({ pill: "VOID" }, "all", false)).toBe(false);
  });
  test("the month starts at 00:00 UTC on the 1st", () => {
    expect(monthStartUtc(Date.UTC(2026, 10, 24, 12))).toBe(Date.UTC(2026, 10, 1));
  });
});
