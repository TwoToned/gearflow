// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { resolveActor } from "./lib/auth";

// resolveActor is the Phase-3 browser-direct security baseline: the `actor` arg
// every *Writes.ts mutation takes is CLIENT-SUPPLIED, so a user token calling the
// (public) mutation directly could attribute the audit row to anyone. resolveActor
// pins attribution to the VERIFIED token identity. These tests exercise the helper
// directly via an inline `run` (it's a lib fn, not a Convex function).

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });

describe("resolveActor — actor-spoofing baseline (Phase 3)", () => {
  test("service token trusts the supplied actor verbatim", async () => {
    // The trusted backend already authenticated the end-user and passes their id.
    const t = convexTest(schema, modules);
    const out = await t
      .withIdentity(SERVICE)
      .run(async (ctx) =>
        resolveActor(ctx, { userId: "someone_else", userName: "Server Passed" }),
      );
    expect(out).toEqual({ userId: "someone_else", userName: "Server Passed" });
  });

  test("user token OVERWRITES a spoofed userId with the verified subject", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    });
    const out = await t
      .withIdentity(asUser(ORG))
      .run(async (ctx) =>
        resolveActor(ctx, { userId: "victim_id", userName: "Impersonated" }),
      );
    // userId is pinned to the token subject (spoof rejected); userName is resolved
    // from the users mirror, not the client-supplied label.
    expect(out).toEqual({ userId: USER, userName: "Alice" });
  });

  test("user token with no mirror row falls back to the verified userId, NOT the supplied label", async () => {
    const t = convexTest(schema, modules);
    const out = await t
      .withIdentity(asUser(ORG))
      .run(async (ctx) =>
        resolveActor(ctx, { userId: "victim_id", userName: "Impersonated" }),
      );
    // Client-supplied userName is discarded — attribution can't be forged even
    // when the users mirror is briefly lagging.
    expect(out).toEqual({ userId: USER, userName: USER });
  });

  test("no identity is rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => resolveActor(ctx, { userId: USER, userName: "x" })),
    ).rejects.toThrow(/authentication required/i);
  });
});
