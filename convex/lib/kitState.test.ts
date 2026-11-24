// @vitest-environment node
import { describe, expect, test } from "vitest";
import { deriveKitState, missingMembers, type KitSerializedMember } from "./kitState";

const ok = (id: string, over: Partial<NonNullable<KitSerializedMember["asset"]>> = {}): KitSerializedMember => ({
  assetId: id,
  asset: { assetTag: `T-${id}`, status: "AVAILABLE", isActive: true, ...over },
});
const booking = { projectId: "p1", projectNumber: "#2341", projectName: "Gig", start: 1 };

describe("deriveKitState", () => {
  test("complete and unbooked is Available", () => {
    expect(deriveKitState({ kit: { status: "AVAILABLE" }, serialized: [ok("a")], bulk: [] })).toMatchObject({ key: "AVAILABLE", blocksBooking: false, missing: [] });
  });

  test("a LOST, retired or absent serialised member is missing; IN_MAINTENANCE is not", () => {
    const s = [ok("lost", { status: "LOST" }), ok("old", { isActive: false }), { assetId: "gone", asset: null }, ok("repair", { status: "IN_MAINTENANCE" })];
    expect(missingMembers(s, []).map((m) => [m.id, m.why])).toEqual([["lost", "lost"], ["old", "retired"], ["gone", "missing"]]);
  });

  test("a bulk member short of what the kit needs is missing (short); an absent bulk asset is missing", () => {
    const bulk = [
      { bulkAssetId: "b1", required: 4, bulkAsset: { assetTag: "XLR", totalQuantity: 3 } },
      { bulkAssetId: "b2", required: 4, bulkAsset: { assetTag: "OK", totalQuantity: 4 } },
      { bulkAssetId: "b3", required: 1, bulkAsset: null },
    ];
    expect(missingMembers([], bulk).map((m) => [m.id, m.why])).toEqual([["b1", "short"], ["b3", "missing"]]);
  });

  test("Incomplete is derived and blocks booking", () => {
    const s = deriveKitState({ kit: { status: "AVAILABLE" }, serialized: [ok("a", { status: "LOST" })], bulk: [] });
    expect(s).toMatchObject({ key: "INCOMPLETE", blocksBooking: true });
  });

  test("a missing item beats a reservation", () => {
    const s = deriveKitState({ kit: { status: "AVAILABLE" }, serialized: [ok("a", { status: "LOST" })], bulk: [], booking });
    expect(s.key).toBe("INCOMPLETE");
    expect(s.booking).toEqual(booking);
  });

  test("a booked, complete kit is Reserved and does NOT block (the dated check owns clashes)", () => {
    expect(deriveKitState({ kit: { status: "AVAILABLE" }, serialized: [ok("a")], bulk: [], booking })).toMatchObject({ key: "RESERVED", blocksBooking: false });
  });

  test("the stored physical statuses win: Out, In maintenance, Retired", () => {
    const lost = [ok("a", { status: "LOST" })];
    expect(deriveKitState({ kit: { status: "CHECKED_OUT" }, serialized: lost, bulk: [] }).key).toBe("CHECKED_OUT");
    expect(deriveKitState({ kit: { status: "IN_MAINTENANCE" }, serialized: [], bulk: [] })).toMatchObject({ key: "IN_MAINTENANCE", blocksBooking: true });
    expect(deriveKitState({ kit: { status: "AVAILABLE", isActive: false }, serialized: [], bulk: [] }).key).toBe("RETIRED");
    expect(deriveKitState({ kit: { status: "RETIRED" }, serialized: [], bulk: [] }).key).toBe("RETIRED");
  });

  test("a legacy stored INCOMPLETE with nothing missing reads Available, flagged for the report; with a missing member it is Incomplete anyway", () => {
    const legacy = deriveKitState({ kit: { status: "INCOMPLETE" }, serialized: [ok("a")], bulk: [] });
    expect(legacy).toMatchObject({ key: "AVAILABLE", blocksBooking: false, legacyIncomplete: true });
    const real = deriveKitState({ kit: { status: "INCOMPLETE" }, serialized: [ok("a", { status: "LOST" })], bulk: [] });
    expect(real).toMatchObject({ key: "INCOMPLETE", legacyIncomplete: false });
  });

  test("an absent status reads Available", () => {
    expect(deriveKitState({ kit: {}, serialized: [], bulk: [] }).key).toBe("AVAILABLE");
  });
});
