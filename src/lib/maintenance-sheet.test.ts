import { describe, expect, it } from "vitest";
import { assetsEditable, buildMaintenanceCreate, buildMaintenanceEdit, maintenanceSheetError, maintenanceSheetInitialOf, type MaintenanceSheetSource } from "@/lib/maintenance-sheet";

const REC: MaintenanceSheetSource = {
  id: "r1", title: "Fix desk", type: "REPAIR", status: "SCHEDULED", description: "old", scheduledDate: "2026-03-05T00:00:00.000Z", nextDueDate: null,
  assignedToId: "u2", reportedById: null, tags: ["x"], photos: ["https://f/1.jpg"], cost: 0, assets: [{ assetId: "a1" }],
};

describe("maintenanceSheetInitialOf", () => {
  it("reads dates as the UTC day, keeps a stored 0 labour as '0', and flags whether labour was carried", () => {
    const i = maintenanceSheetInitialOf(REC);
    expect(i).toMatchObject({ scheduledDate: "2026-03-05", nextDueDate: "", cost: "0", labourVisible: true, assetIds: ["a1"], assignedToId: "u2", reportedById: "" });
    const hidden = { ...REC };
    delete (hidden as { cost?: unknown }).cost;
    expect(maintenanceSheetInitialOf(hidden)).toMatchObject({ labourVisible: false, cost: "" });
  });
});

describe("buildMaintenanceEdit", () => {
  const before = maintenanceSheetInitialOf(REC);
  const same = { ...before };

  it("an untouched sheet sends NOTHING (so it can never revert someone else's newer edit)", () => {
    expect(buildMaintenanceEdit(same, before)).toEqual({ set: {}, clear: [] });
  });

  it("only the changed fields go, never status or a field off the edit list; a changed-to-blank box CLEARS; a stored 0 labour is a value", () => {
    const r = buildMaintenanceEdit({ ...same, title: " Fix the desk ", description: "", tags: ["x", "y"], cost: "", assignedToId: "" }, before);
    expect(r.set).toEqual({ title: "Fix the desk", tags: ["x", "y"] });
    expect(r.clear.sort()).toEqual(["assignedToId", "cost", "description"]);
    expect(buildMaintenanceEdit({ ...same, cost: "0" }, before)).toEqual({ set: {}, clear: [] });
    expect(buildMaintenanceEdit({ ...same, cost: "5" }, before).set).toEqual({ cost: 5 });
    for (const k of ["status", "partsUsed"]) expect(r.set).not.toHaveProperty(k);
  });

  it("another user's newer edit is not reverted: a sheet that opened with the old photos and changed the title sends no photos", () => {
    const r = buildMaintenanceEdit({ ...same, title: "Renamed" }, before);
    expect(r.set).toEqual({ title: "Renamed" });
    expect(r.set).not.toHaveProperty("photos");
    expect(r.set).not.toHaveProperty("tags");
  });

  it("a caller whose read carried no labour never sends it, set or clear", () => {
    const hidden = { ...before, labourVisible: false, cost: "" };
    const r = buildMaintenanceEdit({ ...hidden, cost: "999" }, hidden);
    expect(r.set).not.toHaveProperty("cost");
    expect(r.clear).not.toContain("cost");
  });

  it("the asset list is sent only when it changed and the job is Scheduled", () => {
    expect(buildMaintenanceEdit(same, before).assetIds).toBeUndefined();
    expect(buildMaintenanceEdit({ ...same, assetIds: ["a1", "a2"] }, before).assetIds).toEqual(["a1", "a2"]);
    const live = { ...before, status: "IN_PROGRESS" };
    expect(buildMaintenanceEdit({ ...live, assetIds: ["a9"] }, live).assetIds).toBeUndefined();
    expect(assetsEditable("SCHEDULED")).toBe(true);
    expect(assetsEditable("AWAITING_PARTS")).toBe(false);
  });

  it("dates go as UTC-midnight epoch ms", () => {
    expect(buildMaintenanceEdit({ ...same, nextDueDate: "2026-04-01" }, before).set.nextDueDate).toBe(Date.UTC(2026, 3, 1));
  });
});

describe("buildMaintenanceCreate", () => {
  it("is always Scheduled, with no labour, and blank optional boxes absent", () => {
    const c = buildMaintenanceCreate({ ...maintenanceSheetInitialOf(REC), title: " New ", description: "", assignedToId: "", cost: "55" });
    expect(c).toMatchObject({ status: "SCHEDULED", title: "New", assetIds: ["a1"], description: undefined, assignedToId: undefined });
    expect(c).not.toHaveProperty("cost");
  });
});

describe("maintenanceSheetError", () => {
  const v = maintenanceSheetInitialOf(REC);
  it("needs a title, an asset (when editable) and sane labour", () => {
    expect(maintenanceSheetError({ ...v, title: " " }, { labourVisible: true, editingAssets: true })).toMatch(/title/);
    expect(maintenanceSheetError({ ...v, assetIds: [] }, { labourVisible: true, editingAssets: true })).toMatch(/asset/);
    expect(maintenanceSheetError({ ...v, assetIds: [] }, { labourVisible: true, editingAssets: false })).toBeNull();
    expect(maintenanceSheetError({ ...v, cost: "-1" }, { labourVisible: true, editingAssets: true })).toMatch(/Labour/);
    expect(maintenanceSheetError({ ...v, cost: "10000001" }, { labourVisible: true, editingAssets: true })).toMatch(/Labour/);
    expect(maintenanceSheetError({ ...v, cost: "-1" }, { labourVisible: false, editingAssets: true })).toBeNull();
    expect(maintenanceSheetError(v, { labourVisible: true, editingAssets: true })).toBeNull();
  });
});
