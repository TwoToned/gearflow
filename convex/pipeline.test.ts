// @vitest-environment node
//
// convex/pipeline.ts (#1245) — the client pipeline: ENQUIRY/QUOTING/QUOTED/
// CONFIRMED projects sorted by next-step date, with rotting shading.
// Verifies: status filtering, next-step-date sort (with the SENT quote's
// sentAt as a fallback ordering key when no next step is logged yet), and
// the rotting level threshold math against the org's configured (or
// default) day counts.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
  });
}

describe("pipeline.forOrg", () => {
  test("filters to the pipeline statuses, sorts by next-step date, and excludes templates", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Later Client", updatedAt: NOW });
      await ctx.db.insert("clients", { id: "c2", organizationId: ORG, name: "Sooner Client", updatedAt: NOW });
      await ctx.db.insert("projects", { id: "pEnquiry", organizationId: ORG, projectNumber: "P1", name: "Enquiry job", clientId: "c1", status: "ENQUIRY", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("projects", { id: "pConfirmed", organizationId: ORG, projectNumber: "P2", name: "Confirmed job", clientId: "c2", status: "CONFIRMED", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("projects", { id: "pDone", organizationId: ORG, projectNumber: "P3", name: "Done job", clientId: "c1", status: "COMPLETED", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("projects", { id: "pTpl", organizationId: ORG, projectNumber: "P4", name: "Template", clientId: "c1", status: "ENQUIRY", isTemplate: true, createdAt: NOW });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, title: "Later step", kind: "follow_up", status: "TODO", dueDate: NOW + 10 * DAY, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("workItemLinks", { id: "l1", organizationId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", createdAt: NOW });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, title: "Sooner step", kind: "follow_up", status: "TODO", dueDate: NOW + DAY, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("workItemLinks", { id: "l2", organizationId: ORG, workItemId: "t2", entityType: "client", entityId: "c2", createdAt: NOW });
    });

    const cards = await t.withIdentity(asUser(ORG)).query(api.pipeline.forOrg, { orgId: ORG, now: NOW });
    const ids = cards.map((c) => c.projectId);
    expect(ids).not.toContain("pDone");
    expect(ids).not.toContain("pTpl");
    expect(ids).toEqual(["pConfirmed", "pEnquiry"]); // sooner next-step date first
  });

  test("a deal with no next step falls back to its quote's sentAt for ordering", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "No Next Step Client", updatedAt: NOW });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Quoted job", clientId: "c1", status: "QUOTED", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("quotes", { id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "SENT", snapshot: null, sentAt: NOW - 2 * DAY, validUntil: NOW + 20 * DAY });
    });
    const cards = await t.withIdentity(asUser(ORG)).query(api.pipeline.forOrg, { orgId: ORG, now: NOW });
    expect(cards).toHaveLength(1);
    expect(cards[0].nextStepDate).toBe(NOW - 2 * DAY);
    expect(cards[0].nextStepTitle).toBeNull();
  });

  test("rotting shades amber/error by days since the client's last touch", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "cFresh", organizationId: ORG, name: "Fresh", updatedAt: NOW - DAY });
      await ctx.db.insert("clients", { id: "cAmber", organizationId: ORG, name: "Amber", updatedAt: NOW - 8 * DAY });
      await ctx.db.insert("clients", { id: "cRotten", organizationId: ORG, name: "Rotten", updatedAt: NOW - 20 * DAY });
      await ctx.db.insert("projects", { id: "pFresh", organizationId: ORG, projectNumber: "PF", name: "Fresh job", clientId: "cFresh", status: "ENQUIRY", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("projects", { id: "pAmber", organizationId: ORG, projectNumber: "PA", name: "Amber job", clientId: "cAmber", status: "ENQUIRY", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("projects", { id: "pRotten", organizationId: ORG, projectNumber: "PR", name: "Rotten job", clientId: "cRotten", status: "ENQUIRY", isTemplate: false, createdAt: NOW });
    });
    const cards = await t.withIdentity(asUser(ORG)).query(api.pipeline.forOrg, { orgId: ORG, now: NOW });
    const byId = new Map(cards.map((c) => [c.projectId, c]));
    expect(byId.get("pFresh")?.rotting).toBe("none");
    expect(byId.get("pAmber")?.rotting).toBe("amber");
    expect(byId.get("pRotten")?.rotting).toBe("error");
  });
});
