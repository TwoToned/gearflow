// @vitest-environment jsdom
//
// Smoke test for the create-vs-join fork screen (#1092, B1) and the join
// flow it forks into (#1094, B2). Covers the three behaviours the B1 issue's
// exit criteria call out (create-company card disappears when org creation
// is gated off — cosmetic only, the server enforces the gate regardless,
// R-9.3; a user with exactly one org is bounced away rather than shown the
// fork), plus B2's invite-code entry and verified-domain request UI.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JoinableOrg } from "@/server/org-join";

// vi.mock factories are hoisted above every import/const in this file, so
// anything they close over must itself come from vi.hoisted() — a bare
// top-level const referenced directly in the object literal a factory
// returns is read before its own initializer runs (TDZ), not merely before
// the test body executes.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  setActive: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  getMyOrganizations: vi.fn(async () => [] as { id: string; name: string; slug: string; role: string }[]),
  getOrgCreationPolicy: vi.fn(async () => ({ allowed: true, codeRequired: false })),
  checkInviteCode: vi.fn(async () => null as { id: string } | null),
  getJoinableOrgs: vi.fn(async () => ({ requiresVerification: false, orgs: [] as JoinableOrg[] })),
  requestToJoinOrg: vi.fn(async () => ({ id: "req_1", created: true })),
  sessionData: {
    user: { name: "Sam Roadie", email: "sam@northlight.com.au" },
  } as { user: { name: string; email: string } } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  organization: { setActive: mocks.setActive },
  signOut: mocks.signOut,
  useSession: () => ({ data: mocks.sessionData }),
}));
vi.mock("@/server/public-org", () => ({
  getMyOrganizations: mocks.getMyOrganizations,
}));
vi.mock("@/server/site-admin", () => ({
  getOrgCreationPolicy: mocks.getOrgCreationPolicy,
}));
vi.mock("@/server/org-join", () => ({
  checkInviteCode: mocks.checkInviteCode,
  getJoinableOrgs: mocks.getJoinableOrgs,
  requestToJoinOrg: mocks.requestToJoinOrg,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WelcomePage from "../page";

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.setActive.mockClear();
  mocks.signOut.mockClear();
  mocks.getMyOrganizations.mockResolvedValue([]);
  mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: false });
  mocks.checkInviteCode.mockResolvedValue(null);
  mocks.getJoinableOrgs.mockResolvedValue({ requiresVerification: false, orgs: [] });
  mocks.requestToJoinOrg.mockResolvedValue({ id: "req_1", created: true });
  mocks.sessionData = { user: { name: "Sam Roadie", email: "sam@northlight.com.au" } };
});

describe("WelcomePage (smoke)", () => {
  it("shows both fork cards when org creation is allowed", async () => {
    render(<WelcomePage />);
    expect(await screen.findByText("Set up a new company")).toBeTruthy();
    expect(screen.getByText("Join my team")).toBeTruthy();
  });

  it("hides the create-company card when org creation is gated off", async () => {
    mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: false, codeRequired: false });
    render(<WelcomePage />);
    expect(await screen.findByText("Join my team")).toBeTruthy();
    expect(screen.queryByText("Set up a new company")).toBeNull();
  });

  it("routes 'Set up a new company' to /onboarding", async () => {
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Set up a new company"));
    expect(mocks.push).toHaveBeenCalledWith("/onboarding");
  });

  it("'Join my team' shows the invite-code + domain-request UI, not a placeholder", async () => {
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    expect(await screen.findByText("Have an invite?")).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste your invite link or code")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("invite-code entry navigates to /invite/[id] when the code resolves", async () => {
    mocks.checkInviteCode.mockResolvedValue({ id: "inv_123" });
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    await user.type(screen.getByPlaceholderText("Paste your invite link or code"), "inv_123");
    await user.click(screen.getByText("Continue"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invite/inv_123"));
  });

  it("invite-code entry shows an inline error for an unknown code", async () => {
    mocks.checkInviteCode.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    await user.type(screen.getByPlaceholderText("Paste your invite link or code"), "bogus");
    await user.click(screen.getByText("Continue"));
    expect(await screen.findByText(/couldn't find that invite/i)).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("prompts email verification before showing domain-matched orgs", async () => {
    mocks.getJoinableOrgs.mockResolvedValue({ requiresVerification: true, orgs: [] });
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    expect(await screen.findByText(/Verify your email to search for a team/)).toBeTruthy();
  });

  it("offers 'Ask to join' for a domain-matched org and calls requestToJoinOrg", async () => {
    mocks.getJoinableOrgs.mockResolvedValue({
      requiresVerification: false,
      orgs: [{ organizationId: "org_x", organizationName: "Northlight AV", memberCount: 3, alreadyRequested: false }],
    });
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    expect(await screen.findByText("Northlight AV")).toBeTruthy();
    await user.click(screen.getByText("Ask to join"));
    await waitFor(() => expect(mocks.requestToJoinOrg).toHaveBeenCalledWith("org_x"));
    expect(await screen.findByText("Request sent")).toBeTruthy();
  });

  it("bounces a user who already has exactly one org to /dashboard", async () => {
    mocks.getMyOrganizations.mockResolvedValue([{ id: "org1", name: "Acme", slug: "acme", role: "owner" }]);
    render(<WelcomePage />);
    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "org1" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("sends a user with 2+ orgs to /select-organization", async () => {
    mocks.getMyOrganizations.mockResolvedValue([
      { id: "org1", name: "Acme", slug: "acme", role: "owner" },
      { id: "org2", name: "Beta", slug: "beta", role: "member" },
    ]);
    render(<WelcomePage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/select-organization"));
  });
});
