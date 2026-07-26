// @vitest-environment node
//
// convex/lib/availabilityCore.ts — the availability CORE for the native line-item
// mutations. Two guarantees:
//  (a) The pure stock math (computeStockBreakdown / resolveModelAssetType) is a
//      byte-for-byte duplicate of src/lib/overbooking-core.ts — PINNED here by a
//      cross-import equality matrix (same pattern as reservationConflicts.test.ts).
//  (b) computeModelAvailability mirrors the server-side model-path math
//      (src/server/line-items.ts == checkAvailability) over the key fixtures.
import { describe, test, expect } from "vitest";
import {
  computeStockBreakdown as coreStock,
  resolveModelAssetType as coreType,
  computeModelAvailability,
  type ModelAvailabilityBundle,
} from "./lib/availabilityCore";
import {
  computeStockBreakdown as origStock,
  resolveModelAssetType as origType,
} from "@/lib/overbooking-core";

// ─── (a) cross-import equality — pins the duplication ─────────────────────────

describe("availabilityCore stock math == overbooking-core (byte-for-byte pin)", () => {
  test("resolveModelAssetType matches the original over every combo", () => {
    for (const assetType of [undefined, null, "SERIALIZED", "BULK", "OTHER", ""]) {
      for (const hasBulk of [true, false]) {
        for (const hasAssets of [true, false]) {
          expect(coreType(assetType, hasBulk, hasAssets)).toBe(origType(assetType, hasBulk, hasAssets));
        }
      }
    }
  });

  test("computeStockBreakdown matches the original over SERIALIZED/BULK/mixed/empty/all-unavailable", () => {
    const matrices: Array<Parameters<typeof coreStock>[0]> = [
      // SERIALIZED — empty
      { assetType: "SERIALIZED", assets: [], bulkAssets: [] },
      // SERIALIZED — all available
      { assetType: "SERIALIZED", assets: [{ status: "AVAILABLE" }, { status: "CHECKED_OUT" }, { status: "RESERVED" }], bulkAssets: [] },
      // SERIALIZED — all unavailable (maintenance / lost / retired)
      { assetType: "SERIALIZED", assets: [{ status: "IN_MAINTENANCE" }, { status: "LOST" }, { status: "RETIRED" }], bulkAssets: [] },
      // SERIALIZED — mixed
      { assetType: "SERIALIZED", assets: [{ status: "AVAILABLE" }, { status: "IN_MAINTENANCE" }, { status: "AVAILABLE" }, { status: "RETIRED" }], bulkAssets: [] },
      // BULK — several quantities
      { assetType: "BULK", assets: [], bulkAssets: [{ totalQuantity: 10 }, { totalQuantity: 5 }] },
      // BULK — empty
      { assetType: "BULK", assets: [], bulkAssets: [] },
      // BULK — with (ignored) serialized assets present
      { assetType: "BULK", assets: [{ status: "AVAILABLE" }], bulkAssets: [{ totalQuantity: 7 }] },
    ];
    for (const m of matrices) {
      expect(coreStock(m)).toEqual(origStock(m));
    }
  });
});

// ─── (b) computeModelAvailability fixtures ────────────────────────────────────

type L = { projectId: string; quantity?: number; status?: string; subHireId?: string | null };
type P = { id: string; rentalStartDate?: number | null; rentalEndDate?: number | null; status?: string; isTemplate?: boolean };

function mkBundle(opts: {
  assetType?: "SERIALIZED" | "BULK";
  assets?: { status?: string }[];
  bulks?: { totalQuantity?: number }[];
  lines?: L[];
  projects?: P[];
  model?: null;
}): ModelAvailabilityBundle {
  return {
    model: opts.model === null ? null : ({ assetType: opts.assetType ?? "SERIALIZED" } as never),
    activeAssets: (opts.assets ?? []) as never,
    activeBulkAssets: (opts.bulks ?? []) as never,
    lines: (opts.lines ?? []) as never,
    projects: (opts.projects ?? []) as never,
  };
}

const START = 1_000;
const END = 2_000;

