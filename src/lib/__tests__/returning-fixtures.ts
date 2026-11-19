import type { ReturningGroup, ReturningLine } from "@/lib/returning";
import { DAY, TODAY } from "./floor-fixtures";

export function returningLine(over: Partial<ReturningLine> = {}): ReturningLine {
  return {
    lineItemId: "l1", description: "Shure SM58", modelName: "Shure SM58", kind: "serialized",
    quantity: 4, out: 2, back: 2, damaged: 0, missing: 0, lateBack: 0, scannable: true,
    kitId: null, kitAssetTag: null, accessories: [],
    ...over,
  };
}

export function returningGroup(over: Partial<ReturningGroup> = {}, lines: ReturningLine[] = [returningLine()]): ReturningGroup {
  const totals = { out: 0, back: 0, damaged: 0, missing: 0, lateBack: 0 };
  for (const l of lines) {
    totals.out += l.out;
    totals.back += l.back;
    totals.damaged += l.damaged;
    totals.missing += l.missing;
    totals.lateBack += l.lateBack;
  }
  return {
    projectId: "p1", projectNumber: "2341", projectName: "Gala", status: "CHECKED_OUT",
    windowEnd: TODAY + DAY, totals, lines,
    ...over,
  };
}
