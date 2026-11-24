// @vitest-environment node
//
// Field-level read boundary on the raw-row crew reads (security hotfix):
//   • crewAssignments.{list,getById,listByProject,listByServiceIds} never hand
//     the single-use offer-respond `responseToken` to anyone but the service
//     identity (it is a bearer credential for /api/crew/respond/[token]);
//   • their pay fields (`estimatedCost`/`rateOverride`) and crewMembers.{list,
//     getById}'s default rates reach only `canSeeCrewPay` callers — manager+
//     AND not a `noFinancials` API key.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Identity = Parameters<T["withIdentity"]>[0];

const ORG = "org_A";
const USER = "user_1";
const KEY = "key_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T, role: string, key?: { noFinancials: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER,
        noFinancials: key.noFinancials,
      });
    }
    await ctx.db.insert("crewMembers", {
      id: "cm1", organizationId: ORG, firstName: "Sam", lastName: "Crew",
      defaultDayRate: 300, defaultHourlyRate: 40, icalToken: "ical-secret",
    });
    await ctx.db.insert("crewAssignments", {
      id: "ca1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "svc1",
      status: "OFFERED", estimatedCost: 360, rateOverride: 50, responseToken: "respond-secret",
    });
  });
}

type Row = Record<string, unknown> | null | undefined;

/** Every raw-row assignment read, normalised to "the ca1 row it returned". */
async function assignmentReads(t: T, identity: Identity): Promise<Record<string, Row>> {
  const as = t.withIdentity(identity);
  const pick = (rows: Array<{ id: string }>) => rows.find((r) => r.id === "ca1") as Row;
  return {
    list: pick(await as.query(api.crewAssignments.list, { orgId: ORG })),
    getById: (await as.query(api.crewAssignments.getById, { id: "ca1" })) as Row,
    listByProject: pick(await as.query(api.crewAssignments.listByProject, { projectId: "p1", orgId: ORG })),
    listByServiceIds: pick(await as.query(api.crewAssignments.listByServiceIds, { serviceIds: ["svc1"], orgId: ORG })),
  };
}

async function memberReads(t: T, identity: Identity): Promise<Record<string, Row>> {
  const as = t.withIdentity(identity);
  return {
    list: (await as.query(api.crewMembers.list, { orgId: ORG })).find((r) => r.id === "cm1") as Row,
    getById: (await as.query(api.crewMembers.getById, { id: "cm1" })) as Row,
  };
}

describe.each(["member", "viewer"])("a %s", (role) => {
  test("gets no responseToken and no pay from any crewAssignments read", async () => {
    const t = makeT();
    await seed(t, role);
    for (const [name, row] of Object.entries(await assignmentReads(t, asUser))) {
      expect(row, name).toBeTruthy();
      expect(row, name).not.toHaveProperty("responseToken");
      expect(row, name).not.toHaveProperty("estimatedCost");
      expect(row, name).not.toHaveProperty("rateOverride");
      expect(row?.status, name).toBe("OFFERED"); // the rest of the row is intact
    }
  });

  test("gets no default rates (or icalToken) from crewMembers list/getById", async () => {
    const t = makeT();
    await seed(t, role);
    for (const [name, row] of Object.entries(await memberReads(t, asUser))) {
      expect(row, name).toBeTruthy();
      expect(row, name).not.toHaveProperty("defaultDayRate");
      expect(row, name).not.toHaveProperty("defaultHourlyRate");
      expect(row, name).not.toHaveProperty("icalToken");
      expect(row?.firstName, name).toBe("Sam");
    }
  });
});

describe("a manager", () => {
  test("gets the pay fields but still no responseToken", async () => {
    const t = makeT();
    await seed(t, "manager");
    for (const [name, row] of Object.entries(await assignmentReads(t, asUser))) {
      expect(row, name).not.toHaveProperty("responseToken");
      expect(row?.estimatedCost, name).toBe(360);
      expect(row?.rateOverride, name).toBe(50);
    }
    for (const [name, row] of Object.entries(await memberReads(t, asUser))) {
      expect(row?.defaultDayRate, name).toBe(300);
      expect(row?.defaultHourlyRate, name).toBe(40);
      // A manager holds crew:update — they manage feed links, so they get the token.
      expect(row?.icalToken, name).toBe("ical-secret");
    }
  });
});

