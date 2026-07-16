// @vitest-environment node
//
// convex/lib/projectNumber.ts — the PURE project-number renderers the native
// createNative auto-number loop needs. The Convex bundler can't resolve `@/`, so
// they're duplicated byte-for-byte from src/lib/project-number.ts. This test PINS
// the duplication: it imports BOTH copies and asserts identical output over a
// matrix (same pattern as convex/availabilityCore.test.ts).
import { describe, test, expect } from "vitest";
import {
  renderProjectNumber as convexRender,
  scopeKeyFor as convexScope,
  datePartsInTimezone as convexParts,
  hasIncrementToken as convexHasInc,
  type IncrementReset,
} from "./lib/projectNumber";
import {
  renderProjectNumber as srcRender,
  scopeKeyFor as srcScope,
  datePartsInTimezone as srcParts,
  hasIncrementToken as srcHasInc,
} from "@/lib/project-number";

const RESETS: IncrementReset[] = ["NONE", "YEARLY", "MONTHLY", "DAILY"];
const FORMATS = [
  "%YY%MM%INC",
  "%YYYY-%INCREMENT",
  "P-%YYYY%MM%DD-%SEQ",
  "%M/%D/%YY #%INC",
  "JOB%SEQ",
  "no-token-here",
  "%INCREMENT",
];
const PARTS = [
  { year: 2026, month: 6, day: 5 },
  { year: 2026, month: 12, day: 31 },
  { year: 2000, month: 1, day: 1 },
  { year: 2026, month: 7, day: 8 },
];

describe("projectNumber renderers — convex/lib == src/lib (byte-for-byte pin)", () => {
  test("hasIncrementToken matches over every format", () => {
    for (const f of FORMATS) {
      expect(convexHasInc(f)).toBe(srcHasInc(f));
    }
  });

  test("scopeKeyFor matches over every reset × parts", () => {
    for (const reset of RESETS) {
      for (const parts of PARTS) {
        expect(convexScope(reset, parts)).toBe(srcScope(reset, parts));
      }
    }
  });

  test("renderProjectNumber matches over every format × parts × padding × sequence", () => {
    for (const format of FORMATS) {
      for (const parts of PARTS) {
        for (const padding of [1, 2, 4]) {
          for (const sequence of [1, 7, 42, 1000]) {
            expect(convexRender(format, { parts, sequence, padding })).toBe(
              srcRender(format, { parts, sequence, padding }),
            );
          }
        }
      }
    }
  });

  test("renderProjectNumber default padding matches (padding omitted)", () => {
    for (const format of FORMATS) {
      expect(convexRender(format, { parts: PARTS[0], sequence: 3 })).toBe(
        srcRender(format, { parts: PARTS[0], sequence: 3 }),
      );
    }
  });

  test("datePartsInTimezone matches over a set of dates + zones", () => {
    const dates = [new Date("2026-06-05T12:00:00Z"), new Date("2026-12-31T23:30:00Z"), new Date("2026-01-01T00:15:00Z")];
    const zones: (string | undefined)[] = [undefined, "UTC", "Australia/Sydney", "America/Los_Angeles", "not-a-zone"];
    for (const d of dates) {
      for (const z of zones) {
        expect(convexParts(d, z)).toEqual(srcParts(d, z));
      }
    }
  });
});
