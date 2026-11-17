import { describe, it, expect, vi } from "vitest";
import { buildWarehouseLineActions } from "./warehouse-line";

const row = { title: "SM58", status: "CONFIRMED" };
const keys = (s: { items: Array<{ key: string }> }) => s.items.map((i) => i.key);

describe("warehouse line menu", () => {
  it("absent, not disabled, when a handler is missing", () => {
    expect(keys(buildWarehouseLineActions(row, { stage: "pick" }))).not.toContain("move-back");
  });
  it("To pick has no move-back; later stages name the stage they return to", () => {
    const fn = vi.fn();
    expect(keys(buildWarehouseLineActions(row, { stage: "pick", onMoveBack: fn }))).not.toContain("move-back");
    const out = buildWarehouseLineActions(row, { stage: "out", onMoveBack: fn });
    expect(out.items.find((i) => i.key === "move-back")?.label).toBe("Move to Prepped");
  });
  it("shares the gear menu's report-issue and keeps the custom-unit verbs", () => {
    const s = buildWarehouseLineActions({ ...row, status: "CHECKED_OUT" }, { stage: "out", onReportIssue: vi.fn(), onConvertToCustom: vi.fn() });
    expect(keys(s)).toEqual(expect.arrayContaining(["prep-as-custom"]));
    expect(s.items.some((i) => /issue/i.test(i.label))).toBe(true);
  });
  it("de-prepped gear cannot be moved to a case", () => {
    expect(keys(buildWarehouseLineActions(row, { stage: "deprepped", onMoveToCase: vi.fn() }))).not.toContain("move-to-case");
  });
});
