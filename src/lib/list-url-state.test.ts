import { describe, it, expect } from "vitest";
import {
  parseListState,
  serializeListState,
  defaultListState,
  setFilter,
  toggleSort,
  clearFilters,
  hasNoListParams,
  withPatch,
  type ListUrlSpec,
} from "./list-url-state";

const spec: ListUrlSpec = {
  segments: ["all", "quoting", "booked", "out", "done", "needs"],
  filters: ["status", "type", "client"],
  sorts: ["start", "total", "name"],
  defaultSort: "start:desc",
  views: ["table", "board"],
};

const p = (s: string) => new URLSearchParams(s);

describe("list url state", () => {
  it("an empty URL is the default state and serialises back to nothing", () => {
    const s = parseListState(p(""), spec);
    expect(s).toEqual(defaultListState(spec));
    expect(serializeListState(s, spec).toString()).toBe("");
  });

  it("round-trips every param", () => {
    const qs = "seg=out&q=hilton&status=CONFIRMED%2CPREPPING&type=TOUR&sort=total%3Aasc&page=2&view=board";
    const s = parseListState(p(qs), spec);
    expect(s).toMatchObject({
      seg: "out",
      q: "hilton",
      filters: { status: ["CONFIRMED", "PREPPING"], type: ["TOUR"] },
      sortBy: "total",
      sortOrder: "asc",
      page: 2,
      view: "board",
    });
    expect(parseListState(serializeListState(s, spec), spec)).toEqual(s);
  });

  it("drops unknown and invalid params instead of throwing", () => {
    const s = parseListState(p("seg=nope&sort=bogus:asc&sort2=1&page=-3&view=cards&status=,,"), spec);
    expect(s).toEqual(defaultListState(spec));
    expect(parseListState(p("page=abc&sort=start:sideways"), spec).page).toBe(1);
  });

  it("de-duplicates list values and keeps chosen order", () => {
    const s = parseListState(p("status=B,A,B"), spec);
    expect(s.filters.status).toEqual(["B", "A"]);
  });

  it("omits defaults but keeps a non-default direction", () => {
    const s = parseListState(p("sort=start:asc"), spec);
    expect(serializeListState(s, spec).get("sort")).toBe("start:asc");
    expect(serializeListState(parseListState(p("sort=start:desc"), spec), spec).has("sort")).toBe(false);
  });

  it("filter and sort changes reset paging; an explicit page does not", () => {
    const base = withPatch(defaultListState(spec), { page: 3 });
    expect(setFilter(base, "status", ["ENQUIRY"]).page).toBe(1);
    expect(toggleSort(base, "name").page).toBe(1);
    expect(withPatch(base, { page: 4 }).page).toBe(4);
  });

  it("setFilter with no values removes the key; clearFilters clears search too", () => {
    const s = setFilter(defaultListState(spec), "type", ["TOUR"]);
    expect(setFilter(s, "type", []).filters).toEqual({});
    expect(clearFilters({ ...s, q: "x" })).toMatchObject({ filters: {}, q: "" });
  });

  it("toggleSort flips the active column and starts a new one ascending", () => {
    const s = defaultListState(spec);
    expect(toggleSort(s, "start")).toMatchObject({ sortBy: "start", sortOrder: "asc" });
    expect(toggleSort(s, "name")).toMatchObject({ sortBy: "name", sortOrder: "asc" });
  });

  it("hasNoListParams ignores unrelated params", () => {
    expect(hasNoListParams(p("tab=overview"), spec)).toBe(true);
    expect(hasNoListParams(p("seg=out"), spec)).toBe(false);
  });
});
