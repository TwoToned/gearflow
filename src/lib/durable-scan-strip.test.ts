import { describe, it, expect, vi } from "vitest";
import { intakeToStripEntries } from "./durable-scan-strip";
import type { SavedScan } from "./scan-intake";

const scan = (over: Partial<SavedScan>): SavedScan => ({
  id: "s1", raw: "A1", operation: "deploy", condition: "GOOD", notes: "", state: "pending", createdAt: 1,
  orgId: "o", userId: "u", projectId: "p", expectedVersionId: "v1", ...over,
}) as SavedScan;

describe("intakeToStripEntries", () => {
  it("maps each state to a tone and the intake's own retry", () => {
    const retry = vi.fn();
    const e = intakeToStripEntries([
      scan({ id: "p", state: "pending", createdAt: 1 }),
      scan({ id: "r", state: "review", createdAt: 2 }),
      scan({ id: "f", state: "failed", error: "Project version changed", createdAt: 3 }),
      scan({ id: "c", state: "confirmed", createdAt: 4 }),
    ], retry);
    expect(e.map((x) => [x.id, x.tone])).toEqual([["f", "error"], ["r", "warning"], ["p", "neutral"]]);
    e[0].action!.onSelect();
    e[1].action!.onSelect();
    expect(retry.mock.calls).toEqual([["f"], ["r"]]);
    expect(e[0].action!.label).toBe("Retry saved scan");
    expect(e[1].action!.label).toBe("Review saved scan");
  });
  it("surfaces an unsaved scan and an intake error as error entries", () => {
    const e = intakeToStripEntries([], vi.fn(), { unsaved: { raw: "KIT" }, error: "Device storage unavailable." });
    expect(e.map((x) => x.tone)).toEqual(["error", "error"]);
    expect(e[0].text).toContain("KIT");
  });
});
