import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function req(path: string, opts?: { cookie?: string }) {
  const r = new NextRequest(new URL(`https://flow.rvlt.app${path}`));
  if (opts?.cookie) r.cookies.set("better-auth.session_token", opts.cookie);
  return r;
}

/** A response is a login redirect if it 307s to /login. */
function redirectsToLogin(res: Response): boolean {
  const loc = res.headers.get("location");
  return res.status === 307 && !!loc && loc.includes("/login");
}

describe("middleware — session redirect gating", () => {
  it("still redirects a normal protected route to /login when there's no session", () => {
    const res = middleware(req("/dashboard"));
    expect(redirectsToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("callbackUrl=%2Fdashboard");
  });

  it("still lets the Better Auth routes through", () => {
    expect(redirectsToLogin(middleware(req("/api/auth/session")))).toBe(false);
  });

  it("lets public token-based feeds through without a login redirect", () => {
    expect(redirectsToLogin(middleware(req("/api/calendar/tok/feed")))).toBe(false);
    expect(redirectsToLogin(middleware(req("/api/crew/respond/tok")))).toBe(false);
  });

  it("lets the bearer-only agent API through without a login redirect (#998)", () => {
    expect(redirectsToLogin(middleware(req("/api/v1/ops/assets.list")))).toBe(false);
    expect(redirectsToLogin(middleware(req("/api/v1/whoami")))).toBe(false);
    expect(redirectsToLogin(middleware(req("/api/v1/operations")))).toBe(false);
  });
});

describe("middleware — x-request-id correlation (R-8.9.5)", () => {
  it("mints x-request-id on the response even for a public route", () => {
    const res = middleware(req("/login"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("mints x-request-id on the response for a public token-based route", () => {
    const res = middleware(req("/api/calendar/tok/feed"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("mints x-request-id even on the login-redirect response", () => {
    const res = middleware(req("/dashboard"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("reuses an inbound x-request-id instead of minting a new one", () => {
    const r = req("/login");
    r.headers.set("x-request-id", "inbound-id-123");
    const res = middleware(r);
    expect(res.headers.get("x-request-id")).toBe("inbound-id-123");
  });

  it("forwards x-request-id to the downstream request (readable via request.headers), not just the response", () => {
    const res = middleware(req("/api/calendar/tok/feed"));
    // NextResponse.next({ request }) mirrors the rewritten request headers back
    // onto the response's `x-middleware-request-*` headers in the test/edge
    // runtime — this is how we assert the request-side header was actually set,
    // not just the response header.
    expect(res.headers.get("x-middleware-request-x-request-id")).toBeTruthy();
  });
});
