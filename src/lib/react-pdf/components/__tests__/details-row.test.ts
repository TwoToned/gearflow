/**
 * #1153 — regression coverage for details-row.tsx's `config`-gated fields
 * (`showClientTaxId`/`showPaymentTerms`/`showInvoiceNumber`), the invoice
 * layout's delta over quote's plain `DetailsRow` usage. Mirrors
 * line-items-table.test.ts's convention of asserting on the exported pure
 * functions directly rather than rendering a PDF.
 */
import { describe, it, expect } from "vitest";
import { buildClientLines, buildProjectLines } from "../details-row";
import { makeSpikeData } from "../../fixture";

describe("buildClientLines", () => {
  it("omits the client tax id line with no config (quote's usage)", () => {
    const data = makeSpikeData({ client_tax_id: "98 765 432 100" });
    const lines = buildClientLines(data, {});
    expect(lines.some((l) => l.includes("98 765 432 100"))).toBe(false);
  });

  it("includes the client tax id line, labelled with the org's country-derived business-number label, when showClientTaxId is on", () => {
    const data = makeSpikeData({ client_tax_id: "98 765 432 100", org_business_number_label: "ABN" });
    const lines = buildClientLines(data, { showClientTaxId: true });
    expect(lines).toContain("ABN: 98 765 432 100");
  });

  it("uses a GB org's business-number label instead of ABN", () => {
    const data = makeSpikeData({ client_tax_id: "GB987654321", org_business_number_label: "VAT number" });
    const lines = buildClientLines(data, { showClientTaxId: true });
    expect(lines).toContain("VAT number: GB987654321");
    expect(lines.some((l) => l.startsWith("ABN:"))).toBe(false);
  });

  it("omits the tax id line even with showClientTaxId on when the client has none set", () => {
    const data = makeSpikeData({ client_tax_id: "" });
    const lines = buildClientLines(data, { showClientTaxId: true });
    expect(lines.some((l) => l.includes("ABN") || l.includes("VAT"))).toBe(false);
  });
});

describe("buildProjectLines", () => {
  it("omits payment terms and invoice number with no config (quote's usage)", () => {
    const data = makeSpikeData({ client_payment_terms: "14 days", invoice_number: "INV-2026-0142" });
    const lines = buildProjectLines(data, {});
    expect(lines.some((l) => l.startsWith("Payment Terms:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Invoice #:"))).toBe(false);
  });

  it("includes payment terms and invoice number when both config flags are on and the data is set", () => {
    const data = makeSpikeData({ client_payment_terms: "14 days", invoice_number: "INV-2026-0142" });
    const lines = buildProjectLines(data, { showPaymentTerms: true, showInvoiceNumber: true });
    expect(lines).toContain("Payment Terms: 14 days");
    expect(lines).toContain("Invoice #: INV-2026-0142");
  });

  it("omits the invoice number line when the invoice hasn't been issued yet, even with showInvoiceNumber on (WS1 #940)", () => {
    const data = makeSpikeData({ invoice_number: "" });
    const lines = buildProjectLines(data, { showInvoiceNumber: true });
    expect(lines.some((l) => l.startsWith("Invoice #:"))).toBe(false);
  });

  it("omits the payment terms line when the client has none set, even with showPaymentTerms on", () => {
    const data = makeSpikeData({ client_payment_terms: "" });
    const lines = buildProjectLines(data, { showPaymentTerms: true });
    expect(lines.some((l) => l.startsWith("Payment Terms:"))).toBe(false);
  });
});
