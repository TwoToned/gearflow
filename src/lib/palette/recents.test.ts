import { describe, expect, it } from "vitest";
import { parseRecents, pushRecent, readRecents, recentsKey, writeRecents } from "@/lib/palette/recents";
import type { RecentRef } from "../../../convex/lib/paletteRecentRefs";

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("palette Recent (Q7: ids only, per org + user)", () => {
  it("opening a row moves it to the top, without duplicates, at most five", () => {
    let list: RecentRef[] = [1, 2, 3, 4, 5].map((i) => ({ type: "project" as const, id: `p${i}` }));
    list = pushRecent(list, { type: "project", id: "p3" });
    expect(list.map((r) => r.id)).toEqual(["p3", "p1", "p2", "p4", "p5"]);
    list = pushRecent(list, { type: "asset", id: "a1" });
    expect(list.map((r) => r.id)).toEqual(["a1", "p3", "p1", "p2", "p4"]);
  });

  it("stores ids only, under a key per org AND user", () => {
    const store = memoryStore();
    writeRecents("orgA", "u1", [{ type: "client", id: "c1" }], store);
    expect([...store.m.keys()]).toEqual([recentsKey("orgA", "u1")]);
    expect(JSON.parse(store.m.get(recentsKey("orgA", "u1"))!)).toEqual([{ type: "client", id: "c1" }]);
    // Another org, or another user, sees nothing.
    expect(readRecents("orgB", "u1", store)).toEqual([]);
    expect(readRecents("orgA", "u2", store)).toEqual([]);
    expect(readRecents("orgA", "u1", store)).toEqual([{ type: "client", id: "c1" }]);
  });

  it("junk in storage reads as an empty list (a trust boundary)", () => {
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents(JSON.stringify([{ type: "invoice", id: "i1" }]))).toEqual([]);
    expect(parseRecents(JSON.stringify([{ type: "project", id: "x".repeat(65) }]))).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });

  it("storage that throws (private mode, blocked site data) never throws out", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readRecents("orgA", "u1", broken)).toEqual([]);
    expect(() => writeRecents("orgA", "u1", [{ type: "project", id: "p1" }], broken)).not.toThrow();
  });
});
