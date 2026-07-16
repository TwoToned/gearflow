// @vitest-environment node
//
// Pins the Convex-side getUserColor / COLLAB_COLORS port (convex/lib/collaborationColors.ts)
// byte-for-byte to the src canonical (@/lib/collaboration-colors), so the avatar colour a
// browser-direct collaboration mutation recomputes from the pinned actor matches what the
// UI derives client-side.
import { describe, test, expect } from "vitest";
import { getUserColor as convexColor, COLLAB_COLORS as convexPalette } from "./lib/collaborationColors";
import { getUserColor as srcColor, COLLAB_COLORS as srcPalette } from "../src/lib/collaboration-colors";

describe("collaborationColors port parity", () => {
  test("palettes are identical", () => {
    expect([...convexPalette]).toEqual([...srcPalette]);
  });

  test("getUserColor agrees across a range of ids", () => {
    const ids = ["", "u", "user_1", "user_2", "abc123", "a".repeat(50), "cuid_zx8y7", "🙂emoji"];
    for (const id of ids) {
      expect(convexColor(id)).toBe(srcColor(id));
    }
  });
});
