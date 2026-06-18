/**
 * Unit tests for the PURE reservation-conflict-detection helpers (Convex
 * read-rewiring, Phase A bucket-1). The Convex fetchers (`getOrgLineItems` /
 * `getOrgLineItemUnits`) are thin I/O and not exercised here; these tests pin the
 * date-overlap math (the high-risk surface) and the status/where replication.
 */

import { describe, it, expect } from "vitest";
import {
  overlappingProjectIds,
  collectHereAssetRefs,
  buildOverlapByAsset,
  filterSwapCandidateAssets,
  collectBookedAssetIds,
  toConflictProject,
} from "@/lib/reservation-conflicts-read";
import type { MappedLineItem, MappedUnit } from "@/lib/project-line-item-read";
import type { ConvexAsset } from "@/lib/assets-read";
import type { ConvexProject } from "@/lib/projects-read";

const day = (n: number) => new Date(2026, 5, n).getTime(); // June n, 2026

function project(over: Record<string, unknown> & { id: string }): ConvexProject {
  return {
    organizationId: "org1",
    projectNumber: `P-${over.id}`,
    name: `Project ${over.id}`,
    status: "CONFIRMED",
    isTemplate: false,
    rentalStartDate: day(1),
    rentalEndDate: day(10),
    ...over,
  } as unknown as ConvexProject;
}

function line(over: Record<string, unknown> & { id: string; projectId: string }): MappedLineItem {
  return {
    organizationId: "org1",
    type: "EQUIPMENT",
    modelId: null,
    assetId: null,
    status: "CONFIRMED",
    quantity: 1,
    sortOrder: 0,
    // remaining fields irrelevant to the predicates; cast through unknown.
    ...over,
  } as unknown as MappedLineItem;
}

function unit(over: Record<string, unknown> & { id: string; lineItemId: string }): MappedUnit {
  return {
    organizationId: "org1",
    ordinal: 0,
    assetId: null,
    status: "CHECKED_OUT",
    quantity: 1,
    returnedQuantity: 0,
    ...over,
  } as unknown as MappedUnit;
}

function asset(over: Record<string, unknown> & { id: string }): ConvexAsset {
  return {
    organizationId: "org1",
    assetTag: `TAG-${over.id}`,
    modelId: "m1",
    status: "AVAILABLE",
    isActive: true,
    ...over,
  } as unknown as ConvexAsset;
}

describe("overlappingProjectIds — date overlap math", () => {
  const window = [day(5), day(10)] as const;

  it("includes a project whose window fully contains the query window", () => {
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: day(1), rentalEndDate: day(20) })],
      window[0],
      window[1],
      "p1",
    );
    expect([...ids]).toEqual(["p2"]);
  });

  it("includes touching-at-the-end (inclusive upper bound)", () => {
    // other ends exactly when query starts → s(other) <= end && e(other) >= start
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: day(1), rentalEndDate: day(5) })],
      window[0],
      window[1],
      "p1",
    );
    expect([...ids]).toEqual(["p2"]);
  });

  it("includes touching-at-the-start (inclusive lower bound)", () => {
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: day(10), rentalEndDate: day(15) })],
      window[0],
      window[1],
      "p1",
    );
    expect([...ids]).toEqual(["p2"]);
  });

  it("excludes a project ending one ms before the query starts", () => {
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: day(1), rentalEndDate: day(5) - 1 })],
      window[0],
      window[1],
      "p1",
    );
    expect([...ids]).toEqual([]);
  });

  it("excludes a project starting one ms after the query ends", () => {
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: day(10) + 1, rentalEndDate: day(20) })],
      window[0],
      window[1],
      "p1",
    );
    expect([...ids]).toEqual([]);
  });

  it("excludes the excludeProjectId, templates, dead statuses, and dateless projects", () => {
    const projects = [
      project({ id: "self", rentalStartDate: day(6), rentalEndDate: day(7) }),
      project({ id: "tmpl", isTemplate: true }),
      project({ id: "cancelled", status: "CANCELLED" }),
      project({ id: "returned", status: "RETURNED" }),
      project({ id: "completed", status: "COMPLETED" }),
      project({ id: "invoiced", status: "INVOICED" }),
      project({ id: "dateless", rentalStartDate: null, rentalEndDate: null }),
      project({ id: "live", rentalStartDate: day(6), rentalEndDate: day(8) }),
    ];
    const ids = overlappingProjectIds(projects, window[0], window[1], "self");
    expect([...ids]).toEqual(["live"]);
  });

  it("treats a one-day window (start === end) inclusively", () => {
    const t = day(5);
    const ids = overlappingProjectIds(
      [project({ id: "p2", rentalStartDate: t, rentalEndDate: t })],
      t,
      t,
      "p1",
    );
    expect([...ids]).toEqual(["p2"]);
  });
});

