import { describe, it, expect } from "vitest";

import { whereaboutsOf, whereaboutsText, type WhereaboutsInput } from "./asset-whereabouts";

const line = (over: Partial<WhereaboutsInput["lineItems"][number]> = {}) => ({
  id: "li1", projectId: "p1", type: "EQUIPMENT", status: "CHECKED_OUT", returnedAt: null,
  project: { name: "Hilton gala", projectNumber: "#2341" }, ...over,
});
const asset = (over: Partial<WhereaboutsInput> = {}): WhereaboutsInput => ({
  status: "AVAILABLE", location: { name: "Warehouse A" }, lineItems: [], ...over,
});
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

describe("whereaboutsOf", () => {
  it("deployed: the line that is out and not returned, over an older returned one", () => {
    const w = whereaboutsOf(asset({ status: "CHECKED_OUT", lineItems: [line({ id: "old", returnedAt: new Date() }), line({ id: "now" })] }));
    expect(w).toMatchObject({ kind: "deployed", job: { lineItemId: "now", projectId: "p1" } });
    expect(whereaboutsText(w, label)).toBe("Out on Hilton gala · #2341");
  });

  it("deployed but the line is gone: falls through to status", () => {
    expect(whereaboutsOf(asset({ status: "CHECKED_OUT" })).kind).toBe("status");
  });

  it("maintenance and available keep the home location, available says when there is none", () => {
    expect(whereaboutsText(whereaboutsOf(asset({ status: "IN_MAINTENANCE" })), label)).toBe("In maintenance · home: Warehouse A");
    expect(whereaboutsText(whereaboutsOf(asset()), label)).toBe("Available · Warehouse A");
    expect(whereaboutsText(whereaboutsOf(asset({ location: null })), label)).toBe("Available · no home location set");
  });

  it("sold (WS11): the SALE line, non-cancelled preferred", () => {
    const w = whereaboutsOf(asset({ status: "SOLD", lineItems: [line({ id: "c", type: "SALE", status: "CANCELLED" }), line({ id: "s", type: "SALE", status: "RETURNED" })] }));
    expect(w).toMatchObject({ kind: "sold", job: { lineItemId: "s" } });
    expect(whereaboutsText(w, label)).toBe("Sold on Hilton gala · #2341");
    expect(whereaboutsOf(asset({ status: "SOLD" })).kind).toBe("status");
  });

  it("retired and lost print the status and the home", () => {
    expect(whereaboutsText(whereaboutsOf(asset({ status: "RETIRED" })), label)).toBe("retired · Warehouse A");
    expect(whereaboutsText(whereaboutsOf(asset({ status: "LOST", location: null })), label)).toBe("lost");
  });
});
