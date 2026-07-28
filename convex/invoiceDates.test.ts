// @vitest-environment node
//
// convex/lib/invoiceDates.ts — invoice payment-terms default (#989).
//
// `computeDueDate` is a thin call-through to `quoteDates.ts#computeValidUntil`
// (already exhaustively DST/timezone-tested in `quoteDates.test.ts`), so this
// file only pins the duplicated CONSTANTS against their src/lib mirror and
// checks the due-date contract at a couple of representative instants — it does
// not re-run the full DST matrix, which would just be re-testing
// `computeValidUntil` under a different name.
import { describe, test, expect } from "vitest";
import {
  DEFAULT_PAYMENT_TERMS_DAYS as CONVEX_DEFAULT,
  PAYMENT_TERMS_BOUNDS as CONVEX_BOUNDS,
  resolvePaymentTermsDays as convexResolveDays,
  computeDueDate,
} from "./lib/invoiceDates";
import {
  DEFAULT_PAYMENT_TERMS_DAYS as SRC_DEFAULT,
  PAYMENT_TERMS_BOUNDS as SRC_BOUNDS,
  resolvePaymentTermsDays as srcResolveDays,
} from "@/lib/invoice-terms";

describe("invoiceDates — convex/lib == src/lib (byte-for-byte pin)", () => {
  test("the shared constants are identical", () => {
    expect(CONVEX_DEFAULT).toBe(SRC_DEFAULT);
    expect(CONVEX_BOUNDS).toEqual(SRC_BOUNDS);
  });

  test("resolvePaymentTermsDays agrees across a representative matrix", () => {
    for (const configured of [undefined, null, 0, 1, 14, 30, 365, 366, 14.5, -1]) {
      expect(convexResolveDays(configured)).toBe(srcResolveDays(configured));
    }
  });
});

describe("computeDueDate", () => {
  test("lands on the end of the Nth calendar day after the invoice date (Net 14)", () => {
    const invoiceDate = Date.UTC(2026, 6, 26, 9, 0, 0); // 26 Jul
    const due = computeDueDate(invoiceDate, 14, "UTC");
    expect(new Date(due).toISOString()).toBe("2026-08-09T23:59:59.999Z");
  });

  test("resolves in the org's timezone", () => {
    const invoiceDate = Date.UTC(2026, 6, 26, 9, 0, 0);
    const due = computeDueDate(invoiceDate, 14, "Australia/Sydney");
    expect(due).not.toBe(computeDueDate(invoiceDate, 14, "UTC"));
  });

  test("zero-day terms are due the same day", () => {
    const invoiceDate = Date.UTC(2026, 6, 26, 9, 0, 0);
    const due = computeDueDate(invoiceDate, 0, "UTC");
    expect(new Date(due).toISOString()).toBe("2026-07-26T23:59:59.999Z");
  });
});
