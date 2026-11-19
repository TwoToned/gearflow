import { describe, expect, it } from "vitest";

import { defaultListState, parseListState } from "@/lib/list-url-state";
import { ASSETS_SPEC, assetRowOf, assetSegments, assetsQueryArgs, kindOf, serializedQueryArgs } from "./assets";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), ASSETS_SPEC);
const NOW = 1_700_000_000_000;

describe("assets list config", () => {
  it("defaults to serialized, page size 25, tag order", () => {
    const s = defaultListState(ASSETS_SPEC);
    expect(kindOf(s)).toBe("serialized");
    expect(assetsQueryArgs(s)).toMatchObject({ page: 1, pageSize: 25, sortBy: "assetTag", sortOrder: "asc" });
    expect(serializedQueryArgs(s, NOW)).toEqual({ conditionIn: undefined, segment: undefined, now: undefined });
  });

  it("kind=bulk selects the bulk list and only All + Retired segments", () => {
    expect(kindOf(parse("kind=bulk"))).toBe("bulk");
    expect(assetSegments("bulk").map((s) => s.key)).toEqual(["all", "retired"]);
    expect(assetSegments("serialized").map((s) => s.key)).toContain("due");
  });

  it("maps filter words to the multi-value args and drops unknown statuses", () => {
    const args = assetsQueryArgs(parse("status=AVAILABLE,NOPE&loc=l1,l2&cat=c1&tag=a&model=m1"));
    expect(args).toMatchObject({ statusIn: ["AVAILABLE"], locationIdIn: ["l1", "l2"], categoryIdIn: ["c1"], tagsHasSome: ["a"], modelIdIn: ["m1"] });
  });

  it("only the T&T segments pass now", () => {
    expect(serializedQueryArgs(parse("seg=attention"), NOW)).toMatchObject({ segment: "attention", now: NOW });
    expect(serializedQueryArgs(parse("seg=available"), NOW).now).toBeUndefined();
  });

  it("maps a serialized row with On job and Next due, and a bulk row with quantities", () => {
    const a = { id: "a", assetTag: "AV-1", modelId: "m", status: "CHECKED_OUT", condition: "GOOD", model: { name: "Par", category: { name: "Lighting" } } };
    const row = assetRowOf(a, "serialized", { nextDue: NOW, job: { id: "p", name: "Gig", number: "P-1" } });
    expect(row.facts.onJob).toEqual({ kind: "text", label: "P-1 Gig" });
    expect(row.facts.nextDue).toBeTruthy();
    expect(row.subtitle).toBe("Lighting");
    expect(row.href).toBe("/assets/registry/a");
    const bulk = assetRowOf({ ...a, totalQuantity: 10, availableQuantity: 4, status: "ACTIVE" }, "bulk", {});
    expect(bulk.facts.available).toEqual({ kind: "qty", value: 4 });
    expect(bulk.href).toBe("/assets/registry/a?type=bulk");
  });
});
