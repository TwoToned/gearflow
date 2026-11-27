// @vitest-environment node
/**
 * Hotfix: Better Auth's stock organization endpoints let an Admin session bypass the role
 * policy (promote to admin, demote/remove another admin, invite as admin, rename the org).
 * This drives the REAL Better Auth handler (`auth.handler`, the same function
 * `/api/auth/[...all]` serves) and asserts every write endpoint the app doesn't use is a
 * 404 from Better Auth's own `onRequest` (before any session or database work, so no
 * session, Admin or otherwise, can reach it), while the endpoints the app does use are NOT
 * 404 (they get as far as Better Auth's own session check). The kept-path half needs no
 * database: an unauthenticated call is answered by the session middleware.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => () => Promise.reject(new Error("no db in this test")) }) }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: async () => ({ query: async () => null, mutation: async () => null }) }));

import { auth } from "@/lib/auth";
import { DISABLED_AUTH_PATHS, KEPT_AUTH_PATHS } from "@/lib/auth-disabled-paths";

const BASE = "http://localhost:3000/api/auth";

function call(path: string, method = "POST") {
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: "better-auth.session_token=admin-session", origin: "http://localhost:3000" },
      body: method === "POST" ? JSON.stringify({ memberId: "m1", role: "admin", email: "x@y.co" }) : undefined,
    }),
  );
}

describe("Better Auth organization endpoints that bypass the role policy are closed", () => {
  it("is configured on the real auth instance", () => {
    expect(auth.options.disabledPaths).toEqual([...DISABLED_AUTH_PATHS]);
  });

  it.each([
    "/organization/update-member-role",
    "/organization/remove-member",
    "/organization/invite-member",
    "/organization/cancel-invitation",
    "/organization/update",
    "/organization/delete",
    "/organization/leave",
    "/organization/reject-invitation",
  ])("%s is a 404 for a caller with a session cookie (an Admin's)", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(404);
  });

  it("covers every member/invitation/role write the plugin exposes", () => {
    for (const p of ["update-member-role", "remove-member", "invite-member", "cancel-invitation", "add-member", "update", "delete", "leave", "create-role", "update-role", "delete-role"]) {
      expect(DISABLED_AUTH_PATHS).toContain(`/organization/${p}`);
    }
  });

  it.each([...KEPT_AUTH_PATHS])("%s is still served (not a 404)", async (path) => {
    const method = path === "/organization/list" || path === "/organization/get-full-organization" ? "GET" : "POST";
    const res = await call(path, method);
    expect(res.status).not.toBe(404);
  });

  it("no kept path is also disabled", () => {
    for (const p of KEPT_AUTH_PATHS) expect(DISABLED_AUTH_PATHS as readonly string[]).not.toContain(p);
  });
});

describe("accepting an invitation refuses any role that isn't exactly an assignable role", () => {
  type Hook = (d: { invitation: { role: unknown } }) => Promise<void>;
  const orgPlugin = (auth.options.plugins ?? []).find((p) => p.id === "organization") as unknown as {
    options: { organizationHooks: { beforeAcceptInvitation: Hook } };
  };
  const accept = (role: unknown) => orgPlugin.options.organizationHooks.beforeAcceptInvitation({ invitation: { role } });

  it("accepts the five assignable roles", async () => {
    for (const r of ["admin", "manager", "member", "warehouse", "viewer"]) await expect(accept(r)).resolves.toBeUndefined();
  });

  it.each(["owner", "admin,owner", "owner,admin", "made-up", "", null, undefined, ["admin"]])("refuses %j", async (role) => {
    await expect(accept(role)).rejects.toThrow(/can't be accepted/i);
  });
});
