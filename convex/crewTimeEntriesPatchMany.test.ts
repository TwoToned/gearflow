// @vitest-environment node
//
// crewTimeEntries.patchManyStatus — the Phase 3 bulk single-call invariant for
// submit/approve timesheets (Appendix A*): ONE shared `set` applied to N entries in
// one array mutation (was one round-trip per entry) with a per-item org re-check + a
// TOCTOU-safe status-eligibility gate.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

const entry = (id: string, org: string, status: "DRAFT" | "DISPUTED" | "SUBMITTED" | "APPROVED") => ({
  id, organizationId: org, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00", status, updatedAt: NOW,
});

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("crewTimeEntries", entry("e1", ORG, "DRAFT"));
    await ctx.db.insert("crewTimeEntries", entry("e2", ORG, "DISPUTED"));
    await ctx.db.insert("crewTimeEntries", entry("e3", ORG, "APPROVED")); // not eligible to submit
    await ctx.db.insert("crewTimeEntries", entry("ex", OTHER, "DRAFT")); // another org
  });
}
const status = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.status);

describe("crewTimeEntries.patchManyStatus — bulk single-call + guards", () => {
  test("submits eligible entries, skips ineligible-status and cross-org", async () => {
    const t = makeT();
    await seed(t);

    const res = await t.withIdentity(SERVICE).mutation(api.crewTimeEntries.patchManyStatus, {
      organizationId: ORG,
      ids: ["e1", "e2", "e3", "ex"],
      fromStatuses: ["DRAFT", "DISPUTED"],
      set: { status: "SUBMITTED", updatedAt: NOW + 1 },
    });

    expect(res.count).toBe(2);
    expect([...res.updated].sort()).toEqual(["e1", "e2"]);
    expect(await status(t, "e1")).toBe("SUBMITTED");
    expect(await status(t, "e2")).toBe("SUBMITTED");
    expect(await status(t, "e3")).toBe("APPROVED"); // wrong from-status → untouched
    expect(await status(t, "ex")).toBe("DRAFT"); // cross-org → untouched (org re-check)
  });

  test("approve stamps approver fields on the eligible entries", async () => {
    const t = makeT();
    await seed(t);
    // move e1 to SUBMITTED first
    await t.withIdentity(SERVICE).mutation(api.crewTimeEntries.patchManyStatus, {
      organizationId: ORG, ids: ["e1"], fromStatuses: ["DRAFT", "DISPUTED"], set: { status: "SUBMITTED", updatedAt: NOW + 1 },
    });
    const res = await t.withIdentity(SERVICE).mutation(api.crewTimeEntries.patchManyStatus, {
      organizationId: ORG,
      ids: ["e1", "e2"], // e2 is DISPUTED (eligible), e1 now SUBMITTED (eligible)
      fromStatuses: ["SUBMITTED", "DISPUTED"],
      set: { status: "APPROVED", approvedById: "u1", approvedAt: NOW + 2, updatedAt: NOW + 2 },
    });
    expect(res.count).toBe(2);
    await t.run(async (ctx) => {
      const e1 = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "e1")).unique();
      expect(e1?.status).toBe("APPROVED");
      expect(e1?.approvedById).toBe("u1");
      expect(e1?.approvedAt).toBe(NOW + 2);
    });
  });

  test("a non-service (user) token cannot call the batch", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.crewTimeEntries.patchManyStatus, {
        organizationId: ORG, ids: ["e1"], fromStatuses: ["DRAFT"], set: { status: "SUBMITTED", updatedAt: NOW },
      }),
    ).rejects.toThrow(/server/i);
  });
});
