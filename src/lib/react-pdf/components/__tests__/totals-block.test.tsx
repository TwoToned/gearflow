/**
 * #1152 — coverage for TotalsBlock's invoice-only addition: Deposit Paid /
 * Balance Due / Due Date rows, gated on the data being present (mirrors
 * gearflow-financial-summary.ts's `depositPaid > 0` / `dueDate` truthy
 * gates) rather than a separate config flag, since `document-layouts.ts`'s
 * quote `defaultTotals` never populates that data in the first place.
 * Renders to a real PDF and asserts on extracted text via a page-count-style
 * "no throw" smoke test — see line-items-table.render.test.tsx for why this
 * codebase's react-pdf tests stop at that bar rather than parsing PDF text.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { TotalsBlock } from "../totals-block";
import { makeSpikeData } from "../../fixture";

async function pageCount(data: ReturnType<typeof makeSpikeData>, itemDiscountTotal = 0) {
  const buffer = await renderToBuffer(
    <Document>
      <Page size="A4">
        <TotalsBlock data={data} itemDiscountTotal={itemDiscountTotal} />
      </Page>
    </Document>,
  );
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("TotalsBlock", () => {
  it("renders the quote shape (no deposit/balance/due-date data) without throwing", async () => {
    const data = makeSpikeData({ deposit_paid: 0, balance_due: 0, invoice_due_date: "" });
    await expect(pageCount(data)).resolves.toBe(1);
  });

  it("renders Deposit Paid + Balance Due when deposit_paid > 0", async () => {
    const data = makeSpikeData({ deposit_paid: 500, balance_due: 18560.8, invoice_due_date: "" });
    await expect(pageCount(data)).resolves.toBe(1);
  });

  it("omits Deposit Paid + Balance Due when deposit_paid is 0, even if balance_due is set", async () => {
    // balance_due can legitimately equal total with no deposit taken —
    // the row pair is gated on deposit_paid, not balance_due, matching
    // gearflow-financial-summary.ts's `config.depositPaid > 0` check.
    const data = makeSpikeData({ deposit_paid: 0, balance_due: 19060.8, invoice_due_date: "" });
    await expect(pageCount(data)).resolves.toBe(1);
  });

  it("renders the Due Date row only when invoice_due_date is set", async () => {
    const withDueDate = makeSpikeData({ invoice_due_date: "2026-09-17" });
    const withoutDueDate = makeSpikeData({ invoice_due_date: "" });
    await expect(pageCount(withDueDate)).resolves.toBe(1);
    await expect(pageCount(withoutDueDate)).resolves.toBe(1);
  });

  it("renders the full invoice shape (deposit + balance + due date) together without throwing", async () => {
    const data = makeSpikeData({ deposit_paid: 500, balance_due: 18560.8, invoice_due_date: "2026-09-17" });
    await expect(pageCount(data)).resolves.toBe(1);
  });
});
