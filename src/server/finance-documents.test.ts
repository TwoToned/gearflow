/**
 * src/server/finance-documents.ts — render-and-store, with every external
 * boundary mocked (Convex client, Convex `_storage`, the pdfme pipeline,
 * permission + activity-log plumbing).
 *
 * The first test in this file is the point of the whole #985 program: a sent
 * quote's document must be byte-identical on a repeat download WHILE THE LIVE
 * PROJECT CHANGES UNDERNEATH IT. Everything else here — the never-overwrite
 * guard, the retry path, orphan cleanup, stamped dates — exists to make that
 * property hold rather than merely be intended.
 *
 * The pdfme pipeline itself is mocked deliberately: it needs Prisma + a live
 * Convex deployment, and what is under test here is that it is called ONCE and
 * never again, not what it draws. `document-composer.test.ts` covers the render.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

const mutationMock = vi.fn();
const queryMock = vi.fn();

vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: queryMock, mutation: mutationMock })),
}));
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org_1", userId: "user_1", userName: "Alice" })),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

const generatePdf = vi.fn();
vi.mock("@/lib/pdfme/generate-pdf", () => ({ generatePdf: (...a: unknown[]) => generatePdf(...a) }));

const uploadToS3 = vi.fn();
const deleteFromS3 = vi.fn(async (_storageKey: string) => {});
vi.mock("@/lib/storage", () => ({
  uploadToS3: (...a: unknown[]) => uploadToS3(...a),
  deleteFromS3: (...a: unknown[]) => deleteFromS3(...(a as [string])),
}));

import { generateQuoteArtifact, generateInvoiceArtifact } from "./finance-documents";

const SENT_AT = 1_700_000_000_000;
const QUOTE_DATE = 1_699_999_000_000;
const VALID_UNTIL = 1_702_591_000_000;

/** A minimal fake of Convex `_storage`: bytes keyed by storage id, so a test can
 *  assert what a later download would actually serve. */
const storedBytes = new Map<string, Uint8Array>();

type QuoteRow = {
  quoteId: string;
  projectId: string;
  projectNumber: string;
  version: number;
  label: string;
  pdfFileId: string | null;
  sentAt: number | null;
  quoteDate: number | null;
  validUntil: number | null;
  effectiveStatus?: string;
};

/** The Convex row, mutated by the attach mutation exactly as the real one is. */
let quoteRow: QuoteRow;
let invoiceRow: {
  invoiceId: string;
  projectId: string;
  projectNumber: string;
  invoiceNumber: string | null;
  kind: string;
  status: string;
  pdfFileId: string | null;
  issuedAt: number | null;
  dueDate: number | null;
};

