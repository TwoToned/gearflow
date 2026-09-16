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
});
