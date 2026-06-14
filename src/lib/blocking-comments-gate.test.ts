import { describe, it, expect } from "vitest";
import { evaluateBlockingGate } from "./blocking-comments-gate";

const empty = {
  count: 0,
  lineItemTargetIds: [] as string[],
  groupTargetIds: [] as string[],
  hasProjectLevel: false,
};

describe("evaluateBlockingGate — full-project gate (no scope)", () => {
  it("does not block when there are no blocking comments", () => {
    const r = evaluateBlockingGate(empty, { actionLabel: "check out items" });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("none");
  });

  it("blocks on any open blocker and counts them", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 2, hasProjectLevel: true },
      { actionLabel: "check out items" },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("project");
    expect(r.message).toContain("2 unresolved blocking comments");
    expect(r.message).toContain("check out items");
  });

  it("uses singular phrasing for a single blocker", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, groupTargetIds: ["g1"] },
      { actionLabel: "check out items" },
    );
    expect(r.blocked).toBe(true);
    expect(r.message).toContain("1 unresolved blocking comment.");
    expect(r.message).toContain("Resolve it");
  });
});

describe("evaluateBlockingGate — per-line-item gate", () => {
  it("blocks the item when a project-level blocker exists", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, hasProjectLevel: true },
      { lineItemId: "li1", groupId: "g1", actionLabel: "prep this item" },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("project");
    expect(r.message).toContain("project-wide");
  });

  it("blocks the item when the item itself is blocked", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, lineItemTargetIds: ["li1"] },
      { lineItemId: "li1", groupId: "g1", actionLabel: "prep this item" },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("item");
    expect(r.message).toContain("this item has");
  });

  it("blocks the item when its group is blocked", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, groupTargetIds: ["g1"] },
      { lineItemId: "li1", groupId: "g1", actionLabel: "prep this item" },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("group");
    expect(r.message).toContain("this item's group");
  });

  it("does NOT block when the blocker is on an unrelated item or group", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 2, lineItemTargetIds: ["other"], groupTargetIds: ["otherG"] },
      { lineItemId: "li1", groupId: "g1", actionLabel: "prep this item" },
    );
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("none");
  });

  it("blocks by group even when groupId is the only scope provided", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, groupTargetIds: ["g1"] },
      { groupId: "g1", actionLabel: "prep this group" },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("group");
  });

  it("treats a null groupId as no group scope", () => {
    const r = evaluateBlockingGate(
      { ...empty, count: 1, lineItemTargetIds: ["li1"] },
      { lineItemId: "li2", groupId: null, actionLabel: "prep this item" },
    );
    expect(r.blocked).toBe(false);
  });
});
