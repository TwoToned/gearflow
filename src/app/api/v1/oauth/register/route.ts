import { NextResponse, type NextRequest } from "next/server";
import {
  validateRegistrationRequest,
  registerOauthClient,
  ClientRegistrationError,
} from "@/lib/api/oauth/client-registration";

export const runtime = "nodejs";

/**
 * RFC 7591 Dynamic Client Registration — `POST /api/v1/oauth/register`
 * (Phase 7, #1003). Deliberately unauthenticated (a client has no credential
 * yet — that's what this endpoint issues), same posture as the token
 * endpoint. Public per `src/middleware.ts`'s bearer-exempt list.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const validated = validateRegistrationRequest(body);
    const result = await registerOauthClient(validated);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ClientRegistrationError) {
      return NextResponse.json({ error: "invalid_client_metadata", error_description: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Registration failed." }, { status: 400 });
  }
}
