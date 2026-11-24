// @vitest-environment jsdom
//
// Home's ONE setup panel (UX Phase 11, §6c.2): "Finish setup" (C6, #1104) and
// "Get started" (D1, #1105) as one progress line and one list. Every row is
// derived from real org state, the panel is gone once both halves are dismissed
// or complete, and Dismiss now has an Undo that removes exactly the rows it
// created. Rendered inside a real DashboardCard, since the count and Dismiss
// portal into the card's header.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const DONE_ACTIVATION = {
  firstModelId: "m1",
  firstModelName: "Aura PXL",
  hasModel: true,
  hasAssetOnFirstModel: true,
  firstProjectId: "p1",
  firstProjectName: "Gala",
  hasProject: true,
  hasModelLineItemOnFirstProject: true,
};

const mocks = vi.hoisted(() => ({
  org: { data: { settings: {} } as Record<string, unknown> | undefined, isLoading: false },
  locations: [] as unknown[] | undefined,
  members: { data: [] as unknown[], isLoading: false },
  invites: { data: [] as unknown[] | undefined, isLoading: false },
  setupDismissedAt: null as number | null | undefined,
  activation: undefined as Record<string, unknown> | undefined,
  activationDismissedAt: null as number | null | undefined,
  setupDismiss: vi.fn(async (): Promise<string | null> => "setup-row"),
  setupUndismiss: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  activationDismiss: vi.fn(async (): Promise<string | null> => "act-row"),
  activationUndismiss: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  toast: vi.fn(),
  captured: [] as [string, unknown][],
}));

vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => mocks.org }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => mocks.locations }));
vi.mock("@/hooks/use-org-members", () => ({ useOrgMembers: () => mocks.members }));
vi.mock("@/hooks/use-pending-invitations", () => ({ usePendingInvitations: () => mocks.invites }));
vi.mock("@/hooks/use-setup-dismissal", () => ({
  useSetupDismissal: () => ({ dismissedAt: mocks.setupDismissedAt, dismiss: mocks.setupDismiss, undismiss: mocks.setupUndismiss }),
}));
vi.mock("@/hooks/use-activation-milestones", () => ({
  useActivationMilestones: () => mocks.activation,
  useActivationMilestoneAnalytics: () => undefined,
}));
vi.mock("@/hooks/use-activation-dismissal", () => ({
  useActivationDismissal: () => ({
    dismissedAt: mocks.activationDismissedAt,
    dismiss: mocks.activationDismiss,
    undismiss: mocks.activationUndismiss,
  }),
}));
vi.mock("@/lib/analytics", () => ({
  capture: (event: string, props: unknown) => mocks.captured.push([event, props]),
  AnalyticsEvent: { ActivationChecklistDismissed: "activation_checklist_dismissed" },
}));
vi.mock("sonner", () => ({ toast: Object.assign(mocks.toast, { success: mocks.toast, error: vi.fn() }) }));

import { SetupPanel } from "../setup-panel";
import { DashboardCard } from "../dashboard-card";

function renderPanel() {
  return render(<DashboardCard title="Finish setup" editMode={false} widget={<SetupPanel orgId="org1" />} />);
}

/** The Undo onClick the last toast offered. */
function lastUndo(): (() => Promise<void>) | undefined {
  const opts = mocks.toast.mock.calls.at(-1)?.[1] as { action?: { onClick: () => Promise<void> } } | undefined;
  return opts?.action?.onClick;
}

beforeEach(() => {
  mocks.org = { data: { settings: {} }, isLoading: false };
  mocks.locations = [];
  mocks.members = { data: [], isLoading: false };
  mocks.invites = { data: [], isLoading: false };
  mocks.setupDismissedAt = null;
  mocks.activation = { ...DONE_ACTIVATION };
  mocks.activationDismissedAt = null;
  mocks.setupDismiss.mockReset().mockResolvedValue("setup-row");
  mocks.activationDismiss.mockReset().mockResolvedValue("act-row");
  mocks.setupUndismiss.mockClear();
  mocks.activationUndismiss.mockClear();
  mocks.toast.mockClear();
  mocks.captured = [];
});