function wireConvex() {
  queryMock.mockImplementation(async (fnRef: unknown) => {
    const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
    if (name === "financeArtifacts:quoteArtifactContext") return { ...quoteRow };
    if (name === "financeArtifacts:invoiceArtifactContext") return { ...invoiceRow };
    throw new Error(`Unmocked query: ${name}`);
  });

  // Mirrors convex/financeArtifacts.ts: attach ONCE, never overwrite.
  mutationMock.mockImplementation(async (fnRef: unknown, args: { storageId: string }) => {
    const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
    if (name === "financeArtifacts:attachQuoteArtifact") {
      if (quoteRow.pdfFileId) return { attached: false, pdfFileId: quoteRow.pdfFileId };
      quoteRow.pdfFileId = args.storageId;
      return { attached: true, pdfFileId: args.storageId };
    }
    if (name === "financeArtifacts:attachInvoiceArtifact") {
      if (invoiceRow.pdfFileId) return { attached: false, pdfFileId: invoiceRow.pdfFileId };
      invoiceRow.pdfFileId = args.storageId;
      return { attached: true, pdfFileId: args.storageId };
    }
    throw new Error(`Unmocked mutation: ${name}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storedBytes.clear();
  quoteRow = {
    quoteId: "q1",
    projectId: "p1",
    projectNumber: "RVLT-2026-0087",
    version: 2,
    label: "RVLT-2026-0087 v2",
    pdfFileId: null,
    sentAt: SENT_AT,
    quoteDate: QUOTE_DATE,
    validUntil: VALID_UNTIL,
    effectiveStatus: "SENT",
  };
  invoiceRow = {
    invoiceId: "inv1",
    projectId: "p1",
    projectNumber: "RVLT-2026-0087",
    invoiceNumber: "INV-2026-0001",
    kind: "FULL",
    status: "ISSUED",
    pdfFileId: null,
    issuedAt: SENT_AT,
    dueDate: null,
  };
  wireConvex();

  let uploadCount = 0;
  uploadToS3.mockImplementation(async (file: Buffer) => {
    const storageKey = `storage_${++uploadCount}`;
    storedBytes.set(storageKey, new Uint8Array(file));
    return { storageKey, url: `/api/files/${storageKey}` };
  });
});

describe("a sent quote's PDF is byte-identical on repeat download while the live project changes underneath it", () => {
  test("the second download serves the ORIGINAL bytes — the re-priced project never reaches the client's document", async () => {
    // Render #1: the project as it was when the quote was sent.
    generatePdf.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]));
    const first = await generateQuoteArtifact("q1");
    expect(first.generated).toBe(true);

    // ── The project changes underneath: prices edited, lines added, whatever.
    //    The live renderer would now produce a completely different document.
    generatePdf.mockResolvedValue(new Uint8Array([9, 9, 9, 9]));

    const second = await generateQuoteArtifact("q1");

    // Same artifact, no second render, and the bytes on disk are untouched.
    expect(second.pdfFileId).toBe(first.pdfFileId);
    expect(second.generated).toBe(false);
    expect(generatePdf).toHaveBeenCalledTimes(1);
    expect(uploadToS3).toHaveBeenCalledTimes(1);
    expect(Array.from(storedBytes.get(first.pdfFileId)!)).toEqual([1, 2, 3, 4]);
  });

  test("an issued invoice's document is frozen at issue in exactly the same way", async () => {
    generatePdf.mockResolvedValueOnce(new Uint8Array([5, 6, 7]));
    const first = await generateInvoiceArtifact("inv1");
    generatePdf.mockResolvedValue(new Uint8Array([0, 0, 0]));

    const second = await generateInvoiceArtifact("inv1");

    expect(second.pdfFileId).toBe(first.pdfFileId);
    expect(second.generated).toBe(false);
    expect(generatePdf).toHaveBeenCalledTimes(1);
    expect(Array.from(storedBytes.get(first.pdfFileId)!)).toEqual([5, 6, 7]);
  });
});

describe("generateQuoteArtifact — stamped dates (the silent-validity-extension bug)", () => {
  test("renders with the ROW's quoteDate/validUntil, never with `now`", async () => {
    generatePdf.mockResolvedValue(new Uint8Array([1]));
    await generateQuoteArtifact("q1");

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "quote", {
      stampedDates: { documentDate: QUOTE_DATE, quoteValidUntil: VALID_UNTIL },
      versionSuffix: "v2",
    });
  });

  test("falls back to sentAt when a pre-#986 row carries no quoteDate", async () => {
    quoteRow.quoteDate = null;
    quoteRow.validUntil = null;
    generatePdf.mockResolvedValue(new Uint8Array([1]));

    await generateQuoteArtifact("q1");

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "quote", {
      stampedDates: { documentDate: SENT_AT, quoteValidUntil: undefined },
      versionSuffix: "v2",
    });
  });

  test("versionSuffix includes the custom label only when labelOnDocument is set (#1080/#1097)", async () => {
    (quoteRow as unknown as { customLabel?: string; labelOnDocument?: boolean }).customLabel = "Budget option";
    (quoteRow as unknown as { customLabel?: string; labelOnDocument?: boolean }).labelOnDocument = true;
    generatePdf.mockResolvedValue(new Uint8Array([1]));

    await generateQuoteArtifact("q1");

    expect(generatePdf).toHaveBeenCalledWith(
      "p1", "org_1", "quote",
      expect.objectContaining({ versionSuffix: "v2 · Budget option" }),
    );
  });

  test("an issued invoice's document date is its issuedAt", async () => {
    generatePdf.mockResolvedValue(new Uint8Array([1]));
    await generateInvoiceArtifact("inv1");

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "invoice", {
      stampedDates: { documentDate: SENT_AT },
    });
  });
});

describe("generateQuoteArtifact — the retry path", () => {
  test("a SENT revision whose render failed keeps a null artifact, and the retry fills it", async () => {
    generatePdf.mockRejectedValueOnce(new Error("pdfme exploded"));
    await expect(generateQuoteArtifact("q1")).rejects.toThrow("pdfme exploded");
    expect(quoteRow.pdfFileId).toBeNull();
    expect(uploadToS3).not.toHaveBeenCalled();

    generatePdf.mockResolvedValueOnce(new Uint8Array([7, 7]));
    const retried = await generateQuoteArtifact("q1");

    expect(retried.generated).toBe(true);
    expect(quoteRow.pdfFileId).toBe(retried.pdfFileId);
  });

  test("a never-sent draft has no stored document and cannot be given one", async () => {
    quoteRow.sentAt = null;
    quoteRow.effectiveStatus = "DRAFT";

    await expect(generateQuoteArtifact("q1")).rejects.toThrow(/sent quote revision/i);
    expect(generatePdf).not.toHaveBeenCalled();
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  test("a DRAFT invoice cannot be given one either", async () => {
    invoiceRow.issuedAt = null;
    invoiceRow.status = "DRAFT";
    invoiceRow.invoiceNumber = null;

    await expect(generateInvoiceArtifact("inv1")).rejects.toThrow(/issued invoice/i);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("losing the attach race deletes the orphan upload and serves the winner's artifact", async () => {
    generatePdf.mockResolvedValue(new Uint8Array([1, 2]));
    // The row reads as empty (this caller's snapshot), but another attempt has
    // already attached by the time the mutation lands.
    mutationMock.mockResolvedValueOnce({ attached: false, pdfFileId: "storage_winner" });

    const result = await generateQuoteArtifact("q1");

    expect(result).toEqual({ pdfFileId: "storage_winner", generated: false });
    expect(deleteFromS3).toHaveBeenCalledWith("storage_1");
  });
});

describe("artifact file naming", () => {
  test("a quote artifact is named for its REVISION, so v2 and v3 never collide", async () => {
    generatePdf.mockResolvedValue(new Uint8Array([1]));
    await generateQuoteArtifact("q1");

    expect(uploadToS3).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org_1",
        folder: "finance/quotes",
        fileName: "RVLT-2026-0087-quote-v2.pdf",
        mimeType: "application/pdf",
      }),
    );
  });

  test("an invoice artifact leads with the invoice number", async () => {
    generatePdf.mockResolvedValue(new Uint8Array([1]));
    await generateInvoiceArtifact("inv1");

    expect(uploadToS3).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ folder: "finance/invoices", fileName: "INV-2026-0001-invoice.pdf" }),
    );
  });
});
