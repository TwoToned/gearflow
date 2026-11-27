import { describe, expect, test, vi } from "vitest";

import { bulkCapMessage, bulkToastTitle, MAX_FINANCE_BULK, runBulk } from "./finance-bulk";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `INV-${i}` }));

describe("runBulk", () => {
  test("is capped at 50 rows", async () => {
    const run = vi.fn(async () => {});
    const out = await runBulk(rows(80), () => null, run);
    expect(MAX_FINANCE_BULK).toBe(50);
    expect(run).toHaveBeenCalledTimes(50);
    expect(out.done).toBe(50);
  });
  test("names what it skipped and why, and does not call the write for an ineligible row", async () => {
    const run = vi.fn(async () => {});
    const out = await runBulk(rows(3), (r) => (r.id === "r1" ? "only a draft can be deleted" : null), run);
    expect(out.skipped).toEqual([{ name: "INV-1", why: "only a draft can be deleted" }]);
    expect(run).toHaveBeenCalledTimes(2);
  });
  test("a server refusal on one row becomes that row's skip, the rest still run", async () => {
    const out = await runBulk(rows(3), () => null, async (r) => {
      if (r.id === "r0") throw new Error("not permitted");
    });
    expect(out.done).toBe(2);
    expect(out.skipped).toEqual([{ name: "INV-0", why: "not permitted" }]);
  });
  test("a non-Error throw gets a generic reason", async () => {
    const out = await runBulk(rows(1), () => null, async () => {
      throw "x";
    });
    expect(out.skipped[0].why).toBe("Couldn't be done");
  });
});

describe("messages", () => {
  test("cap message only past 50", () => {
    expect(bulkCapMessage(50)).toBeNull();
    expect(bulkCapMessage(51)).toContain("at most 50");
  });
  test("nothing done names the first skip; partial names it via the list-write title", () => {
    expect(bulkToastTitle("Deleted", "draft", { done: 0, skipped: [{ name: "INV-9", why: "x" }] })).toBe("Nothing changed · INV-9: x");
    expect(bulkToastTitle("Deleted", "draft", { done: 2, skipped: [{ name: "INV-9", why: "x" }] })).toContain("INV-9");
  });
});
