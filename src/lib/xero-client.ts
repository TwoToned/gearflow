/**
 * Xero API client (WS1 #940) — thin, testable wrapper over Xero's public REST
 * API (OAuth2 + Accounting API, `api.xro/2.0`). No live Xero developer app
 * credentials are available in this build/test sandbox — every function is
 * unit-tested against FIXTURE responses with `fetch` mocked (see
 * xero-client.test.ts), never a real network call. Built against Xero's
 * published OpenAPI/REST shape from training knowledge; the real end-to-end
 * OAuth round-trip has NOT been exercised against Xero's live servers (see the
 * PR description's "Deferred / not verified" section).
 *
 * Every Xero HTTP response is Zod-parsed before any field is read
 * (POLICY.md R-8.2.3 — trust-boundary schema validation). Unknown/extra
 * fields in Xero's payload are silently dropped by the non-strict schemas
 * below; only the fields this integration actually uses are modeled.
 *
 * Plain `src/lib/*` module (no "use server") so it can be imported by both
 * server actions and its own unit tests without the re-export crash CLAUDE.md
 * warns about.
 */
import { z } from "zod";

const IDENTITY_BASE = "https://identity.xero.com";
const API_BASE = "https://api.xero.com";
const AUTHORIZE_BASE = "https://login.xero.com/identity/connect/authorize";

/** Scopes requested at connect time — read-only reference data + invoice/contact
 *  write, plus offline_access for the refresh token. */
export const XERO_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings.read",
] as const;

export interface XeroFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

/** Escape a value for embedding in a Xero `where` clause string literal.
 *  Backslashes MUST be escaped before quotes — escaping quotes first would
 *  leave a literal backslash in the input free to escape the closing quote
 *  Xero's clause parser adds, breaking out of the string literal. */
function escapeXeroWhereLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class XeroApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "XeroApiError";
  }
}

// ─── OAuth2 ──────────────────────────────────────────────────────────────────

export function buildXeroAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  // NOT URLSearchParams: its application/x-www-form-urlencoded encoding turns
  // the space-separated `scope` list into `+`-joined tokens
  // (openid+profile+email+...). Xero's /authorize endpoint parses the query
  // string strictly and never decodes `+` back to a space, so it sees one
  // unrecognized scope blob and rejects the whole request with
  // `invalid_scope`. encodeURIComponent percent-encodes a space as `%20`,
  // which Xero decodes correctly.
  const params: Record<string, string> = {
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: XERO_OAUTH_SCOPES.join(" "),
    state: opts.state,
  };
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${AUTHORIZE_BASE}?${query}`;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});
export type XeroTokenResponse = z.infer<typeof tokenResponseSchema>;

async function postToken(
  body: URLSearchParams,
  opts: { clientId: string; clientSecret: string; fetchImpl?: XeroFetch },
): Promise<XeroTokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const res = await fetchImpl(`${IDENTITY_BASE}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const json = await safeJson(res);
  if (!res.ok) {
    throw new XeroApiError(`Xero token endpoint returned ${res.status}`, res.status, json);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new XeroApiError("Xero token response failed schema validation", res.status, json);
  }
  return parsed.data;
}

/** Exchange an OAuth2 authorization code for an access/refresh token pair. */
export async function exchangeXeroAuthCode(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: XeroFetch;
}): Promise<XeroTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  return postToken(body, opts);
}

/** Refresh an access token using a stored (decrypted) refresh token. Xero
 *  rotates the refresh token on every use — callers MUST persist the new
 *  `refresh_token` from the response, not reuse the old one. */
export async function refreshXeroAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: XeroFetch;
}): Promise<XeroTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
  });
  return postToken(body, opts);
}

const connectionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantType: z.string().optional(),
  tenantName: z.string().optional(),
});
const connectionsSchema = z.array(connectionSchema);
export type XeroConnection = z.infer<typeof connectionSchema>;

/** List the Xero organisations (tenants) this connection has access to —
 *  called once right after the OAuth callback so the operator can pick one. */
