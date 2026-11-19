import { describe, expect, it } from "vitest";

import { runBulk } from "./bulk-run";
import { listWriteTitle } from "./list-write-toast";

describe("runBulk", () => {
  const rows = [{ n: "P-1" }, { n: "P-2" }, { n: "P-3" }];
  const name = (r: { n: string }) => r.n;

  it("applies every row that passes its gate and names the skipped ones", async () => {
    const applied: string[] = [];
    const out = await runBulk(rows, {
      name,
      gate: (r) => (r.n === "P-2" ? "already there" : null),
      apply: async (r) => void applied.push(r.n),
    });
    expect(applied).toEqual(["P-1", "P-3"]);
    expect(out.done.map(name)).toEqual(["P-1", "P-3"]);
    expect(out.skipped).toEqual([{ name: "P-2", why: "already there" }]);
  });

  it("one failing row is skipped with its message and the rest still run", async () => {
    const out = await runBulk(rows, {
      name,
      apply: async (r) => {
        if (r.n === "P-1") throw new Error("locked");
      },
    });
    expect(out.done.map(name)).toEqual(["P-2", "P-3"]);
    expect(out.skipped).toEqual([{ name: "P-1", why: "locked" }]);
  });
});

describe("listWriteTitle", () => {
  it("is the plain sentence when nothing was skipped", () => {
    expect(listWriteTitle("Set 3 jobs to Booked", [])).toBe("Set 3 jobs to Booked");
  });

  it("names up to four skipped rows and counts the rest", () => {
    const skipped = ["A", "B", "C", "D", "E", "F"].map((name) => ({ name, why: "already Booked" }));
    expect(listWriteTitle("Set 1 job to Booked", skipped)).toBe("Set 1 job to Booked · skipped A, B, C, D +2 more: already Booked");
  });
});
