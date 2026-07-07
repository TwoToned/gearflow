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

describe("middleware — agent API routes bypass the session redirect", () => {
  it("does NOT redirect /api/v1/* to /login (they authenticate via Bearer)", () => {
    for (const path of ["/api/v1/whoami", "/api/v1/reserve-items", "/api/v1/mcp"]) {
      const res = middleware(req(path)); // no session cookie
      expect(redirectsToLogin(res), `${path} should not redirect to login`).toBe(false);
    }
  });

  it("still redirects a normal protected route to /login when there's no session", () => {
    const res = middleware(req("/dashboard"));
    expect(redirectsToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("callbackUrl=%2Fdashboard");
  });

  it("still lets the Better Auth routes through", () => {
    expect(redirectsToLogin(middleware(req("/api/auth/session")))).toBe(false);
  });
});
