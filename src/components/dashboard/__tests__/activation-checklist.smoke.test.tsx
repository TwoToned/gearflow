// @vitest-environment jsdom
//
// Smoke test for the dashboard's "Get started" activation checklist (D1,
// #1105): every milestone is derived from the org's real
// models/assets/projects/line items — nothing here tracks "step N done" —
// and the card disappears for good once dismissed OR every milestone is
// complete, per D5/R-3.1.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const EMPTY_STATE = {
  firstModelId: null as string | null,
  firstModelName: null as string | null,
  hasModel: false,
  hasAssetOnFirstModel: false,
  firstProjectId: null as string | null,
  firstProjectName: null as string | null,
  hasProject: false,
  hasModelLineItemOnFirstProject: false,
};

const mocks = vi.hoisted(() => ({
  state: undefined as typeof EMPTY_STATE | undefined,
  dismissedAt: null as number | null | undefined,
  dismiss: vi.fn(async () => undefined),
  captured: [] as [string, unknown][],
}));

vi.mock("@/hooks/use-activation-milestones", () => ({
  useActivationMilestones: () => mocks.state,
  // D4 (#1108) — analytics side-effect hook; out of scope for this
  // component's own behavior tests (has its own coverage).
  useActivationMilestoneAnalytics: () => undefined,
}));
vi.mock("@/hooks/use-activation-dismissal", () => ({
  useActivationDismissal: () => ({ dismissedAt: mocks.dismissedAt, dismiss: mocks.dismiss }),
}));
vi.mock("@/lib/analytics", () => ({
  capture: (event: string, props: unknown) => mocks.captured.push([event, props]),
  AnalyticsEvent: { ActivationChecklistDismissed: "activation_checklist_dismissed" },
}));

import { ActivationChecklist } from "../activation-checklist";

beforeEach(() => {
  mocks.state = { ...EMPTY_STATE };
  mocks.dismissedAt = null;
  mocks.dismiss.mockClear();
  mocks.captured = [];
});

describe("ActivationChecklist (smoke)", () => {
  it("renders nothing while milestones are still loading", () => {
    mocks.state = undefined;
    const { container } = render(<ActivationChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the dismissal read is still loading", () => {
    mocks.dismissedAt = undefined;
    const { container } = render(<ActivationChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once dismissed, even with unfinished milestones", async () => {
    mocks.dismissedAt = Date.now();
    const { container } = render(<ActivationChecklist orgId="org1" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders nothing once every milestone is complete", () => {
    mocks.state = {
      firstModelId: "m1",
      firstModelName: "MAC Aura XB",
      hasModel: true,
      hasAssetOnFirstModel: true,
      firstProjectId: "p1",
      firstProjectName: "Corporate Gala",
      hasProject: true,
      hasModelLineItemOnFirstProject: true,
    };
    const { container } = render(<ActivationChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows progress, the done row's meta chip, and the active row's inline CTA", async () => {
    mocks.state = {
      ...EMPTY_STATE,
      firstModelId: "m1",
      firstModelName: "MAC Aura XB",
      hasModel: true,
    };
    render(<ActivationChecklist orgId="org1" />);

    expect(await screen.findByText("1 / 4")).toBeTruthy();
    expect(screen.getByText("Add a piece of gear you own").className).toContain("line-through");
    expect(screen.getByText("MAC Aura XB")).toBeTruthy();

    // Only the active (next incomplete) row gets an inline CTA link.
    const ctas = screen.getAllByRole("link");
    expect(ctas).toHaveLength(1);
    expect(ctas[0].textContent).toBe("Add an asset");
    expect(ctas[0].getAttribute("href")).toBe("/assets/registry/new?modelId=m1");
  });

  it("links the first CTA to model creation when nothing exists yet", async () => {
    render(<ActivationChecklist orgId="org1" />);
    const cta = await screen.findByRole("link", { name: "Add a model" });
    expect(cta.getAttribute("href")).toBe("/assets/models/new");
  });

  it("links the line-item CTA to the first project's equipment tab", async () => {
    mocks.state = {
      ...EMPTY_STATE,
      firstModelId: "m1",
      firstModelName: "MAC Aura XB",
      hasModel: true,
      hasAssetOnFirstModel: true,
      firstProjectId: "p1",
      firstProjectName: "Corporate Gala",
      hasProject: true,
    };
    render(<ActivationChecklist orgId="org1" />);
    const cta = await screen.findByRole("link", { name: "Add it to the job" });
    expect(cta.getAttribute("href")).toBe("/projects/p1?tab=equipment");
  });

  it("clicking Dismiss calls the dismiss mutation", async () => {
    const user = userEvent.setup();
    render(<ActivationChecklist orgId="org1" />);

    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(mocks.dismiss).toHaveBeenCalled();
  });

  it("fires activation_checklist_dismissed with the count of milestones already done at dismiss time (D4, #1108)", async () => {
    mocks.state = {
      ...EMPTY_STATE,
      firstModelId: "m1",
      firstModelName: "MAC Aura XB",
      hasModel: true,
      hasAssetOnFirstModel: true,
    };
    const user = userEvent.setup();
    render(<ActivationChecklist orgId="org1" />);

    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(mocks.captured).toEqual([["activation_checklist_dismissed", { milestones_done: 2 }]]);
  });
});