describe("the iCal feed token (a bearer secret) — self or crew:update, on a user session, never an agent", () => {
  /** Every member read that can return the token, normalised to "the cm1 row". */
  const feedReads = async (t: T, identity: Identity): Promise<Record<string, Row>> => {
    const as = t.withIdentity(identity);
    return {
      ...(await memberReads(t, identity)),
      listPage: (await as.query(api.crewMembers.listPage, { orgId: ORG })).items.find((r) => r.id === "cm1") as Row,
      memberDetail: (await as.query(api.crew.memberDetail, { id: "cm1", orgId: ORG })) as Row,
    };
  };
  const linkSelf = (t: T) =>
    t.run(async (ctx) => {
      const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "cm1")).first();
      await ctx.db.patch(m!._id, { userId: USER });
    });

  test("a plain crew:read member who isn't the crew member: field absent on every read", async () => {
    const t = makeT();
    await seed(t, "member");
    for (const [name, row] of Object.entries(await feedReads(t, asUser))) {
      expect(row?.firstName, name).toBe("Sam");
      expect(row, name).not.toHaveProperty("icalToken");
    }
  });

  test("the crew member themself (their linked userId) gets it, even without crew:update", async () => {
    const t = makeT();
    await seed(t, "member");
    await linkSelf(t);
    for (const [name, row] of Object.entries(await feedReads(t, asUser))) expect(row?.icalToken, name).toBe("ical-secret");
  });

  test("crew:update (manager) gets it on every read", async () => {
    const t = makeT();
    await seed(t, "manager");
    for (const [name, row] of Object.entries(await feedReads(t, asUser))) expect(row?.icalToken, name).toBe("ical-secret");
  });

  test("an API key never gets it — not as an owner, not as the crew member themself", async () => {
    const t = makeT();
    await seed(t, "owner", { noFinancials: false });
    await linkSelf(t);
    for (const [name, row] of Object.entries(await feedReads(t, asAgent))) {
      expect(row?.firstName, name).toBe("Sam");
      expect(row, name).not.toHaveProperty("icalToken");
    }
  });
});

describe("an agent key", () => {
  test("acting as an owner WITHOUT noFinancials sees pay, never the token", async () => {
    const t = makeT();
    await seed(t, "owner", { noFinancials: false });
    for (const [name, row] of Object.entries(await assignmentReads(t, asAgent))) {
      expect(row, name).not.toHaveProperty("responseToken");
      expect(row?.estimatedCost, name).toBe(360);
    }
  });

  test("flagged noFinancials gets no pay even when acting as an owner", async () => {
    const t = makeT();
    await seed(t, "owner", { noFinancials: true });
    for (const [name, row] of Object.entries(await assignmentReads(t, asAgent))) {
      expect(row, name).toBeTruthy();
      expect(row, name).not.toHaveProperty("responseToken");
      expect(row, name).not.toHaveProperty("estimatedCost");
      expect(row, name).not.toHaveProperty("rateOverride");
    }
    for (const [name, row] of Object.entries(await memberReads(t, asAgent))) {
      expect(row, name).not.toHaveProperty("defaultDayRate");
      expect(row, name).not.toHaveProperty("defaultHourlyRate");
    }
  });
});

describe("the service identity", () => {
  test("still gets the responseToken and pay (offer emails + the respond route build links from it)", async () => {
    const t = makeT();
    await seed(t, "viewer");
    for (const [name, row] of Object.entries(await assignmentReads(t, SERVICE))) {
      expect(row?.responseToken, name).toBe("respond-secret");
      expect(row?.estimatedCost, name).toBe(360);
      expect(row?.rateOverride, name).toBe(50);
    }
    for (const [name, row] of Object.entries(await memberReads(t, SERVICE))) {
      expect(row?.defaultDayRate, name).toBe(300);
      expect(row?.icalToken, name).toBe("ical-secret");
    }
  });
});
