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
});
