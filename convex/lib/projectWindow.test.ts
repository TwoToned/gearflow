// @vitest-environment node
//
// convex/lib/projectWindow.ts — the Convex-side copy of getProjectWindow. Pinned
// against src/lib/project-window.ts by a cross-import equality matrix (same
// pattern as availabilityCore.test.ts's stock-math pin).
import { describe, test, expect } from "vitest";
import { getProjectWindow as coreWindow } from "./projectWindow";
import { getProjectWindow as origWindow } from "@/lib/project-window";

describe("convex/lib/projectWindow byte-for-byte pin", () => {
  test("matches src/lib/project-window over every combination of set/unset fields", () => {
    const values = [undefined, null, 100, 200];
    for (const projectStartDate of values) {
      for (const projectEndDate of values) {
        for (const rentalStartDate of values) {
          for (const rentalEndDate of values) {
            const input = { projectStartDate, projectEndDate, rentalStartDate, rentalEndDate };
            expect(coreWindow(input)).toEqual(origWindow(input));
          }
        }
      }
    }
  });
});