describe("computeModelAvailability", () => {
  test("dateless: only THIS project's bookings count", () => {
    const b = mkBundle({
      assets: [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }],
      lines: [
        { projectId: "thisP", quantity: 2 },
        { projectId: "otherP", quantity: 5 }, // ignored — no dates, not this project
      ],
    });
    const r = computeModelAvailability(b, { rentalStart: null, rentalEnd: null, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ totalStock: 3, effectiveStock: 3, booked: 2, available: 1, assetType: "SERIALIZED" });
  });

  test("dated: overlapping bookings across projects (incl. this project) count", () => {
    const b = mkBundle({
      assets: [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }],
      lines: [
        { projectId: "thisP", quantity: 2 },
        { projectId: "otherP", quantity: 5 },
      ],
      projects: [
        { id: "thisP", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED" },
        { id: "otherP", rentalStartDate: START + 100, rentalEndDate: END + 100, status: "CONFIRMED" },
      ],
    });
    const r = computeModelAvailability(b, { rentalStart: START, rentalEnd: END, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ totalStock: 3, booked: 7, available: 0 });
  });

  test("SERIALIZED effectiveStock reduced by IN_MAINTENANCE / LOST / RETIRED", () => {
    const b = mkBundle({
      assets: [
        { status: "AVAILABLE" }, { status: "AVAILABLE" },
        { status: "IN_MAINTENANCE" }, { status: "LOST" }, { status: "RETIRED" },
      ],
    });
    const r = computeModelAvailability(b, { rentalStart: null, rentalEnd: null, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ totalStock: 5, effectiveStock: 2, unavailable: 3, booked: 0, available: 2 });
  });

  test("BULK: availability from summed totalQuantity", () => {
    const b = mkBundle({
      assetType: "BULK",
      bulks: [{ totalQuantity: 10 }, { totalQuantity: 4 }],
      lines: [{ projectId: "thisP", quantity: 3 }],
      projects: [{ id: "thisP", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED" }],
    });
    const r = computeModelAvailability(b, { rentalStart: START, rentalEnd: END, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ totalStock: 14, effectiveStock: 14, unavailable: 0, booked: 3, available: 11, assetType: "BULK" });
  });

  // Regression: issue #801 — a model created via model-form.tsx keeps the
  // create form's explicit "SERIALIZED" default unless someone deliberately
  // switches the Asset type selector to Bulk, even when it's stocked
  // exclusively with bulk assets. Before the fix, `assetType: "SERIALIZED"`
  // was PRESENT (not absent), so the undefined-only fallback in
  // resolveModelAssetType never kicked in, and this bulk-only model showed
  // `available: 0` no matter how much real bulk stock existed.
  test("BULK-only model mislabeled SERIALIZED (model-form.tsx default) still reports real bulk availability", () => {
    const b = mkBundle({
      assetType: "SERIALIZED", // the model-form.tsx create default — never switched to Bulk
      assets: [], // zero serialized assets — this model only ever held bulk stock
      bulks: [{ totalQuantity: 10 }],
      lines: [{ projectId: "thisP", quantity: 3 }],
      projects: [{ id: "thisP", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED" }],
    });
    const r = computeModelAvailability(b, { rentalStart: START, rentalEnd: END, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ totalStock: 10, effectiveStock: 10, unavailable: 0, booked: 3, available: 7, assetType: "BULK" });
  });

  test("dated: CANCELLED lines + sub-hire lines are excluded from booked", () => {
    const b = mkBundle({
      assets: [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }],
      lines: [
        { projectId: "thisP", quantity: 5, status: "CANCELLED" },
        { projectId: "thisP", quantity: 3, subHireId: "sh1" },
        { projectId: "thisP", quantity: 2, status: "CONFIRMED" },
      ],
      projects: [{ id: "thisP", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED" }],
    });
    const r = computeModelAvailability(b, { rentalStart: START, rentalEnd: END, excludeProjectId: "thisP" });
    expect(r).toMatchObject({ booked: 2, available: 1 });
  });

  test("dated: template + dead-status projects are excluded from booked", () => {
    const b = mkBundle({
      assets: [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }],
      lines: [
        { projectId: "tmpl", quantity: 4 },
        { projectId: "dead", quantity: 4 },
        { projectId: "live", quantity: 2 },
      ],
      projects: [
        { id: "tmpl", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED", isTemplate: true },
        { id: "dead", rentalStartDate: START, rentalEndDate: END, status: "CANCELLED" },
        { id: "live", rentalStartDate: START, rentalEndDate: END, status: "CONFIRMED" },
      ],
    });
    const r = computeModelAvailability(b, { rentalStart: START, rentalEnd: END, excludeProjectId: "live" });
    expect(r).toMatchObject({ booked: 2, available: 1 });
  });
});
