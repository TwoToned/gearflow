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
const upsertXeroDraftInvoice = vi.fn(async () => ({ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-2026-0001", Status: "DRAFT" }));
const refreshXeroAccessToken = vi.fn(async () => ({ access_token: "access-tok", refresh_token: "new-refresh-tok" }));

vi.mock("@/lib/xero-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/xero-client")>("@/lib/xero-client");
  return {
    ...actual,
    refreshXeroAccessToken: (...args: unknown[]) => refreshXeroAccessToken(...(args as [])),
    findXeroContactByEmail: (...args: unknown[]) => findXeroContactByEmail(...(args as [])),
    createXeroContact: (...args: unknown[]) => createXeroContact(...(args as [])),
    upsertXeroDraftInvoice: (...args: unknown[]) => upsertXeroDraftInvoice(...(args as [])),
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
    upsertXeroDraftInvoice.mockResolvedValue({ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-2026-0001", Status: "DRAFT" });
  });

  test("links to an existing Xero contact found by exact email match — does NOT create a duplicate", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test" };
    queryMock.mockImplementation(queryImplFor(client));
    findXeroContactByEmail.mockResolvedValue({ ContactID: "existing-contact-1", Name: "Acme Events" });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(findXeroContactByEmail).toHaveBeenCalledWith("billing@acme.test", expect.anything());
    expect(createXeroContact).not.toHaveBeenCalled(); // duplicate protection — no create when found
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
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
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.autoCreatedContact).toBe(true);
  });

  test("skips the contact search/create entirely when the client is already mapped", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test", xeroContactId: "already-mapped", xeroContactName: "Acme Events" };
    queryMock.mockImplementation(queryImplFor(client));

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(findXeroContactByEmail).not.toHaveBeenCalled();
    expect(createXeroContact).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.autoCreatedContact).toBe(false);
    expect(result.xeroInvoiceId).toBe("xero-inv-1");
    expect(result.updated).toBe(false);
  });

  // The "make Push to Xero also update" feature: re-pushing an ALREADY-synced
  // invoice (xeroInvoiceId set from a prior push) must update that same Xero
  // invoice, not create a duplicate — Button visibility used to hide once
  // xeroSyncStatus === "SYNCED", so a Flow-side fix (wrong description,
  // corrected coding) had no way back into Xero short of editing it by hand.
  test("re-pushing an already-synced invoice UPDATES the same Xero invoice, not a new one", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", xeroContactId: "mapped", xeroContactName: "Acme" };
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
      if (name === "invoices:getById") return { ...INVOICE, xeroInvoiceId: "xero-inv-1", xeroSyncStatus: "SYNCED" };
      if (name === "xeroIntegrations:getByOrgId") return INTEGRATION;
      if (name === "projects:getById") return PROJECT;
      if (name === "clients:getById") return client;
      if (name === "invoiceLines:listForInvoice") return [{ id: "line1", description: "USB Pro DI", quantity: 1, unitPrice: 1000 }];
      if (name === "xeroPush:resolveCodingForInvoice") return { lines: [{ lineId: "line1", accountCode: "4200", taxType: "OUTPUT2" }], varianceNote: null };
      throw new Error(`Unmocked query: ${name}`);
    });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.updated).toBe(true);
    expect(result.xeroInvoiceId).toBe("xero-inv-1");
    expect(upsertXeroDraftInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ xeroInvoiceId: "xero-inv-1" }),
      expect.anything(),
    );

    const activityCall = mutationMock.mock.calls.find((c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === "xeroPush:logXeroPushActivity");
    expect(activityCall?.[1]).toMatchObject({ updated: true });
  });

  // Regression: a discounted line's Xero LineAmount used to be silently
  // dropped — pushInvoiceToXero only sent Quantity/UnitAmount and let Xero
  // recompute the total itself (Quantity × UnitAmount), which knows nothing
  // about Flow's discount already netted into invoiceLines.lineTotal. Xero's
  // invoice total then overstated the client's actual charge by the discount
  // amount. `lineAmount` must always carry the authoritative, discount- (and
  // duration-) adjusted `lineTotal`, not a value Xero re-derives.
  test("a discounted line's Xero LineAmount reflects the net lineTotal, not Quantity × UnitAmount", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", xeroContactId: "mapped", xeroContactName: "Acme" };
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
      if (name === "invoices:getById") return INVOICE;
      if (name === "xeroIntegrations:getByOrgId") return INTEGRATION;
      if (name === "projects:getById") return PROJECT;
      if (name === "clients:getById") return client;
      // Gross would be 2 × $100 = $200; a $30 discount nets lineTotal to $170.
      if (name === "invoiceLines:listForInvoice") return [{ id: "line1", description: "USB Pro DI", quantity: 2, unitPrice: 100, lineTotal: 170 }];
      if (name === "xeroPush:resolveCodingForInvoice") return { lines: [{ lineId: "line1", accountCode: "4200", taxType: "OUTPUT2" }], varianceNote: null };
      throw new Error(`Unmocked query: ${name}`);
    });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(upsertXeroDraftInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItems: [expect.objectContaining({ quantity: 2, unitAmount: 100, lineAmount: 170 })],
      }),
      expect.anything(),
    );
  });

  test("a Xero API failure marks the invoice ERROR and returns { ok: false }, without silently swallowing the error", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", contactEmail: "billing@acme.test", xeroContactId: "mapped", xeroContactName: "Acme" };
    queryMock.mockImplementation(queryImplFor(client));
    upsertXeroDraftInvoice.mockRejectedValue(new Error("Xero POST /Invoices returned 400"));

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/xero push failed/i);

    const failCall = mutationMock.mock.calls.find((c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === "xeroPush:markXeroPushFailedNative");
    expect(failCall).toBeDefined();
  });

  // Regression (live bug): every one of these precondition failures used to
  // throw a plain, uncaught Error straight out of the Server Action. Next.js
  // redacts uncaught Server Action errors in production to a generic "error
  // occurred in the Server Components render" message + digest, so the user
  // pressing "Push to Xero" saw a useless 500 no matter which of these fired.
  // pushInvoiceToXero must never throw — every failure resolves to
  // `{ ok: false, error }` so the real reason survives to the client.
  test("never throws — an invoice not ISSUED yet resolves to { ok: false } with a clear reason", async () => {
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events" };
    queryMock.mockImplementation(queryImplFor(client));
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
      if (name === "invoices:getById") return { ...INVOICE, status: "DRAFT" };
      throw new Error(`Unmocked query: ${name}`);
    });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/only an issued invoice/i);
  });

  test("never throws — Xero not connected for the org resolves to { ok: false } with a clear reason", async () => {
    queryMock.mockImplementation(async (fnRef: unknown) => {
      const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
      if (name === "invoices:getById") return INVOICE;
      if (name === "xeroIntegrations:getByOrgId") return { ...INTEGRATION, isConnected: false };
      throw new Error(`Unmocked query: ${name}`);
    });

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/not connected/i);
  });

  test("never throws — Xero not configured on this deployment resolves to { ok: false } with a clear reason", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "");
    vi.stubEnv("XERO_CLIENT_SECRET", "");
    // @/env parses process.env into a frozen object once at first import;
    // vi.resetModules forces a fresh read so the empty stub above takes effect
    // (a plain vi.stubEnv is invisible to an already-cached `env` object).
    vi.resetModules();
    const client = { id: "c1", organizationId: "org_1", name: "Acme Events", xeroContactId: "mapped", xeroContactName: "Acme" };
    queryMock.mockImplementation(queryImplFor(client));

    const { pushInvoiceToXero } = await import("./xero");
    const result = await pushInvoiceToXero("inv1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/not configured/i);
  });
});
