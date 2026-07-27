"use server";

/**
 * Xero server action module (WS1 #940) — the permanent server-only carve-out
 * for the Xero integration (external I/O + secrets, FEATUREDOCS/54's
 * "HMAC/crypto tokens/external API" bucket — same bucket as
 * src/server/woocommerce.ts). Handles: the OAuth2 connect/callback round
 * trip, reference-data (chart of accounts/tax rates) caching, coding
 * settings, client<->Xero contact mapping, and pushing an ISSUED invoice as a
 * Xero DRAFT invoice.
 *
 * No live Xero developer app credentials exist in this sandbox — every
 * function here is exercised by unit tests against the fixture-driven
 * src/lib/xero-client.ts (mocked fetch), never a real Xero API call. The
 * real end-to-end OAuth round trip + a real invoice push have NOT been
 * verified against Xero's live servers (see the PR's "Deferred / not
 * verified" section).
 */
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { env } from "@/env";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-vault";
import { createXeroOAuthState, verifyXeroOAuthState } from "@/lib/xero-oauth-state";
import {
  buildXeroAuthorizeUrl,
  exchangeXeroAuthCode,
  refreshXeroAccessToken,
  listXeroConnections,
  fetchXeroAccounts,
  fetchXeroTaxRates,
  findXeroContactByEmail,
  searchXeroContactsByName,
  createXeroContact,
  createXeroDraftInvoice,
  XeroApiError,
  type XeroInvoiceLineInput,
} from "@/lib/xero-client";

function xeroRedirectUri(): string {
  return env.XERO_REDIRECT_URI || `${env.NEXT_PUBLIC_APP_URL}/api/integrations/xero/callback`;
}

function requireXeroAppCredentials(): { clientId: string; clientSecret: string } {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error("Xero is not configured on this deployment (XERO_CLIENT_ID / XERO_CLIENT_SECRET unset).");
  }
  return { clientId: env.XERO_CLIENT_ID, clientSecret: env.XERO_CLIENT_SECRET };
}

// ─── Connection status + settings ──────────────────────────────────────────
// NOTE: there is no getXeroIntegrationStatus() server action here — the
// Settings -> Xero page and every other consumer read connection status via
// the reactive `useXeroIntegration()`/`useXeroLinked()` hooks
// (src/hooks/use-xero-linked.ts, backed by `xeroIntegrations.getForOrg`)
// instead of a server-action round trip, per FEATUREDOCS/54's "browser
// components subscribe to native reactive queries" default.

/**
 * Whether this DEPLOYMENT has a Xero developer app configured
 * (XERO_CLIENT_ID/XERO_CLIENT_SECRET) — distinct from whether any particular
 * org has connected (that's `xeroIntegrations.isConnected`, read via
 * `useXeroLinked()`). No permission gate: it reveals nothing but a boolean,
 * and the settings nav needs it before a user's org context justifies
 * `xero_manage`. Consumed via `useServerQuery` (never invalidated — a
 * deployment's env config doesn't change mid-session, see use-server-query.ts).
 */
export async function isXeroConfigured() {
  return serialize({ configured: Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET) });
}

/** Build the Xero authorize URL for the "Connect Xero" button. Requires
 *  xero_manage (org admin+) — connecting/disconnecting the integration is a
 *  more sensitive action than everyday invoice pushing. */
export async function getXeroAuthorizeUrl() {
  const { organizationId, userId } = await requirePermission("invoice", "xero_manage");
  const { clientId } = requireXeroAppCredentials();
  const state = createXeroOAuthState(organizationId, userId);
  return serialize({ url: buildXeroAuthorizeUrl({ clientId, redirectUri: xeroRedirectUri(), state }) });
}

/**
 * Called by the PUBLIC callback route (`/api/integrations/xero/callback`,
 * added to `src/middleware.ts` publicRoutes per the issue spec) — the state
 * token IS the auth here (HMAC-signed, see xero-oauth-state.ts), not a
 * session, since the round trip through Xero's own servers can't rely on the
 * browser's session cookie surviving the external redirect.
 */
