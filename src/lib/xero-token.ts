import "server-only";

import { createId } from "@paralleldrive/cuid2";
import { api } from "../../convex/_generated/api";
import type { getConvexClient } from "@/lib/convex-client";
import { env } from "@/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-vault";
import { refreshXeroAccessToken } from "@/lib/xero-client";

/**
 * Xero access tokens, one refresh at a time (follow-up automation phase 2,
 * FEATUREDOCS/82). Xero rotates the refresh token on EVERY use and invalidates
 * the old one, so two concurrent refreshes — a user pushing an invoice while
 * the payment sync runs — would each persist a token the other already spent,
 * and the org's connection would silently die. Every caller goes through this
 * one function, which holds a per-org lease (`xeroPaymentSync.acquireTokenLease`),
 * RE-READS the stored token after acquiring it (another holder may have just
 * rotated it), refreshes, persists the rotated token, and releases.
 *
 * A plain module, not `"use server"`: it hands back a live access token, so it
 * must never be callable as a Server Action from the browser.
 */

type Convex = Awaited<ReturnType<typeof getConvexClient>>;

const LEASE_TTL_MS = 30_000;
const LEASE_WAIT_MS = 15_000;
const LEASE_POLL_MS = 400;

export function requireXeroAppCredentials(): { clientId: string; clientSecret: string } {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error("Xero is not configured on this deployment (XERO_CLIENT_ID / XERO_CLIENT_SECRET unset).");
  }
  return { clientId: env.XERO_CLIENT_ID, clientSecret: env.XERO_CLIENT_SECRET };
}

async function acquireLease(convex: Convex, orgId: string, holder: string): Promise<void> {
  const deadline = Date.now() + LEASE_WAIT_MS;
  while (!(await convex.mutation(api.xeroPaymentSync.acquireTokenLease, { orgId, holder, now: Date.now(), ttlMs: LEASE_TTL_MS }))) {
    if (Date.now() > deadline) throw new Error("Another Xero request is refreshing this organisation's token — try again in a moment.");
    await new Promise((r) => setTimeout(r, LEASE_POLL_MS));
  }
}

/** A fresh access token for `orgId`'s Xero connection; the rotated refresh
 *  token is persisted before this returns. */
export async function getFreshAccessToken(convex: Convex, orgId: string): Promise<{ accessToken: string; tenantId: string }> {
  const holder = createId();
  await acquireLease(convex, orgId, holder);
  try {
    const integration = await convex.query(api.xeroIntegrations.getByOrgId, { orgId });
    if (!integration?.isConnected || !integration.refreshTokenEncrypted || !integration.tenantId) {
      throw new Error("Xero is not connected for this organisation.");
    }
    const { clientId, clientSecret } = requireXeroAppCredentials();
    const tokens = await refreshXeroAccessToken({ refreshToken: decryptSecret(integration.refreshTokenEncrypted), clientId, clientSecret });
    await convex.mutation(api.xeroIntegrations.patchXeroIntegration, {
      id: integration.id,
      set: { refreshTokenEncrypted: encryptSecret(tokens.refresh_token), updatedAt: Date.now() },
      clear: [],
    });
    return { accessToken: tokens.access_token, tenantId: integration.tenantId };
  } finally {
    await convex.mutation(api.xeroPaymentSync.releaseTokenLease, { orgId, holder });
  }
}
