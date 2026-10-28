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

// The raw-quantity forms these sites used before they moved onto stockBackedQty. A
// regression that reintroduces one (even alongside an unrelated stockBackedQty call
// elsewhere in the file) fails here.
const RAW_DEMAND_FORMS: Record<string, RegExp[]> = {
  "convex/lib/availabilityCore.ts": [/sum \+ \(li\.quantity \?\? 0\)/],
  "convex/lib/overbookingBoard.ts": [/const qty = li\.quantity \?\? 0/],
  "src/lib/overbooking-core.ts": [/bumpTotal\(li\.modelId, li\.quantity\)/, /bumpClaim\([^)]*li\.quantity/],
  "src/server/line-items.ts": [/quantity: li\.quantity \?\? 0/],
};

describe("stockBackedQty demand-site guard", () => {
  test.each(Object.entries(RAW_DEMAND_FORMS))("%s no longer sums raw quantity as stock demand", (file, forms) => {
    const src = readFileSync(resolve(ROOT, file), "utf8");
    for (const re of forms) expect(src).not.toMatch(re);
  });

  test.each(DEMAND_SITES)("%s sums stock demand through stockBackedQty", (file) => {
    expect(readFileSync(resolve(ROOT, file), "utf8")).toContain("stockBackedQty(");
  });
});
