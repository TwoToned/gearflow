import { describe, expect, it } from "vitest";
import { buildCategoryEdit, categorySheetError, categorySheetInitialOf } from "@/lib/category-sheet";
import { categoryStateWord, deleteEffectText, modelsWithoutRates, subtreeIds } from "@/lib/category-record-facts";

const SRC = { id: "c1", name: "Power", parentId: "p1", description: "d", tags: ["x"], defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 };

describe("categorySheetInitialOf / buildCategoryEdit", () => {
  const v = categorySheetInitialOf(SRC);

  it("reads the optional defaults as typed and blanks the absent ones", () => {
    expect(v).toMatchObject({ parentId: "p1", defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: "6", icon: "", xeroAccountCode: "" });
    expect(categorySheetInitialOf({ id: "c", name: "n" })).toMatchObject({ parentId: "", defaultEquipmentClass: "", defaultTestIntervalMonths: "", tags: [] });
  });

  it("an untouched sheet sends NOTHING (so it can never revert someone else's newer edit)", () => {
    expect(buildCategoryEdit(v, v)).toEqual({ set: {}, clear: [] });
  });

  it("only the changed fields go; a changed-to-blank optional box is CLEARED; never the id or an off-list field", () => {
    const r = buildCategoryEdit({ ...v, name: " Power cables ", defaultTestIntervalMonths: "12", defaultEquipmentClass: "", parentId: "", tags: ["x", "y"] }, v);
    expect(r.set).toEqual({ name: "Power cables", defaultTestIntervalMonths: 12, tags: ["x", "y"] });
    expect(r.clear.sort()).toEqual(["defaultEquipmentClass", "parentId"]);
    for (const k of ["id", "sortOrder", "defaultTestProfileId", "defaultApplianceType"]) expect(r.set).not.toHaveProperty(k);
  });

  it("another user's newer edit is not reverted: opened with the old description, changing only the interval sends only the interval", () => {
    const opened = { ...v, description: "old" };
    expect(buildCategoryEdit({ ...opened, defaultTestIntervalMonths: "9" }, opened)).toEqual({ set: { defaultTestIntervalMonths: 9 }, clear: [] });
  });
});

describe("categorySheetError", () => {
  const v = categorySheetInitialOf(SRC);
  it("mirrors the server's bounds", () => {
    expect(categorySheetError(v, "c1")).toBeNull();
    expect(categorySheetError({ ...v, name: " " }, "c1")).toMatch(/name/);
    expect(categorySheetError({ ...v, icon: "x".repeat(11) }, "c1")).toMatch(/icon/);
    expect(categorySheetError({ ...v, parentId: "c1" }, "c1")).toMatch(/own parent/);
    for (const bad of ["0", "121", "1.5", "abc"]) expect(categorySheetError({ ...v, defaultTestIntervalMonths: bad }, "c1")).toMatch(/interval/);
    expect(categorySheetError({ ...v, defaultTestIntervalMonths: "" }, "c1")).toBeNull();
  });
});

describe("subtreeIds", () => {
  it("is the category and everything below it, and nothing beside it", () => {
    const cats = [{ id: "root" }, { id: "mid", parentId: "root" }, { id: "leaf", parentId: "mid" }, { id: "other" }, { id: "kid", parentId: "other" }];
    expect(subtreeIds(cats, "mid").sort()).toEqual(["leaf", "mid"]);
    expect(subtreeIds(cats, "leaf")).toEqual(["leaf"]);
  });
});

describe("category record words", () => {
  it("a model with a rate of 0 has a rate; only a model with neither rate is without", () => {
    expect(modelsWithoutRates([{ dailyRate: 0 }, { weeklyRate: 5 }, {}, { dailyRate: null, weeklyRate: null }])).toBe(2);
  });

  it("the header word: unrated models first, else the model count, else Empty", () => {
    expect(categoryStateWord({ models: 5, kits: 0, children: 0 }, 2)).toEqual({ label: "2 models without rates", intent: "warning" });
    expect(categoryStateWord({ models: 1, kits: 0, children: 0 }, 0).label).toBe("1 model");
    expect(categoryStateWord({ models: 0, kits: 0, children: 0 }, 0)).toMatchObject({ label: "Empty", outline: true });
  });

  it("Delete says what happens to what is inside, and where the subcategories go", () => {
    expect(deleteEffectText({ models: 12, kits: 1, children: 2 }, "Audio")).toBe("12 models and 1 kit become Uncategorised; 2 subcategories move up to Audio. You can undo it from the toast.");
    expect(deleteEffectText({ models: 0, kits: 0, children: 1 }, null)).toBe("1 subcategory moves up to the top level. You can undo it from the toast.");
    expect(deleteEffectText({ models: 0, kits: 0, children: 0 }, null)).toMatch(/empty/);
  });
});
