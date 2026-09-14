// @vitest-environment jsdom
//
// Smoke test for the wizard's C5 screen (#1103): "your team" (invite send)
// and "your gear" (add-by-hand model create) each fire live, independent
// writes with no batching — there's no OrgSettings patch on this screen at
// all. "Skip for now" is a genuine no-op here (unlike C4's location
// fallback), and both exit buttons just call onDone().
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  addMemberByEmail: vi.fn(async () => ({})),
  refreshOrgMembers: vi.fn(),
  refreshPendingInvitations: vi.fn(),
  createModel: vi.fn(async () => ({ id: "model1" })),
  captured: [] as [string, unknown][],
}));

vi.mock("@/lib/analytics", () => ({
  capture: (event: string, props: unknown) => mocks.captured.push([event, props]),
  AnalyticsEvent: { SetupStepViewed: "setup_step_viewed", SetupStepCompleted: "setup_step_completed", SetupStepSkipped: "setup_step_skipped" },
}));
vi.mock("@/server/settings", () => ({
  addMemberByEmail: mocks.addMemberByEmail,
}));
vi.mock("@/hooks/use-org-members", () => ({
  refreshOrgMembers: mocks.refreshOrgMembers,
}));
vi.mock("@/hooks/use-pending-invitations", () => ({
  refreshPendingInvitations: mocks.refreshPendingInvitations,
}));
vi.mock("@/hooks/use-model-writes", () => ({
  useModelWrites: () => ({ create: mocks.createModel }),
}));
// CSVImportDialog pulls in its own file-input/server-action machinery, out
// of scope for this step's own test (the dialog has its own coverage) —
// shimmed to a visibility-tracking stub.
vi.mock("@/components/assets/csv-import-dialog", () => ({
  CSVImportDialog: ({ open }: { open: boolean }) => (open ? <div>CSV import dialog open</div> : null),
}));
// Radix Select's portal/pointer-capture behavior is unreliable in jsdom
// (see step-operating.smoke.test.tsx's own comment on this) — shimmed as a
// native <select> so userEvent can drive it.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Role" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

import { StepTeamGear } from "../step-team-gear";

beforeEach(() => {
  mocks.addMemberByEmail.mockClear().mockResolvedValue({});
  mocks.refreshOrgMembers.mockClear();
  mocks.refreshPendingInvitations.mockClear();
  mocks.createModel.mockClear().mockResolvedValue({ id: "model1" });
  mocks.captured = [];
});

describe("StepTeamGear (smoke)", () => {
  it("'Skip for now' calls onDone without writing anything, and reports its own outcome as skipped (not completed)", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onStepOutcome = vi.fn();
    render(<StepTeamGear orgId="org1" onDone={onDone} onStepOutcome={onStepOutcome} />);
    mocks.captured = []; // clear the mount-time setup_step_viewed capture

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    expect(onDone).toHaveBeenCalled();
    expect(mocks.addMemberByEmail).not.toHaveBeenCalled();
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(onStepOutcome).toHaveBeenCalledExactlyOnceWith("skipped");
    expect(mocks.captured).toEqual([["setup_step_skipped", { step: "team_gear" }]]);
  });

  it("'Finish setup' calls onDone without requiring any invites or gear, and reports its own outcome as completed (not skipped)", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onStepOutcome = vi.fn();
    render(<StepTeamGear orgId="org1" onDone={onDone} onStepOutcome={onStepOutcome} />);
    mocks.captured = []; // clear the mount-time setup_step_viewed capture

    await user.click(await screen.findByRole("button", { name: /finish setup/i }));

    expect(onDone).toHaveBeenCalled();
    expect(onStepOutcome).toHaveBeenCalledExactlyOnceWith("completed");
    expect(mocks.captured).toEqual([["setup_step_completed", { step: "team_gear" }]]);
  });

  it("sends an invite immediately on 'Send invite' (no batching), shows it in the list, and does NOT call onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepTeamGear orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.type(await screen.findByLabelText("Email address"), "colleague@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => expect(mocks.addMemberByEmail).toHaveBeenCalledWith("colleague@example.com", "member"));
    expect(mocks.refreshOrgMembers).toHaveBeenCalledWith("org1");
    expect(mocks.refreshPendingInvitations).toHaveBeenCalledWith("org1");
    expect(await screen.findByText(/colleague@example.com — Member/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("held Enter (key-repeat) while an invite is in flight doesn't double-submit — the in-flight guard applies to Enter, not just the button's own disabled state", async () => {
    let resolveInvite: (() => void) | undefined;
    mocks.addMemberByEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvite = () => resolve({});
        }),
    );
    const user = userEvent.setup();
    render(<StepTeamGear orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    const input = await screen.findByLabelText("Email address");
    await user.type(input, "colleague@example.com");
    fireEvent.keyDown(input, { key: "Enter" });
    // A second Enter (OS key-repeat, or a fast double-tap) while the first
    // request is still unresolved must be a no-op, not a second send.
    fireEvent.keyDown(input, { key: "Enter" });

    resolveInvite?.();
    await waitFor(() => expect(mocks.addMemberByEmail).toHaveBeenCalledTimes(1));
  });

  it("shows a per-row error when an invite fails, without blocking further use of the screen", async () => {
    mocks.addMemberByEmail.mockRejectedValueOnce(new Error("Already a member"));
    const user = userEvent.setup();
    render(<StepTeamGear orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.type(await screen.findByLabelText("Email address"), "existing@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    expect(await screen.findByText(/existing@example.com: Already a member/)).toBeTruthy();
  });

  it("includes 'Warehouse' as an assignable role (the invite-role list drift this screen's shared module fixes)", async () => {
    render(<StepTeamGear orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);
    expect(await screen.findByRole("option", { name: "Warehouse" })).toBeTruthy();
  });

  it("creates a model immediately on 'Add' and shows it in the list", async () => {
    const user = userEvent.setup();
    render(<StepTeamGear orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.type(await screen.findByLabelText("Model name"), "Shure SM58");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(mocks.createModel).toHaveBeenCalledWith({ name: "Shure SM58" }));
    expect(await screen.findByText("Shure SM58")).toBeTruthy();
  });

  it("opens the CSV import dialog (models, not assets — a brand-new org has no models to attach assets to)", async () => {
    const user = userEvent.setup();
    render(<StepTeamGear orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /import a spreadsheet/i }));

    expect(await screen.findByText("CSV import dialog open")).toBeTruthy();
  });
});
