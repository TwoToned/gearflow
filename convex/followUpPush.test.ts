// @vitest-environment node
//
// Follow-up automation — the urgent push's rationing (FEATUREDOCS/82): one push
// per follow-up rung, at most `cap` per person per day, service-only, and a
// dead subscription is removed only inside its own org.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org1";
const NOW = Date.UTC(2026, 9, 1, 0, 0, 0);
const asService = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

const claim = (t: T, item: string, day = "day:u1:2026-10-01") =>
  t.withIdentity(asService).mutation(api.followUpPush.claimPush, { orgId: ORG, userId: "u1", itemKey: item, dayKey: day, cap: 2, now: NOW });

describe("claimPush", () => {
  test("two pushes a day per person, then nothing until tomorrow", async () => {
    const t = makeT();
    expect(await claim(t, "a:1")).toEqual({ claimed: true });
    expect(await claim(t, "b:1")).toEqual({ claimed: true });
    expect(await claim(t, "c:1")).toEqual({ claimed: false });
    expect(await claim(t, "c:1", "day:u1:2026-10-02")).toEqual({ claimed: true });
  });

  test("the same rung never pushes twice; the next rung may", async () => {
    const t = makeT();
    expect(await claim(t, "a:1")).toEqual({ claimed: true });
    expect(await claim(t, "a:1", "day:u1:2026-10-02")).toEqual({ claimed: false });
    expect(await claim(t, "a:2", "day:u1:2026-10-02")).toEqual({ claimed: true });
  });

  test("rejects a caller without the service identity", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.followUpPush.claimPush, { orgId: ORG, userId: "u1", itemKey: "x", dayKey: "d", cap: 2, now: NOW }),
    ).rejects.toThrow();
  });
});

describe("subscriptions", () => {
  test("lists a person's devices and removes a gone one only inside its own org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      for (const [id, org, endpoint] of [["s1", ORG, "https://p/1"], ["s2", "org2", "https://p/2"]] as const) {
        await ctx.db.insert("pushSubscriptions", { id, organizationId: org, userId: "u1", endpoint, p256dh: "k", auth: "a", createdAt: NOW, updatedAt: NOW });
      }
    });
    const svc = t.withIdentity(asService);
    expect(await svc.query(api.followUpPush.subscriptionsForUser, { orgId: ORG, userId: "u1" })).toEqual([{ endpoint: "https://p/1", p256dh: "k", auth: "a" }]);
    await svc.mutation(api.followUpPush.removeGoneSubscription, { orgId: ORG, endpoint: "https://p/2" });
    await svc.mutation(api.followUpPush.removeGoneSubscription, { orgId: ORG, endpoint: "https://p/1" });
    const left = await t.run(async (ctx) => ctx.db.query("pushSubscriptions").take(10));
    expect(left.map((r) => r.id)).toEqual(["s2"]);
  });
});
