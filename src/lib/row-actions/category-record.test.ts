import { describe, expect, it, vi } from "vitest";
import { buildCategoryRecordActions } from "@/lib/row-actions/category-record";

describe("buildCategoryRecordActions", () => {
  const ctx = { name: "Power", counts: { models: 3, kits: 0, children: 1 }, parentName: "Audio" };

  it("Delete… is red, confirmed, and names what happens to what is inside", () => {
    const spec = buildCategoryRecordActions({ ...ctx, onDelete: vi.fn() });
    expect(spec.items.map((i) => i.key)).toEqual(["delete"]);
    expect(spec.items[0]).toMatchObject({ danger: true, group: "danger" });
    expect(spec.items[0].confirm?.title).toBe("Delete Power?");
    expect(spec.items[0].confirm?.body).toBe("3 models become Uncategorised; 1 subcategory moves up to Audio. You can undo it from the toast.");
  });

  it("is ABSENT (not disabled) for a caller who may not delete", () => {
    expect(buildCategoryRecordActions(ctx).items).toEqual([]);
  });
});
