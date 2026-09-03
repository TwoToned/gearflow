import { describe, test, expect } from "vitest";
import { ConvexError } from "convex/values";
import { mapNativeWriteError } from "./native-writes";
import { UserFacingError } from "./errors/user-facing-error";

describe("mapNativeWriteError", () => {
  test("maps a lifecycle-lock ConvexError to its friendly UserFacingError", () => {
    // Regression: use-project-service-writes.ts used to let this ConvexError
    // propagate raw, so the panel's `toast.error(e.message)` showed the ugly
    // `Uncaught ConvexError: {"code":"FINANCIALS_LOCKED",...}` JSON instead of
    // the mapped message below.
    const raw = new ConvexError({
      code: "FINANCIALS_LOCKED",
      message: "This project's financials are locked. Open an unlock session (Financials tab) to edit money fields.",
    });
    const mapped = mapNativeWriteError(raw);
    expect(mapped).toBeInstanceOf(UserFacingError);
    expect((mapped as UserFacingError).code).toBe("FINANCIALS_LOCKED");
    expect((mapped as UserFacingError).title).toBe("Financials are locked");
    expect((mapped as UserFacingError).message).toBe(
      "This project's financials are locked. Open an unlock session (Financials tab) to edit money fields.",
    );
  });

  test("unrecognised ConvexError code passes through unchanged", () => {
    const raw = new ConvexError({ code: "SOME_UNMAPPED_CODE", message: "x" });
    expect(mapNativeWriteError(raw)).toBe(raw);
  });

  test("non-ConvexError values pass through unchanged", () => {
    const raw = new Error("boom");
    expect(mapNativeWriteError(raw)).toBe(raw);
  });
});
