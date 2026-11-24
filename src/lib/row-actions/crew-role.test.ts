import { describe, expect, it, vi } from "vitest";

import { buildCrewRoleActions } from "./crew-role";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const all = { onEdit: vi.fn(), onMove: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn() };

describe("buildCrewRoleActions", () => {
  it("a middle active role: Edit…, both moves, Archive… last and red", () => {
    const spec = buildCrewRoleActions({ isActive: true, index: 1, activeCount: 3 }, all);
    expect(keys(spec)).toEqual(["edit", "up", "down", "archive"]);
    expect(spec.items.at(-1)!.danger).toBe(true);
  });

  it("moves are ABSENT at the ends, not disabled", () => {
    expect(keys(buildCrewRoleActions({ isActive: true, index: 0, activeCount: 3 }, all))).toEqual(["edit", "down", "archive"]);
    expect(keys(buildCrewRoleActions({ isActive: true, index: 2, activeCount: 3 }, all))).toEqual(["edit", "up", "archive"]);
    expect(keys(buildCrewRoleActions({ isActive: true, index: 0, activeCount: 1 }, all))).toEqual(["edit", "archive"]);
  });

  it("an archived role: Edit… and Restore, no moves, no Archive", () => {
    expect(keys(buildCrewRoleActions({ isActive: false, index: 0, activeCount: 3 }, all))).toEqual(["edit", "restore"]);
  });

  it("no handlers (no crew:update), no items", () => {
    expect(buildCrewRoleActions({ isActive: true, index: 1, activeCount: 3 }, {}).items).toEqual([]);
  });

  it("Move up calls the one atomic move with its direction", () => {
    const onMove = vi.fn();
    buildCrewRoleActions({ isActive: true, index: 1, activeCount: 3 }, { onMove }).items[0].onSelect();
    expect(onMove).toHaveBeenCalledWith("up");
  });
});
