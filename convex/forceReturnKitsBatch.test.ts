// @vitest-environment node
//
// forceReturnKitsBatch — the Phase 3 bulk single-call invariant for kit force-return
// (Appendix A): N kits force-returned in ONE array mutation with partial-success + a
// per-item organizationId re-check. Uses kits with no project lines so the batch's
// dispatch/validation is isolated (the full restore path is covered by kitPerUnit.test).
import { convexTest } from "convex-test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT() {
  const t = convexTest(schema, modules);
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const kitDoc = (id: string, org: string, status: "AVAILABLE" | "CHECKED_OUT") => ({
  id, organizationId: org, assetTag: id.toUpperCase(), name: id,
  status, condition: "GOOD" as const, isActive: true, createdAt: NOW, updatedAt: NOW,
});

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("kits", kitDoc("k1", ORG, "CHECKED_OUT"));
    await ctx.db.insert("kits", kitDoc("k2", ORG, "CHECKED_OUT"));
    await ctx.db.insert("kits", kitDoc("k3", ORG, "AVAILABLE")); // nothing to return
    await ctx.db.insert("kits", kitDoc("kx", OTHER, "CHECKED_OUT")); // another org
  });
}

const kitStatus = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.status);

describe("forceReturnKitsBatch — bulk single-call + partial-success", () => {
  test("returns the checked-out kits; skips already-available / missing / cross-org with errors", async () => {
    const t = makeT();
    await seed(t);

    const res = await t.withIdentity(SERVICE).mutation(api.warehouseOps.forceReturnKitsBatch, {
      organizationId: ORG,
      kitIds: ["k1", "k2", "k3", "kx", "ghost"],
      userId: USER,
      now: NOW,
    });

    expect([...res.succeeded].sort()).toEqual(["k1", "k2"]);
    expect(res.errors.map((e) => e.kitId).sort()).toEqual(["ghost", "k3", "kx"]);

    // The valid checked-out kits are now available…
    expect(await kitStatus(t, "k1")).toBe("AVAILABLE");
    expect(await kitStatus(t, "k2")).toBe("AVAILABLE");
    // …and the cross-org kit is untouched (per-item org re-check on a GLOBAL by_cuid).
    expect(await kitStatus(t, "kx")).toBe("CHECKED_OUT");
  });

  test("a cross-org kit id can't be force-returned through another org's batch", async () => {
    const t = makeT();
    await seed(t);

    const res = await t.withIdentity(SERVICE).mutation(api.warehouseOps.forceReturnKitsBatch, {
      organizationId: ORG,
      kitIds: ["kx"],
      userId: USER,
      now: NOW,
    });

    expect(res.succeeded).toEqual([]);
    expect(res.errors).toEqual([{ kitId: "kx", error: "Kit not found" }]);
    expect(await kitStatus(t, "kx")).toBe("CHECKED_OUT");
  });

  test("a non-service (user) token cannot call the batch", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG }).mutation(api.warehouseOps.forceReturnKitsBatch, {
        organizationId: ORG,
        kitIds: ["k1"],
        userId: USER,
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});
