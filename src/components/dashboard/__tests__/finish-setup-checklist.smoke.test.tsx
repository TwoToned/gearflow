// @vitest-environment jsdom
//
// Smoke test for the dashboard's "Finish setup" checklist (C6, #1104):
// every item is derived from the org's real settings/locations/members —
// nothing here tracks "step N done" — and the card disappears for good once
// dismissed OR every item is complete, per D5/R-3.1.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  org: { data: { settings: {} } as Record<string, unknown> | undefined, isLoading: false },
  locations: [] as unknown[] | undefined,
  members: { data: [] as unknown[], isLoading: false },
  invites: { data: [] as unknown[] | undefined, isLoading: false },
  dismissedAt: null as number | null | undefined,
  dismiss: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => mocks.org,
}));
vi.mock("@/hooks/use-locations", () => ({
  useLocations: () => mocks.locations,
}));
vi.mock("@/hooks/use-org-members", () => ({
  useOrgMembers: () => mocks.members,
}));
vi.mock("@/hooks/use-pending-invitations", () => ({
  usePendingInvitations: () => mocks.invites,
}));
vi.mock("@/hooks/use-setup-dismissal", () => ({
  useSetupDismissal: () => ({ dismissedAt: mocks.dismissedAt, dismiss: mocks.dismiss }),
}));

import { FinishSetupChecklist } from "../finish-setup-checklist";

beforeEach(() => {
  mocks.org = { data: { settings: {} }, isLoading: false };
  mocks.locations = [];
  mocks.members = { data: [], isLoading: false };
  mocks.invites = { data: [], isLoading: false };
  mocks.dismissedAt = null;
  mocks.dismiss.mockClear();
});

describe("FinishSetupChecklist (smoke)", () => {
  it("renders nothing while any underlying read is still loading", () => {
    mocks.org = { data: undefined, isLoading: true };
    const { container } = render(<FinishSetupChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("stays hidden while pending invitations are still loading, even though every other read has resolved — does not flash 'team' as unfinished", () => {
    // usePendingInvitations is its own independent store, so it can still be
    // mid-fetch after org/locations/members have all resolved; omitting its
    // isLoading from the gate let "team" flash not-done for one render.
    mocks.org = { data: { settings: { currency: "AUD" } }, isLoading: false };
    mocks.members = { data: [{ id: "owner" }], isLoading: false };
    mocks.invites = { data: undefined, isLoading: true };
    const { container } = render(<FinishSetupChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once dismissed, even with unfinished items", async () => {
    mocks.dismissedAt = Date.now();
    const { container } = render(<FinishSetupChecklist orgId="org1" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders nothing once every item is complete", () => {
    mocks.org = { data: { settings: { currency: "AUD", branding: { logoUrl: "https://x/logo.png" } } }, isLoading: false };
    mocks.locations = [{ id: "loc1" }];
    mocks.members = { data: [{ id: "m1" }, { id: "m2" }], isLoading: false };
    const { container } = render(<FinishSetupChecklist orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows unfinished items with a working deep link, and done items struck through", async () => {
    mocks.org = { data: { settings: { currency: "AUD" } }, isLoading: false };
    render(<FinishSetupChecklist orgId="org1" />);

    expect(await screen.findByText("1 of 4 done")).toBeTruthy();
    expect(screen.getByText("Set your currency & tax details").className).toContain("line-through");
    // Three unfinished items (branding/location/team) each get a "Fix it" deep link.
    const links = screen.getAllByRole("link", { name: /fix it/i });
    expect(links.some((l) => l.getAttribute("href") === "/settings/branding")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/locations")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/settings/team")).toBe(true);
  });

  it("counts pending invites toward the team item, not just accepted members", async () => {
    mocks.members = { data: [{ id: "owner" }], isLoading: false };
    mocks.invites = { data: [{ id: "inv1" }], isLoading: false };
    mocks.org = {
      data: { settings: { currency: "AUD", branding: { logoUrl: "https://x/logo.png" } } },
      isLoading: false,
    };
    mocks.locations = [{ id: "loc1" }];
    const { container } = render(<FinishSetupChecklist orgId="org1" />);
    // All four items now complete (1 member + 1 invite = 2) — card disappears.
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("clicking Dismiss calls the dismiss mutation", async () => {
    mocks.org = { data: { settings: {} }, isLoading: false };
    const user = userEvent.setup();
    render(<FinishSetupChecklist orgId="org1" />);

    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(mocks.dismiss).toHaveBeenCalled();
  });
});
