import { describe, expect, it } from "vitest";
import { GEAR_STAGE_LABELS, LOOSE_LABEL, MODULE_NAMES, OUT_LABEL, type GearStageKey } from "@/lib/vocabulary";
import { getStatusIntent } from "@/lib/status-colors";
import { assetStatusLabels, kitStatusLabels, lineItemStatusLabels, projectStatusLabels } from "@/lib/status-labels";
import { WAREHOUSE_STAGES } from "@/components/warehouse/warehouse-stages";

const KEYS: GearStageKey[] = ["to_prep", "prepped", "deployed", "returned", "deprepped", "closed"];

describe("vocabulary (D90)", () => {
  it("names the six gear stages with the one set of words", () => {
    expect(KEYS.map((k) => GEAR_STAGE_LABELS[k])).toEqual([
      "To pick", "Prepped", "Out", "Returned", "De-prepped", "Closed",
    ]);
  });

  it("names the modules", () => {
    expect(MODULE_NAMES.jobs).toBe("Jobs");
    expect(MODULE_NAMES.home).toBe("Home");
    expect(MODULE_NAMES.schedule).toBe("Schedule");
    expect(LOOSE_LABEL).toBe("Loose");
  });

  it("CHECKED_OUT reads Out in every status label map", () => {
    for (const m of [assetStatusLabels, kitStatusLabels, projectStatusLabels, lineItemStatusLabels]) {
      expect(m.CHECKED_OUT).toBe(OUT_LABEL);
    }
  });

  it("the warehouse stepper takes its words from vocabulary", () => {
    expect(WAREHOUSE_STAGES.map((s) => s.label)).toEqual(KEYS.slice(0, 5).map((k) => GEAR_STAGE_LABELS[k]));
  });
});

describe("gear stage → intent (D2): the one table", () => {
  it.each([
    ["to_prep", "neutral"],
    ["prepped", "info"],
    ["deployed", "primary"],
    ["returned", "warning"],
    ["deprepped", "success"],
    ["closed", "neutral"],
  ] as const)("%s is %s", (stage, intent) => {
    expect(getStatusIntent("gearStage", stage)).toBe(intent);
  });

  it("line-item RETURNED is warning, CHECKED_OUT primary; the project status intent is unchanged", () => {
    expect(getStatusIntent("lineItem", "RETURNED")).toBe("warning");
    expect(getStatusIntent("lineItem", "CHECKED_OUT")).toBe("primary");
    expect(getStatusIntent("project", "RETURNED")).toBe("primary");
  });
});
