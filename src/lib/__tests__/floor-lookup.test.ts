import { describe, it, expect } from "vitest";
import { jobByNumber, jobLookup, tagLookup, type ScanResolve } from "@/lib/floor-lookup";
import { floorJob } from "./floor-fixtures";

const jobs = [floorJob({ id: "p1", projectNumber: "2341", name: "Gala" })];
const res = (over: Partial<ScanResolve>): ScanResolve => ({ url: "/assets/registry/a1", label: "Asset SK-0012", activity: [], guard: null, ...over });
const act = (projectId: string, projectNumber: string, state: "to_pick" | "packed" | "out") =>
  ({ projectId, projectNumber, projectName: "x", lineItemId: "l", state, quantity: 1 });

describe("floor look up", () => {
  it("a job number (with or without #) rings that card", () => {
    expect(jobByNumber(jobs, " #2341 ")?.id).toBe("p1");
    expect(jobByNumber(jobs, "9")).toBeNull();
    expect(jobLookup(jobs[0])).toEqual({ tone: "info", text: "#2341 · Gala", ringJobId: "p1", openHref: "/warehouse/p1" });
  });

  it("a tag on one job says what it is doing there and rings it", () => {
    expect(tagLookup("SK-0012", res({ activity: [act("p1", "2341", "packed")] }), jobs)).toEqual({
      tone: "info", text: "Asset SK-0012 · packed for #2341", ringJobId: "p1", openHref: "/warehouse/p1",
    });
  });

  it("a job not on the board is not rung; several jobs are listed", () => {
    expect(tagLookup("X", res({ activity: [act("p9", "9", "out")] }), jobs).ringJobId).toBeNull();
    expect(tagLookup("X", res({ activity: [act("p1", "2341", "out"), act("p2", "2342", "out")] }), jobs).text).toBe("Asset SK-0012 · on #2341, #2342");
  });

  it("guards, unknown tags and idle gear say so", () => {
    expect(tagLookup("A-1", res({ guard: { kind: "kit_member", kitTag: "K-1" } }), jobs)).toMatchObject({ tone: "warning", text: "A-1 is in kit K-1 · scan the kit" });
    expect(tagLookup("A-3", res({ guard: { kind: "accessory_child", parentTag: "A-1" } }), jobs).text).toBe("A-3 returns with its parent A-1");
    expect(tagLookup("??", res({ url: null, label: null }), jobs)).toMatchObject({ tone: "error", text: "?? · not a gear tag" });
    expect(tagLookup("SK", res({}), jobs)).toMatchObject({ tone: "info", text: "Asset SK-0012 · not on a job", openHref: "/assets/registry/a1" });
  });
});
