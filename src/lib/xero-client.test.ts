import { describe, expect, it, vi } from "vitest";
import {
  buildXeroAuthorizeUrl,
  createXeroContact,
  createXeroDraftInvoice,
  exchangeXeroAuthCode,
  fetchXeroAccounts,
  fetchXeroTaxRates,
  findXeroContactByEmail,
  listXeroConnections,
  refreshXeroAccessToken,
  searchXeroContactsByName,
  XeroApiError,
  XERO_OAUTH_SCOPES,
} from "./xero-client";

/** Build a mock `fetch` that returns a fixed JSON body + status, and records
 *  every call for assertion. Mirrors the mock-HTTP pattern this repo's other
 *  external-integration tests use (never a real network call). */
function mockFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  return { impl, calls };
}

describe("buildXeroAuthorizeUrl", () => {
  it("builds a login.xero.com authorize URL with the required OAuth2 params", () => {
    const url = buildXeroAuthorizeUrl({
      clientId: "client-123",
      redirectUri: "https://flow.rvlt.app/api/integrations/xero/callback",
      state: "signed-state-token",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://flow.rvlt.app/api/integrations/xero/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("signed-state-token");
    // Every declared OAuth2 scope reaches the URL — no silent scope drift
    // between the documented XERO_OAUTH_SCOPES list and what's requested.
    expect(parsed.searchParams.get("scope")).toBe(XERO_OAUTH_SCOPES.join(" "));
  });

  it("percent-encodes the scope's spaces as %20, not +", () => {
    // Regression test: `new URLSearchParams(...).toString()` encodes spaces
    // as `+` (application/x-www-form-urlencoded), which round-trips fine
    // through URLSearchParams.get() in a test (masking the bug) but Xero's
    // /authorize endpoint parses the query string strictly and never decodes
    // `+` back to a space — it saw one unrecognized scope blob and rejected
    // the whole authorize request with `invalid_scope`.
    const url = buildXeroAuthorizeUrl({
      clientId: "client-123",
      redirectUri: "https://flow.rvlt.app/api/integrations/xero/callback",
      state: "signed-state-token",
    });
    expect(url).toContain("scope=openid%20profile%20email");
    expect(url).not.toContain("+");
  });
});

describe("exchangeXeroAuthCode / refreshXeroAccessToken", () => {
  const tokenFixture = {
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    token_type: "Bearer",
    expires_in: 1800,
    scope: "openid profile email offline_access accounting.invoices",
  };

  it("exchanges an authorization code for a token pair with Basic auth", async () => {
    const { impl, calls } = mockFetch(tokenFixture);
    const result = await exchangeXeroAuthCode({
      code: "auth-code-1",
      redirectUri: "https://flow.rvlt.app/api/integrations/xero/callback",
      clientId: "cid",
      clientSecret: "csecret",
      fetchImpl: impl,
    });
    expect(result).toEqual(tokenFixture);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://identity.xero.com/connect/token");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
  });

  it("refreshes an access token via grant_type=refresh_token", async () => {
    const { impl, calls } = mockFetch(tokenFixture);
    const result = await refreshXeroAccessToken({
      refreshToken: "old-refresh",
      clientId: "cid",
      clientSecret: "csecret",
      fetchImpl: impl,
    });
    expect(result.access_token).toBe("access-abc");
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
  });

  it("throws XeroApiError on a non-2xx token response", async () => {
    const { impl } = mockFetch({ error: "invalid_grant" }, 400);
    await expect(
      refreshXeroAccessToken({ refreshToken: "bad", clientId: "cid", clientSecret: "csecret", fetchImpl: impl }),
    ).rejects.toThrow(XeroApiError);
  });

  it("throws XeroApiError when the token response fails schema validation", async () => {
    const { impl } = mockFetch({ unexpected: "shape" });
    await expect(
      refreshXeroAccessToken({ refreshToken: "x", clientId: "cid", clientSecret: "csecret", fetchImpl: impl }),
    ).rejects.toThrow(XeroApiError);
  });
});

describe("listXeroConnections", () => {
  it("parses the tenant connection list", async () => {
    const fixture = [
      { id: "conn-1", tenantId: "tenant-abc", tenantType: "ORGANISATION", tenantName: "Two Toned Productions" },
    ];
    const { impl, calls } = mockFetch(fixture);
    const result = await listXeroConnections({ accessToken: "tok", fetchImpl: impl });
    expect(result).toEqual(fixture);
    expect(calls[0]!.url).toBe("https://api.xero.com/connections");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });
});

const authOpts = { accessToken: "tok", tenantId: "tenant-abc" };

describe("fetchXeroAccounts", () => {
  it("parses accounts and filters out ARCHIVED ones", async () => {
    const fixture = {
      Accounts: [
        { AccountID: "a1", Code: "4200", Name: "Equipment Rental Income", Type: "REVENUE", Status: "ACTIVE" },
        { AccountID: "a2", Code: "9999", Name: "Old Account", Type: "REVENUE", Status: "ARCHIVED" },
      ],
    };
    const { impl, calls } = mockFetch(fixture);
    const result = await fetchXeroAccounts({ ...authOpts, fetchImpl: impl });
    expect(result).toHaveLength(1);
    expect(result[0]!.Code).toBe("4200");
    expect(calls[0]!.url).toBe("https://api.xero.com/api.xro/2.0/Accounts");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Xero-tenant-id"]).toBe("tenant-abc");
  });

  it("throws when the Accounts response is malformed", async () => {
    const { impl } = mockFetch({ notAccounts: true });
    await expect(fetchXeroAccounts({ ...authOpts, fetchImpl: impl })).rejects.toThrow(XeroApiError);
  });
});

describe("fetchXeroTaxRates", () => {
  it("parses tax rates and filters out DELETED/ARCHIVED", async () => {
    const fixture = {
      TaxRates: [
        { Name: "GST on Income", TaxType: "OUTPUT2", Status: "ACTIVE", DisplayTaxRate: 10, EffectiveRate: 10 },
        { Name: "Old rate", TaxType: "OUTPUT_OLD", Status: "DELETED" },
      ],
    };
    const { impl } = mockFetch(fixture);
    const result = await fetchXeroTaxRates({ ...authOpts, fetchImpl: impl });
    expect(result).toHaveLength(1);
    expect(result[0]!.TaxType).toBe("OUTPUT2");
  });

  // Regression (live bug): a push failed with "The TaxType code 'INPUT'
  // cannot be used with account code '200'" because the org's default tax
  // type was set to an expenses-only rate — nothing modeled or surfaced
  // Xero's own CanApplyToRevenue flag that would have caught this at
  // configuration time. It must survive schema parsing so the Settings ->
  // Xero picker can filter on it (xero-coding-fields.test.tsx).
  it("preserves CanApplyToRevenue on both income and expense rates", async () => {
    const fixture = {
      TaxRates: [
        { Name: "GST on Income", TaxType: "OUTPUT2", Status: "ACTIVE", CanApplyToRevenue: true, CanApplyToExpenses: false },
        { Name: "GST on Expenses", TaxType: "INPUT2", Status: "ACTIVE", CanApplyToRevenue: false, CanApplyToExpenses: true },
      ],
    };
    const { impl } = mockFetch(fixture);
    const result = await fetchXeroTaxRates({ ...authOpts, fetchImpl: impl });
    expect(result.find((r) => r.TaxType === "OUTPUT2")?.CanApplyToRevenue).toBe(true);
    expect(result.find((r) => r.TaxType === "INPUT2")?.CanApplyToRevenue).toBe(false);
  });
});

describe("findXeroContactByEmail", () => {
  it("returns the matched contact when found", async () => {
    const fixture = { Contacts: [{ ContactID: "c1", Name: "Acme Pty Ltd", EmailAddress: "billing@acme.test" }] };
    const { impl, calls } = mockFetch(fixture);
    const result = await findXeroContactByEmail("billing@acme.test", { ...authOpts, fetchImpl: impl });
    expect(result?.ContactID).toBe("c1");
    expect(calls[0]!.url).toContain("where=");
    expect(decodeURIComponent(calls[0]!.url)).toContain('EmailAddress=="billing@acme.test"');
  });

  it("returns null when no contact matches", async () => {
    const { impl } = mockFetch({ Contacts: [] });
    const result = await findXeroContactByEmail("nobody@acme.test", { ...authOpts, fetchImpl: impl });
    expect(result).toBeNull();
  });

  it("escapes backslashes before quotes so a crafted email can't break out of the where clause", async () => {
    const { impl, calls } = mockFetch({ Contacts: [] });
    await findXeroContactByEmail('\\"; DROP', { ...authOpts, fetchImpl: impl });
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain('EmailAddress=="\\\\\\"; DROP"');
  });
});

describe("searchXeroContactsByName", () => {
  it("returns matching contacts", async () => {
    const fixture = { Contacts: [{ ContactID: "c2", Name: "Acme Events" }] };
    const { impl } = mockFetch(fixture);
    const result = await searchXeroContactsByName("Acme", { ...authOpts, fetchImpl: impl });
    expect(result).toHaveLength(1);
    expect(result[0]!.Name).toBe("Acme Events");
  });

  it("escapes backslashes before quotes in the name clause", async () => {
    const { impl, calls } = mockFetch({ Contacts: [] });
    await searchXeroContactsByName('back\\slash', { ...authOpts, fetchImpl: impl });
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain('Name.Contains("back\\\\slash")');
  });
});

describe("createXeroContact", () => {
  it("posts a new contact and returns the created record", async () => {
    const fixture = { Contacts: [{ ContactID: "c3", Name: "New Client", EmailAddress: "hello@newclient.test" }] };
    const { impl, calls } = mockFetch(fixture);
    const result = await createXeroContact(
      { name: "New Client", email: "hello@newclient.test", addressLine1: "1 Test St", city: "Sydney" },
      { ...authOpts, fetchImpl: impl },
    );
    expect(result.ContactID).toBe("c3");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.Contacts[0].Name).toBe("New Client");
    expect(body.Contacts[0].Addresses[0].AddressLine1).toBe("1 Test St");
  });

  it("throws when Xero returns no contact", async () => {
    const { impl } = mockFetch({ Contacts: [] });
    await expect(
      createXeroContact({ name: "X" }, { ...authOpts, fetchImpl: impl }),
    ).rejects.toThrow(XeroApiError);
  });
});

describe("createXeroDraftInvoice", () => {
  it("posts a DRAFT ACCREC invoice with Flow's invoice number and line coding", async () => {
    const fixture = { Invoices: [{ InvoiceID: "inv-1", InvoiceNumber: "INV-2026-0001", Status: "DRAFT", Type: "ACCREC" }] };
    const { impl, calls } = mockFetch(fixture);
    const result = await createXeroDraftInvoice(
      {
        contactId: "c1",
        invoiceNumber: "INV-2026-0001",
        reference: "Project 260701",
        date: "2026-07-26",
        dueDate: "2026-08-09",
        lineItems: [
          { description: "PA System hire", quantity: 1, unitAmount: 500, accountCode: "4200", taxType: "OUTPUT2" },
        ],
      },
      { ...authOpts, fetchImpl: impl },
    );
    expect(result.InvoiceID).toBe("inv-1");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.Invoices[0].Type).toBe("ACCREC");
    expect(body.Invoices[0].Status).toBe("DRAFT");
    expect(body.Invoices[0].InvoiceNumber).toBe("INV-2026-0001");
    expect(body.Invoices[0].LineItems[0].AccountCode).toBe("4200");
    expect(body.Invoices[0].LineItems[0].TaxType).toBe("OUTPUT2");
  });

  it("throws XeroApiError on a non-2xx response with the Xero error payload attached", async () => {
    const { impl } = mockFetch({ Type: "ValidationException", Message: "A validation exception occurred" }, 400);
    await expect(
      createXeroDraftInvoice(
        { contactId: "c1", invoiceNumber: "INV-1", date: "2026-07-26", lineItems: [] },
        { ...authOpts, fetchImpl: impl },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  // Regression (live bug): a bare "Xero POST /api.xro/2.0/Invoices returned
  // 400" told the user (and the persisted invoices.lastSyncError /
  // xeroSyncLogs.errorMessage) nothing about WHY Xero rejected the push.
  // Xero's actual reason (per-line ValidationErrors, e.g. an invalid account
  // code or tax type) sat unread in the error body. The thrown message must
  // surface it.
  it("includes Xero's per-line ValidationErrors detail in the thrown message, not just the status", async () => {
    const { impl } = mockFetch(
      {
        Type: "ValidationException",
        Message: "A validation exception occurred",
        Elements: [
          {
            LineItems: [{ Description: "PA System hire" }],
            ValidationErrors: [{ Message: "Account code '9999' is not a valid code for this document." }],
          },
        ],
      },
      400,
    );
    await expect(
      createXeroDraftInvoice(
        {
          contactId: "c1",
          invoiceNumber: "INV-1",
          date: "2026-07-26",
          lineItems: [{ description: "PA System hire", quantity: 1, unitAmount: 500, accountCode: "9999", taxType: "OUTPUT2" }],
        },
        { ...authOpts, fetchImpl: impl },
      ),
    ).rejects.toThrow(/Account code '9999' is not a valid code for this document/);
  });
});
