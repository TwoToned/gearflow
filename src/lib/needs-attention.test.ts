import { describe, expect, it } from "vitest";
import { buildNeedsAttentionLines, type NeedsAttentionInput } from "@/lib/needs-attention";
import { canOpenLink } from "@/lib/dashboard-links";
import { rolePermissions } from "@/lib/permissions";

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;

const FULL: NeedsAttentionInput = {
  blockers: [{ projectId: "p1" }, { projectId: "p2" }],
  stats: { overdueReturnJobs: 2, overdueTruncated: false },
  maintenance: { maintenanceDue: 2, modelsDueForService: 1 },
  subHireOverdue: 1,
  overbookings: { hardCount: 0, pencilledCount: 1, saleStockCount: 0 },
  crewOffers: 3,
  finance: { overdueCount: 2, overdueOutstanding: 16975, overdueTruncated: false, expiringCount: 1, quotesOutCount: 6 },
  overdueTileOnBoard: false,
  canOpen: () => true,
  formatMoney: money,
};

const keys = (i: NeedsAttentionInput) => buildNeedsAttentionLines(i).map((l) => l.key);

describe("buildNeedsAttentionLines", () => {
  it("lists every non-zero source in a fixed order; zeros are absent", () => {
    expect(keys(FULL)).toEqual([
      "blockers",
      "overdueReturns",
      "subHireOverdue",
      "invoicesOverdue",
      "pencilled",
      "maintenanceDue",
      "modelsDue",
      "crewOffers",
      "quotesExpiring",
      "quotesOut",
    ]);
  });

  it("a capped maintenance read prints n+ on its lines", () => {
    const lines = buildNeedsAttentionLines({ ...FULL, maintenance: { maintenanceDue: 1000, modelsDueForService: 3, maintenanceTruncated: true } });
    expect(lines.find((l) => l.key === "maintenanceDue")?.count).toBe("1000+");
    expect(lines.find((l) => l.key === "modelsDue")?.count).toBe("3+");
  });

  it("words the figure separately, singular vs plural", () => {
    const lines = buildNeedsAttentionLines(FULL);
    const by = (k: string) => lines.find((l) => l.key === k)!;
    expect(by("blockers")).toMatchObject({ count: "2", text: "blockers need you", tone: "error", link: { href: "/projects/p1" } });
    expect(by("modelsDue")).toMatchObject({ count: "1", text: "model due for service" });
    expect(by("overdueReturns").link.href).toBe("/projects?overdue=1");
  });

  it("D88: overdue invoices carry what is still owed, labelled outstanding", () => {
    const inv = buildNeedsAttentionLines(FULL).find((l) => l.key === "invoicesOverdue")!;
    expect(inv).toMatchObject({ count: "2", text: "invoices overdue", detail: "$16,975 outstanding", link: { href: "/finance" } });
  });

  it("a truncated count prints n+, never a wrong exact number", () => {
    const lines = buildNeedsAttentionLines({
      ...FULL,
      stats: { overdueReturnJobs: 500, overdueTruncated: true },
      finance: { ...FULL.finance!, overdueTruncated: true },
    });
    expect(lines.find((l) => l.key === "overdueReturns")!.count).toBe("500+");
    expect(lines.find((l) => l.key === "invoicesOverdue")!.count).toBe("2+");
  });

  it("suppresses the overdue-returns line while its stat tile is on the board", () => {
    expect(keys({ ...FULL, overdueTileOnBoard: true })).not.toContain("overdueReturns");
  });

  it("a skipped source (role can't open it) has no line at all", () => {
    const k = keys({ ...FULL, finance: undefined, maintenance: undefined, subHireOverdue: undefined });
    expect(k).not.toContain("invoicesOverdue");
    expect(k).not.toContain("quotesOut");
    expect(k).not.toContain("maintenanceDue");
    expect(k).not.toContain("subHireOverdue");
    expect(k).toContain("blockers");
  });

  it("all clear is an empty list", () => {
    expect(buildNeedsAttentionLines({ overdueTileOnBoard: false, canOpen: () => true, formatMoney: money })).toEqual([]);
  });

  it("a line whose TARGET the role can't open is absent, even with its count read (sub-hires open Suppliers)", () => {
    const subHireOnly = { ...rolePermissions.member, supplier: [] };
    const k = keys({ ...FULL, canOpen: (link) => canOpenLink(link, subHireOnly) });
    expect(k).not.toContain("subHireOverdue");
    expect(k).toContain("blockers");
    // With the real member role every line's target opens.
    expect(keys({ ...FULL, canOpen: (link) => canOpenLink(link, rolePermissions.member) })).toContain("subHireOverdue");
  });

  it("an overdue invoice with nothing owed has no detail", () => {
    const inv = buildNeedsAttentionLines({ ...FULL, finance: { ...FULL.finance!, overdueOutstanding: 0 } }).find(
      (l) => l.key === "invoicesOverdue",
    )!;
    expect(inv.detail).toBeUndefined();
  });
});
