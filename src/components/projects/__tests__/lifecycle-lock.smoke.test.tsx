// @vitest-environment jsdom
//
// #1230: `JustificationDialog`, `UnlockSessionDialog` and `UnlockSessionBanner`
// (and the whole freeform-justification / unlock-session mechanism they
// belonged to) are deleted along with the 4-tier lock system. `UnpricedBadge`
// survives — a $0-defaulted row still needs the badge regardless of how
// pricingLocked reached true — so its render-time smoke coverage (a Radix
// Tooltip missing its TooltipProvider passes typecheck/lint/build and only
// crashes at render time, per CLAUDE.md's overlay-test rule) stays here.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { UnpricedBadge } from "@/components/projects/unpriced-badge";

describe("UnpricedBadge smoke", () => {
  it("renders with its own TooltipProvider (no global provider in this app)", async () => {
    render(<UnpricedBadge />);
    expect(screen.getByText("Unpriced")).toBeTruthy();
  });
});
