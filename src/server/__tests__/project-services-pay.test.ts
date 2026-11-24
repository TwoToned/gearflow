// @vitest-environment node
//
// B-2: `getProjectServices` reads with the service identity (which always sees
// crew pay), so it must strip each call's pay for its REAL caller — the ONE
// crew-pay rule (`crewPayVisible`: manager+ AND not a noFinancials key; an
// ambient API key counts as noFinancials, fail closed).
import { describe, expect, it, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "member" as string }));
const ambient = vi.hoisted(() => ({ value: null as null | { actorType: string } }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Ann" })),
  getCurrentRole: vi.fn(async () => role.value),
  requirePermission: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Ann" })),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => ambient.value) }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn() }));
vi.mock("@/server/crew-communication", () => ({ sendCrewOffer: vi.fn() }));

const call = {
  id: "a1", status: "CONFIRMED", estimatedCost: 650, rateOverride: 650, rateType: "DAILY", estimatedHours: null,
  resolvedRate: 650, resolvedRateType: "DAILY", startDate: null, endDate: null,
  crewMember: { id: "c1", firstName: "Bob", lastName: "Ryan", image: null },
};
vi.mock("@/lib/project-service-read", async (orig) => ({
  ...(await orig<object>()),
  getProjectServicesFromConvex: vi.fn(async () => [{ id: "s1", title: "Rig", costTotal: 650, lineTotal: 900, crewAssignments: [call] }]),
  getProjectServicesSummaryFromConvex: vi.fn(async () => ({ chargeTotal: 900, costTotal: 650, serviceCount: 1 })),
}));

import { getProjectServices, getProjectServicesSummary } from "../project-services";

type Row = { crewAssignments: Record<string, unknown>[] };
const firstCall = async () => ((await getProjectServices("p1")) as unknown as Row[])[0].crewAssignments[0];

beforeEach(() => {
  role.value = "member";
  ambient.value = null;
});

describe("getProjectServices — crew pay follows the one rule for the real caller (B-2)", () => {
  it("a member (below the pay line): estimatedCost, rateOverride and resolvedRate are ABSENT; the rest stays", async () => {
    const a = await firstCall();
    expect(a).not.toHaveProperty("estimatedCost");
    expect(a).not.toHaveProperty("rateOverride");
    expect(a).not.toHaveProperty("resolvedRate");
    expect(a).toMatchObject({ id: "a1", status: "CONFIRMED", crewMember: { firstName: "Bob" } });
  });

  it("a manager sees them", async () => {
    role.value = "manager";
    expect(await firstCall()).toMatchObject({ estimatedCost: 650, rateOverride: 650, resolvedRate: 650 });
  });

  it("a member: the service's own costTotal (crew pay rolled in) is absent too; its charge stays", async () => {
    const s = ((await getProjectServices("p1")) as unknown as Record<string, unknown>[])[0];
    expect(s).not.toHaveProperty("costTotal");
    expect(s).toMatchObject({ lineTotal: 900 });
    role.value = "manager";
    expect(((await getProjectServices("p1")) as unknown as Record<string, unknown>[])[0]).toMatchObject({ costTotal: 650 });
  });

  it("getProjectServicesSummary: below the pay line the cost total and its aliases are ABSENT, every other field stays", async () => {
    const member = (await getProjectServicesSummary("p1")) as unknown as Record<string, unknown>;
    for (const f of ["costTotal", "totalCost", "internalTotal"]) expect(member, f).not.toHaveProperty(f);
    expect(member).toEqual({ chargeTotal: 900, onDocumentsTotal: 900, serviceCount: 1 });
    ambient.value = { actorType: "apiKey" };
    role.value = "owner";
    expect(await getProjectServicesSummary("p1")).not.toHaveProperty("costTotal");
    ambient.value = null;
    role.value = "manager";
    expect(await getProjectServicesSummary("p1")).toMatchObject({ costTotal: 650, totalCost: 650, internalTotal: 650, chargeTotal: 900 });
  });

  it("an API key (noFinancials, fail closed) acting as an owner does not", async () => {
    role.value = "owner";
    ambient.value = { actorType: "apiKey" };
    const a = await firstCall();
    expect(a).not.toHaveProperty("estimatedCost");
    expect(a).not.toHaveProperty("resolvedRate");
  });
});
