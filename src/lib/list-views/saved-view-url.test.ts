import { describe, expect, it } from "vitest";

import { parseListState } from "@/lib/list-url-state";
import { ASSETS_SPEC } from "./assets";
import { JOBS_SPEC } from "./jobs";
import { queryOf, viewQuery } from "./saved-view-url";

const state = (qs: string) => parseListState(new URLSearchParams(qs), JOBS_SPEC);

describe("viewQuery: the saved-view adapter", () => {
  it("passes a URL-mode query through the codec (junk dropped, defaults omitted)", () => {
    expect(viewQuery({ query: "seg=out&status=QUOTED&bogus=1&sort=nope:asc&page=3" }, JOBS_SPEC)).toBe("seg=out&status=QUOTED");
    expect(viewQuery({ query: "seg=all" }, JOBS_SPEC)).toBe("");
  });

  it("converts the legacy {filters, sortBy, sortOrder} row on read", () => {
    const q = viewQuery({ filters: { status: ["QUOTED", "CONFIRMED"], type: "TOUR" }, sortBy: "name", sortOrder: "desc" }, JOBS_SPEC);
    expect(new URLSearchParams(q).get("status")).toBe("QUOTED,CONFIRMED");
    expect(new URLSearchParams(q).get("type")).toBe("TOUR");
    expect(new URLSearchParams(q).get("sort")).toBe("name:desc");
  });

  it("drops legacy filters and sort keys the list no longer has; non-list values", () => {
    expect(viewQuery({ filters: { nope: ["x"], status: { from: "a" } as never }, sortBy: "gone", sortOrder: "asc" }, JOBS_SPEC)).toBe("");
  });

  it("renames legacy asset filter keys through the alias map", () => {
    const aliases = { locationId: "loc", categoryId: "cat", tags: "tag" };
    const q = viewQuery({ filters: { status: ["AVAILABLE"], locationId: ["l1"], tags: ["blue"] }, sortBy: "assetTag", sortOrder: "desc" }, ASSETS_SPEC, aliases);
    const p = new URLSearchParams(q);
    expect([p.get("status"), p.get("loc"), p.get("tag"), p.get("sort")]).toEqual(["AVAILABLE", "l1", "blue", "assetTag:desc"]);
  });

  it("an empty or missing config is the default list", () => {
    expect(viewQuery({}, JOBS_SPEC)).toBe("");
    expect(viewQuery(undefined, JOBS_SPEC)).toBe("");
  });

  it("ignores an over-long stored query rather than parsing it", () => {
    expect(viewQuery({ query: `status=${"A".repeat(2000)}` }, JOBS_SPEC)).toBe("");
  });
});

describe("queryOf", () => {
  it("captures filters and sort but never search text or the page", () => {
    expect(queryOf(state("q=hilton&page=4&status=QUOTED&sort=name:desc"), JOBS_SPEC)).toBe("status=QUOTED&sort=name%3Adesc");
  });

  it("round-trips: viewQuery(queryOf(state)) is stable", () => {
    const q = queryOf(state("seg=booked&type=TOUR&sort=total:desc"), JOBS_SPEC);
    expect(viewQuery({ query: q }, JOBS_SPEC)).toBe(q);
  });
});
