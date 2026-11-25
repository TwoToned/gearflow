// D75 (UX Phase 14): `checkKitAvailability` reads the DERIVED kit booking state, one definition
// (`convex/lib/kitState.ts`), never the stored `INCOMPLETE` status.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  kit: null as Record<string, unknown> | null,
  gate: null as { key: string; blocksBooking: boolean; missing: unknown[] } | null,
  gateCalls: [] as string[],
}));

vi.mock("@/lib/org-context", () => ({ getOrgContext: async () => ({ organizationId: "org1" }) }));
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }));
vi.mock("@/lib/kits-read", () => ({
  getKitById: async () => h.kit,
  getKitBookingGate: async (org: string, id: string) => {
    h.gateCalls.push(`${org}:${id}`);
    return h.gate;
  },
}));
vi.mock("@/lib/projects-read", () => ({ getProjectById: async () => null, getProjectsByOrg: async () => [] }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: async () => ({ query: async () => [] }) }));
vi.mock("@/lib/assets-read", () => ({ getAssetByAssetTag: async () => null, getAssetsByOrg: async () => [], getBulkAssetsByIds: async () => [] }));
vi.mock("@/lib/model-category-join", () => ({ getModelWithCategoryMap: async () => new Map() }));
vi.mock("@/lib/locations-read", () => ({ getLocationById: async () => null }));

import { checkKitAvailability } from "../line-items";

beforeEach(() => {
  h.kit = { id: "k1", organizationId: "org1", status: "AVAILABLE" };
  h.gate = { key: "AVAILABLE", blocksBooking: false, missing: [] };
  h.gateCalls = [];
});

const check = () => checkKitAvailability("k1", "2026-12-01", "2026-12-03");

describe("checkKitAvailability reads the derived gate", () => {
  it("a derived-Incomplete kit is unavailable even though its stored status is AVAILABLE", async () => {
    h.gate = { key: "INCOMPLETE", blocksBooking: true, missing: [{ label: "PA805", why: "lost" }] };
    expect(await check()).toMatchObject({ available: false, conflictsWith: "Kit status: INCOMPLETE" });
    expect(h.gateCalls).toEqual(["org1:k1"]);
  });

  it("a legacy stored INCOMPLETE kit that is derived complete is not blocked by the gate", async () => {
    h.kit = { id: "k1", organizationId: "org1", status: "INCOMPLETE" };
    expect(await check()).not.toMatchObject({ conflictsWith: expect.stringMatching(/Kit status/) });
  });

  it("In maintenance still blocks, with its own word", async () => {
    h.gate = { key: "IN_MAINTENANCE", blocksBooking: true, missing: [] };
    expect(await check()).toMatchObject({ available: false, conflictsWith: "Kit status: IN MAINTENANCE" });
  });

  it("a kit from another org is not found and the gate is never asked", async () => {
    h.kit = { id: "k1", organizationId: "org2", status: "AVAILABLE" };
    expect(await check()).toMatchObject({ available: false, conflictsWith: "Kit not found" });
    expect(h.gateCalls).toEqual([]);
  });
});
