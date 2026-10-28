// @vitest-environment node
//
// Guard (FEATUREDOCS/11, "off-inventory units"): every site that sums a line's
// quantity as STOCK DEMAND must go through stockBackedQty, or an off-inventory
// ("prep as custom item") unit would still count against the model's stock.
// A static check by design — a new demand site belongs on this list.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = resolve(__dirname, "..");
const DEMAND_SITES = [
  "convex/lib/availabilityCore.ts",
  "convex/availability.ts",
  "convex/lib/overbookingBoard.ts",
  "src/lib/overbooking-core.ts",
  "src/server/line-items.ts",
];

describe("stockBackedQty demand-site guard", () => {
  test.each(DEMAND_SITES)("%s sums stock demand through stockBackedQty", (file) => {
    expect(readFileSync(resolve(ROOT, file), "utf8")).toContain("stockBackedQty(");
  });
});
