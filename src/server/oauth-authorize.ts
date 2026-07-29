"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/auth-server";
import { getCurrentRole } from "@/lib/org-context";
import { loadOauthClient, type OAuthClientRecord } from "@/lib/api/oauth/client-registration";
import { narrowScopesToRole, describeScope } from "@/lib/api/oauth/rbac-scopes";
import { createAuthorizationCode } from "@/lib/api/oauth/authorization-code";
import { authorizeQuerySchema } from "@/lib/validations/oauth";

/**
 * `/oauth/authorize` consent flow (Phase 7, #1003, design §14). Unlike every
 * other `"use server"` file in this codebase, these are NOT called via
 * `useServerMutation` from a client component — they're bound directly to a
 * plain `<form action={...}>` (native Next.js Server Action form submission),
 * because completing the flow means a real top-level browser navigation back
 * to the client's (possibly cross-origin) `redirect_uri`, not a fetch. That's
 * also why they redirect() instead of returning a serialized value.
 *
 * Gated on the existing Better Auth session (`requireOrganization()` throws if
 * absent — `src/middleware.ts` already redirects an unauthenticated request to
 * `/login?callbackUrl=...` before this page ever renders) so the consenting
 * identity IS the acting user, per the design's core OAuth constraint.
 */

interface AuthorizeContext {
  client: { id: string; name: string };
  narrowedScopes: string[];
  scopeDescriptions: string[];
  query: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    state?: string;
    code_challenge: string;
    resource?: string;
  };
}

export type AuthorizeContextResult =
  | { ok: true; data: AuthorizeContext }
  | { ok: false; message: string };

/** The ONLY query params `/oauth/authorize` reads. Fixed, not derived from the
 *  request — copying into `single` below by an allowlisted, statically-known
 *  key (never `rawParams`' own key) is what makes this immune to a
 *  prototype-pollution-shaped property write from a crafted query string. */
const AUTHORIZE_QUERY_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Validate the incoming `/oauth/authorize` request and compute what the
 *  consent screen should show. Every failure here is a "show an error page,
 *  do NOT redirect" case (`redirect_uri` isn't trustworthy yet at this point —
 *  redirecting to an unverified URI would be an open-redirect footgun). */
export async function loadAuthorizeContext(
  rawParams: Record<string, string | string[] | undefined>,
): Promise<AuthorizeContextResult> {
  const single: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_QUERY_KEYS) single[key] = firstValue(rawParams[key]);

  const parsed = authorizeQuerySchema.safeParse(single);
  if (!parsed.success) {
    return { ok: false, message: "This authorization request is missing or has invalid parameters." };
  }
  const query = parsed.data;

  const client = await loadOauthClient(query.client_id);
  if (!client) return { ok: false, message: "Unknown OAuth client. It may need to register again." };
  if (!client.redirectUris.includes(query.redirect_uri)) {
    return { ok: false, message: "This redirect URI is not registered for this client." };
  }

  await requireOrganization(); // defensive — middleware already gates this page on a session
  const role = await getCurrentRole();
  const requested = query.scope ? query.scope.split(/\s+/).filter(Boolean) : [];
  const narrowedScopes = narrowScopesToRole(requested, role);

  return {
    ok: true,
    data: {
      client: { id: client.id, name: client.clientName ?? client.id },
      narrowedScopes,
      scopeDescriptions: narrowedScopes.map(describeScope),
      query: {
        client_id: query.client_id,
        redirect_uri: query.redirect_uri,
        scope: requested.join(" "),
        state: query.state,
        code_challenge: query.code_challenge,
        resource: query.resource,
      },
    },
  };
}

async function requireRedirectTarget(clientId: string, redirectUri: string): Promise<OAuthClientRecord> {
  const client = await loadOauthClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    throw new Error("Invalid OAuth authorization request.");
  }
  return client;
}

function fieldOf(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The user clicked "Allow". Re-validates client/redirect_uri/scope narrowing
 *  server-side from scratch (never trusts the hidden form fields for the
 *  security-critical pairing), mints a one-time authorization code, and
 *  redirects the browser back to the client with `code`+`state`. */
export async function approveOauthAuthorization(formData: FormData): Promise<void> {
  const clientId = fieldOf(formData, "client_id");
  const redirectUri = fieldOf(formData, "redirect_uri");
  const codeChallenge = fieldOf(formData, "code_challenge");
  const state = formData.get("state") ? fieldOf(formData, "state") : undefined;
  const resource = formData.get("resource") ? fieldOf(formData, "resource") : undefined;
  const requestedScope = fieldOf(formData, "scope");

  await requireRedirectTarget(clientId, redirectUri);

  const { session, organizationId } = await requireOrganization();
  const role = await getCurrentRole();
  const narrowed = narrowScopesToRole(requestedScope.split(/\s+/).filter(Boolean), role);

  const code = await createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge,
    scopes: narrowed,
    userId: session.user.id,
    organizationId,
    resource,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}

/** The user clicked "Deny". Redirects back with the standard `access_denied`
 *  error (RFC 6749 §4.1.2.1) rather than creating a code. */
export async function denyOauthAuthorization(formData: FormData): Promise<void> {
  const clientId = fieldOf(formData, "client_id");
  const redirectUri = fieldOf(formData, "redirect_uri");
  const state = formData.get("state") ? fieldOf(formData, "state") : undefined;

  await requireRedirectTarget(clientId, redirectUri);

  const url = new URL(redirectUri);
  url.searchParams.set("error", "access_denied");
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
