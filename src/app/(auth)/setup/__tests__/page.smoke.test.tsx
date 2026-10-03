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
  captured: [] as [string, unknown][],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({
  capture: (event: string, props: unknown) => mocks.captured.push([event, props]),
  AnalyticsEvent: {
    SetupStepViewed: "setup_step_viewed",
    SetupStepCompleted: "setup_step_completed",
    SetupStepSkipped: "setup_step_skipped",
    SetupCompleted: "setup_completed",
  },
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
// StepOperating (C2, #1099), StepBranding (C3, #1101), StepNumbering (C4,
// #1102) and StepTeamGear (C5, #1103) each have their own dependencies and
// their own smoke test (step-operating.smoke.test.tsx,
// step-branding.smoke.test.tsx, step-numbering.smoke.test.tsx,
// step-team-gear.smoke.test.tsx) — stubbed here so this file stays scoped
// to step-1/transition behavior, not re-testing steps 2-5's internals.
// Each stub exposes both a "Finish stub" (completed) and a "Skip stub"
// (skipped) button so tests can exercise stepTally's mixed accumulation —
// see setup_completed's steps_completed/steps_skipped test below.
type StepStubProps = {
  orgId: string;
  onDone: () => void;
  onStepOutcome: (outcome: "completed" | "skipped") => void;
};
function makeStepStub(label: string) {
  return function StepStub({ orgId, onDone, onStepOutcome }: StepStubProps) {
    return (
      <div>
        <p>{label} for {orgId}</p>
        <button
          type="button"
          onClick={() => {
            onStepOutcome("completed");
            onDone();
          }}
        >
          Finish stub
        </button>
        <button
          type="button"
          onClick={() => {
            onStepOutcome("skipped");
            onDone();
          }}
        >
          Skip stub
        </button>
      </div>
    );
  };
}
vi.mock("../step-operating", () => ({ StepOperating: makeStepStub("Step 2 stub") }));
vi.mock("../step-branding", () => ({ StepBranding: makeStepStub("Step 3 stub") }));
vi.mock("../step-numbering", () => ({ StepNumbering: makeStepStub("Step 4 stub") }));
vi.mock("../step-team-gear", () => ({ StepTeamGear: makeStepStub("Step 5 stub") }));

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
  mocks.captured = [];
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

  it("chains through steps 2, 3, 4 and 5 (each stub's onDone advances the wizard), and step 5's onDone lands on /dashboard", async () => {
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

    await screen.findByText("Step 5 stub for org1");
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });

  it("fires setup_step_viewed and setup_step_completed for step 1 ('company') on a successful create", async () => {
    const user = userEvent.setup();
    render(<SetupPage />);

    await waitFor(() => expect(mocks.captured).toContainEqual(["setup_step_viewed", { step: "company" }]));

    await user.type(await screen.findByLabelText("Company name"), "Acme Productions");
    await user.click(screen.getByRole("button", { name: /create company/i }));

    await screen.findByText("Step 2 stub for org1");
    expect(mocks.captured).toContainEqual(["setup_step_completed", { step: "company" }]);
    // Step 1 is never skippable, so it must never report a skip.
    expect(mocks.captured).not.toContainEqual(["setup_step_skipped", { step: "company" }]);
  });

  it("reports the full-session tally on setup_completed — a mix of completed and skipped steps across the wizard (D4, #1108)", async () => {
    // company (completed) -> step 2 (skipped) -> step 3 (completed) ->
    // step 4 (skipped) -> step 5 (completed, the final step) = 3
    // completed / 2 skipped, regardless of which button finished step 5.
    const user = userEvent.setup();
    render(<SetupPage />);

    await user.type(await screen.findByLabelText("Company name"), "Acme Productions");
    await user.click(screen.getByRole("button", { name: /create company/i }));

    await screen.findByText("Step 2 stub for org1");
    await user.click(screen.getByRole("button", { name: /skip stub/i }));

    await screen.findByText("Step 3 stub for org1");
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    await screen.findByText("Step 4 stub for org1");
    await user.click(screen.getByRole("button", { name: /skip stub/i }));

    await screen.findByText("Step 5 stub for org1");
    await user.click(screen.getByRole("button", { name: /finish stub/i }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    expect(mocks.captured).toContainEqual(["setup_completed", { steps_completed: 3, steps_skipped: 2 }]);
    // setup_completed must fire exactly once, at the very end.
    expect(mocks.captured.filter(([event]) => event === "setup_completed")).toHaveLength(1);
  });
});
