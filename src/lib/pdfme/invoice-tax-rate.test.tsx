// @vitest-environment node
/**
 * A specific invoice's tax row describes ITS OWN row (CLAUDE.md "a finance
 * render takes its data from the row"). Before this, a DEPOSIT/BALANCE/CREDIT
 * invoice took its rate from `orgSettings.taxRate` — a field the settings page
 * has stopped writing — so every org that never saved it carried a 0% rate on
 * the document's one tax row. The rate now comes from the row's own frozen
 * `taxAmount` over its `subtotal`, so changing the org's default tax rate
 * later cannot change what an issued document says.
 *
 * Pipeline: invoice row → `resolveTaxBreakdown` (the piece `buildDocumentData`
 * runs) → `DocumentData` → react-pdf `InvoiceDocument` → extracted PDF text.
 * `buildDocumentData` itself needs ~15 Convex/Prisma reads and is not run here;
 * its tax-row decision is the exported function under test, called with the
 * same row shape `financeArtifacts.invoiceArtifactContext` returns.
 *
 * Note the printed document shows a single tax row as `GST  $amount` with no
 * rate suffix (`totals-block.tsx`); the rate is carried in `tax_breakdown` and
 * printed as `GST (n%)` when a document has more than one rate.
 */
import { describe, expect, it } from "vitest";

import { invoiceRowTaxRate } from "@/lib/invoice-tax-rate";
import { resolveTaxBreakdown } from "./build-document-data";
import { InvoiceDocument } from "@/lib/react-pdf/invoice-document";
import { makeSpikeData } from "@/lib/react-pdf/fixture";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";

const depositRow = { kind: "DEPOSIT", subtotal: 3000, taxAmount: 300, total: 3300 };

describe("a specific invoice's tax row takes its rate from the row", () => {
  it("a deposit invoice's row carries 10%, with no org settings involved", () => {
    expect(resolveTaxBreakdown(depositRow, null)).toEqual([{ rate: 10, amount: 300 }]);
  });

  it("is stable when the org's default rate later changes: the inputs never include it", () => {
    // resolveTaxBreakdown takes the row and the project's stored breakdown only.
    expect(resolveTaxBreakdown.length).toBe(2);
    expect(resolveTaxBreakdown(depositRow, JSON.stringify([{ rate: 15, amount: 450 }]))[0].rate).toBe(10);
  });

  it("derives a sensible rate from cent-rounded tax, and 0 for a tax-free or empty row", () => {
    expect(invoiceRowTaxRate({ subtotal: 33.33, taxAmount: 3.33 })).toBe(10);
    expect(invoiceRowTaxRate({ subtotal: 1000, taxAmount: 75 })).toBe(7.5);
    expect(invoiceRowTaxRate({ subtotal: 1000, taxAmount: 0 })).toBe(0);
    expect(resolveTaxBreakdown({ subtotal: 1000, taxAmount: 0 }, null)).toEqual([]);
    expect(invoiceRowTaxRate({ subtotal: 0, taxAmount: 5 })).toBe(0);
    // A FULL invoice keeps the PRE-discount subtotal; its tax was charged on the
    // post-discount amount (total - tax), so 1000 less 10% at 10% GST is 10%, not 9%.
    expect(invoiceRowTaxRate({ subtotal: 1000, taxAmount: 90, total: 990 })).toBe(10);
    expect(resolveTaxBreakdown({ subtotal: 1000, taxAmount: 90, total: 990 }, null)).toEqual([{ rate: 10, amount: 90 }]);
  });

  it("a live render (no invoice row) reads the project's own stored breakdown", () => {
    expect(resolveTaxBreakdown(null, JSON.stringify([{ rate: 10, amount: 5 }]))).toEqual([{ rate: 10, amount: 5 }]);
    expect(resolveTaxBreakdown(null, "not json")).toEqual([]);
    expect(resolveTaxBreakdown(null, undefined)).toEqual([]);
  });

  it("renders through the react-pdf invoice: the deposit's tax amount prints, from the row", async () => {
    const data = makeSpikeData({
      line_items: [],
      total_items: 0,
      subtotal: depositRow.subtotal,
      discount_percent: 0,
      discount_amount: 0,
      tax_amount: depositRow.taxAmount,
      tax_status: "COMPUTED",
      tax_breakdown: resolveTaxBreakdown(depositRow, null),
      total: depositRow.total,
      balance_due: depositRow.total,
      deposit_paid: 0,
    });
    expect(data.tax_breakdown[0].rate).toBe(10);
    const { fullText } = await renderPdfPages(InvoiceDocument({ data }));
    expect(fullText).toContain("$300.00");
    expect(fullText).toContain("$3,300.00");
  });

  it("two rates on one document print one `GST (n%)` row each from the breakdown's own rates", async () => {
    const data = makeSpikeData({
      line_items: [],
      total_items: 0,
      tax_breakdown: [
        { rate: 10, amount: 300 },
        { rate: 5, amount: 25 },
      ],
      tax_amount: 325,
    });
    const { fullText } = await renderPdfPages(InvoiceDocument({ data }));
    expect(fullText).toContain("GST (10%)");
    expect(fullText).toContain("GST (5%)");
  });
});
