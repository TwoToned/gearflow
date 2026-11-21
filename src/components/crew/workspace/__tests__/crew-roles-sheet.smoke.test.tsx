// @vitest-environment jsdom
//
// Crew roles & rates (UX Phase 15, §9h.5): the /crew/settings roles admin as a
// sheet. Opened for real, and every overlay inside it OPENED: New role, the
// row ⋯ (Edit…, Move up/down, Archive… with its usage dialog, Restore).
// Moves call the ONE atomic move and offer the opposite move as Undo.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
const perms = vi.hoisted(() => ({ manager: true }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true, useIsManagerPlus: () => perms.manager }));
const usage = vi.hoisted(() => vi.fn(async () => ({ crewMembers: 3, crewAssignments: 7, projectServices: 1 })));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: usage }) }));

const roles = [
  { id: "r1", name: "Audio", department: "Audio", sortOrder: 0, isActive: true, defaultRate: 600, chargeRate: 900, rateType: "DAILY" },
  { id: "r2", name: "Rigger", department: "Rigging", sortOrder: 1, isActive: true, rateType: "HOURLY" },
  { id: "r3", name: "Old LX", sortOrder: 2, isActive: false },
];
vi.mock("@/hooks/use-crew", () => ({ useCrewRolesForSettings: (orgId?: string) => (orgId ? roles : undefined) }));
const w = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "new" })),
  update: vi.fn(async () => ({ id: "r1" })),
  archive: vi.fn(async (id: string, isActive: boolean) => ({ id, isActive, usage: { crewMembers: 0, crewAssignments: 0, projectServices: 0 } })),
  move: vi.fn(async (id: string) => ({ id, moved: true })),
}));
vi.mock("@/hooks/use-crew-role-writes", () => ({ useCrewRoleWrites: () => w }));
const announced = vi.hoisted(() => [] as { title: string; performUndo?: () => Promise<unknown> }[]);
vi.mock("@/lib/list-write-toast", async (orig) => ({
  ...(await orig<object>()),
  announceListWrite: (a: { title: string; performUndo?: () => Promise<unknown> }) => {
    announced.push(a);
    return undefined;
  },
}));

import { CrewRolesSheet } from "../roles/crew-roles-sheet";

beforeEach(() => {
  perms.manager = true;
  announced.length = 0;
  Object.values(w).forEach((f) => f.mockClear());
});

const sheet = () => screen.getAllByRole("dialog")[0];

describe("CrewRolesSheet (smoke)", () => {
  it("lists active roles in order, archived under their own head, cost/charge for a manager", () => {
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    const s = sheet();
    expect(within(s).getByText("Crew roles & rates")).toBeTruthy();
    expect(within(s).getByText("Audio")).toBeTruthy();
    expect(within(s).getByText("Archived")).toBeTruthy();
    expect(within(s).getByText("$600")).toBeTruthy();
    expect(within(s).getByText("$900")).toBeTruthy();
  });

  it("below manager: no cost or charge (the server strips them too)", () => {
    perms.manager = false;
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    expect(within(sheet()).queryByText("Cost / charge")).toBeNull();
    expect(within(sheet()).getByText(/managers only/)).toBeTruthy();
  });

  it("New role opens the editor over the sheet", async () => {
    const user = userEvent.setup();
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    await user.click(within(sheet()).getByRole("button", { name: "New role" }));
    const editor = await screen.findByRole("dialog", { name: "New role" });
    expect(within(editor).getByLabelText("Name")).toBeTruthy();
    expect(within(editor).getByLabelText(/Cost rate/)).toBeTruthy();
  });

  it("the first role's ⋯ has no Move up; Move down is the one atomic move, Undo the opposite", async () => {
    const user = userEvent.setup();
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Audio actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit…/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Move up/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Move down/ }));
    await waitFor(() => expect(w.move).toHaveBeenCalledWith("r1", "down"));
    await announced[0].performUndo!();
    expect(w.move).toHaveBeenLastCalledWith("r1", "up");
  });

  it("Edit… opens the editor with the role's values", async () => {
    const user = userEvent.setup();
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Rigger actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit…/ }));
    const editor = await screen.findByRole("dialog", { name: "Edit Rigger" });
    expect((within(editor).getByLabelText("Name") as HTMLInputElement).value).toBe("Rigger");
  });

  it("Archive… shows where the role is used before archiving; Undo restores", async () => {
    const user = userEvent.setup();
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Rigger actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Archive…/ }));
    const dialog = await screen.findByRole("dialog", { name: /Archive “Rigger”/ });
    expect(await within(dialog).findByText(/3 crew members have this role and 7 calls use it/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(w.archive).toHaveBeenCalledWith("r2", false));
    await announced[0].performUndo!();
    expect(w.archive).toHaveBeenLastCalledWith("r2", true);
  });

  it("an archived role offers Restore and no moves", async () => {
    const user = userEvent.setup();
    render(<CrewRolesSheet open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Old LX actions" }));
    expect(await screen.findByRole("menuitem", { name: /Restore/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Move/ })).toBeNull();
  });
});
