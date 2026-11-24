// @vitest-environment node
//
// UX Phase 15: the activity log keeps crew pay in its field diffs (the audit
// needs it — `crewWrites.updateNative` writes `defaultDayRate` / `defaultHourlyRate`
// from → to), but every READ redacts those change rows for a caller below the pay
// line (the ONE rule) by the shared field lists. The rest of the entry stays.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { redactActivityPay } from "./lib/activityPay";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const actor = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/** A manager edits a crew member's name AND day rate: the audit row records both. */
async function seed(t: T, role: string, key?: { noFinancials: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", defaultDayRate: 600 });
  });
  await t.withIdentity(asUser).mutation(api.crewWrites.updateNative, { id: "c1", orgId: ORG, set: { firstName: "Robert", defaultDayRate: 650 }, clear: [], actor, auditId: "log1", now: NOW });
  await t.run(async (ctx) => {
    const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
    await ctx.db.patch(m!._id, { role });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
      });
    }
  });
}

type Change = { field: string; from: unknown; to: unknown };
const fieldsOf = (row: unknown) => ((row as { details?: { changes?: Change[] } }).details?.changes ?? []).map((c) => c.field);

const reads = async (t: T, who = asUser) => {
  const c = t.withIdentity(who);
  return {
    list: (await c.query(api.activityLog.list, { orgId: ORG })).items[0],
    byEntity: (await c.query(api.activityLog.listByEntity, { orgId: ORG, entityType: "crew_member", entityId: "c1" })).items[0],
    exportRow: (await c.query(api.activityLog.exportRows, { orgId: ORG }))[0],
  };
};

describe("activity log: crew pay in field diffs is written, and redacted on read below the pay line", () => {
  test("the write keeps the rate diff (the audit needs it)", async () => {
    const t = makeT(); await seed(t, "manager");
    const row = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first());
    expect(fieldsOf(row)).toEqual(["firstName", "defaultDayRate"]);
  });

  test("a member: list, listByEntity and exportRows drop the rate change rows, keep the rest", async () => {
    const t = makeT(); await seed(t, "member");
    for (const [name, row] of Object.entries(await reads(t))) {
      expect(fieldsOf(row), name).toEqual(["firstName"]);
      expect((row as { summary: string }).summary, name).toMatch(/Updated crew member/);
    }
  });

  test("a noFinancials key (as owner) gets no rate diff; a manager gets it", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    for (const row of Object.values(await reads(ta, asAgent))) expect(fieldsOf(row)).toEqual(["firstName"]);
    const tm = makeT(); await seed(tm, "manager");
    for (const row of Object.values(await reads(tm))) expect(fieldsOf(row)).toEqual(["firstName", "defaultDayRate"]);
  });

  test("redactActivityPay drops every listed pay field (member and role rates, crew-cost totals)", () => {
    const changes = ["defaultDayRate", "defaultHourlyRate", "overtimeMultiplier", "defaultRate", "chargeRate", "costTotal", "margin", "status"].map((field) => ({ field, from: 1, to: 2 }));
    expect(fieldsOf(redactActivityPay({ details: { changes } }))).toEqual(["status"]);
    expect(redactActivityPay({ details: { deleted: { name: "x" } } })).toEqual({ details: { deleted: { name: "x" } } });
  });
});
