// @vitest-environment jsdom
//
// Smoke test for the create-vs-join fork screen (#1092, B1). Covers the
// three behaviours the issue's exit criteria call out: the create-company
// card disappears when org creation is gated off (hiding it is cosmetic —
// the server enforces the gate regardless, R-9.3), the join card never
// navigates anywhere since B2 (#1067) hasn't landed yet, and a user who
// already has exactly one org is bounced away rather than shown the fork.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import WelcomePage from "../page";

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.setActive.mockClear();
  mocks.signOut.mockClear();
  mocks.getMyOrganizations.mockResolvedValue([]);
  mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: false });
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

  it("'Join my team' shows an in-flow placeholder instead of navigating", async () => {
    const user = userEvent.setup();
    render(<WelcomePage />);
    await user.click(await screen.findByText("Join my team"));
    expect(
      await screen.findByText(/You'll need an invite from whoever runs your organisation/),
    ).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
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
