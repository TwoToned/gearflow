/**
 * Regression tests for the Convex read-path auth guards (`convex/lib/auth.ts`).
 *
 * These guards must throw `ConvexError`, NOT a plain `Error`. A plain `Error`
 * thrown from a Convex function in a production deployment is masked to the caller
 * as the generic "InternalServerError / Try again later." — which is exactly the
 * unactionable string that showed up in the pm2 logs for the projects-read crash.
 * `ConvexError`'s payload survives the prod boundary, so an auth failure surfaces
 * its real message in the Next.js log + PostHog. This test pins that behaviour so a
 * future edit can't silently regress a guard back to a masked plain `Error`.
 */
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { requireOrgRead, requireOrgReadDoc, requireService } from "../../convex/lib/auth";

type Identity = Record<string, unknown> | null;
// Minimal Convex AuthCtx stub: only `auth.getUserIdentity()` is read by the guards.
const ctxWith = (identity: Identity) =>
  ({ auth: { getUserIdentity: async () => identity } }) as unknown as Parameters<
    typeof requireOrgRead
  >[0];

const SERVICE = { subject: "gearflow-service", svc: true };
const USER = (orgId: string) => ({ subject: "user-1", orgId, role: "ADMIN" });

describe("convex auth guards throw ConvexError (not a masked plain Error)", () => {
  it("requireOrgRead rejects an anonymous caller with ConvexError", async () => {
    await expect(requireOrgRead(ctxWith(null), "org-1")).rejects.toBeInstanceOf(ConvexError);
  });

  it("requireOrgRead rejects an org mismatch with ConvexError", async () => {
    await expect(
      requireOrgRead(ctxWith(USER("org-OTHER")), "org-1"),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it("requireOrgRead allows the service token", async () => {
    await expect(requireOrgRead(ctxWith(SERVICE), "org-1")).resolves.toBeUndefined();
  });

  it("requireOrgRead allows a user token scoped to the same org", async () => {
    await expect(requireOrgRead(ctxWith(USER("org-1")), "org-1")).resolves.toBeUndefined();
  });

  it("requireOrgReadDoc rejects an anonymous caller with ConvexError", async () => {
    await expect(
      requireOrgReadDoc(ctxWith(null), { organizationId: "org-1" }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it("requireOrgReadDoc rejects a cross-org doc with ConvexError", async () => {
    await expect(
      requireOrgReadDoc(ctxWith(USER("org-1")), { organizationId: "org-OTHER" }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it("requireService rejects a non-service caller with ConvexError", async () => {
    await expect(requireService(ctxWith(USER("org-1")))).rejects.toBeInstanceOf(ConvexError);
  });
});
