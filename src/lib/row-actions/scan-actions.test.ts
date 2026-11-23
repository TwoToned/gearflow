import { describe, expect, it, vi } from "vitest";
import { buildScanCardMenu, buildScanPageMenu, buildScanRowMenu } from "./scan-actions";

const keys = (s: { items: { key: string }[] }) => s.items.map((i) => i.key);

describe("scan-actions", () => {
  const page = {
    soundsOn: true, hasLoaded: false, lastScanCount: 0, canTestTag: false, canAssets: false, canCheckItemSettings: false,
    onToggleSounds: vi.fn(), onClearScan: vi.fn(), onOpen: vi.fn(), onClearLastScans: vi.fn(),
  };

  it("page ⋯: what doesn't apply is absent (never disabled); danger is last and confirms", () => {
    expect(keys(buildScanPageMenu(page))).toEqual(["sounds"]);
    const full = buildScanPageMenu({ ...page, hasLoaded: true, lastScanCount: 3, canTestTag: true, canAssets: true, canCheckItemSettings: true });
    expect(keys(full)).toEqual(["sounds", "clear", "tt-list", "assets", "check-items", "clear-last"]);
    const last = full.items[full.items.length - 1];
    expect(last.danger).toBe(true);
    expect(last.confirm?.title).toBe("Clear 3 last scans?");
    expect(full.items.every((i) => !("disabled" in i))).toBe(true);
    expect(buildScanPageMenu({ ...page, soundsOn: false }).items[0].label).toBe("Scan sounds: Off");
  });

  it("card ⋯: Open asset, Pass all only with unanswered items, the T&T list only with a T&T row", () => {
    const base = { assetId: "a1", ttId: null, canTestTag: true, canPassAll: false, onOpen: vi.fn(), onPassAll: vi.fn(), onClearScan: vi.fn() };
    expect(keys(buildScanCardMenu(base))).toEqual(["open", "clear"]);
    expect(keys(buildScanCardMenu({ ...base, canPassAll: true, ttId: "tt1" }))).toEqual(["open", "pass-all", "tt", "clear"]);
    expect(keys(buildScanCardMenu({ ...base, ttId: "tt1", canTestTag: false }))).toEqual(["open", "clear"]);
    const onOpen = vi.fn();
    void buildScanCardMenu({ ...base, onOpen }).items[0].onSelect();
    expect(onOpen).toHaveBeenCalledWith("/assets/registry/a1");
  });

  it("row ⋯: Open asset only for a known asset; Scan it again always", () => {
    const onRescan = vi.fn();
    expect(keys(buildScanRowMenu({ assetId: null, tag: "ZZ", onOpen: vi.fn(), onRescan }))).toEqual(["rescan"]);
    const spec = buildScanRowMenu({ assetId: "a1", tag: "A-1", onOpen: vi.fn(), onRescan });
    expect(keys(spec)).toEqual(["open", "rescan"]);
    void spec.items[1].onSelect();
    expect(onRescan).toHaveBeenCalledWith("A-1");
  });
});