export async function completeXeroConnection(code: string, state: string) {
  const { orgId, userId } = verifyXeroOAuthState(state); // throws XeroOAuthStateError on tamper/expiry
  const { clientId, clientSecret } = requireXeroAppCredentials();

  const tokens = await exchangeXeroAuthCode({ code, redirectUri: xeroRedirectUri(), clientId, clientSecret });
  const connections = await listXeroConnections({ accessToken: tokens.access_token });
  const connection = connections[0]; // single-tenant connect flow (v1) — see PR "Ambiguities resolved"
  if (!connection) throw new Error("Xero returned no connected organisations for this authorization.");

  const convex = await getConvexClient();
  const existing = await convex.query(api.xeroIntegrations.getByOrgId, { orgId });
  const now = Date.now();
  const patch = {
    isConnected: true,
    tenantId: connection.tenantId,
    tenantName: connection.tenantName,
    refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
    connectedAt: now,
    connectedById: userId,
    cacheError: undefined,
    updatedAt: now,
  };
  if (existing) {
    await convex.mutation(api.xeroIntegrations.patchXeroIntegration, { id: existing.id, set: patch, clear: [] });
  } else {
    await convex.mutation(api.xeroIntegrations.createIfMissing, { id: createId(), organizationId: orgId, ...patch, createdAt: now });
  }

  await logSyncEvent(orgId, "REFRESH_TOKEN", "SUCCESS", { tenantName: connection.tenantName });
  await logActivity({
    organizationId: orgId, userId, userName: "Xero connection",
    action: "UPDATE", entityType: "xeroIntegration", entityId: orgId,
    entityName: connection.tenantName ?? "Xero",
    summary: `Connected Xero organisation "${connection.tenantName ?? connection.tenantId}"`,
  });

  return serialize({ tenantName: connection.tenantName ?? null });
}

export async function disconnectXero() {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  const existing = await convex.query(api.xeroIntegrations.getByOrgId, { orgId: organizationId });
  if (!existing) return serialize({ ok: true as const });

  await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
    id: existing.id,
    set: { isConnected: false, updatedAt: Date.now() },
    clear: ["refreshTokenEncrypted", "tenantId", "tenantName", "cachedAccounts", "cachedTaxRates"],
  });
  await logActivity({
    organizationId, userId, userName,
    action: "UPDATE", entityType: "xeroIntegration", entityId: organizationId, entityName: "Xero",
    summary: "Disconnected Xero",
  });
  return serialize({ ok: true as const });
}

export interface XeroCodingSettingsInput {
  defaultAccountCode?: string;
  serviceAccountDefaults?: Partial<Record<"LABOUR" | "DELIVERY_TRANSPORT" | "MISC", string>>;
  defaultTaxType?: string;
}

export async function updateXeroCodingSettings(data: XeroCodingSettingsInput) {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  const existing = await convex.query(api.xeroIntegrations.getByOrgId, { orgId: organizationId });
  if (!existing) throw new Error("Connect Xero before configuring account coding.");

  await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
    id: existing.id,
    set: {
      defaultAccountCode: data.defaultAccountCode || undefined,
      serviceAccountDefaults: data.serviceAccountDefaults,
      defaultTaxType: data.defaultTaxType || undefined,
      updatedAt: Date.now(),
    },
    clear: [
      ...(data.defaultAccountCode ? [] : ["defaultAccountCode"]),
      ...(data.defaultTaxType ? [] : ["defaultTaxType"]),
    ],
  });
  await logActivity({
    organizationId, userId, userName,
    action: "UPDATE", entityType: "xeroIntegration", entityId: organizationId, entityName: "Xero",
    summary: "Updated Xero account-coding defaults",
  });
  return serialize({ ok: true as const });
}

/** Refresh the cached chart of accounts + tax rates. Rotates + persists the
 *  refresh token (Xero issues a new one on every use) BEFORE returning, so a
 *  later call always has a live token even if the caller never inspects the
 *  result. */
export async function refreshXeroReferenceData() {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  const integration = await convex.query(api.xeroIntegrations.getByOrgId, { orgId: organizationId });
  if (!integration?.isConnected || !integration.refreshTokenEncrypted || !integration.tenantId) {
    throw new Error("Xero is not connected for this organisation.");
  }

  try {
    const { accessToken, refreshToken } = await getFreshAccessToken(integration.refreshTokenEncrypted);
    const [accounts, taxRates] = await Promise.all([
      fetchXeroAccounts({ accessToken, tenantId: integration.tenantId }),
      fetchXeroTaxRates({ accessToken, tenantId: integration.tenantId }),
    ]);
    const now = Date.now();
    await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
      id: integration.id,
      set: {
        refreshTokenEncrypted: encryptSecret(refreshToken),
        cachedAccounts: accounts,
        cachedTaxRates: taxRates,
        cacheRefreshedAt: now,
        cacheError: undefined,
        updatedAt: now,
      },
      clear: [],
    });
    await logSyncEvent(organizationId, "FETCH_REFERENCE_DATA", "SUCCESS", { accounts: accounts.length, taxRates: taxRates.length });
    await logActivity({
      organizationId, userId, userName,
      action: "UPDATE", entityType: "xeroIntegration", entityId: organizationId, entityName: "Xero",
      summary: `Refreshed Xero reference data (${accounts.length} accounts, ${taxRates.length} tax rates)`,
    });
    return serialize({ accounts: accounts.length, taxRates: taxRates.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
      id: integration.id,
      set: { cacheError: message, updatedAt: Date.now() },
      clear: [],
    });
    await logSyncEvent(organizationId, "FETCH_REFERENCE_DATA", "FAILED", { error: message });
    throw new Error(`Failed to refresh Xero reference data: ${message}`);
  }
}

