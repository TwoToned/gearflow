import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexErrorMessage } from "./convex-error-message";

describe("convexErrorMessage", () => {
  it("unwraps a structured { code, message } ConvexError payload", () => {
    const e = new ConvexError({ code: "QUOTE_STATE_INVALID", message: "Can't accept it — it is superseded." });
    expect(convexErrorMessage(e, "fallback")).toBe("Can't accept it — it is superseded.");
  });

  it("unwraps a bare-string ConvexError payload", () => {
    const e = new ConvexError("Invoice not found: i1");
    expect(convexErrorMessage(e, "fallback")).toBe("Invoice not found: i1");
  });

  it("falls back for a ConvexError with no usable data", () => {
    const e = new ConvexError({ code: "SOMETHING" });
    expect(convexErrorMessage(e, "fallback")).toBe("fallback");
  });

  it("never returns the ConvexError's own raw .message wrapper", () => {
    const e = new ConvexError({ code: "X", message: "Real reason." });
    // Sanity check on the fixture itself: `.message` is NOT what we want surfaced.
    expect(e.message).not.toBe("Real reason.");
    expect(convexErrorMessage(e, "fallback")).toBe("Real reason.");
  });

  it("passes through a plain Error's message", () => {
    expect(convexErrorMessage(new Error("No active organization"), "fallback")).toBe("No active organization");
  });

  it("falls back for a non-Error value", () => {
    expect(convexErrorMessage("nope", "fallback")).toBe("fallback");
    expect(convexErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("masked Convex server errors", () => {
  it("never shows the [CONVEX M(...)] wrapper, keeps the request id", () => {
    const e = new Error("[CONVEX M(warehouseWrites:checkOutKitsBatch)] [Request ID: 14c6ba53f5ca59c4] Server Error");
    const msg = convexErrorMessage(e, "fallback");
    expect(msg).not.toMatch(/CONVEX|Server Error/);
    expect(msg).toContain("14c6ba53f5ca59c4");
  });
});
