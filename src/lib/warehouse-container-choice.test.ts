import { describe, it, expect } from "vitest";
import { isLooseChosen } from "./warehouse-container-choice";

describe("warehouse container choice", () => {
  it("nothing chosen is not Loose", () => {
    expect(isLooseChosen(undefined)).toBe(false);
  });
  it("Loose is chosen only when null", () => {
    expect(isLooseChosen(null)).toBe(true);
  });
  it("a case id is not Loose", () => {
    expect(isLooseChosen("c1")).toBe(false);
  });
});
