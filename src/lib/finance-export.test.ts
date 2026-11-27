import { describe, expect, test } from "vitest";

import { invoicesCsv, quotesCsv } from "./finance-export";

type Q = Parameters<typeof quotesCsv>[0][number];
type I = Parameters<typeof invoicesCsv>[0][number];
const quote = (o: Partial<Q> = {}) =>
  ({ version: 2, status: "SENT", sentAt: Date.UTC(2026, 10, 3, 12), validUntil: Date.UTC(2026, 11, 3, 12), total: 1234.5, project: { projectNumber: "#10", name: "Gig", clientName: "Acme" }, ...o }) as Q;
const invoice = (o: Partial<I> = {}) =>
  ({ invoiceNumber: "INV-1", kind: "FULL", pillLabel: "Overdue", issuedAt: Date.UTC(2026, 10, 3, 12), dueDate: null, total: 100, outstanding: 40, xero: null, project: { projectNumber: "#10", clientName: "Acme" }, ...o }) as I;

describe("exports", () => {
  test("money columns exist only when the server sent money (absent, never zeros)", () => {
    expect(quotesCsv([quote()]).split("\n")[0]).toContain("Total");
    const hidden = quotesCsv([quote({ total: undefined })]);
    expect(hidden.split("\n")[0]).not.toContain("Total");
    expect(hidden).not.toContain("0.00");
    const ih = invoicesCsv([invoice({ total: undefined, outstanding: undefined })]);
    expect(ih.split("\n")[0]).not.toMatch(/Total|Still owed/);
  });
  test("prints the server's figures to the cent", () => {
    expect(quotesCsv([quote()])).toContain("1234.50");
    expect(invoicesCsv([invoice()])).toMatch(/100\.00.*40\.00/);
  });
  test("formula guard: a client or job name starting with = + @ is neutralised", () => {
    for (const evil of ["=HYPERLINK(1)", "+1", "@SUM"]) {
      const csv = quotesCsv([quote({ project: { projectNumber: "#1", name: evil, clientName: evil } as Q["project"] })]);
      const cells = csv.split("\n")[1].split(",");
      expect(cells.some((c) => c.replace(/^"/, "").startsWith(evil))).toBe(false);
    }
  });
  test("dates are in the org timezone", () => {
    const at = Date.UTC(2026, 10, 3, 20); // 07:00 on the 4th in Sydney
    expect(quotesCsv([quote({ sentAt: at })], "Australia/Sydney")).toContain("2026-11-04");
    expect(quotesCsv([quote({ sentAt: at })], "UTC")).toContain("2026-11-03");
  });
});
