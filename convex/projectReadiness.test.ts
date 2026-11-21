// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * UX Phase 7: `projectReadiness.forProject` carries the Overview's incidents
 * count, read through the existing `by_projectId` index (capped, foreign-org
 * rows dropped because the index is global) instead of the page subscribing
 * to the org's whole maintenance table.
 */
const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = () => ({ subject: USER, orgId: ORG });

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED", isTemplate: false,
      taxRate: 10, discountPercent: 0, revision: 1, createdAt: NOW, updatedAt: NOW, liveVersionId: "v1",
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
  });
}

type Rec = { id: string; org?: string; projectId?: string; incidentType?: "BROKEN_DAMAGED" | "NEEDS_SERVICE"; status?: "SCHEDULED" | "COMPLETED" };
async function addRecords(t: ReturnType<typeof makeT>, recs: Rec[]) {
  await t.run(async (ctx) => {
    for (const r of recs) {
      await ctx.db.insert("maintenanceRecords", {
        id: r.id, organizationId: r.org ?? ORG, projectId: r.projectId ?? "p1", type: "REPAIR", status: r.status ?? "SCHEDULED",
        title: r.id, incidentType: r.incidentType, createdAt: NOW, updatedAt: NOW,
      } as never);
    }
  });
}

const read = (t: ReturnType<typeof makeT>) =>
  t.withIdentity(asUser()).query(api.projectReadiness.forProject, { orgId: ORG, projectId: "p1" });

describe("projectReadiness.forProject — incidents", () => {
  test("counts this job's open incidents only: not closed ones, not planned maintenance", async () => {
    const t = makeT();
    await seed(t);
    await addRecords(t, [
      { id: "i1", incidentType: "BROKEN_DAMAGED" },
      { id: "i2", incidentType: "NEEDS_SERVICE" },
      { id: "i3", incidentType: "BROKEN_DAMAGED", status: "COMPLETED" },
      { id: "m1" },
      { id: "i4", incidentType: "BROKEN_DAMAGED", projectId: "p2" },
    ]);
    expect((await read(t)).incidents).toEqual({ openCount: 2, truncated: false });
  });

  test("an org-mismatch row on the same project id is dropped (by_projectId is global)", async () => {
    const t = makeT();
    await seed(t);
    await addRecords(t, [
      { id: "i1", incidentType: "BROKEN_DAMAGED" },
      { id: "x1", org: OTHER, incidentType: "BROKEN_DAMAGED" },
      { id: "x2", org: OTHER, incidentType: "NEEDS_SERVICE" },
    ]);
    expect((await read(t)).incidents).toEqual({ openCount: 1, truncated: false });
  });

  test("only foreign-org rows on the project id count as zero", async () => {
    const t = makeT();
    await seed(t);
    await addRecords(t, [{ id: "x1", org: OTHER, incidentType: "BROKEN_DAMAGED" }]);
    expect((await read(t)).incidents).toEqual({ openCount: 0, truncated: false });
  });

  test("no records reads as zero, not truncated", async () => {
    const t = makeT();
    await seed(t);
    expect((await read(t)).incidents).toEqual({ openCount: 0, truncated: false });
  });
});
