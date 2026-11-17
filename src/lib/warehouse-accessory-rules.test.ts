import { describe, it, expect } from "vitest";
import { verifyByCount, prefillOverrideReason, JobRememberStore, accessoryTally } from "./warehouse-accessory-rules";

describe("D8 count verification", () => {
  it("none / partial / full", () => {
    expect(verifyByCount(0, 4)).toBe("none");
    expect(verifyByCount(2, 4)).toBe("partial");
    expect(verifyByCount(4, 4)).toBe("full");
    expect(verifyByCount(5, 4)).toBe("full");
  });
});
describe("D9 prefill", () => {
  const parent = { accessoryPlan: { excludedReasons: [{ bulkAssetId: "b1", reason: " Client supplies " }] } };
  it("reads the office note, trimmed", () => expect(prefillOverrideReason(parent, "b1")).toBe("Client supplies"));
  it("empty when none", () => {
    expect(prefillOverrideReason(parent, "b2")).toBe("");
    expect(prefillOverrideReason({ accessoryPlan: null }, "b1")).toBe("");
  });
});
describe("D10 job scope", () => {
  it("counts down and never leaks across jobs", () => {
    const s = new JobRememberStore();
    s.remember("j1", "p", "pack", 2);
    expect(s.take("j2", "p")).toBeNull();
    expect(s.take("j1", "p")).toBe("pack");
    expect(s.take("j1", "p")).toBe("pack");
    expect(s.take("j1", "p")).toBeNull();
  });
});
it("tally", () => expect(accessoryTally(["packed", "pick", "pick", "skipped"])).toBe("accessories: 1 packed · 2 to pick · 1 skipped"));