describe("SetupPanel (smoke)", () => {
  it("renders no rows while a read is loading (pending invites included, so Team never flashes unfinished), but holds its place", () => {
    mocks.invites = { data: undefined, isLoading: true };
    renderPanel();
    expect(screen.queryByText("Invite your team")).toBeNull();
    // The slot's height is reserved while it loads (no layout shift when it lands).
    expect(screen.getByLabelText("Loading the setup panel")).toBeDefined();
  });

  it("one half failing to dismiss still offers Undo for the half that DID, and analytics fire only for a real dismissal", async () => {
    mocks.activation = { ...DONE_ACTIVATION, hasProject: false, hasModelLineItemOnFirstProject: false };
    mocks.activationDismiss.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls.at(-1)?.[0]).toBe("Setup panel partly dismissed");
    // The activation half failed: no analytics for it.
    expect(mocks.captured).toEqual([]);
    await lastUndo()!();
    expect(mocks.setupUndismiss).toHaveBeenCalledWith("setup-row");
    expect(mocks.activationUndismiss).not.toHaveBeenCalled();
  });

  it("renders nothing once both halves are dismissed or complete", () => {
    mocks.setupDismissedAt = Date.now();
    renderPanel();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByText("Add your logo")).toBeNull();
  });

  it("shows the setup half with destination words and the count in the card header", async () => {
    mocks.org = { data: { settings: { currency: "AUD" } }, isLoading: false };
    renderPanel();
    expect(await screen.findByText("1 of 4")).toBeTruthy();
    expect(screen.getByText("Set your currency and tax details").className).toContain("line-through");
    const logo = screen.getByText("Add your logo").closest("a");
    expect(logo?.getAttribute("href")).toBe("/settings/branding");
    expect(logo?.textContent).toContain("Branding ›");
    // Activation is all done in this fixture, so only the setup half shows.
    expect(screen.queryByText("Create your first job")).toBeNull();
  });

  it("counts pending invites toward the team row", async () => {
    mocks.members = { data: [{ id: "owner" }], isLoading: false };
    mocks.invites = { data: [{ id: "inv1" }], isLoading: false };
    renderPanel();
    expect((await screen.findByText("Invite your team")).className).toContain("line-through");
  });

  it("merges the Get started half into the same panel while it is incomplete", async () => {
    mocks.activation = { ...DONE_ACTIVATION, hasModelLineItemOnFirstProject: false };
    renderPanel();
    expect(await screen.findByText("Put that gear on the job")).toBeTruthy();
    expect(screen.getByText("Put that gear on the job").closest("a")?.getAttribute("href")).toBe("/projects/p1?tab=equipment");
    expect(screen.getByText("Aura PXL")).toBeTruthy();
    expect(screen.getByText("3 of 8")).toBeTruthy();
  });

  it("Dismiss → toast with Undo, and Undo removes exactly the rows that Dismiss created", async () => {
    mocks.activation = { ...DONE_ACTIVATION, hasProject: false, hasModelLineItemOnFirstProject: false };
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls.at(-1)?.[0]).toBe("Setup panel dismissed");
    expect(mocks.setupDismiss).toHaveBeenCalledTimes(1);
    expect(mocks.activationDismiss).toHaveBeenCalledTimes(1);
    expect(mocks.captured).toEqual([["activation_checklist_dismissed", { milestones_done: 2 }]]);

    await lastUndo()!();
    expect(mocks.setupUndismiss).toHaveBeenCalledWith("setup-row");
    expect(mocks.activationUndismiss).toHaveBeenCalledWith("act-row");
  });

  it("offers no Undo when the dismissal already existed (nothing was created)", async () => {
    mocks.setupDismiss.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(lastUndo()).toBeUndefined();
    expect(mocks.activationDismiss).not.toHaveBeenCalled();
  });
});
