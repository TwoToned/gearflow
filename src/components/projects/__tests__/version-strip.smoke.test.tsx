// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.2) — the
// three-state VersionStrip. Renders (not just type-checks) each state to
// catch the TooltipProvider-missing crash class (GatedButton's own tooltip,
// used in state 3) the same way `model-roi-tab.smoke.test.tsx` does.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// `<CanDo resource="project" action="update">` gates the Make-live/Unlock
// actions — stub it open so the buttons render without a real session/org
// (mirrors project-version-switcher.smoke.test.tsx's mockUseCanDo).
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));

import { VersionStrip } from "@/components/projects/version-strip";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

const LIVE_VERSION: ProjectVersionSummary = {
  id: "v4",
  number: 4,
  isLive: true,
  contentState: "ready",
  createdAt: 1,
  createdById: "u1",
};

const VIEWING_VERSION: ProjectVersionSummary = {
  id: "v3",
  number: 3,
  label: "With LED wall",
  isLive: false,
  contentState: "ready",
  createdAt: 1,
  createdById: "u1",
};

const UNLOCKED = { loading: false, pricingLocked: false, canUnlockPricing: true };
const LOCKED = { loading: false, pricingLocked: true, canUnlockPricing: true, pricingLockedAt: Date.now(), pricingLockedByName: "Jayden" };

function baseProps(overrides: Partial<React.ComponentProps<typeof VersionStrip>> = {}) {
  return {
    isTemplate: false,
    isViewingVersion: false,
    viewingVersion: null,
    liveVersion: LIVE_VERSION,
    onMakeLive: vi.fn(),
    onBackToLive: vi.fn(),
    lockStatus: UNLOCKED,
    onUnlock: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("VersionStrip smoke", () => {
  it("state 1 — absent: live + unlocked renders nothing", () => {
    const { container } = render(<VersionStrip {...baseProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a template regardless of lock state", () => {
    const { container } = render(<VersionStrip {...baseProps({ isTemplate: true, lockStatus: LOCKED })} />);
    expect(container.firstChild).toBeNull();
  });

  it("state 2 — viewing a non-live version: offers Make live and Back to live", () => {
    const onMakeLive = vi.fn();
    const onBackToLive = vi.fn();
    render(
      <VersionStrip
        {...baseProps({ isViewingVersion: true, viewingVersion: VIEWING_VERSION, onMakeLive, onBackToLive })}
      />,
    );
    expect(screen.getByText(/v3 · With LED wall/)).toBeTruthy();
    expect(screen.getByText(/fully editable/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /make v3 live/i }));
    expect(onMakeLive).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /back to live/i }));
    expect(onBackToLive).toHaveBeenCalled();
  });

  it("state 3 — live + pricing locked: renders the Unlock pricing action (GatedButton's own TooltipProvider doesn't crash)", () => {
    expect(() => render(<VersionStrip {...baseProps({ lockStatus: LOCKED })} />)).not.toThrow();
    expect(screen.getByRole("button", { name: /unlock pricing/i })).toBeTruthy();
  });

  it("state 2 takes priority over state 3 — pricing-locked is irrelevant while viewing a non-live version", () => {
    render(
      <VersionStrip
        {...baseProps({ isViewingVersion: true, viewingVersion: VIEWING_VERSION, lockStatus: LOCKED })}
      />,
    );
    expect(screen.getByRole("button", { name: /make v3 live/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unlock pricing/i })).toBeNull();
  });

  it("clicking Unlock pricing calls onUnlock", async () => {
    const onUnlock = vi.fn(async () => {});
    render(<VersionStrip {...baseProps({ lockStatus: LOCKED, onUnlock })} />);
    fireEvent.click(screen.getByRole("button", { name: /unlock pricing/i }));
    expect(onUnlock).toHaveBeenCalled();
  });

  // #1233 (Phase 6) — the drift DETECTION signal, plain text, no click target.
  describe("quoteDrift (#1233)", () => {
    it("renders a drift line when the viewed version's total has moved since it was sent", () => {
      render(
        <VersionStrip
          {...baseProps({
            isViewingVersion: true,
            viewingVersion: VIEWING_VERSION,
            quoteDrift: { quoteLabel: "RVLT-2026-0087 v3", driftAmount: 1240 },
          })}
        />,
      );
      expect(screen.getByText(/Quote total has moved \+\$1,240\.00 since RVLT-2026-0087 v3 was sent/)).toBeTruthy();
    });

    it("shows a negative drift with a minus sign", () => {
      render(
        <VersionStrip
          {...baseProps({
            isViewingVersion: true,
            viewingVersion: VIEWING_VERSION,
            quoteDrift: { quoteLabel: "RVLT-2026-0087 v3", driftAmount: -50.5 },
          })}
        />,
      );
      expect(screen.getByText(/-\$50\.50/)).toBeTruthy();
    });

    it("renders no drift line when driftAmount is exactly zero (nothing has moved)", () => {
      render(
        <VersionStrip
          {...baseProps({
            isViewingVersion: true,
            viewingVersion: VIEWING_VERSION,
            quoteDrift: { quoteLabel: "RVLT-2026-0087 v3", driftAmount: 0 },
          })}
        />,
      );
      expect(screen.queryByText(/Quote total has moved/)).toBeNull();
    });

    it("renders no drift line when quoteDrift is null (no quote ever sent for this version)", () => {
      render(
        <VersionStrip
          {...baseProps({ isViewingVersion: true, viewingVersion: VIEWING_VERSION, quoteDrift: null })}
        />,
      );
      expect(screen.queryByText(/Quote total has moved/)).toBeNull();
    });

    it("the drift line is plain text when no onOpenDriftCompare handler is wired (defensive default)", () => {
      render(
        <VersionStrip
          {...baseProps({
            isViewingVersion: true,
            viewingVersion: VIEWING_VERSION,
            quoteDrift: { quoteLabel: "RVLT-2026-0087 v3", driftAmount: 1240 },
          })}
        />,
      );
      const driftText = screen.getByText(/Quote total has moved/);
      expect(driftText.closest("a")).toBeNull();
      expect(driftText.closest("button")).toBeNull();
    });

    // #1232 (Phase 5b, D53) — the drift line's real click target: opens
    // Compare with side A = the sent quote's frozen money snapshot.
    it("becomes a button that calls onOpenDriftCompare when wired", () => {
      const onOpenDriftCompare = vi.fn();
      render(
        <VersionStrip
          {...baseProps({
            isViewingVersion: true,
            viewingVersion: VIEWING_VERSION,
            quoteDrift: { quoteLabel: "RVLT-2026-0087 v3", driftAmount: 1240 },
            onOpenDriftCompare,
          })}
        />,
      );
      const driftButton = screen.getByText(/Quote total has moved/).closest("button");
      expect(driftButton).toBeTruthy();
      fireEvent.click(driftButton!);
      expect(onOpenDriftCompare).toHaveBeenCalledTimes(1);
    });
  });
});
