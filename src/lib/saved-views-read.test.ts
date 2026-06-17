import { describe, it, expect } from "vitest";
import {
  mapSavedView,
  filterAndSortSavedViews,
  type SavedTableViewRow,
} from "@/lib/saved-views-read";

describe("saved-views-read mapper", () => {
  it("converts epoch-ms timestamps to Date and passes config through", () => {
    const m = mapSavedView({
      id: "v1",
      organizationId: "org",
      userId: "u1",
      tableId: "assets",
      name: "Overdue",
      config: { filters: { status: ["OVERDUE"] }, pageSize: 25 },
      isDefault: true,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_500_000,
    } as never);

    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.createdAt?.getTime()).toBe(1_700_000_000_000);
    expect(m.updatedAt?.getTime()).toBe(1_700_000_500_000);
    expect(m.isDefault).toBe(true);
    // JSON column passes through untouched.
    expect(m.config).toEqual({ filters: { status: ["OVERDUE"] }, pageSize: 25 });
  });

  it("coerces absent Prisma-defaulted/optional fields", () => {
    const m = mapSavedView({
      id: "v2",
      organizationId: "org",
      userId: "u1",
      tableId: "projects",
      name: "Active",
      config: undefined,
      // isDefault / createdAt / updatedAt absent
    } as never);

    expect(m.isDefault).toBe(false);
    expect(m.config).toEqual({});
    expect(m.createdAt).toBeNull();
    expect(m.updatedAt).toBeNull();
  });
});

describe("saved-views-read filterAndSortSavedViews", () => {
  const make = (over: Partial<SavedTableViewRow>): SavedTableViewRow => ({
    id: Math.random().toString(36).slice(2),
    organizationId: "org",
    userId: "u1",
    tableId: "assets",
    name: "x",
    config: {},
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    ...over,
  });

  it("filters to the given user + table", () => {
    const rows = [
      make({ userId: "u1", tableId: "assets", name: "Mine" }),
      make({ userId: "u2", tableId: "assets", name: "Theirs" }),
      make({ userId: "u1", tableId: "projects", name: "OtherTable" }),
    ];
    const out = filterAndSortSavedViews(rows, "u1", "assets");
    expect(out.map((v) => v.name)).toEqual(["Mine"]);
  });

  it("orders default-first then name ascending", () => {
    const rows = [
      make({ name: "Bravo", isDefault: false }),
      make({ name: "Alpha", isDefault: false }),
      make({ name: "Zulu", isDefault: true }),
    ];
    const out = filterAndSortSavedViews(rows, "u1", "assets");
    expect(out.map((v) => v.name)).toEqual(["Zulu", "Alpha", "Bravo"]);
    expect(out[0].isDefault).toBe(true);
  });

  it("returns an empty array when nothing matches (no Prisma fallback)", () => {
    const rows = [make({ userId: "u9", tableId: "clients" })];
    expect(filterAndSortSavedViews(rows, "u1", "assets")).toEqual([]);
  });
});
