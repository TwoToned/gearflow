// @vitest-environment node
// D50 / Q5 — the check condition words and when a check writes (convex/lib/assetCondition.ts).
import { describe, expect, test } from "vitest";
import { CHECK_CONDITION_VALUE, conditionWord, resolveCheckCondition } from "./assetCondition";

describe("conditionWord", () => {
  test.each([
    [undefined, "Good"], [null, "Good"], ["NEW", "Good"], ["GOOD", "Good"],
    ["FAIR", "Worn"], ["POOR", "Worn"], ["DAMAGED", "Damaged"],
  ] as const)("%s reads %s", (stored, word) => {
    expect(conditionWord(stored)).toBe(word);
  });

  test("each word's value reads back as that word", () => {
    for (const [word, value] of Object.entries(CHECK_CONDITION_VALUE)) expect(conditionWord(value)).toBe(word);
  });
});

describe("resolveCheckCondition", () => {
  test("writes only a changed word", () => {
    expect(resolveCheckCondition("NEW", "GOOD", false)).toBeNull();
    expect(resolveCheckCondition(undefined, "GOOD", false)).toBeNull();
    expect(resolveCheckCondition("POOR", "FAIR", false)).toBeNull();
    expect(resolveCheckCondition("GOOD", "FAIR", false)).toBe("FAIR");
    expect(resolveCheckCondition("DAMAGED", "GOOD", false)).toBe("GOOD");
  });

  test("any fail forces DAMAGED, whatever was chosen", () => {
    expect(resolveCheckCondition("GOOD", "GOOD", true)).toBe("DAMAGED");
    expect(resolveCheckCondition("NEW", undefined, true)).toBe("DAMAGED");
    expect(resolveCheckCondition("DAMAGED", "GOOD", true)).toBeNull(); // already Damaged
  });

  test("no choice and no fail writes nothing", () => {
    expect(resolveCheckCondition("FAIR", undefined, false)).toBeNull();
  });
});
