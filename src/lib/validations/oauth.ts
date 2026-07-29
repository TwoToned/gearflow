import { z } from "zod";

// ─── MCP OAuth 2.1 (Phase 7 — #1003) ────────────────────────────────────────
//
// Validates the `/oauth/authorize` GET request's query params, per RFC 6749
// §4.1.1 + PKCE (RFC 7636) + OAuth 2.1's "PKCE required, S256 only" posture.

export const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  resource: z.string().optional(),
});

export const clientRegistrationBodySchema = z.object({
  redirect_uris: z.array(z.string()).min(1),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_basic"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  software_id: z.string().max(200).optional(),
  software_version: z.string().max(100).optional(),
});
