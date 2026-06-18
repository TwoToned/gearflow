import { describe, it, expect } from "vitest";
import {
  mapWooCommerceOrderLog,
  filterAndSortOrderLogs,
} from "@/lib/woocommerce-order-logs-read";
import type { Doc } from "../../convex/_generated/dataModel";

type Raw = Doc<"wooCommerceOrderLogs">;

function raw(p: Partial<Raw>): Raw {
  return {
    _id: "x" as Raw["_id"],
    _creationTime: 0,
    id: "l",
    organizationId: "org",
    wooOrderId: 1,
    status: "RECEIVED",
    payload: {},
    ...p,
  } as Raw;
}

function row(p: { id?: string; status?: string; createdAt?: number }) {
  return mapWooCommerceOrderLog(raw(p as Partial<Raw>), null);
}

describe("mapWooCommerceOrderLog", () => {
  it("maps epoch-ms createdAt to Date, absent optionals to null, attaches project", () => {
    const out = mapWooCommerceOrderLog(
      raw({
        id: "l1",
        wooOrderId: 42,
        wooOrderNumber: "WEB-42",
        status: "COMPLETED",
        projectId: "p1",
        clientId: "c1",
        errorMessage: undefined,
        matchResults: [{ a: 1 }],
        dateExtraction: undefined,
        createdAt: 5000,
      }),
      { id: "p1", projectNumber: "WEB-42", name: "Order" },
    );
    expect(out.id).toBe("l1");
    expect(out.wooOrderNumber).toBe("WEB-42");
    expect(out.errorMessage).toBeNull();
    expect(out.dateExtraction).toBeNull();
    expect(out.matchResults).toEqual([{ a: 1 }]);
    expect(out.createdAt).toEqual(new Date(5000));
    expect(out.project).toEqual({ id: "p1", projectNumber: "WEB-42", name: "Order" });
  });

  it("maps absent createdAt to null and null project", () => {
    const out = mapWooCommerceOrderLog(raw({ createdAt: undefined }), null);
    expect(out.createdAt).toBeNull();
    expect(out.project).toBeNull();
  });
});

describe("filterAndSortOrderLogs", () => {
  it("filters by status when given", () => {
    const rows = [
      row({ id: "a", status: "FAILED", createdAt: 1 }),
      row({ id: "b", status: "COMPLETED", createdAt: 2 }),
      row({ id: "c", status: "FAILED", createdAt: 3 }),
    ];
    const out = filterAndSortOrderLogs(rows, "FAILED");
    expect(out.map((r) => r.id)).toEqual(["c", "a"]); // createdAt desc
  });

  it("returns all rows sorted createdAt desc when no status filter", () => {
    const rows = [
      row({ id: "a", createdAt: 100 }),
      row({ id: "b", createdAt: 300 }),
      row({ id: "c", createdAt: 200 }),
    ];
    expect(filterAndSortOrderLogs(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("treats absent createdAt as oldest", () => {
    const rows = [
      row({ id: "a", createdAt: undefined }),
      row({ id: "b", createdAt: 10 }),
    ];
    expect(filterAndSortOrderLogs(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});