describe("collectHereAssetRefs", () => {
  const assetMap = new Map([
    ["a1", asset({ id: "a1", assetTag: "A1", modelId: "m1" })],
    ["a2", asset({ id: "a2", assetTag: "A2", modelId: "m2" })],
  ]);
  const modelMap = new Map([
    ["m1", { name: "Model One" }],
    ["m2", { name: "Model Two" }],
  ]);

  it("collects line.assetId rows for the project, excluding CANCELLED + null + other projects", () => {
    const lines = [
      line({ id: "l1", projectId: "p1", assetId: "a1", modelId: "m1" }),
      line({ id: "l2", projectId: "p1", assetId: "a2", modelId: "m2", status: "CANCELLED" }),
      line({ id: "l3", projectId: "p1", assetId: null, modelId: "m1" }),
      line({ id: "l4", projectId: "pOther", assetId: "a1", modelId: "m1" }),
    ];
    const refs = collectHereAssetRefs("p1", lines, [], assetMap, modelMap);
    expect(refs).toEqual([
      { lineItemId: "l1", assetId: "a1", modelId: "m1", assetTag: "A1", modelName: "Model One" },
    ]);
  });

  it("collects unit rows (modelId derived from the unit's asset), excluding RETURNED + cancelled/foreign parent", () => {
    const lines = [
      line({ id: "l1", projectId: "p1", assetId: null }),
      line({ id: "l2", projectId: "p1", assetId: null, status: "CANCELLED" }),
      line({ id: "l3", projectId: "pOther", assetId: null }),
    ];
    const units = [
      unit({ id: "u1", lineItemId: "l1", assetId: "a2", status: "CHECKED_OUT" }),
      unit({ id: "u2", lineItemId: "l1", assetId: "a1", status: "RETURNED" }), // excluded
      unit({ id: "u3", lineItemId: "l2", assetId: "a1" }), // parent CANCELLED
      unit({ id: "u4", lineItemId: "l3", assetId: "a1" }), // parent foreign project
      unit({ id: "u5", lineItemId: "lMissing", assetId: "a1" }), // no parent
    ];
    const refs = collectHereAssetRefs("p1", lines, units, assetMap, modelMap);
    expect(refs).toEqual([
      { lineItemId: "l1", assetId: "a2", modelId: "m2", assetTag: "A2", modelName: "Model Two" },
    ]);
  });

  it("falls back to em-dash placeholders when asset/model missing from maps", () => {
    const lines = [line({ id: "l1", projectId: "p1", assetId: "ghost", modelId: "ghostM" })];
    const refs = collectHereAssetRefs("p1", lines, [], new Map(), new Map());
    expect(refs[0]).toMatchObject({ assetTag: "—", modelName: "—" });
  });
});

describe("buildOverlapByAsset", () => {
  it("matches assets on conflict projects, lines win the tie-break over units", () => {
    const lines = [
      line({ id: "lc", projectId: "pConflict", assetId: "a1" }),
      line({ id: "lu", projectId: "pConflict", assetId: null }),
      line({ id: "lother", projectId: "pNotConflict", assetId: "a1" }),
      line({ id: "lcancel", projectId: "pConflict", assetId: "a2", status: "CANCELLED" }),
    ];
    const units = [unit({ id: "u1", lineItemId: "lu", assetId: "a1" })];
    const map = buildOverlapByAsset(
      new Set(["a1", "a2"]),
      new Set(["pConflict"]),
      lines,
      units,
    );
    // a1 hit via the line (scanned first) not the unit.
    expect(map.get("a1")).toEqual({ id: "lc", projectId: "pConflict" });
    // a2 only on a CANCELLED line → no hit.
    expect(map.has("a2")).toBe(false);
  });

  it("matches via a unit when no line holds the asset", () => {
    const lines = [line({ id: "lu", projectId: "pConflict", assetId: null })];
    const units = [
      unit({ id: "u1", lineItemId: "lu", assetId: "a1", status: "CHECKED_OUT" }),
      unit({ id: "u2", lineItemId: "lu", assetId: "a2", status: "RETURNED" }), // excluded
    ];
    const map = buildOverlapByAsset(new Set(["a1", "a2"]), new Set(["pConflict"]), lines, units);
    expect(map.get("a1")).toEqual({ id: "lu", projectId: "pConflict" });
    expect(map.has("a2")).toBe(false);
  });

  it("ignores assets outside the candidate set or off the conflict projects", () => {
    const lines = [
      line({ id: "l1", projectId: "pConflict", assetId: "a9" }), // not in assetIds
      line({ id: "l2", projectId: "pElsewhere", assetId: "a1" }), // not a conflict project
    ];
    const map = buildOverlapByAsset(new Set(["a1"]), new Set(["pConflict"]), lines, []);
    expect(map.size).toBe(0);
  });
});