// ─── Client <-> Xero contact mapping ────────────────────────────────────────

export async function searchXeroContactsAction(searchTerm: string) {
  const { organizationId } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  const integration = await requireLinkedIntegration(convex, organizationId);
  const { accessToken } = await getFreshAccessToken(integration.refreshTokenEncrypted!, integration.id, convex);
  const results = await searchXeroContactsByName(searchTerm, { accessToken, tenantId: integration.tenantId! });
  return serialize(results);
}

export async function linkXeroContact(clientId: string, xeroContactId: string, xeroContactName: string) {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  await convex.mutation(api.clientXeroWrites.setXeroContactNative, {
    clientId, orgId: organizationId, xeroContactId, xeroContactName,
    actorUserId: userId, actorUserName: userName, auditId: createId(), now: Date.now(),
  });
  return serialize({ ok: true as const });
}

export async function unlinkXeroContact(clientId: string) {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_manage");
  const convex = await getConvexClient();
  await convex.mutation(api.clientXeroWrites.unlinkXeroContactNative, {
    clientId, orgId: organizationId, actorUserId: userId, actorUserName: userName, auditId: createId(), now: Date.now(),
  });
  return serialize({ ok: true as const });
}

// ─── Push ────────────────────────────────────────────────────────────────

export interface XeroPushResult {
  xeroInvoiceId: string;
  varianceNote: string | null;
  autoCreatedContact: boolean;
}

/**
 * Push an ISSUED invoice to Xero as a DRAFT (ACCREC) invoice. Ensures the
 * client has a mapped Xero contact first — duplicate protection: an
 * exact-email match against Xero's contacts LINKS instead of creating (spec
 * requirement). Coding is resolved server-side (convex/xeroPush.ts,
 * convex/lib/xeroAccountCascade.ts) and snapshotted onto invoiceLines.
 */
