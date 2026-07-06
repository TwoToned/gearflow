/**
 * Integration parity tests for createTimeEntries — proves the batched "log time
 * for N crew" action produces the same Convex rows as the old per-crew
 * createTimeEntry loop, and preserves the loop's partial-success behaviour
 * (one bad crew member doesn't sink the rest).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { createTimeEntry, createTimeEntries } from "@/server/crew-time";

async function createCrew(orgId: string, first: string) {
  const id = createId();
  const convex = await getConvexClient();
  await convex.mutation(api.crewMembers.createIfMissing, {
    id,
    organizationId: orgId,
    firstName: first,
    lastName: "Crew",
  });
  return id;
}

async function entriesByCrew(orgId: string, crewIds: string[]) {
  const convex = await getConvexClient();
  const all = await convex.query(api.crewTimeEntries.list, { orgId });
  return all
    .filter((e) => crewIds.includes(e.crewMemberId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => ({
      date: e.date ?? null,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      breakMinutes: e.breakMinutes ?? null,
      totalHours: e.totalHours ?? null,
      status: e.status ?? null,
      description: e.description ?? null,
      hasAssignment: !!e.assignmentId,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const DATA = {
  assignmentId: "",
  crewMemberId: "",
  description: "General",
  date: new Date("2026-07-06T00:00:00.000Z"),
  startTime: "09:00",
  endTime: "17:00",
  breakMinutes: 30,
} as const;

describe("createTimeEntries — parity with the per-crew createTimeEntry loop", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("batched log == the per-crew loop", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    // Loop: two crew, one createTimeEntry each.
    const a1 = await createCrew(org.id, "Ada");
    const a2 = await createCrew(org.id, "Bob");
    await createTimeEntry({ ...DATA, crewMemberId: a1 });
    await createTimeEntry({ ...DATA, crewMemberId: a2 });

    // Batch: two crew, one createTimeEntries call.
    const b1 = await createCrew(org.id, "Cy");
    const b2 = await createCrew(org.id, "Di");
    const res = await createTimeEntries({ ...DATA }, [b1, b2]);
    expect(res.created.sort()).toEqual([b1, b2].sort());
    expect(res.errors).toEqual([]);

    const loop = await entriesByCrew(org.id, [a1, a2]);
    const batch = await entriesByCrew(org.id, [b1, b2]);
    expect(batch).toEqual(loop);
    expect(batch).toHaveLength(2);
    expect(batch[0].totalHours).toBe(7.5); // 8h - 30m break
  });

  it("partial success: an unknown crew id errors, the valid ones are still written", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const good = await createCrew(org.id, "Eve");
    const bogus = createId();

    const res = await createTimeEntries({ ...DATA }, [good, bogus]);
    expect(res.created).toEqual([good]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].crewMemberId).toBe(bogus);
    expect(res.errors[0].message).toMatch(/not found/i);

    expect(await entriesByCrew(org.id, [good, bogus])).toHaveLength(1);
  });

  it("dedupes repeated crew ids in the input", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const c = await createCrew(org.id, "Fay");
    const res = await createTimeEntries({ ...DATA }, [c, c, c]);
    expect(res.created).toEqual([c]);
    expect(await entriesByCrew(org.id, [c])).toHaveLength(1);
  });
});
