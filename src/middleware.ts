import { NextRequest, NextResponse } from "next/server";

const publicRoutes = ["/login", "/register", "/api/auth", "/api/platform-name", "/api/registration-policy", "/invite", "/two-factor", "/onboarding", "/pending-approval", "/api/integrations/woocommerce/webhook"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Correlation id for log/error tracing (POLICY.md R-8.9.5): reuse an inbound
  // x-request-id or mint one; forwarded to server code and returned to the client
  // on EVERY branch below (including the public/token early-returns) — a route
  // handler that only sees the request half of a public route must still be able
  // to read it via `headers().get("x-request-id")`.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  // CVE-2025-29927: Strip x-middleware-subrequest header to prevent middleware bypass
  if (request.headers.has("x-middleware-subrequest")) {
    return new NextResponse(null, { status: 403 });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const forwardedRequest = { headers: requestHeaders };

  // Allow public routes
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return withRequestId(NextResponse.next({ request: forwardedRequest }), requestId);
  }

  // Allow public token-based routes (no session required)
  // - Org calendar feeds: /api/calendar/[token]/[feed]
  // - Crew iCal feeds: /api/crew/calendar/[token] (but NOT /api/crew/calendar/assignment/)
  // - Offer responses: /api/crew/respond/[token]
  if (
    pathname.startsWith("/api/calendar/") ||
    (pathname.startsWith("/api/crew/calendar/") &&
      !pathname.startsWith("/api/crew/calendar/assignment")) ||
    pathname.startsWith("/api/crew/respond/") ||
    pathname.startsWith("/warehouse/display/") ||
    pathname.startsWith("/api/warehouse/display/") ||
    pathname.startsWith("/auditor/") ||
    pathname.startsWith("/api/auditor/") ||
    pathname.startsWith("/api/cron/")
  ) {
    return withRequestId(NextResponse.next({ request: forwardedRequest }), requestId);
  }

  // Check for session token cookie (Better Auth uses this)
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return withRequestId(NextResponse.redirect(loginUrl), requestId);
  }

  const response = NextResponse.next({ request: forwardedRequest });
  addSecurityHeaders(response);
  return withRequestId(response, requestId);
}

/** Attach the correlation id to the outbound response (all branches, not just the authed path). */
function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "off");
}

export const config = {
  matcher: [
    // Match all routes except static files and api/auth
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
