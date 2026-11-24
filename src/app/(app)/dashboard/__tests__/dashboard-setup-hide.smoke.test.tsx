// @vitest-environment jsdom
//
// Customise › ✕ on the setup panel, with the REAL SetupPanel (only its data
// hooks are stubbed). The two setup kinds are one panel: hiding it must hide
// both slots in one change (one toast, one Undo) — removing only the clicked
// slot used to promote the other and the panel stayed — and Add widget must
// offer the panel again once it is gone.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({
  push: vi.fn(),
  toast: vi.fn(),
  save: vi.fn(async () => undefined),
}));

const FULL = { project: ["read", "create", "update"], asset: ["read", "create"], warehouse: ["read"], invoice: ["read"], crew: ["read"], subHire: ["read"], supplier: ["read"], maintenance: ["read"], reports: ["view"] };

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1", name: "Two Toned" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Jayden Cole" } } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: FULL, isLoading: false }),
  useCanDo: (r: string, a: string) => (FULL as Record<string, string[]>)[r]?.includes(a) ?? false,
}));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => null }));
vi.mock("convex/react", () => ({ useMutation: () => m.save }));
vi.mock("@/hooks/use-project-tasks-writes", () => ({ useProjectTaskWrites: () => ({ update: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(m.toast, { success: m.toast, error: vi.fn() }) }));

// The setup panel's own reads: "Finish setup" has work to do, "Get started" is complete.
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => ({ data: { settings: {} }, isLoading: false }) }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-org-members", () => ({ useOrgMembers: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/use-pending-invitations", () => ({ usePendingInvitations: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/use-setup-dismissal", () => ({
  useSetupDismissal: () => ({ dismissedAt: null, dismiss: vi.fn(), undismiss: vi.fn() }),
}));
vi.mock("@/hooks/use-activation-dismissal", () => ({
  useActivationDismissal: () => ({ dismissedAt: null, dismiss: vi.fn(), undismiss: vi.fn() }),
}));
vi.mock("@/hooks/use-activation-milestones", () => ({
  useActivationMilestones: () => ({
    firstModelId: "m1", firstModelName: "Aura", hasModel: true, hasAssetOnFirstModel: true,
    firstProjectId: "p1", firstProjectName: "Gala", hasProject: true, hasModelLineItemOnFirstProject: true,
  }),
  useActivationMilestoneAnalytics: () => undefined,
}));

vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeDashboardStats: () => ({ data: undefined, isLoading: false }),
  useNativeSubHireStats: () => undefined,
  useNativeUpcoming: () => [],
  useNativeFloorJobs: () => undefined,
  useNativeHome: () => ({ userName: "Jayden Cole", myProjects: [] }),
  useNativeBlocking: () => [],
  useNativePendingCrewOffers: () => 0,
  useNativeActivity: () => ({ logs: [], testRecords: [], maintenanceRecords: [] }),
  useNativeOverbookingCounts: () => undefined,
  useNativeOrgFinanceCounts: () => undefined,
  useNativeMyOpenTasks: () => [],
}));

import DashboardPage from "../page";

const lastToast = () => m.toast.mock.calls.at(-1) as [string, { action?: { onClick: () => Promise<void> } }?] | undefined;

beforeEach(() => {
  m.toast.mockClear();
});

async function customise(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Home actions" }));
  await user.click(await screen.findByRole("menuitem", { name: "Customise…" }));
}

describe("Home › hide the setup panel (real SetupPanel)", () => {
  it("the panel renders once, under its own title", () => {
    render(<DashboardPage />);
    expect(screen.getAllByRole("heading", { name: "Finish setup" })).toHaveLength(1);
    expect(screen.getByText("Set your currency and tax details")).toBeDefined();
  });

  it("✕ hides BOTH setup slots in one change, one toast, one Undo that brings the panel back", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await customise(user);
    await user.click(screen.getByLabelText("Hide Finish setup"));

    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(lastToast()?.[0]).toBe("Setup panel hidden · Add widget brings it back");
    // Not promoted into the other slot: the panel is gone.
    expect(screen.queryByText("Set your currency and tax details")).toBeNull();
    expect(screen.queryByLabelText(/^Hide (Finish setup|Get started)$/)).toBeNull();

    await lastToast()?.[1]?.action?.onClick();
    await waitFor(() => expect(screen.getByText("Set your currency and tax details")).toBeDefined());
  });

  it("once hidden, Add widget offers the panel again (once), and adding it brings it back", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await customise(user);
    await user.click(screen.getByLabelText("Hide Finish setup"));

    await user.click(screen.getByRole("button", { name: /Add widget/ }));
    const popover = await screen.findByRole("dialog");
    const offer = within(popover).getAllByRole("button");
    expect(offer).toHaveLength(1);
    expect(offer[0].textContent).toContain("Finish setup");
    await user.click(offer[0]);
    expect(lastToast()?.[0]).toBe("Setup panel added at the bottom");
    await waitFor(() => expect(screen.getByText("Set your currency and tax details")).toBeDefined());
  });
});
