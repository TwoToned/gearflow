import { describe, it, expect } from "vitest";
import {
  mapMaintenanceRecord,
  filterMaintenanceRecords,
  sortMaintenanceRecords,
  type MaintenanceJoinData,
  type MaintenanceRecordRow,
} from "./maintenance-read";

// Minimal Convex-doc factory (only the fields the mapper reads).
function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "convex_internal_id" as never,
    _creationTime: 1_700_000_000_000,
    id: "rec_1",
    organizationId: "org_1",
    type: "REPAIR",
    status: "IN_PROGRESS",
    title: "Fix amp",
    createdAt: 1_700_000_100_000,
    updatedAt: 1_700_000_200_000,
    ...overrides,
  } as never;
}

describe("mapMaintenanceRecord", () => {
  it("converts epoch-ms date fields to Date and strips Convex internals", () => {
    const r = mapMaintenanceRecord(
      doc({
        scheduledDate: 1_700_000_300_000,
        completedDate: 1_700_000_400_000,
        nextDueDate: 1_700_000_500_000,
      }),
    );
    expect(r.scheduledDate).toBeInstanceOf(Date);
    expect(r.scheduledDate?.getTime()).toBe(1_700_000_300_000);
    expect(r.completedDate?.getTime()).toBe(1_700_000_400_000);
    expect(r.nextDueDate?.getTime()).toBe(1_700_000_500_000);
    expect(r.createdAt.getTime()).toBe(1_700_000_100_000);
    expect(r.updatedAt.getTime()).toBe(1_700_000_200_000);
    // _id / _creationTime are not on the typed result shape.
    expect((r as unknown as Record<string, unknown>)._id).toBeUndefined();
    expect((r as unknown as Record<string, unknown>)._creationTime).toBeUndefined();
  });

  it("normalises absent optionals to null", () => {
    const r = mapMaintenanceRecord(doc());
    expect(r.kitId).toBeNull();
    expect(r.projectId).toBeNull();
    expect(r.description).toBeNull();
    expect(r.reportedById).toBeNull();
    expect(r.assignedToId).toBeNull();
    expect(r.scheduledDate).toBeNull();
    expect(r.completedDate).toBeNull();
    expect(r.nextDueDate).toBeNull();
    expect(r.cost).toBeNull();
    expect(r.partsUsed).toBeNull();
    expect(r.result).toBeNull();
  });

  it("coerces Prisma-defaulted columns non-null (status / arrays)", () => {
    const r = mapMaintenanceRecord(doc({ status: undefined }));
    expect(r.status).toBe("SCHEDULED");
    expect(r.attachments).toEqual([]);
    expect(r.photos).toEqual([]);
    expect(r.tags).toEqual([]);
  });

  it("keeps cost as a number (Convex stores it numeric)", () => {
    const r = mapMaintenanceRecord(doc({ cost: 123.45 }));
    expect(r.cost).toBe(123.45);
  });

  it("falls back to _creationTime when createdAt/updatedAt are absent", () => {
    const r = mapMaintenanceRecord(doc({ createdAt: undefined, updatedAt: undefined }));
    expect(r.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(r.updatedAt.getTime()).toBe(1_700_000_000_000);
  });
});

// ─── filter ──────────────────────────────────────────────────────────────────

function row(overrides: Partial<MaintenanceRecordRow> = {}): MaintenanceRecordRow {
  return {
    id: "r1",
    organizationId: "org_1",
    kitId: null,
    projectId: null,
    type: "REPAIR",
    status: "SCHEDULED",
    title: "Generic title",
    description: null,
    reportedById: null,
    assignedToId: null,
    scheduledDate: null,
    completedDate: null,
    cost: null,
    partsUsed: null,
    attachments: [],
    photos: [],
    result: null,
    nextDueDate: null,
    tags: [],
    incidentType: null,
    incidentSeverity: null,
    lineItemId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const emptyJoin: MaintenanceJoinData = { assetIds: [], assetTags: [], modelNames: [] };

function joinMap(entries: Record<string, MaintenanceJoinData>): Map<string, MaintenanceJoinData> {
  return new Map(Object.entries(entries));
}

describe("filterMaintenanceRecords", () => {
  it("filters by status and type", () => {
    const records = [
      row({ id: "a", status: "SCHEDULED", type: "REPAIR" }),
      row({ id: "b", status: "COMPLETED", type: "REPAIR" }),
      row({ id: "c", status: "SCHEDULED", type: "CLEANING" }),
    ];
    const jm = joinMap({ a: emptyJoin, b: emptyJoin, c: emptyJoin });
    expect(filterMaintenanceRecords(records, jm, { status: "SCHEDULED" }).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
    expect(
      filterMaintenanceRecords(records, jm, { status: "SCHEDULED", type: "REPAIR" }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("filters by assetId via the join data", () => {
    const records = [row({ id: "a" }), row({ id: "b" })];
    const jm = joinMap({
      a: { assetIds: ["asset_x"], assetTags: [], modelNames: [] },
      b: { assetIds: ["asset_y"], assetTags: [], modelNames: [] },
    });
    expect(filterMaintenanceRecords(records, jm, { assetId: "asset_x" }).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  it("search matches title, description, asset tag, and model name (case-insensitive)", () => {
    const records = [
      row({ id: "title", title: "Replace XLR cable" }),
      row({ id: "desc", description: "Loose XLR connector" }),
      row({ id: "tag" }),
      row({ id: "model" }),
      row({ id: "none", title: "unrelated" }),
    ];
    const jm = joinMap({
      title: emptyJoin,
      desc: emptyJoin,
      tag: { assetIds: [], assetTags: ["XLR-001"], modelNames: [] },
      model: { assetIds: [], assetTags: [], modelNames: ["XLR Snake"] },
      none: emptyJoin,
    });
    const hits = filterMaintenanceRecords(records, jm, { search: "xlr" }).map((r) => r.id);
    expect(hits.sort()).toEqual(["desc", "model", "tag", "title"]);
  });
});

// ─── sort ──────────────────────────────────────────────────────────────────

describe("sortMaintenanceRecords", () => {
  it("default order: status (declared rank) then scheduledDate asc (NULLS LAST)", () => {
    const records = [
      row({ id: "completed", status: "COMPLETED", scheduledDate: new Date(100) }),
      row({ id: "sched-null", status: "SCHEDULED", scheduledDate: null }),
      row({ id: "sched-early", status: "SCHEDULED", scheduledDate: new Date(50) }),
      row({ id: "inprog", status: "IN_PROGRESS", scheduledDate: new Date(10) }),
    ];
    expect(sortMaintenanceRecords(records).map((r) => r.id)).toEqual([
      "sched-early", // SCHEDULED rank 0, earliest date
      "sched-null", // SCHEDULED rank 0, null date last
      "inprog", // IN_PROGRESS rank 2
      "completed", // COMPLETED rank 4
    ]);
  });

  it("explicit sortBy=type asc uses declared enum order, not alphabetical", () => {
    const records = [
      row({ id: "cleaning", type: "CLEANING" }),
      row({ id: "repair", type: "REPAIR" }),
      row({ id: "inspection", type: "INSPECTION" }),
    ];
    // Declared order: REPAIR(0) < INSPECTION(3) < CLEANING(4) — NOT alphabetical.
    expect(sortMaintenanceRecords(records, "type", "asc").map((r) => r.id)).toEqual([
      "repair",
      "inspection",
      "cleaning",
    ]);
  });

  it("explicit sortBy with desc reverses and puts NULLS FIRST", () => {
    const records = [
      row({ id: "has", scheduledDate: new Date(50) }),
      row({ id: "null", scheduledDate: null }),
      row({ id: "later", scheduledDate: new Date(100) }),
    ];
    expect(sortMaintenanceRecords(records, "scheduledDate", "desc").map((r) => r.id)).toEqual([
      "null", // NULLS FIRST on desc
      "later",
      "has",
    ]);
  });

  it("sortBy=title is a plain string compare", () => {
    const records = [row({ id: "b", title: "Beta" }), row({ id: "a", title: "Alpha" })];
    expect(sortMaintenanceRecords(records, "title", "asc").map((r) => r.id)).toEqual(["a", "b"]);
  });
});
