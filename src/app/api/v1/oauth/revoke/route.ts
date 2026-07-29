import { type NextRequest } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import { getConvexClient } from "@/lib/convex-client";
import { hashApiKey } from "@/lib/api-key";
import { oauthErrorResponse } from "@/lib/api/oauth/oauth-errors";
import { parseFormBody } from "@/lib/api/oauth/form-body";
import { authenticateClientRequest } from "@/lib/api/oauth/client-registration";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";

/**
 * RFC 7009 token revocation — `POST /api/v1/oauth/revoke` (Phase 7, #1003).
 * Per §2.2 of that RFC: an unknown/already-revoked/not-this-client's token is
 * NOT an error — the endpoint returns 200 either way, so a caller can never
 * use it to probe whether a token string is valid.
 */
export async function POST(request: NextRequest) {
  const form = await parseFormBody(request);
  if (!form) return oauthErrorResponse("invalid_request", "Expected an application/x-www-form-urlencoded body.");

  const token = form.get("token");
  if (!token) return oauthErrorResponse("invalid_request", "`token` is required.");

  const auth = await authenticateClientRequest(request, form);
  if (!auth.ok) {
    const message = auth.reason === "missing_client_id" ? "client_id is required." : "Client authentication failed.";
    return oauthErrorResponse("invalid_client", message);
  }

  await revokeIfOwnedByClient(token, auth.client.id);
  return withCors(new Response(null, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }));
}

export const OPTIONS = corsPreflight;

/** Only a grant this same client was issued (origin "oauth" + matching
 *  oauthClientId) may be revoked here — a raw bearer/manual key hash
 *  colliding with someone else's revoke call must never be actionable. */
async function revokeIfOwnedByClient(rawToken: string, clientId: string): Promise<void> {
  const convex = await getConvexClient();
  const tokenHash = hashApiKey(rawToken);
  const [byAccess, byRefresh] = await Promise.all([
    convex.query(api.apiKeys.getByTokenHash, { tokenHash }),
    convex.query(api.apiKeys.getByRefreshTokenHash, { refreshTokenHash: tokenHash }),
  ]);
  const key = byAccess ?? byRefresh;
  if (!key || key.origin !== "oauth" || key.oauthClientId !== clientId) return;
  await convex.mutation(api.apiKeys.revoke, { id: key.id, orgId: key.organizationId });
}
