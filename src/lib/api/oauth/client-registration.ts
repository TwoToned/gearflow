import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "../../convex-client";
import { api } from "../../../../convex/_generated/api";
import { clientRegistrationBodySchema } from "../../validations/oauth";
import { isAllowedRedirectUri, OAUTH_CLIENT_SECRET_PREFIX } from "./constants";

/**
 * RFC 7591 Dynamic Client Registration (Phase 7, #1003). A client (claude.ai,
 * a desktop connector, the local stdio proxy) registers itself once, with no
 * admin step — the whole point of decision 9's "non-technical staff can add
 * RVLT Flow to their own AI client themselves."
 */

export interface ClientRegistrationResult {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  token_endpoint_auth_method: "none" | "client_secret_basic";
  grant_types: string[];
  response_types: string[];
  client_name?: string;
}

export class ClientRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientRegistrationError";
  }
}

/** Validate + normalize a raw RFC 7591 registration body against the shared
 *  Zod schema (`src/lib/validations/oauth.ts`), then apply the one business
 *  rule Zod can't express: each redirect URI must be https, or a loopback URI
 *  for native/CLI clients (`isAllowedRedirectUri`). Throws
 *  {@link ClientRegistrationError} with a caller-facing message on any
 *  violation — every rejection reason here is safe to surface (no internal
 *  detail), unlike the dispatcher's `internal`-category errors. */
export function validateRegistrationRequest(body: unknown): {
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod: "none" | "client_secret_basic";
  softwareId?: string;
  softwareVersion?: string;
} {
  const parsed = clientRegistrationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ClientRegistrationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  for (const uri of parsed.data.redirect_uris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new ClientRegistrationError(
        `Redirect URI "${uri}" is not allowed — must be https://, or a loopback (127.0.0.1/localhost) URI.`,
      );
    }
  }

  return {
    redirectUris: parsed.data.redirect_uris,
    clientName: parsed.data.client_name,
    tokenEndpointAuthMethod: parsed.data.token_endpoint_auth_method ?? "none",
    softwareId: parsed.data.software_id,
    softwareVersion: parsed.data.software_version,
  };
}

/**
 * Salted scrypt, NOT the fast SHA-256 digest `hashApiKey` (src/lib/api-key.ts)
 * uses. Those two look identical at a glance (both hash a CSPRNG secret) but
 * differ in the one property that matters: `hashApiKey`'s output is looked up
 * BY EQUALITY as a Convex index key on every bearer request, so it must stay a
 * deterministic, unsalted, fast digest — a slow KDF there would tax every API
 * call. `clientSecretHash` is never looked up; the client is already resolved
 * by `client_id` before this ever runs, so a salted, deliberately slow hash
 * costs nothing extra structurally and is strictly better defense-in-depth
 * for a credential that authenticates a caller as a whole registered client.
 * Format: `<salt-hex>:<derived-key-hex>`.
 */
function hashClientSecret(raw: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(raw, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Register a new OAuth client. Returns the raw `client_secret` exactly ONCE
 *  (confidential clients only — a public client gets no secret at all, which
 *  is the expected shape for claude.ai/desktop connectors using PKCE alone). */
export async function registerOauthClient(
  input: ReturnType<typeof validateRegistrationRequest>,
): Promise<ClientRegistrationResult> {
  const id = createId();
  const now = Date.now();

  let clientSecretRaw: string | undefined;
  let clientSecretHash: string | undefined;
  if (input.tokenEndpointAuthMethod === "client_secret_basic") {
    clientSecretRaw = `${OAUTH_CLIENT_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
    clientSecretHash = hashClientSecret(clientSecretRaw);
  }

  const convex = await getConvexClient();
  await convex.mutation(api.oauthClients.register, {
    id,
    clientName: input.clientName,
    clientSecretHash,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    redirectUris: input.redirectUris,
    softwareId: input.softwareId,
    softwareVersion: input.softwareVersion,
    createdAt: now,
  });

  return {
    client_id: id,
    ...(clientSecretRaw ? { client_secret: clientSecretRaw } : {}),
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris: input.redirectUris,
    token_endpoint_auth_method: input.tokenEndpointAuthMethod,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(input.clientName ? { client_name: input.clientName } : {}),
  };
}

/** Verify a presented `client_secret` against a confidential client's stored
 *  `<salt-hex>:<derived-key-hex>` hash (constant-time comparison, per the
 *  acceptance criteria's "constant-time secret comparison"). */
function verifyClientSecret(presented: string, storedHash: string): boolean {
  const sepIndex = storedHash.indexOf(":");
  if (sepIndex < 0) return false;
  const salt = Buffer.from(storedHash.slice(0, sepIndex), "hex");
  const expected = Buffer.from(storedHash.slice(sepIndex + 1), "hex");
  const actual = scryptSync(presented, salt, expected.length || 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface OAuthClientRecord {
  id: string;
  clientName?: string;
  clientSecretHash?: string;
  tokenEndpointAuthMethod: "none" | "client_secret_basic";
  redirectUris: string[];
}

/** Load a registered client by id, or `null` if unknown. */
export async function loadOauthClient(clientId: string): Promise<OAuthClientRecord | null> {
  const convex = await getConvexClient();
  return await convex.query(api.oauthClients.getById, { id: clientId });
}

/** Is the caller authenticated as `client`? Public clients
 *  (`token_endpoint_auth_method: "none"`) need no secret; confidential
 *  clients must present one that matches (constant-time). */
function authenticateOauthClient(client: OAuthClientRecord, presentedSecret: string | null): boolean {
  if (client.tokenEndpointAuthMethod === "none") return true;
  if (!presentedSecret || !client.clientSecretHash) return false;
  return verifyClientSecret(presentedSecret, client.clientSecretHash);
}

/** HTTP Basic `Authorization` header, or the body's `client_id`/`client_secret`
 *  fields — either is valid per RFC 6749 §2.3.1. Shared by the token and
 *  revocation endpoints so the credential-extraction rule lives in ONE place. */
function extractClientCredentials(
  request: Request,
  form: URLSearchParams,
): { clientId: string | null; clientSecret: string | null } {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep >= 0) return { clientId: decoded.slice(0, sep), clientSecret: decoded.slice(sep + 1) };
    } catch {
      // fall through to body params
    }
  }
  return { clientId: form.get("client_id"), clientSecret: form.get("client_secret") };
}

export type ClientAuthOutcome =
  | { ok: true; client: OAuthClientRecord }
  | { ok: false; reason: "missing_client_id" | "invalid_client" };

/** The one entry point both `/oauth/token` and `/oauth/revoke` use to resolve
 *  + authenticate the calling client from a form-encoded request — extraction,
 *  lookup and secret verification, in one place (R-3.1). */
export async function authenticateClientRequest(request: Request, form: URLSearchParams): Promise<ClientAuthOutcome> {
  const { clientId, clientSecret } = extractClientCredentials(request, form);
  if (!clientId) return { ok: false, reason: "missing_client_id" };
  const client = await loadOauthClient(clientId);
  if (!client || !authenticateOauthClient(client, clientSecret)) return { ok: false, reason: "invalid_client" };
  return { ok: true, client };
}
