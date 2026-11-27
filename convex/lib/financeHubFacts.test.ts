import { describe, expect, test } from "vitest";
import { startOfMonthInTimezone } from "./quoteDates";
import { inInvoiceSegment, inQuoteSegment, invoiceSortValue, quoteSortValue, type InvoiceHubRow, type QuoteHubRow } from "./financeHubFacts";

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
  test("the month starts at 00:00 on the 1st in the ORG timezone (an AU month boundary is not the UTC one)", () => {
    expect(startOfMonthInTimezone(Date.UTC(2026, 10, 24, 12), "UTC")).toBe(Date.UTC(2026, 10, 1));
    // 00:30 on 1 Dec in Sydney (AEDT, UTC+11) is still 30 Nov in UTC; the month is December.
    const at = Date.UTC(2026, 10, 30, 13, 30);
    expect(startOfMonthInTimezone(at, "Australia/Sydney")).toBe(Date.UTC(2026, 10, 30, 13, 0));
    expect(startOfMonthInTimezone(at, "UTC")).toBe(Date.UTC(2026, 10, 1));
    // Across the DST change (Oct): 1 Oct 00:00 in Sydney is AEST (+10), 14:00 UTC the day before.
    expect(startOfMonthInTimezone(Date.UTC(2026, 9, 15), "Australia/Sydney")).toBe(Date.UTC(2026, 8, 30, 14, 0));
  });
});
