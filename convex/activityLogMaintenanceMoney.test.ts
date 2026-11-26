// @vitest-environment node
//
// UX Phase 14 (14b-3 review): the audit rows of the maintenance writes carry MONEY in their snapshots: a part's
// `unitPrice` (`details.partOp`), the record's labour `cost` (`details.lifecycle` for Complete, `details.fieldEdit` for
// the edit sheet). Every activity READ (`list`, `listByEntity`, `exportRows`, and the CSV action built on them) drops
// those keys for a caller without job cost; a caller who sees it reads them untouched. The rest of each row stays.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: "key_1" };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** An owner makes every kind of maintenance write that leaves money in its audit row. */
async function seedWrites(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("apiKeys", { id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", status: "IN_MAINTENANCE", isActive: true, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Fix desk", status: "IN_PROGRESS", cost: 50, createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecordAssets", { id: "l1", maintenanceRecordId: "r1", assetId: "a1", kind: "LINK" });
  });
  const u = t.withIdentity(asUser);
  const base = { orgId: ORG, actor: ACTOR, now: NOW };
  await u.mutation(api.maintenancePartsWrites.addNative, { ...base, recordId: "r1", id: "p1", part: { name: "Strut", quantity: 2, unitPrice: 12.5 }, auditId: "au_add" });
  await u.mutation(api.maintenancePartsWrites.editNative, { ...base, recordId: "r1", id: "p1", set: { unitPrice: 15 }, clear: [], auditId: "au_pedit" });
  await u.mutation(api.maintenanceEditWrites.editNative, { ...base, id: "r1", set: { title: "Fix the desk", cost: 80 }, clear: [], auditId: "au_edit" });
  await u.mutation(api.maintenanceLifecycleWrites.completeNative, { ...base, id: "r1", result: "PASS", completedDate: NOW, labour: 120, auditId: "au_done" });
}

/** Every `details` of the record's maintenance rows, flattened to the set of KEYS and the whole JSON. */
const detailsOf = (rows: { entityType: string; details?: unknown }[]) => JSON.stringify(rows.filter((r) => r.entityType === "maintenance").map((r) => r.details ?? null));
const MONEY_KEY = /"(unitPrice|cost)":/;

type Reader = (t: T, who: typeof asUser) => Promise<{ entityType: string; details?: unknown; summary?: string }[]>;
const READS: Record<string, Reader> = {
  "activityLog.list": async (t, who) => (await t.withIdentity(who).query(api.activityLog.list, { orgId: ORG, pageSize: 200 })).items as never,
  "activityLog.listByEntity": async (t, who) => (await t.withIdentity(who).query(api.activityLog.listByEntity, { orgId: ORG, entityType: "maintenance", entityId: "r1", limit: 50 })).items as never,
  "activityLog.exportRows": async (t, who) => (await t.withIdentity(who).query(api.activityLog.exportRows, { orgId: ORG })) as never,
};

describe("maintenance audit rows: money is redacted on every activity read", () => {
  for (const [name, read] of Object.entries(READS)) {
    test(`${name}: a noFinancials key reads no unitPrice / cost key in any maintenance row; an owner reads them`, async () => {
      const t = makeT();
      await seedWrites(t);
      const seen = detailsOf(await read(t, asUser));
      expect(seen).toMatch(/"unitPrice":/); // the owner reads the part price…
      expect(seen).toMatch(/"cost":/); // …and the labour
      const hidden = await read(t, asAgent);
      expect(detailsOf(hidden)).not.toMatch(MONEY_KEY);
      // Only the money keys go: each row and its non-money snapshot fields are still there.
      expect(detailsOf(hidden)).toMatch(/"name":"Strut"/); // the part row's other fields
      expect(detailsOf(hidden)).toMatch(/"title":/); // the edit's other fields
      expect(detailsOf(hidden)).toMatch(/"status":"COMPLETED"/); // Complete's status
      expect((await read(t, asAgent)).filter((r) => r.entityType === "maintenance").length).toBe((await read(t, asUser)).filter((r) => r.entityType === "maintenance").length);
    });
  }

  test("the stored rows still hold the money (the audit needs it, and the Undo reads it server-side)", async () => {
    const t = makeT();
    await seedWrites(t);
    const raw = await t.run(async (ctx) => (await ctx.db.query("activityLogs").collect()).filter((r) => r.entityType === "maintenance"));
    expect(JSON.stringify(raw.map((r) => r.details))).toMatch(/"unitPrice":15/);
    expect(JSON.stringify(raw.map((r) => r.details))).toMatch(/"cost":120/);
  });
});
