import { describe, test, expect } from "vitest";
import { getProjectWindow } from "./project-window";

describe("getProjectWindow", () => {
  test("coalesces to the rental window when the project window is entirely unset", () => {
    expect(getProjectWindow({ rentalStartDate: 100, rentalEndDate: 200 })).toEqual({
      start: 100,
      end: 200,
    });
  });

  test("prefers the project window when both are set", () => {
    expect(
      getProjectWindow({
        projectStartDate: 50,
        projectEndDate: 250,
        rentalStartDate: 100,
        rentalEndDate: 200,
      }),
    ).toEqual({ start: 50, end: 250 });
  });

  test("resolves each side independently — partial project window", () => {
    // Only projectStartDate diverges (an earlier load-in); end stays the rental end.
    expect(
      getProjectWindow({ projectStartDate: 50, rentalStartDate: 100, rentalEndDate: 200 }),
    ).toEqual({ start: 50, end: 200 });

    // Only projectEndDate diverges (a later load-out); start stays the rental start.
    expect(
      getProjectWindow({ projectEndDate: 250, rentalStartDate: 100, rentalEndDate: 200 }),
    ).toEqual({ start: 100, end: 250 });
  });

  test("null is both a valid absent-value input and a valid absent-value output", () => {
    expect(getProjectWindow({})).toEqual({ start: null, end: null });
    expect(
      getProjectWindow({
        projectStartDate: null,
        projectEndDate: null,
        rentalStartDate: null,
        rentalEndDate: null,
      }),
    ).toEqual({ start: null, end: null });
  });

  test("dateless project (no rental window either) resolves to null on both sides", () => {
    expect(getProjectWindow({ projectStartDate: undefined, rentalStartDate: undefined })).toEqual({
      start: null,
      end: null,
    });
  });
});