export async function pushInvoiceToXero(invoiceId: string): Promise<XeroPushResult> {
  const { organizationId, userId, userName } = await requirePermission("invoice", "xero_push");
  const convex = await getConvexClient();

  const invoice = await convex.query(api.invoices.getById, { id: invoiceId });
  if (!invoice || invoice.organizationId !== organizationId) throw new Error("Invoice not found.");
  if (invoice.status !== "ISSUED") throw new Error("Only an ISSUED invoice can be pushed to Xero.");
  if (!invoice.invoiceNumber) throw new Error("Invoice has no number — this should not happen for an ISSUED invoice.");

  const integration = await requireLinkedIntegration(convex, organizationId);
  const project = await convex.query(api.projects.getById, { id: invoice.projectId });
  const client = await convex.query(api.clients.getById, { id: invoice.clientId });
  if (!client) throw new Error("Client not found.");

  let autoCreatedContact = false;
  let xeroContactId = client.xeroContactId as string | undefined;
  const { accessToken } = await getFreshAccessToken(integration.refreshTokenEncrypted!, integration.id, convex);
  const tenantId = integration.tenantId!;

  if (!xeroContactId) {
    // Duplicate protection: exact-email match links instead of creating.
    const email = client.contactEmail || undefined;
    const existingContact = email ? await findXeroContactByEmail(email, { accessToken, tenantId }) : null;
    const contact =
      existingContact ??
      (await createXeroContact(
        { name: client.name, email, addressLine1: client.billingAddress || undefined },
        { accessToken, tenantId },
      ));
    xeroContactId = contact.ContactID;
    autoCreatedContact = existingContact == null;
    await convex.mutation(api.clientXeroWrites.setXeroContactNative, {
      clientId: client.id, orgId: organizationId, xeroContactId: contact.ContactID, xeroContactName: contact.Name,
      actorUserId: userId, actorUserName: userName, auditId: createId(), now: Date.now(),
    });
  }

  const lines = await convex.query(api.invoiceLines.listForInvoice, { orgId: organizationId, invoiceId });
  const coding = await convex.query(api.xeroPush.resolveCodingForInvoice, { invoiceId, orgId: organizationId });
  const codingByLineId = new Map(coding.lines.map((l) => [l.lineId, l]));

  const lineItems: XeroInvoiceLineInput[] = lines.map((l) => {
    const resolved = codingByLineId.get(l.id);
    return {
      description: l.description,
      quantity: l.quantity,
      unitAmount: l.unitPrice,
      accountCode: resolved?.accountCode ?? null,
      taxType: resolved?.taxType ?? null,
    };
  });

  const invoiceLabel = `${invoice.kind} invoice ${invoice.invoiceNumber}`;
  try {
    const created = await createXeroDraftInvoice(
      {
        contactId: xeroContactId,
        invoiceNumber: invoice.invoiceNumber,
        reference: project ? `Project ${project.projectNumber} — ${project.name}` : undefined,
        date: toDateOnly(invoice.issuedAt ?? Date.now()),
        dueDate: invoice.dueDate ? toDateOnly(invoice.dueDate) : undefined,
        lineItems,
      },
      { accessToken, tenantId },
    );

    await convex.mutation(api.xeroPush.applyXeroPushResultNative, {
      invoiceId, orgId: organizationId, xeroInvoiceId: created.InvoiceID, resolvedLines: coding.lines, now: Date.now(),
    });
    await logSyncEvent(organizationId, "PUSH_INVOICE", "SUCCESS", { xeroInvoiceId: created.InvoiceID }, invoiceId, created.InvoiceID, client.id);
    await convex.mutation(api.xeroPush.logXeroPushActivity, {
      organizationId, invoiceId, invoiceLabel, success: true,
      actorUserId: userId, actorUserName: userName, auditId: createId(), now: Date.now(),
    });

    return serialize<XeroPushResult>({ xeroInvoiceId: created.InvoiceID, varianceNote: coding.varianceNote, autoCreatedContact });
  } catch (err) {
    const message = err instanceof XeroApiError ? err.message : err instanceof Error ? err.message : "Unknown error";
    await convex.mutation(api.xeroPush.markXeroPushFailedNative, { invoiceId, orgId: organizationId, error: message, now: Date.now() });
    await logSyncEvent(organizationId, "PUSH_INVOICE", "FAILED", { error: message }, invoiceId, undefined, client.id);
    await convex.mutation(api.xeroPush.logXeroPushActivity, {
      organizationId, invoiceId, invoiceLabel, success: false, detail: message,
      actorUserId: userId, actorUserName: userName, auditId: createId(), now: Date.now(),
    });
    throw new Error(`Xero push failed: ${message}`);
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

async function requireLinkedIntegration(convex: Awaited<ReturnType<typeof getConvexClient>>, organizationId: string) {
  const integration = await convex.query(api.xeroIntegrations.getByOrgId, { orgId: organizationId });
  if (!integration?.isConnected || !integration.refreshTokenEncrypted || !integration.tenantId) {
    throw new Error("Xero is not connected for this organisation.");
  }
  return integration;
}

/**
 * Exchange the stored (encrypted) refresh token for a fresh access token,
 * persisting Xero's ROTATED refresh token immediately (Xero invalidates the
 * old one on every refresh — never reuse it). When `integrationId`/`convex`
 * are omitted the rotated token is returned but NOT persisted (used by
 * refreshXeroReferenceData, which persists it itself alongside the cache).
 */
async function getFreshAccessToken(
  refreshTokenEncrypted: string,
  integrationId?: string,
  convex?: Awaited<ReturnType<typeof getConvexClient>>,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = requireXeroAppCredentials();
  const tokens = await refreshXeroAccessToken({ refreshToken: decryptSecret(refreshTokenEncrypted), clientId, clientSecret });
  if (integrationId && convex) {
    await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
      id: integrationId,
      set: { refreshTokenEncrypted: encryptSecret(tokens.refresh_token), updatedAt: Date.now() },
      clear: [],
    });
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

async function logSyncEvent(
  organizationId: string,
  direction: "PUSH_INVOICE" | "SYNC_CONTACT" | "REFRESH_TOKEN" | "FETCH_REFERENCE_DATA",
  status: "SUCCESS" | "FAILED",
  payload: Record<string, unknown>,
  invoiceId?: string,
  xeroInvoiceId?: string,
  clientId?: string,
): Promise<void> {
  try {
    const convex = await getConvexClient();
    await convex.mutation(api.xeroSyncLogs.create, {
      id: createId(), organizationId, direction, status,
      invoiceId, xeroInvoiceId, clientId, payload,
      errorMessage: status === "FAILED" ? String(payload.error ?? "") : undefined,
      createdAt: Date.now(),
    });
  } catch {
    // Sync logging is best-effort — never break the actual Xero operation over it.
  }
}

function toDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