describe("filterSwapCandidateAssets", () => {
  it("keeps same-model bookable assets, drops kit/retired/lost/inactive/other-model", () => {
    const assets = [
      asset({ id: "ok", modelId: "m1" }),
      asset({ id: "wrongModel", modelId: "m2" }),
      asset({ id: "kit", modelId: "m1", kitId: "k1" }),
      asset({ id: "retired", modelId: "m1", status: "RETIRED" }),
      asset({ id: "lost", modelId: "m1", status: "LOST" }),
      asset({ id: "inactive", modelId: "m1", isActive: false }),
    ];
    expect(filterSwapCandidateAssets(assets, "m1").map((a) => a.id)).toEqual(["ok"]);
  });

  it("treats isActive === undefined as active (isActive !== false)", () => {
    const a = asset({ id: "u", modelId: "m1" });
    delete (a as Record<string, unknown>).isActive;
    expect(filterSwapCandidateAssets([a], "m1").map((x) => x.id)).toEqual(["u"]);
  });
});

describe("collectBookedAssetIds", () => {
  it("collects booked-elsewhere candidates from lines + units, excluding the swapped line item", () => {
    const lines = [
      line({ id: "lself", projectId: "pConflict", assetId: "a1" }), // excluded (the line being swapped)
      line({ id: "lbooked", projectId: "pConflict", assetId: "a2" }),
      line({ id: "lcancel", projectId: "pConflict", assetId: "a3", status: "CANCELLED" }),
      line({ id: "lparent", projectId: "pConflict", assetId: null }),
    ];
    const units = [
      unit({ id: "uself", lineItemId: "lself", assetId: "a4" }), // excluded by lineItemId
      unit({ id: "ubooked", lineItemId: "lparent", assetId: "a5" }),
      unit({ id: "uret", lineItemId: "lparent", assetId: "a6", status: "RETURNED" }), // excluded
    ];
    const booked = collectBookedAssetIds(
      new Set(["a1", "a2", "a3", "a4", "a5", "a6"]),
      new Set(["pConflict"]),
      "lself",
      lines,
      units,
    );
    expect([...booked].sort()).toEqual(["a2", "a5"]);
  });

  it("ignores bookings on non-conflict projects", () => {
    const lines = [line({ id: "l1", projectId: "pElsewhere", assetId: "a1" })];
    const booked = collectBookedAssetIds(
      new Set(["a1"]),
      new Set(["pConflict"]),
      "lother",
      lines,
      [],
    );
    expect(booked.size).toBe(0);
  });
});

describe("toConflictProject", () => {
  it("maps epoch-ms windows to Date and null status to empty string", () => {
    const p = project({ id: "p2", status: null as unknown as string, rentalStartDate: day(1), rentalEndDate: day(2) });
    const out = toConflictProject(p);
    expect(out.status).toBe("");
    expect(out.rentalStartDate).toBeInstanceOf(Date);
    expect(out.rentalStartDate?.getTime()).toBe(day(1));
  });

  it("maps a null window to null dates", () => {
    const p = project({ id: "p3", rentalStartDate: null, rentalEndDate: null });
    const out = toConflictProject(p);
    expect(out.rentalStartDate).toBeNull();
    expect(out.rentalEndDate).toBeNull();
  });
});
