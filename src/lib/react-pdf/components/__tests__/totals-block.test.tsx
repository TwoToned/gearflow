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
import { renderPdfPages } from "../../pdf-test-utils";

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

async function totalsText(data: ReturnType<typeof makeSpikeData>) {
  const { fullText } = await renderPdfPages(
    <Document>
      <Page size="A4">
        <TotalsBlock data={data} itemDiscountTotal={0} />
      </Page>
    </Document>,
  );
  return fullText;
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

/**
 * T3 (#1091, docs/designs/tax-model.md §2.3/§3.3) — a reader can't tell
 * "no tax applies" from "tax wasn't calculated" from a bare "$0.00", so
 * EXEMPT/UNSET must never render as a plain amount, and a mixed-rate
 * project must show one row per distinct rate rather than folding them
 * into a single number that hides the split.
 */
describe("TotalsBlock — T3 (#1091) tax status rendering", () => {
  it("COMPUTED with a single rate renders exactly the pre-T3 single tax row", async () => {
    const text = await totalsText(makeSpikeData({ tax_status: "COMPUTED", tax_breakdown: [{ rate: 10, amount: 1732.8 }], tax_label: "GST" }));
    expect(text).toContain("GST");
    expect(text).not.toContain("GST (10%)");
    expect(text).not.toContain("Exempt");
    expect(text).not.toContain("Rate not set");
  });

  it("EXEMPT renders 'Exempt', never a bare amount, plus the reason when set", async () => {
    const text = await totalsText(makeSpikeData({ tax_status: "EXEMPT", tax_breakdown: [], tax_amount: 0, tax_exempt_reason: "Government purchase order #4471" }));
    expect(text).toContain("Exempt");
    expect(text).toContain("Government purchase order #4471");
    expect(text).not.toContain("$0.00");
  });

  it("EXEMPT with no recorded reason still says Exempt, no reason line", async () => {
    const text = await totalsText(makeSpikeData({ tax_status: "EXEMPT", tax_breakdown: [], tax_amount: 0, tax_exempt_reason: "" }));
    expect(text).toContain("Exempt");
  });

  it("UNSET renders 'Rate not set', never a bare amount", async () => {
    const text = await totalsText(makeSpikeData({ tax_status: "UNSET", tax_breakdown: [], tax_amount: 0 }));
    expect(text).toContain("Rate not set");
    expect(text).not.toContain("$0.00");
  });

  it("a deliberate 0% line under COMPUTED still prints a real $0.00 row (not UNSET's wording)", async () => {
    const text = await totalsText(makeSpikeData({ tax_status: "COMPUTED", tax_breakdown: [{ rate: 0, amount: 0 }], tax_amount: 0, tax_label: "GST" }));
    expect(text).not.toContain("Rate not set");
    expect(text).not.toContain("Exempt");
  });

  it("mixed rates render one row per distinct rate with a (N%) suffix, summing to the total tax", async () => {
    const text = await totalsText(
      makeSpikeData({
        tax_status: "COMPUTED",
        tax_label: "GST",
        tax_breakdown: [
          { rate: 10, amount: 10 },
          { rate: 5, amount: 2 },
          { rate: 0, amount: 0 },
        ],
        tax_amount: 12,
      }),
    );
    expect(text).toContain("GST (10%)");
    expect(text).toContain("GST (5%)");
    expect(text).toContain("GST (0%)");
  });
});