export async function listXeroConnections(opts: {
  accessToken: string;
  fetchImpl?: XeroFetch;
}): Promise<XeroConnection[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${API_BASE}/connections`, {
    headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: "application/json" },
  });
  const json = await safeJson(res);
  if (!res.ok) throw new XeroApiError(`Xero connections returned ${res.status}`, res.status, json);
  const parsed = connectionsSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero connections response failed schema validation", res.status, json);
  return parsed.data;
}

// ─── Accounting API (api.xro/2.0) ──────────────────────────────────────────

interface AuthedRequestOpts {
  accessToken: string;
  tenantId: string;
  fetchImpl?: XeroFetch;
}

async function xeroGet(path: string, opts: AuthedRequestOpts): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Xero-tenant-id": opts.tenantId,
      Accept: "application/json",
    },
  });
  const json = await safeJson(res);
  if (!res.ok) throw new XeroApiError(`Xero GET ${path} returned ${res.status}`, res.status, json);
  return json;
}

async function xeroPost(path: string, body: unknown, opts: AuthedRequestOpts): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Xero-tenant-id": opts.tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await safeJson(res);
  if (!res.ok) throw new XeroApiError(`Xero POST ${path} returned ${res.status}`, res.status, json);
  return json;
}

const accountSchema = z.object({
  AccountID: z.string(),
  Code: z.string().optional(),
  Name: z.string(),
  Type: z.string().optional(),
  Class: z.string().optional(),
  Status: z.string().optional(),
  TaxType: z.string().optional(),
});
const accountsResponseSchema = z.object({ Accounts: z.array(accountSchema) });
export type XeroAccount = z.infer<typeof accountSchema>;

/** Fetch the org's full chart of accounts — cached org-side (xeroIntegrations
 *  .cachedAccounts), refreshed by the settings-page "Refresh" action, never
 *  called per-keystroke from an account picker. */
export async function fetchXeroAccounts(opts: AuthedRequestOpts): Promise<XeroAccount[]> {
  const json = await xeroGet("/api.xro/2.0/Accounts", opts);
  const parsed = accountsResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero Accounts response failed schema validation", undefined, json);
  return parsed.data.Accounts.filter((a) => a.Status !== "ARCHIVED");
}

const taxRateSchema = z.object({
  Name: z.string(),
  TaxType: z.string(),
  Status: z.string().optional(),
  DisplayTaxRate: z.number().optional(),
  EffectiveRate: z.number().optional(),
});
const taxRatesResponseSchema = z.object({ TaxRates: z.array(taxRateSchema) });
export type XeroTaxRate = z.infer<typeof taxRateSchema>;

export async function fetchXeroTaxRates(opts: AuthedRequestOpts): Promise<XeroTaxRate[]> {
  const json = await xeroGet("/api.xro/2.0/TaxRates", opts);
  const parsed = taxRatesResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero TaxRates response failed schema validation", undefined, json);
  return parsed.data.TaxRates.filter((t) => t.Status !== "DELETED" && t.Status !== "ARCHIVED");
}

const contactSchema = z.object({
  ContactID: z.string(),
  Name: z.string(),
  EmailAddress: z.string().optional(),
  ContactStatus: z.string().optional(),
});
const contactsResponseSchema = z.object({ Contacts: z.array(contactSchema) });
export type XeroContact = z.infer<typeof contactSchema>;

/** Exact-email lookup — the duplicate-protection check `pushInvoiceToXero`
 *  runs BEFORE ever creating a new contact (spec: "auto-create first tries an
 *  exact-email match ... and links instead of creating when found"). */
export async function findXeroContactByEmail(
  email: string,
  opts: AuthedRequestOpts,
): Promise<XeroContact | null> {
  const clause = `EmailAddress=="${escapeXeroWhereLiteral(email)}"`;
  const json = await xeroGet(`/api.xro/2.0/Contacts?where=${encodeURIComponent(clause)}`, opts);
  const parsed = contactsResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero Contacts response failed schema validation", undefined, json);
  return parsed.data.Contacts[0] ?? null;
}

export async function searchXeroContactsByName(
  name: string,
  opts: AuthedRequestOpts,
): Promise<XeroContact[]> {
  const clause = `Name.Contains("${escapeXeroWhereLiteral(name)}")`;
  const json = await xeroGet(`/api.xro/2.0/Contacts?where=${encodeURIComponent(clause)}`, opts);
  const parsed = contactsResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero Contacts response failed schema validation", undefined, json);
  return parsed.data.Contacts;
}

export async function createXeroContact(
  input: { name: string; email?: string; addressLine1?: string; city?: string; region?: string; postalCode?: string; country?: string },
  opts: AuthedRequestOpts,
): Promise<XeroContact> {
  const body = {
    Contacts: [
      {
        Name: input.name,
        EmailAddress: input.email || undefined,
        Addresses: input.addressLine1
          ? [
              {
                AddressType: "STREET",
                AddressLine1: input.addressLine1,
                City: input.city,
                Region: input.region,
                PostalCode: input.postalCode,
                Country: input.country,
              },
            ]
          : undefined,
      },
    ],
  };
  const json = await xeroPost("/api.xro/2.0/Contacts", body, opts);
  const parsed = contactsResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero Contacts create response failed schema validation", undefined, json);
  const created = parsed.data.Contacts[0];
  if (!created) throw new XeroApiError("Xero Contacts create returned no contact", undefined, json);
  return created;
}

export interface XeroInvoiceLineInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode?: string | null;
  taxType?: string | null;
}

const xeroInvoiceSchema = z.object({
  InvoiceID: z.string(),
  InvoiceNumber: z.string().optional(),
  Status: z.string().optional(),
  Type: z.string().optional(),
});
const invoicesResponseSchema = z.object({ Invoices: z.array(xeroInvoiceSchema) });
export type XeroInvoice = z.infer<typeof xeroInvoiceSchema>;

/** Create a Xero DRAFT invoice (ACCREC — accounts receivable, i.e. a sales
 *  invoice) carrying Flow's own invoice number as `InvoiceNumber` and
 *  `Reference`. Xero owns the ledger from here — Flow never marks it approved. */
export async function createXeroDraftInvoice(
  input: {
    contactId: string;
    invoiceNumber: string;
    reference?: string;
    date: string; // yyyy-MM-dd
    dueDate?: string; // yyyy-MM-dd
    lineItems: XeroInvoiceLineInput[];
  },
  opts: AuthedRequestOpts,
): Promise<XeroInvoice> {
  const body = {
    Invoices: [
      {
        Type: "ACCREC",
        Contact: { ContactID: input.contactId },
        Date: input.date,
        DueDate: input.dueDate,
        InvoiceNumber: input.invoiceNumber,
        Reference: input.reference,
        Status: "DRAFT",
        LineItems: input.lineItems.map((li) => ({
          Description: li.description,
          Quantity: li.quantity,
          UnitAmount: li.unitAmount,
          AccountCode: li.accountCode || undefined,
          TaxType: li.taxType || undefined,
        })),
      },
    ],
  };
  const json = await xeroPost("/api.xro/2.0/Invoices", body, opts);
  const parsed = invoicesResponseSchema.safeParse(json);
  if (!parsed.success) throw new XeroApiError("Xero Invoices create response failed schema validation", undefined, json);
  const created = parsed.data.Invoices[0];
  if (!created) throw new XeroApiError("Xero Invoices create returned no invoice", undefined, json);
  return created;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
