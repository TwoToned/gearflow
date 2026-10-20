import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { middleware } from "./middleware";

const resources = [
  "/stickers/gaff-tape-sticker.svg",
  "/sw.js",
  "/manifest.json",
  "/workbox-1a2b3c4d.js",
  "/fallback-ce627215c0e4a9af.js",
  "/worker-0123456789abcdef.js",
];

function request(path: string) {
  return new NextRequest(`https://flow.rvlt.app${path}`, {
    headers: { "x-request-id": "static-resource-test" },
  });
}

describe("unauthenticated static resource reachability (F17/F16)", () => {
  it.each(resources)("passes through the public resource %s", (path) => {
    const response = middleware(request(path));
    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("static-resource-test");
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe("static-resource-test");
  });

  it.each([
    "/warehouse?view=private", "/warehouse/report.svg", "/warehouse/sw.js",
    "/stickers/private.svg", "/stickers/gaff-tape-sticker.svg/private",
    "/sw.js/private", "/sw.js.bak", "/manifest.json/private", "/manifest-private.json",
    "/private.js", "/private.svg", "/sensitive/data.json",
    "/workbox-1234567.js", "/workbox-123456789.js", "/workbox-zzzzzzzz.js",
    "/fallback-0123456789abcde.js", "/fallback-0123456789abcdef0.js",
    "/worker-0123456789abcdeg.js", "/worker-development.js",
    "/swe-worker-0123456789abcdef.js", "/nested/workbox-1a2b3c4d.js",
    "/workbox-1a2b3c4d.js.map", "/fallback-ce627215c0e4a9af.js.map",
    "/worker-0123456789abcdef.js/private",
  ])("keeps protected routes and resource lookalikes gated: %s", (path) => {
    const response = middleware(request(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe(path);
  });

  it.each([...resources, "/offline", "/login?noSso=1", "/warehouse"])(
    "rejects subrequest headers before exemptions: %s", (path) => {
      const req = request(path);
      req.headers.set("x-middleware-subrequest", "middleware:middleware:middleware");
      const response = middleware(req);
      expect(response.status).toBe(403);
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each(["/offline", "/login?noSso=1"])("preserves public shell/login behavior: %s", (path) => {
    expect(middleware(request(path)).headers.get("x-middleware-next")).toBe("1");
  });
});
