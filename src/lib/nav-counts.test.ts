import { describe, expect, it } from "vitest";
import { formatNavCount } from "@/lib/nav-counts";
import { ALL_NAV, moreSheetGroups } from "@/lib/nav";

describe("formatNavCount (§6d.6 More sheet words)", () => {
  it("totals read as a number, n+ when the read was capped, even at zero", () => {
    expect(formatNavCount("assets", { value: 605, truncated: false })).toEqual({ text: "605", tone: "muted" });
    expect(formatNavCount("locations", { value: 200, truncated: true })).toEqual({ text: "200+", tone: "muted" });
    expect(formatNavCount("clients", { value: 0, truncated: false })).toEqual({ text: "0", tone: "muted" });
  });

  it("exceptions read as words with a tone, and are absent at zero", () => {
    expect(formatNavCount("invoicesOverdue", { value: 1, truncated: false })).toEqual({ text: "1 overdue", tone: "error" });
    expect(formatNavCount("overbookings", { value: 5, truncated: false })).toEqual({ text: "5 overbooked", tone: "error" });
    expect(formatNavCount("returnsOverdue", { value: 2, truncated: false })).toEqual({ text: "2 overdue", tone: "warning" });
    expect(formatNavCount("testTagOverdue", { value: 0, truncated: false })).toBeNull();
  });

  it("maintenance: `20 open · 5 overdue`, `20 open`, or nothing", () => {
    expect(formatNavCount("maintenance", { value: 20, secondary: 5, truncated: false })).toEqual({ text: "20 open · 5 overdue", tone: "warning" });
    expect(formatNavCount("maintenance", { value: 20, secondary: 0, truncated: false })).toEqual({ text: "20 open", tone: "muted" });
    expect(formatNavCount("maintenance", { value: 0, truncated: false })).toBeNull();
  });

  it("loading (undefined) or not readable by the role (null) shows nothing", () => {
    expect(formatNavCount("assets", undefined)).toBeNull();
    expect(formatNavCount("assets", null)).toBeNull();
  });
});

describe("NAV count sources", () => {
  const rows = ALL_NAV.flatMap((i) => [i, ...(i.subs ?? [])]);

  it("a count source sits only on a gated row (it is counted under that row's own gate)", () => {
    for (const r of rows.filter((x) => x.count)) expect(r.resource, r.key).toBeDefined();
  });

  it("the §6d.6 rows carry their sources; Crew's is Phase 15's to attach (Q10)", () => {
    const by = Object.fromEntries(rows.filter((r) => r.count).map((r) => [r.key, r.count]));
    expect(by).toEqual({
      overbookings: "overbookings",
      finance: "invoicesOverdue",
      assets: "assets",
      "warehouse-returns": "returnsOverdue",
      "test-and-tag": "testTagOverdue",
      maintenance: "maintenance",
      clients: "clients",
      suppliers: "suppliers",
      locations: "locations",
    });
  });

  it("the More sheet rows pass the source through", () => {
    const more = moreSheetGroups(ALL_NAV).flatMap((g) => g.rows);
    expect(more.find((r) => r.key === "warehouse-returns")?.count).toBe("returnsOverdue");
    expect(more.find((r) => r.key === "assets")?.count).toBe("assets");
  });
});
