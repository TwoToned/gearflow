/**
 * src/server/xero.ts — pushInvoiceToXero orchestration, with every external
 * boundary mocked (Convex client, Xero API client, permission/activity-log
 * plumbing). Focused on the ONE piece of business logic that lives in this
 * file rather than in an already-unit-tested pure module: the auto-create-
 * contact-on-push decision — "exact-email match links instead of creating"
 * (spec requirement, duplicate-protection). Live Convex + live Xero are both
 * out of scope for a unit test; see the PR's "Deferred / not verified"
 * section for what this does NOT cover.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

const mutationMock = vi.fn(async (_fnRef: unknown, _args?: unknown) => ({}));
const queryMock = vi.fn();

vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: queryMock, mutation: mutationMock })),
}));
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org_1", userId: "user_1", userName: "Alice" })),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/crypto/secret-vault", () => ({
  encryptSecret: (v: string) => `enc(${v})`,
  decryptSecret: (v: string) => v.replace(/^enc\(|\)$/g, ""),
}));

const findXeroContactByEmail = vi.fn();
const createXeroContact = vi.fn();
const createXeroDraftInvoice = vi.fn(async () => ({ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-2026-0001", Status: "DRAFT" }));
const refreshXeroAccessToken = vi.fn(async () => ({ access_token: "access-tok", refresh_token: "new-refresh-tok" }));

vi.mock("@/lib/xero-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/xero-client")>("@/lib/xero-client");
  return {
    ...actual,
    refreshXeroAccessToken: (...args: unknown[]) => refreshXeroAccessToken(...(args as [])),
    findXeroContactByEmail: (...args: unknown[]) => findXeroContactByEmail(...(args as [])),
    createXeroContact: (...args: unknown[]) => createXeroContact(...(args as [])),
    createXeroDraftInvoice: (...args: unknown[]) => createXeroDraftInvoice(...(args as [])),
  };
});

const INVOICE = {
  id: "inv1", organizationId: "org_1", projectId: "p1", clientId: "c1", kind: "FULL",
  status: "ISSUED", invoiceNumber: "INV-2026-0001", issuedAt: 1_700_000_000_000, total: 1100,
};
const INTEGRATION = {
  id: "xi1", organizationId: "org_1", isConnected: true, tenantId: "tenant1",
  refreshTokenEncrypted: "enc(old-refresh-tok)",
};
const PROJECT = { id: "p1", projectNumber: "P1", name: "Gig" };

function queryImplFor(client: Record<string, unknown>) {
  return async (fnRef: unknown) => {
    // Convex's `anyApi` proxy mints a NEW FunctionReference object on every
    // property access (verified: `api.x.y === api.x.y` is false) — identify
    // by its stable string path instead of reference equality.
    const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
    if (name === "invoices:getById") return INVOICE;
    if (name === "xeroIntegrations:getByOrgId") return INTEGRATION;
    if (name === "projects:getById") return PROJECT;
    if (name === "clients:getById") return client;
    if (name === "invoiceLines:listForInvoice") return [{ id: "line1", description: "PA System", quantity: 1, unitPrice: 1000 }];
    if (name === "xeroPush:resolveCodingForInvoice") return { lines: [{ lineId: "line1", accountCode: "4200", taxType: "OUTPUT2" }], varianceNote: null };
    throw new Error(`Unmocked query: ${name}`);
  };
}

describe("pushInvoiceToXero — auto-create contact idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("XERO_CLIENT_ID", "test-client-id");
    vi.stubEnv("XERO_CLIENT_SECRET", "test-client-secret");
    createXeroDraftInvoice.mockResolvedValue({ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-2026-0001", Status: "DRAFT" });
  });

  test("links to an existing Xero contact found by exact email match — does NOT create a duplicate", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test" };
    queryMock.mockImplementation(queryImplFor(client));
    findXeroContactByEmail.mockResolvedValue({ ContactID: "existing-contact-1", Name: "Acme Events" });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(findXeroContactByEmail).toHaveBeenCalledWith("billing@acme.test", expect.anything());
    expect(createXeroContact).not.toHaveBeenCalled(); // duplicate protection — no create when found
    expect(result.autoCreatedContact).toBe(false);
    // The found contact is stored back onto the client (mutation call present).
    const setContactCall = mutationMock.mock.calls.find((c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === "clientXeroWrites:setXeroContactNative");
    expect(setContactCall?.[1]).toMatchObject({ xeroContactId: "existing-contact-1" });
  });

  test("creates a new Xero contact only when no exact-email match exists", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Brand New Client", contactEmail: "new@client.test" };
    queryMock.mockImplementation(queryImplFor(client));
    findXeroContactByEmail.mockResolvedValue(null);
    createXeroContact.mockResolvedValue({ ContactID: "new-contact-1", Name: "Brand New Client" });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(createXeroContact).toHaveBeenCalledTimes(1);
    expect(result.autoCreatedContact).toBe(true);
  });

  test("skips the contact search/create entirely when the client is already mapped", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test", xeroContactId: "already-mapped", xeroContactName: "Acme Events" };
    queryMock.mockImplementation(queryImplFor(client));

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(findXeroContactByEmail).not.toHaveBeenCalled();
    expect(createXeroContact).not.toHaveBeenCalled();
    expect(result.autoCreatedContact).toBe(false);
    expect(result.xeroInvoiceId).toBe("xero-inv-1");
  });

  test("a Xero API failure marks the invoice ERROR and rethrows, without silently swallowing the error", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test", xeroContactId: "mapped", xeroContactName: "Acme" };
    queryMock.mockImplementation(queryImplFor(client));
    createXeroDraftInvoice.mockRejectedValue(new Error("Xero POST /Invoices returned 400"));

    const { pushInvoiceToXero } = await import("./xero");
    await expect(pushInvoiceToXero("inv1")).rejects.toThrow(/xero push failed/i);

    const failCall = mutationMock.mock.calls.find((c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === "xeroPush:markXeroPushFailedNative");
    expect(failCall).toBeDefined();
  });
});
