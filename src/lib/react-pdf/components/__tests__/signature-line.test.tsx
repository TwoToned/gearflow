/**
 * #1152 — gearflowSignatureLine → react-pdf port coverage. There's no
 * dedicated pdfme test file for gearflow-signature-line.ts to mirror (see
 * the research for #1152 — none exists), so this establishes coverage from
 * scratch: renders without throwing for the default 3-column shape
 * (return-sheet/delivery-docket both use it), a custom column set, and a
 * column with no `subLabel` (the "Date" column never gets the second
 * signature line).
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { SignatureLine, type SignatureColumn } from "../signature-line";

async function renderPageCount(columns?: SignatureColumn[]) {
  const buffer = await renderToBuffer(
    <Document>
      <Page size="A4">
        <SignatureLine columns={columns} />
      </Page>
    </Document>,
  );
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("SignatureLine", () => {
  it("renders the default 3-column shape (Returned By / Received By / Date) without throwing", async () => {
    await expect(renderPageCount()).resolves.toBe(1);
  });

  it("renders delivery-docket's custom column labels without throwing", async () => {
    const columns: SignatureColumn[] = [
      { label: "Delivered By", subLabel: "Name / Signature" },
      { label: "Received By", subLabel: "Name / Signature" },
      { label: "Date" },
    ];
    await expect(renderPageCount(columns)).resolves.toBe(1);
  });

  it("a column with no subLabel renders only its own line, not a second signature line", async () => {
    await expect(renderPageCount([{ label: "Date" }])).resolves.toBe(1);
  });

  it("renders an arbitrary column count without throwing", async () => {
    await expect(renderPageCount([{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }])).resolves.toBe(1);
  });
});
