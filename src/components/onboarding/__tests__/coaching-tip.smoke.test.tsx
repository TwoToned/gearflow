// @vitest-environment jsdom
//
// Smoke test for D2 (#1106)'s helper-rail coaching drop-in: shows coaching
// copy only while its milestone is the org's active one, falls back to the
// form's own ordinary hint otherwise, and "Hide tips" suppresses coaching
// without touching the milestone data itself.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  activeKey: null as string | null | undefined,
  hidden: false,
  setHidden: vi.fn(),
}));

vi.mock("@/hooks/use-activation-milestones", () => ({
  useActiveMilestoneKey: () => mocks.activeKey,
}));
vi.mock("@/hooks/use-persistent-pref", () => ({
  usePersistentPref: () => [mocks.hidden, mocks.setHidden],
}));

import { CoachingTip } from "../coaching-tip";

beforeEach(() => {
  mocks.activeKey = null;
  mocks.hidden = false;
  mocks.setHidden.mockClear();
});

describe("CoachingTip (smoke)", () => {
  it("shows the form's ordinary fallback hint when this milestone isn't the active one", () => {
    mocks.activeKey = "asset";
    render(
      <CoachingTip orgId="org1" milestoneKey="model" fallbackEyebrow="New model" fallbackTip="Ordinary hint" />,
    );
    expect(screen.getByText("New model")).toBeTruthy();
    expect(screen.getByText("Ordinary hint")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hide tips/i })).toBeNull();
  });

  it("shows coaching copy + a Hide tips control when this milestone IS the active one", () => {
    mocks.activeKey = "model";
    render(
      <CoachingTip orgId="org1" milestoneKey="model" fallbackEyebrow="New model" fallbackTip="Ordinary hint" />,
    );
    expect(screen.getByText(/spec sheet for something you rent/)).toBeTruthy();
    expect(screen.queryByText("Ordinary hint")).toBeNull();
    expect(screen.getByRole("button", { name: /hide tips/i })).toBeTruthy();
  });

  it("falls back to the ordinary hint once tips are hidden, even while active", () => {
    mocks.activeKey = "model";
    mocks.hidden = true;
    render(
      <CoachingTip orgId="org1" milestoneKey="model" fallbackEyebrow="New model" fallbackTip="Ordinary hint" />,
    );
    expect(screen.getByText("Ordinary hint")).toBeTruthy();
  });

  it("clicking Hide tips calls the setter", async () => {
    mocks.activeKey = "model";
    const user = userEvent.setup();
    render(
      <CoachingTip orgId="org1" milestoneKey="model" fallbackEyebrow="New model" fallbackTip="Ordinary hint" />,
    );
    await user.click(screen.getByRole("button", { name: /hide tips/i }));
    expect(mocks.setHidden).toHaveBeenCalledWith(true);
  });

  it("hideWhenInactive renders nothing instead of a fallback block", () => {
    mocks.activeKey = "asset";
    const { container } = render(
      <CoachingTip orgId="org1" milestoneKey="lineItem" fallbackEyebrow="" fallbackTip="" hideWhenInactive />,
    );
    expect(container.firstChild).toBeNull();
  });
});
