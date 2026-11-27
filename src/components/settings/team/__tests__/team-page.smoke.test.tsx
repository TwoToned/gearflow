// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TeamPage } from "@/components/settings/team/team-page";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  can: { invite: true, policy: true },
  writes: {
    changeRoles: vi.fn(),
    removeMembers: vi.fn(),
    resend: vi.fn(),
    revoke: vi.fn(),
  },
  addMember: vi.fn(async () => ({ invited: true })),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => state.toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1", name: "Acme" } }),
  useSession: () => ({ data: { user: { id: "u-me" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: (resource: string) => (resource === "orgMembers" ? state.can.invite : state.can.policy),
  useCurrentRole: () => ({ role: state.role }),
}));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => new Date("2026-12-01").getTime() }));
vi.mock("@/hooks/use-team-writes", () => ({ useTeamWrites: () => state.writes }));
vi.mock("@/hooks/use-org-members", () => ({
  refreshOrgMembers: vi.fn(),
  useOrgMembers: () => ({
    isLoading: false,
    data: [
      { id: "m-me", userId: "u-me", role: "owner", createdAt: "2026-01-01T00:00:00Z", user: { name: "Olive", email: "olive@x.co" } },
      { id: "m-1", userId: "u-1", role: "manager", createdAt: "2026-02-01T00:00:00Z", user: { name: "Max", email: "max@x.co" } },
      { id: "m-2", userId: "u-2", role: "viewer", createdAt: "2026-03-01T00:00:00Z", user: { name: "Vi", email: "vi@x.co" } },
    ],
  }),
}));
vi.mock("@/hooks/use-pending-invitations", () => ({
  refreshPendingInvitations: vi.fn(),
  usePendingInvitations: () => ({
    data: [
      { id: "i-1", email: "new@x.co", role: "member", expiresAt: "2026-12-20T00:00:00Z" },
      { id: "i-2", email: "late@x.co", role: "viewer", expiresAt: "2026-11-01T00:00:00Z" },
    ],
  }),
}));
vi.mock("@/server/settings", () => ({ addMemberByEmail: (...a: unknown[]) => (state.addMember as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/settings/join-policy-settings", () => ({ JoinPolicySettings: () => <p>policy radios</p> }));
vi.mock("@/components/settings/join-request-approvals", () => ({ JoinRequestApprovals: () => <p>requests list</p> }));

afterEach(() => {
  cleanup();
  state.role = "owner";
  state.can = { invite: true, policy: true };
  Object.values(state.writes).forEach((f) => f.mockClear());
  state.addMember.mockClear();
  state.toastSuccess.mockClear();
});

describe("Settings → Team", () => {
  it("renders every section in order with counts, derived invite status, and the roles grid", () => {
    render(<TeamPage />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(headings).toEqual(["Members 3", "Invitations 2", "Join requests", "Join policy", "Roles & permissions"]);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Actions granted")).toBeTruthy();
  });

  it("opens a member's ⋯ and offers Change role (sub-menu) and a red Remove that confirms", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    await user.click(screen.getByRole("button", { name: /max actions/i }));
    expect(await screen.findByText("Remove from organisation…")).toBeTruthy();
    await user.click(screen.getByText("Change role"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Viewer" }));
    await waitFor(() => expect(state.writes.changeRoles).toHaveBeenCalledWith(["m-1"], "viewer"));
  });

  it("has no ⋯ on the viewer's own row (absent, not disabled)", () => {
    render(<TeamPage />);
    expect(screen.queryByRole("button", { name: /olive actions/i })).toBeNull();
  });

  it("ticking members raises a bulk bar whose Change role… hands the ticked ids to ONE write", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    const members = screen.getByRole("region", { name: /members/i });
    const boxes = within(members).getAllByRole("checkbox");
    await user.click(boxes[2]); // Max (row 1 is the select-page box in the header)
    await user.click(boxes[3]);
    await user.click(await screen.findByRole("button", { name: /change role… 2/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Member" }));
    expect(state.writes.changeRoles).toHaveBeenCalledWith(["m-1", "m-2"], "member");
  });

  it("Resend n on ticked invitations calls the one resend write", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    const invites = screen.getByRole("region", { name: /invitations/i });
    await user.click(within(invites).getAllByRole("checkbox")[1]);
    await user.click(await screen.findByRole("button", { name: /resend 1/i }));
    expect(state.writes.resend).toHaveBeenCalledWith(["i-1"]);
  });

  it("the invite dialog opens, validates inline (already a member, malformed), and sends a role from the policy list", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    const dialog = await screen.findByRole("dialog");
    const email = within(dialog).getByLabelText(/email address/i);

    await user.type(email, "nope");
    fireEvent.blur(email);
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "That doesn't look like an email address.");

    await user.clear(email);
    await user.type(email, "max@x.co");
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/already a member/i);
    expect((within(dialog).getByRole("button", { name: /send invite/i }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(email);
    await user.type(email, "fresh@x.co");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(5); // an owner may hand out all five
    await user.click(within(dialog).getByLabelText(/warehouse/i));
    await user.click(within(dialog).getByRole("button", { name: /send invite/i }));
    await waitFor(() => expect(state.addMember).toHaveBeenCalledWith("fresh@x.co", "warehouse"));
  });

  it("the E2E harness's invite path (e2e/harness-helpers.ts) works with its exact locators and toast text", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    // Same locators as `inviteAndGetInvitationId`: the primary, the named dialog, the labelled field, Send invite.
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    await user.type(within(dialog).getByLabelText("Email address"), "invitee@x.co");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    // The default role is Member, and the toast text the harness waits for is unchanged.
    await waitFor(() => expect(state.addMember).toHaveBeenCalledWith("invitee@x.co", "member"));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith("Invitation sent to invitee@x.co"));
  });

  it("an admin's invite dialog offers four roles, never Admin", async () => {
    state.role = "admin";
    const user = userEvent.setup();
    render(<TeamPage />);
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    const dialog = await screen.findByRole("dialog");
    const labels = within(dialog).getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(labels).toEqual(["manager", "member", "warehouse", "viewer"]);
  });

  it("a read-only role (no invite, no policy) sees the members and the grid but no primary, invitations or policy", () => {
    state.role = "manager";
    state.can = { invite: false, policy: false };
    render(<TeamPage />);
    expect(screen.queryByRole("button", { name: /invite member/i })).toBeNull();
    expect(screen.queryByText("Invitations")).toBeNull();
    expect(screen.queryByText("policy radios")).toBeNull();
    expect(screen.getByText(/Roles & permissions/)).toBeTruthy();
  });

  it("the roles grid expands a resource to its per-action ticks", async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    const toggle = screen.getByRole("button", { name: /team members/i });
    await user.click(toggle);
    expect(await screen.findByText("Change Roles")).toBeTruthy();
  });
});
