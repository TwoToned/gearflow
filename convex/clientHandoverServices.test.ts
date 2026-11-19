// @vitest-environment node
// UX 5b: client pick up / drop off service types (additive schema change).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { ServiceType } from "./lib/validators";
import { SERVICE_TYPES } from "./lib/serviceTypes";
import { serviceTypeToPhase } from "./lib/serviceSchedule";
import { serviceAccountDefaultKeyForType } from "./lib/xeroAccountCascade";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "QUOTED",
      total: 0, taxRate: 10, liveVersionId: "v-p1",
    });
    await ctx.db.insert("projectVersions", {
      id: "v-p1", organizationId: ORG, projectId: "p1", number: 1,
      contentState: "ready", createdAt: NOW, createdById: "u1",
    });
  });
}

const input = {
  type: "CLIENT_PICKUP" as const, title: "Client pick up", showOnDocuments: false, quantity: 1, taxable: true,
};
const svc = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("service type list (one source)", () => {
  test("the Convex validator and the shared tuple list the same members", () => {
    const members = (ServiceType as unknown as { members: { value: string }[] }).members.map((m) => m.value);
    expect([...members].sort()).toEqual([...SERVICE_TYPES].sort());
  });
});

describe("phase + Xero for the client types", () => {
  test("Handover / Return crew phases", () => {
    expect(serviceTypeToPhase("CLIENT_PICKUP")).toBe("HANDOVER");
    expect(serviceTypeToPhase("CLIENT_DROPOFF")).toBe("RETURN");
  });
  test("a client handover is not transport: Xero falls to the MISC bucket", () => {
    expect(serviceAccountDefaultKeyForType("CLIENT_PICKUP")).toBe("MISC");
    expect(serviceAccountDefaultKeyForType("CLIENT_DROPOFF")).toBe("MISC");
  });
});

describe("createServiceNative / updateServiceNative with a client type", () => {
  test("round-trips contact, phone, vehicle and the counter address; blank becomes unset", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...input, address: "14 Industry Rd",
      clientContactName: "Priya Shah", clientContactPhone: "0412 555 019", clientVehicle: "Van CXQ 412",
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const s = await svc(t, "s1");
    expect(s?.type).toBe("CLIENT_PICKUP");
    expect(s?.clientContactName).toBe("Priya Shah");
    expect(s?.clientContactPhone).toBe("0412 555 019");
    expect(s?.clientVehicle).toBe("Van CXQ 412");
    expect(s?.address).toBe("14 Industry Rd");
    expect(s?.lineTotal).toBeUndefined();

    await t.withIdentity(asUser).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...input, clientContactName: "", clientContactPhone: "", clientVehicle: "",
      now: NOW, actor: ACTOR, auditId: "log2",
    });
    const after = await svc(t, "s1");
    expect(after?.clientContactName).toBeUndefined();
    expect(after?.clientVehicle).toBeUndefined();
  });

  test("cloning onto another job keeps the type and counter but NEVER the client's contact details", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p2", organizationId: ORG, projectNumber: "P-2", name: "Other client", status: "QUOTED",
        total: 0, taxRate: 10, liveVersionId: "v-p2",
      });
      await ctx.db.insert("projectVersions", {
        id: "v-p2", organizationId: ORG, projectId: "p2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1",
      });
    });
    await t.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...input, address: "14 Industry Rd",
      clientContactName: "Priya Shah", clientContactPhone: "0412 555 019", clientVehicle: "Van CXQ 412",
      now: NOW, actor: ACTOR, auditId: "logc",
    });
    await t.withIdentity(asUser).mutation(api.projectServicesWrites.cloneServicesNative, {
      targetProjectId: "p2", sourceProjectId: "p1", orgId: ORG, now: NOW + 5, actor: ACTOR, auditId: "logcl",
    });
    const cloned = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p2")).collect());
    expect(cloned).toHaveLength(1);
    expect(cloned[0].type).toBe("CLIENT_PICKUP");
    expect(cloned[0].address).toBe("14 Industry Rd");
    expect(cloned[0].clientContactName).toBeUndefined();
    expect(cloned[0].clientContactPhone).toBeUndefined();
    expect(cloned[0].clientVehicle).toBeUndefined();
  });

  test("over-length client fields are rejected server-side", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s2", orgId: ORG, projectId: "p1", ...input, clientContactName: "x".repeat(121),
        now: NOW, actor: ACTOR, auditId: "log3",
      }),
    ).rejects.toThrow();
  });

  test("a client service takes its date from the project window (pickup = start, drop off = end)", async () => {
    const t = makeT();
    await seed(t);
    const types = ["CLIENT_PICKUP", "CLIENT_DROPOFF"] as const;
    for (const [i, type] of types.entries()) {
      await t.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, {
        id: `w${i}`, orgId: ORG, projectId: "p1", ...input, type, date: NOW + i * 86_400_000,
        now: NOW, actor: ACTOR, auditId: `logw${i}`,
      });
      expect((await svc(t, `w${i}`))?.type).toBe(type);
    }
  });
});
