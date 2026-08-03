// @vitest-environment jsdom
//
// Smoke test for the org-creation form's B1 wiring (#1092): it's the "Set up
// a new company" destination from /welcome, so it must (a) bounce away if
// org creation has since been gated off rather than show a form the server
// will refuse anyway, and (b) collect + submit the signup code when the gate
// requires one, via the same `organization.create({ metadata: { orgCreationCode
// } })` shape src/lib/auth.ts's beforeCreateOrganization expects.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// See the sibling /welcome smoke test for why these go through vi.hoisted()
// rather than bare top-level consts: vi.mock factories are hoisted above
// every import/const in this file.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  create: vi.fn(async () => ({ data: { id: "org1" }, error: null as { message: string } | null })),
  setActive: vi.fn(async () => undefined),
  getOrgCreationPolicy: vi.fn(async () => ({ allowed: true, codeRequired: false })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  organization: { create: mocks.create, setActive: mocks.setActive },
}));
vi.mock("@/server/public-org", () => ({
  getMyOrganizations: () => Promise.resolve([]),
  mirrorMyMembership: () => Promise.resolve(undefined),
  seedOrgDefaultTaxRate: () => Promise.resolve(undefined),
}));
vi.mock("@/server/site-admin", () => ({
  getOrgCreationPolicy: mocks.getOrgCreationPolicy,
}));

import OnboardingPage from "../page";

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.create.mockClear();
  mocks.setActive.mockClear();
  mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: false });
});

describe("OnboardingPage (smoke)", () => {
  it("bounces to /welcome when org creation has been gated off", async () => {
    mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: false, codeRequired: false });
    render(<OnboardingPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("does not render a signup-code field when none is required", async () => {
    render(<OnboardingPage />);
    await screen.findByLabelText("Organization name");
    expect(screen.queryByLabelText("Signup code")).toBeNull();
  });

  it("renders and submits a signup-code field when the gate requires one", async () => {
    mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: true });
    const user = userEvent.setup();
    render(<OnboardingPage />);

    const codeInput = await screen.findByLabelText("Signup code");
    await user.type(await screen.findByLabelText("Organization name"), "Acme Productions");
    await user.type(codeInput, "abc123");
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Acme Productions",
          metadata: { orgCreationCode: "abc123" },
        }),
      ),
    );
  });
});
