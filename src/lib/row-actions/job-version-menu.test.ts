import { describe, it, expect, vi } from "vitest";
import { buildVersionMenuItem, type VersionMenuVersion } from "./job-version-menu";

const v = (number: number, isLive = false, extra: Partial<VersionMenuVersion> = {}): VersionMenuVersion => ({
  id: `v${number}`,
  number,
  isLive,
  contentState: "ready",
  ...extra,
});

function handlers() {
  return { view: vi.fn(), createFrom: vi.fn(), compare: vi.fn(), manage: vi.fn() };
}

describe("buildVersionMenuItem", () => {
  it("is absent while there are no versions", () => {
    expect(buildVersionMenuItem({ versions: [], liveVersion: null, viewingNumber: null, canPublish: true }, handlers())).toBeNull();
  });

  it("lists every version, then New from the one on screen, Compare and Manage (V)", () => {
    const h = handlers();
    const versions = [v(3, true), v(2, false, { label: "Option B" })];
    const item = buildVersionMenuItem({ versions, liveVersion: versions[0], viewingNumber: null, canPublish: true }, h)!;
    expect(item.label).toBe("Version v3 · Live");
    expect(item.children!.map((c) => c.label)).toEqual([
      "v3 · Live · viewing",
      "v2 · Draft · Option B",
      "New version from v3",
      "Compare",
      "Manage versions…",
    ]);
    expect(item.children!.at(-1)!.kbd).toBe("V");

    item.children![1].onSelect();
    expect(h.view).toHaveBeenCalledWith(2);
    item.children![0].onSelect();
    expect(h.view).toHaveBeenLastCalledWith(null);
    item.children![2].onSelect();
    expect(h.createFrom).toHaveBeenCalledWith("v3");
    item.children![3].onSelect();
    expect(h.compare).toHaveBeenCalledWith(2);
  });

  it("follows the viewed version and drops what does not apply", () => {
    const h = handlers();
    const versions = [v(1, true)];
    const item = buildVersionMenuItem({ versions, liveVersion: versions[0], viewingNumber: null, canPublish: false }, h)!;
    expect(item.children!.map((c) => c.key)).toEqual(["version-v1", "version-manage"]);

    const two = [v(2, true), v(1)];
    const viewing = buildVersionMenuItem({ versions: two, liveVersion: two[0], viewingNumber: 1, canPublish: true }, h)!;
    expect(viewing.label).toBe("Version v1 · Draft");
    expect(viewing.children!.find((c) => c.key === "version-new")!.label).toBe("New version from v1");
    viewing.children!.find((c) => c.key === "version-compare")!.onSelect();
    expect(h.compare).toHaveBeenLastCalledWith(1);
  });
});
