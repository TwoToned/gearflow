// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * UX Phase 7: `activityLog.recentForProject` feeds the job Overview's Recent
 * lines. It is a live read on the landing tab, so it must be BOUNDED (never
 * collect a project's whole history), newest first, and scoped to the org in
 * the index.
 */
const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const ORG = "org_1";
const USER = "user_1";
const asUser = () => ({ subject: USER, orgId: ORG });

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    for (let i = 1; i <= 30; i++) {
      await ctx.db.insert("activityLogs", {
        id: `log${i}`, organizationId: ORG, action: "UPDATE", entityType: "project", entityId: "p1", entityName: "Gig",
        userName: "Alice", summary: `change ${i}`, projectId: "p1", createdAt: 1_700_000_000_000 + i,
      });
    }
    await ctx.db.insert("activityLogs", {
      id: "foreign", organizationId: "org_2", action: "UPDATE", entityType: "project", entityId: "p1", entityName: "Other",
      userName: "Mallory", summary: "foreign change", projectId: "p1", createdAt: 1_800_000_000_000,
    });
  });
}

const read = (t: ReturnType<typeof makeT>, limit?: number) =>
  t.withIdentity(asUser()).query(api.activityLog.recentForProject, { orgId: ORG, projectId: "p1", limit });

describe("activityLog.recentForProject", () => {
  test("returns the newest `limit` rows of THIS org, newest first", async () => {
    const t = makeT();
    await seed(t);
    const { items } = await read(t, 4);
    expect(items.map((r) => r.id)).toEqual(["log30", "log29", "log28", "log27"]);
  });

  test("the limit is clamped to 1..20 server-side, whatever the caller asks", async () => {
    const t = makeT();
    await seed(t);
    expect((await read(t, 500)).items).toHaveLength(20);
    expect((await read(t, 0)).items).toHaveLength(1);
    expect((await read(t)).items).toHaveLength(4);
  });
});
