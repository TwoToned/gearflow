/**
 * The two finance artifact routes + the draft-preview gate (#987).
 *
 * These are the highest-risk NEW surfaces in the finance program: they take an
 * id straight off the URL and stream bytes, and `quotes.by_cuid` /
 * `invoices.by_cuid` are GLOBAL Convex indexes, so "the caller is authenticated"
 * says nothing about whose document this is (R-8.4.3). Every cross-org path is
 * asserted here, plus the two properties that make the artifact immutable in
 * practice: the route NEVER regenerates, and a quote/invoice can no longer be
 * live-rendered out of the Documents menu.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

const requirePermission = vi.fn(async () => ({ organizationId: "org_1", userId: "u1", userName: "Alice" }));
vi.mock("@/lib/org-context", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));

const requireOrganization = vi.fn(async () => ({ organizationId: "org_1", userId: "u1" }));
vi.mock("@/lib/auth-server", () => ({ requireOrganization: () => requireOrganization() }));

const queryMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: queryMock, mutation: vi.fn() })),
}));

const getServeInfo = vi.fn();
vi.mock("@/lib/storage", () => ({ getServeInfo: (...a: unknown[]) => getServeInfo(...(a as [string])) }));

const fetchWithTimeout = vi.fn();
vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: (...a: unknown[]) => fetchWithTimeout(...a) }));

const generatePdf = vi.fn(async () => new Uint8Array([1, 2, 3]));
vi.mock("@/lib/pdfme/generate-pdf", () => ({ generatePdf: (...a: unknown[]) => generatePdf(...(a as [])) }));

import { GET as getQuotePdf } from "../quote/[quoteId]/pdf/route";
import { GET as getInvoicePdf } from "../invoice/[invoiceId]/pdf/route";
import { GET as getProjectDocument } from "../../documents/[projectId]/route";

const STORED_BYTES = new Uint8Array([37, 80, 68, 70]); // "%PDF"

const QUOTE_CONTEXT = {
  quoteId: "q1", projectId: "p1", projectNumber: "RVLT-2026-0087", version: 2,
  effectiveStatus: "SENT", label: "RVLT-2026-0087 v2", pdfFileId: "storage_1",
  sentAt: 1_700_000_000_000, quoteDate: 1_700_000_000_000, validUntil: 1_702_000_000_000,
};
const INVOICE_CONTEXT = {
  invoiceId: "inv1", projectId: "p1", projectNumber: "RVLT-2026-0087",
  invoiceNumber: "INV-2026-0001", kind: "FULL", status: "ISSUED",
  pdfFileId: "storage_2", issuedAt: 1_700_000_000_000, dueDate: null,
};

const req = (url = "http://localhost/x") => new Request(url) as never;
const quoteParams = { params: Promise.resolve({ quoteId: "q1" }) };
const invoiceParams = { params: Promise.resolve({ invoiceId: "inv1" }) };
const projectParams = { params: Promise.resolve({ projectId: "p1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ organizationId: "org_1", userId: "u1", userName: "Alice" });
  requireOrganization.mockResolvedValue({ organizationId: "org_1", userId: "u1" });
  queryMock.mockImplementation(async (fnRef: unknown) => {
    const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
    if (name === "financeArtifacts:quoteArtifactContext") return QUOTE_CONTEXT;
    if (name === "financeArtifacts:invoiceArtifactContext") return INVOICE_CONTEXT;
    throw new Error(`Unmocked query: ${name}`);
  });
  getServeInfo.mockResolvedValue({
    organizationId: "org_1",
    url: "https://convex.example/file",
    contentType: "application/pdf",
    size: STORED_BYTES.length,
    fileName: "stored.pdf",
  });
  fetchWithTimeout.mockResolvedValue(new Response(STORED_BYTES, { status: 200 }));
});

describe("GET /api/finance/quote/[quoteId]/pdf", () => {
  test("streams the STORED bytes and never re-renders", async () => {
    const res = await getQuotePdf(req(), quoteParams);

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(STORED_BYTES);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("names the download after the revision, so v2 and v3 can't collide", async () => {
    const res = await getQuotePdf(req(), quoteParams);

    expect(res.headers.get("Content-Disposition")).toContain('filename="RVLT-2026-0087-quote-v2.pdf"');
  });

  test("another org's quote id is a 404 — indistinguishable from a missing one", async () => {
    queryMock.mockRejectedValue(new Error("Quote not found."));

    const res = await getQuotePdf(req(), quoteParams);

    expect(res.status).toBe(404);
    expect(getServeInfo).not.toHaveBeenCalled();
  });

  test("a stored file belonging to another org is refused even if the row check passed", async () => {
    getServeInfo.mockResolvedValue({
      organizationId: "org_2", url: "https://convex.example/file", contentType: "application/pdf", size: 4, fileName: "x.pdf",
    });

    const res = await getQuotePdf(req(), quoteParams);

    expect(res.status).toBe(403);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  test("a revision with no artifact yet is a 404 — never a silent live render", async () => {
    queryMock.mockResolvedValue({ ...QUOTE_CONTEXT, pdfFileId: null });

    const res = await getQuotePdf(req(), quoteParams);

    expect(res.status).toBe(404);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("requires invoice:read", async () => {
    requirePermission.mockRejectedValue(new Error("You don't have permission to perform this action."));

    const res = await getQuotePdf(req(), quoteParams);

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/finance/invoice/[invoiceId]/pdf", () => {
  test("streams the stored bytes, named for the invoice number", async () => {
    const res = await getInvoicePdf(req(), invoiceParams);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain('filename="INV-2026-0001-invoice.pdf"');
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("another org's invoice id is a 404", async () => {
    queryMock.mockRejectedValue(new Error("Invoice not found."));

    const res = await getInvoicePdf(req(), invoiceParams);

    expect(res.status).toBe(404);
  });

  test("a VOIDed invoice keeps its document — the record has to show what was sent", async () => {
    queryMock.mockResolvedValue({ ...INVOICE_CONTEXT, status: "VOID" });

    const res = await getInvoicePdf(req(), invoiceParams);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/documents/[projectId] — the rogue path is closed", () => {
  test("a bare ?type=quote is refused: there is no live client-facing quote render any more", async () => {
    const res = await getProjectDocument(req("http://localhost/api/documents/p1?type=quote") as never, projectParams);

    expect(res.status).toBe(400);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("a bare ?type=invoice is refused the same way", async () => {
    const res = await getProjectDocument(req("http://localhost/api/documents/p1?type=invoice") as never, projectParams);

    expect(res.status).toBe(400);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("preview=1 renders WITH the watermark and requires invoice:read", async () => {
    const res = await getProjectDocument(
      req("http://localhost/api/documents/p1?type=quote&preview=1") as never,
      projectParams,
    );

    expect(res.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("invoice", "read");
    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "quote", { draftPreview: true });
  });

  test("preview=1 without invoice:read is a 403, not a document", async () => {
    requirePermission.mockRejectedValue(new Error("You don't have permission to perform this action."));

    const res = await getProjectDocument(
      req("http://localhost/api/documents/p1?type=quote&preview=1") as never,
      projectParams,
    );

    expect(res.status).toBe(403);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  test("warehouse documents are untouched — they SHOULD reflect live state, and carry no watermark", async () => {
    const res = await getProjectDocument(
      req("http://localhost/api/documents/p1?type=pull-slip") as never,
      projectParams,
    );

    expect(res.status).toBe(200);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "packing-list", { draftPreview: false });
  });

  test("a warehouse doc can't be tricked into a watermark by adding preview=1", async () => {
    await getProjectDocument(
      req("http://localhost/api/documents/p1?type=delivery-docket&preview=1") as never,
      projectParams,
    );

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "delivery-docket", { draftPreview: false });
  });

  // Bug fix: previewing a DEPOSIT/BALANCE/CREDIT invoice used to always show
  // the live project's full total/breakdown, because this route never told
  // generatePdf WHICH invoice it was previewing.
  test("an invoice preview's invoiceId query param is forwarded to generatePdf", async () => {
    await getProjectDocument(
      req("http://localhost/api/documents/p1?type=invoice&preview=1&invoiceId=inv_deposit") as never,
      projectParams,
    );

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "invoice", { draftPreview: true, invoiceId: "inv_deposit" });
  });

  test("an invoice preview with no invoiceId falls back to the legacy live render (no id to key off)", async () => {
    await getProjectDocument(
      req("http://localhost/api/documents/p1?type=invoice&preview=1") as never,
      projectParams,
    );

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "invoice", { draftPreview: true, invoiceId: undefined });
  });

  test("an invoiceId on a NON-invoice type is ignored — it's meaningless for a quote/warehouse doc", async () => {
    await getProjectDocument(
      req("http://localhost/api/documents/p1?type=quote&preview=1&invoiceId=inv1") as never,
      projectParams,
    );

    expect(generatePdf).toHaveBeenCalledWith("p1", "org_1", "quote", { draftPreview: true });
  });
});
