import { describe, it, expect } from "vitest";

import { ASSET_TAB_KEYS, assetTabItems, resolveAssetTab } from "./asset-tabs";

describe("resolveAssetTab", () => {
  it("opens the tab a ?tab= names, any case", () => {
    for (const k of ASSET_TAB_KEYS) expect(resolveAssetTab(k)).toBe(k);
    expect(resolveAssetTab("Checks")).toBe("checks");
  });

  it("falls back to Overview for nothing, junk, or a tab the page does not offer", () => {
    expect(resolveAssetTab(null)).toBe("overview");
    expect(resolveAssetTab("")).toBe("overview");
    expect(resolveAssetTab("details")).toBe("overview");
    expect(resolveAssetTab("files", ["overview", "history"])).toBe("overview");
  });
});

describe("assetTabItems", () => {
  it("puts counts in the count slot and omits zero", () => {
    const items = assetTabItems({ maintenance: 3, history: 0, files: 5 });
    expect(items.map((i) => i.value)).toEqual([...ASSET_TAB_KEYS]);
    expect(items.find((i) => i.value === "maintenance")?.count).toBe(3);
    expect(items.find((i) => i.value === "history")?.count).toBeUndefined();
    expect(items.find((i) => i.value === "files")?.count).toBe(5);
    expect(items.find((i) => i.value === "overview")?.label).toBe("Overview");
  });
});
