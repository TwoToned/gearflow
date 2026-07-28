import { describe, it, expect } from "vitest";
import { quoteArtifactFileName, invoiceArtifactFileName, sanitizeFileName } from "./finance-artifacts";

/**
 * The names a client actually sees on the documents we hand them (#987). The
 * revision has to be in a quote's name — v2 and v3 are different documents and
 * must never overwrite each other in someone's downloads folder.
 */
describe("quoteArtifactFileName", () => {
  it("carries the project number and the revision", () => {
    expect(quoteArtifactFileName("RVLT-2026-0087", 2)).toBe("RVLT-2026-0087-quote-v2.pdf");
  });

  it("gives consecutive revisions distinct names", () => {
    expect(quoteArtifactFileName("RVLT-2026-0087", 2)).not.toBe(quoteArtifactFileName("RVLT-2026-0087", 3));
  });
});

describe("invoiceArtifactFileName", () => {
  it("leads with the invoice number once issued", () => {
    expect(invoiceArtifactFileName("RVLT-2026-0087", "INV-2026-0001")).toBe("INV-2026-0001-invoice.pdf");
  });

  it("falls back to the project number rather than emitting 'null'", () => {
    expect(invoiceArtifactFileName("RVLT-2026-0087", null)).toBe("RVLT-2026-0087-invoice.pdf");
  });
});

describe("sanitizeFileName", () => {
  it("strips characters that would break a Content-Disposition header", () => {
    expect(sanitizeFileName('a"b\\c/d:e.pdf')).toBe("a_b_c_d_e.pdf");
  });

  it("defuses traversal — no `..` and no separator survives", () => {
    const cleaned = sanitizeFileName("../../etc/passwd");
    expect(cleaned).not.toContain("..");
    expect(cleaned).not.toContain("/");
  });

  it("never leaves a leading dot", () => {
    expect(sanitizeFileName(".hidden.pdf").startsWith(".")).toBe(false);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFileName("   ")).toBe("document");
  });
});
