// @vitest-environment node
//
// crewTimeEntries.removeMany + crewAvailabilities.removeMany — the Phase 3 bulk
// single-call invariant for the crew-member delete cascade (Appendix A*): N rows
// deleted in ONE array mutation (was one round-trip per row) with a per-item org
// re-check. crewAvailabilities.organizationId is OPTIONAL → null-org rows are deleted.
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

const has = (t: T, table: "crewTimeEntries" | "crewAvailabilities", id: string) =>
  t.run(async (ctx) => (await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).unique()) != null);

describe("crewTimeEntries.removeMany — org-checked bulk delete", () => {
  test("deletes in-org entries, skips missing + cross-org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const te = (id: string, org: string) => ctx.db.insert("crewTimeEntries", { id, organizationId: org, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00" });
      await te("t1", ORG); await te("t2", ORG); await te("tx", OTHER);
    });

    const res = await t.withIdentity(SERVICE).mutation(api.crewTimeEntries.removeMany, {
      organizationId: ORG, ids: ["t1", "t2", "tx", "ghost"],
    });

    expect(res.deleted).toBe(2);
    expect(await has(t, "crewTimeEntries", "t1")).toBe(false);
    expect(await has(t, "crewTimeEntries", "t2")).toBe(false);
    expect(await has(t, "crewTimeEntries", "tx")).toBe(true); // cross-org untouched
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.crewTimeEntries.removeMany, { organizationId: ORG, ids: [] }),
    ).rejects.toThrow(/server/i);
  });
});

describe("crewAvailabilities.removeMany — optional-org bulk delete", () => {
  test("deletes in-org + null-org rows, skips a present-but-mismatched org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAvailabilities", { id: "av1", organizationId: ORG, crewMemberId: "c1", startDate: NOW, endDate: NOW + 1 });
      await ctx.db.insert("crewAvailabilities", { id: "av2", crewMemberId: "c1", startDate: NOW, endDate: NOW + 1 }); // null org — the member's own row
      await ctx.db.insert("crewAvailabilities", { id: "avx", organizationId: OTHER, crewMemberId: "c1", startDate: NOW, endDate: NOW + 1 });
    });

    const res = await t.withIdentity(SERVICE).mutation(api.crewAvailabilities.removeMany, {
      organizationId: ORG, ids: ["av1", "av2", "avx"],
    });

    expect(res.deleted).toBe(2); // av1 (in-org) + av2 (null org)
    expect(await has(t, "crewAvailabilities", "av1")).toBe(false);
    expect(await has(t, "crewAvailabilities", "av2")).toBe(false);
    expect(await has(t, "crewAvailabilities", "avx")).toBe(true); // present + mismatched org → kept
  });
});
