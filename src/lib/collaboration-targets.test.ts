import { describe, it, expect } from "vitest";
import {
  lineItemTarget,
  groupTarget,
  categoryTarget,
  targetKey,
  COLLAB_TARGET_TYPES,
} from "./collaboration-targets";

describe("collaboration target helpers", () => {
  it("builds a line-item target", () => {
    expect(lineItemTarget("li1")).toEqual({ targetType: "lineItem", targetId: "li1" });
  });

  it("builds a group target matching the existing comment panel convention", () => {
    // GroupRow renders CommentThreadPanel with targetType="group" — must agree.
    expect(groupTarget("g1")).toEqual({ targetType: COLLAB_TARGET_TYPES.group, targetId: "g1" });
    expect(groupTarget("g1").targetType).toBe("group");
  });

  it("builds a category target", () => {
    expect(categoryTarget("c1")).toEqual({ targetType: "category", targetId: "c1" });
  });

  it("derives a stable key for lock/comment maps", () => {
    expect(targetKey(groupTarget("g1"))).toBe("group:g1");
    expect(targetKey(lineItemTarget("li1"))).toBe("lineItem:li1");
  });

  it("handles null/undefined target fields without throwing", () => {
    expect(targetKey({ targetType: null, targetId: null })).toBe(":");
    expect(targetKey({})).toBe(":");
  });
});
