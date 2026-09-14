// @vitest-environment jsdom
//
// Smoke test for the org-creation form's C1 wiring (#1098): it's the "Set up
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
  checkSlugAvailable: vi.fn(async () => true),
  mirrorMyMembership: vi.fn(async () => undefined),
  seedOrgDefaults: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  organization: { create: mocks.create, setActive: mocks.setActive },
}));
vi.mock("@/server/public-org", () => ({
  getMyOrganizations: () => Promise.resolve([]),
  mirrorMyMembership: mocks.mirrorMyMembership,
  seedOrgDefaults: mocks.seedOrgDefaults,
  checkSlugAvailable: mocks.checkSlugAvailable,
}));
vi.mock("@/server/site-admin", () => ({
  getOrgCreationPolicy: mocks.getOrgCreationPolicy,
}));
// StepOperating (C2, #1099), StepBranding (C3, #1101) and StepNumbering (C4,
// #1102) each have their own dependencies and their own smoke test
// (step-operating.smoke.test.tsx, step-branding.smoke.test.tsx,
// step-numbering.smoke.test.tsx) — stubbed here so this file stays scoped to
// step-1/transition behavior, not re-testing steps 2/3/4's internals.
vi.mock("../step-operating", () => ({
  StepOperating: ({ orgId, onDone }: { orgId: string; onDone: () => void }) => (
    <div>
      <p>Step 2 stub for {orgId}</p>
      <button type="button" onClick={onDone}>
        Finish stub
      </button>
    </div>
  ),
}));
vi.mock("../step-branding", () => ({
  StepBranding: ({ orgId, onDone }: { orgId: string; onDone: () => void }) => (
    <div>
      <p>Step 3 stub for {orgId}</p>
      <button type="button" onClick={onDone}>
        Finish stub
      </button>
    </div>
  ),
}));
vi.mock("../step-numbering", () => ({
  StepNumbering: ({ orgId, onDone }: { orgId: string; onDone: () => void }) => (
    <div>
      <p>Step 4 stub for {orgId}</p>
      <button type="button" onClick={onDone}>
        Finish stub
      </button>
    </div>
  ),
}));

import SetupPage from "../page";

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.create.mockClear();
  mocks.setActive.mockClear();
  mocks.checkSlugAvailable.mockClear();
  mocks.mirrorMyMembership.mockReset().mockResolvedValue(undefined);
  mocks.seedOrgDefaults.mockReset().mockResolvedValue(undefined);
  mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: false });
});

describe("SetupPage (smoke)", () => {
  it("bounces to /welcome when org creation has been gated off", async () => {
    mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: false, codeRequired: false });
    render(<SetupPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("does not render a signup-code field when none is required", async () => {
    render(<SetupPage />);
    await screen.findByLabelText("Company name");
    expect(screen.queryByLabelText("Signup code")).toBeNull();
  });

  it("renders and submits a signup-code field when the gate requires one", async () => {
    mocks.getOrgCreationPolicy.mockResolvedValue({ allowed: true, codeRequired: true });
    const user = userEvent.setup();
    render(<SetupPage />);

    const codeInput = await screen.findByLabelText("Signup code");
    await user.type(await screen.findByLabelText("Company name"), "Acme Productions");
    await user.type(codeInput, "abc123");
    await user.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Acme Productions",
          metadata: { orgCreationCode: "abc123" },
        }),
      ),
    );
  });

  it("still advances to step 2 when the best-effort post-creation seed fails", async () => {
    // The org + membership already exist and are active by this point
    // (organization.create() + setActive() both succeeded) — a transient
    // Convex hiccup in seedOrgDefaults must never strand the user on the
    // form with a generic error, since a retry would fail with "slug
    // already taken" against an org they already own.
    mocks.seedOrgDefaults.mockRejectedValue(new Error("Convex hiccup"));
    const user = userEvent.setup();
    render(<SetupPage />);

    await user.type(await screen.findByLabelText("Company name"), "Acme Productions");
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText("Step 2 stub for org1")).toBeTruthy();
  });

  it("chains through steps 2, 3 and 4 (each stub's onDone advances the wizard), and step 4's onDone lands on /dashboard", async () => {
    const user = userEvent.setup();
    render(<SetupPage />);

    await user.type(await screen.findByLabelText("Company name"), "Acme Productions");
    await user.click(screen.getByRole("button", { name: /create company/i }));

    await screen.findByText("Step 2 stub for org1");
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    await screen.findByText("Step 3 stub for org1");
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    await screen.findByText("Step 4 stub for org1");
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
