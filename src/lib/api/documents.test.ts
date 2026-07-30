/**
 * src/lib/api/documents.ts — the shared resolver behind `GET
 * /api/v1/documents/{projectId}` and the MCP `get_project_document` tool.
 * Every external boundary is mocked (Convex client, `requirePermission`,
 * pdfme) — what's under test is the branching: which permission is checked
 * for which doc type, and whether a quote/invoice resolves to a live render,
 * a stored artifact, or a `DOCUMENT_NOT_READY`/`NOT_FOUND` error.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

const queryMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => ({ query: queryMock })) }));

const requirePermissionMock = vi.fn();
vi.mock("@/lib/org-context", () => ({ requirePermission: (...args: unknown[]) => requirePermissionMock(...args) }));

const generatePdfMock = vi.fn();
vi.mock("@/lib/pdfme/generate-pdf", () => ({ generatePdf: (...args: unknown[]) => generatePdfMock(...args) }));

const { resolveProjectDocument } = await import("./documents");

const actor = { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["*"] };

function nameOf(fnRef: unknown): string {
  return getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockImplementation(async () => ({ organizationId: "org_A", userId: "user_1", userName: "Ada" }));
  generatePdfMock.mockImplementation(async () => new Uint8Array([1, 2, 3]));
});

describe("resolveProjectDocument — validation", () => {
  test("rejects an empty projectId", async () => {
    await expect(resolveProjectDocument(actor, "", "quote")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  test("rejects an unknown docType", async () => {
    await expect(resolveProjectDocument(actor, "proj_1", "invitation" as never)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("resolveProjectDocument — warehouse docs (packing-list / return-sheet / delivery-docket)", () => {
  for (const docType of ["packing-list", "return-sheet", "delivery-docket"] as const) {
    test(`${docType} checks project:read and always live-renders`, async () => {
      const outcome = await resolveProjectDocument(actor, "proj_1", docType);
      expect(requirePermissionMock).toHaveBeenCalledWith("project", "read", actor);
      expect(generatePdfMock).toHaveBeenCalledWith("proj_1", "org_A", docType);
      expect(outcome).toMatchObject({ kind: "bytes", docType, status: "live", contentType: "application/pdf" });
    });
  }
});

describe("resolveProjectDocument — quote", () => {
  test("no live quote falls back to a watermarked draft-preview live render", async () => {
    queryMock.mockImplementationOnce(async (fnRef: unknown) => {
      expect(nameOf(fnRef)).toBe("quotes:revisionStateForProject");
      return { revision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    });

    const outcome = await resolveProjectDocument(actor, "proj_1", "quote");

    expect(requirePermissionMock).toHaveBeenCalledWith("invoice", "read", actor);
    expect(generatePdfMock).toHaveBeenCalledWith("proj_1", "org_A", "quote", { draftPreview: true });
    expect(outcome).toMatchObject({ kind: "bytes", docType: "quote", status: "draft-preview" });
  });

  test("a live (sent) quote with a stored artifact resolves to the stored outcome, never re-rendering", async () => {
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = nameOf(fnRef);
      if (name === "quotes:revisionStateForProject") {
        return { revision: 2, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: { id: "quote_1", version: 2, status: "SENT" } };
      }
      if (name === "financeArtifacts:quoteArtifactContext") {
        return { quoteId: "quote_1", projectId: "proj_1", projectNumber: "RVLT-2026-0001", version: 2, pdfFileId: "storage_1" };
      }
      throw new Error(`Unmocked query: ${name}`);
    });

    const outcome = await resolveProjectDocument(actor, "proj_1", "quote");

    expect(generatePdfMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "stored",
      docType: "quote",
      status: "sent",
      fileName: "RVLT-2026-0001-quote-v2.pdf",
      organizationId: "org_A",
      storageId: "storage_1",
    });
  });

  test("a sent quote whose artifact hasn't finished rendering is DOCUMENT_NOT_READY", async () => {
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = nameOf(fnRef);
      if (name === "quotes:revisionStateForProject") {
        return { revision: 2, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: { id: "quote_1", version: 2, status: "SENT" } };
      }
      if (name === "financeArtifacts:quoteArtifactContext") {
        return { quoteId: "quote_1", projectId: "proj_1", projectNumber: "RVLT-2026-0001", version: 2, pdfFileId: null };
      }
      throw new Error(`Unmocked query: ${name}`);
    });

    await expect(resolveProjectDocument(actor, "proj_1", "quote")).rejects.toMatchObject({ code: "DOCUMENT_NOT_READY" });
  });
});

describe("resolveProjectDocument — invoice", () => {
  test("no issued invoice is NOT_FOUND (no draft-invoice fallback)", async () => {
    queryMock.mockImplementationOnce(async (fnRef: unknown) => {
      expect(nameOf(fnRef)).toBe("invoices:listForProject");
      return [{ id: "inv_1", status: "DRAFT", issuedAt: null }];
    });

    await expect(resolveProjectDocument(actor, "proj_1", "invoice")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(generatePdfMock).not.toHaveBeenCalled();
  });

  test("picks the most recently issued invoice and streams its stored artifact", async () => {
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = nameOf(fnRef);
      if (name === "invoices:listForProject") {
        return [
          { id: "inv_old", status: "ISSUED", issuedAt: 1_000 },
          { id: "inv_new", status: "ISSUED", issuedAt: 2_000 },
          { id: "inv_void", status: "VOID", issuedAt: 3_000 },
        ];
      }
      if (name === "financeArtifacts:invoiceArtifactContext") {
        return { invoiceId: "inv_new", projectId: "proj_1", projectNumber: "RVLT-2026-0001", invoiceNumber: "INV-42", pdfFileId: "storage_2" };
      }
      throw new Error(`Unmocked query: ${name}`);
    });

    const outcome = await resolveProjectDocument(actor, "proj_1", "invoice");

    expect(queryMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ invoiceId: "inv_new" }));
    expect(outcome).toEqual({
      kind: "stored",
      docType: "invoice",
      status: "issued",
      fileName: "INV-42-invoice.pdf",
      organizationId: "org_A",
      storageId: "storage_2",
    });
  });
});
