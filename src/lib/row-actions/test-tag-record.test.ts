import { describe, expect, it, vi } from "vitest";
import { buildTestTagRecordActions } from "@/lib/row-actions/test-tag";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const fn = () => vi.fn();

describe("buildTestTagRecordActions", () => {
  it("an active item offers Retire only (Delete is never offered before Retire)", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "TT1", retired: false, onRetire: fn(), onReactivate: fn(), onDelete: fn() }))).toEqual(["retire"]);
  });

  it("a retired item offers Reactivate and Delete…, which is last, red and confirmed with what goes with it", () => {
    const spec = buildTestTagRecordActions({ testTagId: "TT1", retired: true, onRetire: fn(), onReactivate: fn(), onDelete: fn() });
    expect(keys(spec)).toEqual(["reactivate", "delete"]);
    const del = spec.items.at(-1)!;
    expect(del).toMatchObject({ danger: true, group: "danger" });
    expect(del.confirm?.title).toBe("Delete TT1?");
    expect(del.confirm?.body).toMatch(/every test recorded/);
  });

  it("a verb with no handler (the caller cannot) is ABSENT, never disabled", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: false }))).toEqual([]);
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: true, onDelete: fn() }))).toEqual(["delete"]);
  });
});
