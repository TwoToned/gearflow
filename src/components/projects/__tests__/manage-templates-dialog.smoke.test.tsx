// @vitest-environment jsdom
//
// UX Phase 9 (D23): the Manage templates dialog. Opens and lists with line counts; always-on
// checkboxes with shift range and a bulk `Delete n`; the row ⋯ (`Use for a new job`, `Edit
// template…`, `Delete…` red, each ABSENT without its permission); Delete ARCHIVES with an
// exact Undo; the Archived word is where a final delete (typed confirm, no Undo) lives.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const push = vi.fn();
const archive = vi.fn(async (ids: string[]) => ({ archived: ids.map((id) => ({ id, auditId: `aud-${id}` })) }));
const unarchive = vi.fn(async () => ({ restored: [] as string[] }));
const deleteForever = vi.fn(async (..._a: unknown[]) => {});
const restore = vi.fn(async (ids: string[]) => ({ restored: ids.map((id) => ({ id, auditId: `res-${id}` })) }));
const unrestore = vi.fn(async (..._a: unknown[]) => ({ restored: [] as string[] }));
let mobile = false;
const toastSuccess = vi.fn();
const perms = { create: true, update: true, delete: true };
let state: { templates: unknown[]; total: number; truncated: boolean } | undefined;
let lastArchivedArg: boolean | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }), useSession: () => ({ data: { user: { id: "u1" } } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (_r: string, a: "create" | "update" | "delete") => perms[a] }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
vi.mock("@/hooks/use-templates", () => ({
  useTemplates: (_org: string | undefined, archived = false) => { lastArchivedArg = archived; return archived ? { templates: [{ id: "old", number: "T-9", name: "Old one", type: null, clientName: null, lineCount: 0, updatedAt: 1 }], total: 1, truncated: false } : state; },
  useTemplateWrites: () => ({ archive, unarchive, restore, unrestore, deleteForever, apply: vi.fn(), undoApply: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { ManageTemplatesDialog } from "../templates/manage-templates-dialog";

const row = (id: string, name: string, lineCount: number) => ({ id, number: `T-${id}`, name, type: "CORPORATE", clientName: "Acme", lineCount, updatedAt: 1 });

beforeEach(() => {
  [push, archive, unarchive, restore, unrestore, deleteForever, toastSuccess].forEach((m) => m.mockClear());
  mobile = false;
  perms.create = perms.update = perms.delete = true;
  state = { templates: [row("a", "Gala dinner", 3), row("b", "Festival rig", 1), row("c", "Conference", 0)], total: 3, truncated: false };
});

const open = () => render(<ManageTemplatesDialog open onOpenChange={vi.fn()} />);

describe("ManageTemplatesDialog", () => {
  it("opens and lists the templates with number, type, client and line count", async () => {
    open();
    expect(await screen.findByText("Manage templates")).toBeTruthy();
    expect(screen.getByText("Gala dinner")).toBeTruthy();
    expect(screen.getByText("3 lines")).toBeTruthy();
    expect(screen.getByText("1 line")).toBeTruthy();
    expect(screen.getAllByText(/Acme/).length).toBe(3);
  });

  it("shows loading, and an empty state that names the next action", () => {
    state = undefined;
    const { unmount } = open();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    unmount();
    state = { templates: [], total: 0, truncated: false };
    open();
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
    expect(screen.getAllByText(/New template…/).length).toBeGreaterThan(0);
  });

  it("the row ⋯ offers Use, Edit and Delete…, and Use opens a new job from that template", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Actions for Gala dinner" }));
    expect(await screen.findByText("Use for a new job")).toBeTruthy();
    expect(screen.getByText("Edit template…")).toBeTruthy();
    expect(screen.getByText("Delete…")).toBeTruthy();
    await user.click(screen.getByText("Use for a new job"));
    expect(push).toHaveBeenCalledWith("/projects/new?template=a");
  });

  it("an action the member can't do is ABSENT, never disabled", async () => {
    perms.create = false;
    perms.update = false;
    perms.delete = false;
    open();
    expect(await screen.findByText("Gala dinner")).toBeTruthy();
    // Nothing the member can do on a row: no ⋯ at all, not a disabled one.
    expect(screen.queryByRole("button", { name: "Actions for Gala dinner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New template…" })).toBeNull();
  });

  it("with only project:update the ⋯ has Edit but no Use and no Delete…", async () => {
    perms.create = false;
    perms.delete = false;
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Actions for Gala dinner" }));
    expect(await screen.findByText("Edit template…")).toBeTruthy();
    expect(screen.queryByText("Use for a new job")).toBeNull();
    expect(screen.queryByText("Delete…")).toBeNull();
  });

  it("Delete… confirms, then ARCHIVES, and the toast's Undo restores exactly those ids", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Actions for Gala dinner" }));
    await user.click(await screen.findByText("Delete…"));
    expect(await screen.findByText(/archived: it leaves this list and can be undone/)).toBeTruthy();
    expect(archive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(["a"]));
    const opts = toastSuccess.mock.calls[0][1] as { action: { label: string; onClick: () => Promise<void> } };
    expect(opts.action.label).toBe("Undo");
    await opts.action.onClick();
    expect(unarchive).toHaveBeenCalledWith([{ id: "a", auditId: "aud-a" }]);
  });

  it("ticks with shift range and a bulk Delete n archives the ticked ones", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("checkbox", { name: "Select Gala dinner" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Conference" }));
    await user.keyboard("{/Shift}");
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).getByText(/3 templates selected/)).toBeTruthy();
    await user.click(within(bar).getByRole("button", { name: "Delete 3" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(["a", "b", "c"]));
  });

  it("Archived is where a final delete lives: only Delete forever…, and bulk asks for the typed word", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Archived" }));
    expect(lastArchivedArg).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Actions for Old one" }));
    expect(await screen.findByText("Delete forever…")).toBeTruthy();
    expect(screen.queryByText("Use for a new job")).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("checkbox", { name: "Select Old one" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    await user.click(within(bar).getByRole("button", { name: "Delete 1 forever" }));
    expect(await screen.findByText("Delete templates forever")).toBeTruthy();
    expect(deleteForever).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox"), "DELETE");
    await user.click(screen.getByRole("button", { name: /Delete 1 template/ }));
    await waitFor(() => expect(deleteForever).toHaveBeenCalledWith("old"));
  });

  it("Archived: Restore (row and bulk) brings templates back with no confirm, and its toast Undo archives them again", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Archived" }));
    await user.click(await screen.findByRole("button", { name: "Actions for Old one" }));
    await user.click(await screen.findByText("Restore"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(["old"]));
    const opts = toastSuccess.mock.calls.at(-1)?.[1] as { action: { label: string; onClick: () => Promise<void> } };
    expect(opts.action.label).toBe("Undo");
    await opts.action.onClick();
    expect(unrestore).toHaveBeenCalledWith([{ id: "old", auditId: "res-old" }]);
    await user.click(await screen.findByRole("checkbox", { name: "Select Old one" }));
    await user.click(within(await screen.findByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Restore 1" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(2));
  });

  it("Restore is absent without project:delete", async () => {
    perms.delete = false;
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Old one")).toBeTruthy();
    // Archived rows only ever offer Restore / Delete forever (both project:delete), so there is no ⋯ at all.
    expect(screen.queryByRole("button", { name: "Actions for Old one" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore 1" })).toBeNull();
  });

  it("on a phone the bulk bar stays INSIDE the dialog (a body portal would inherit the modal's pointer-events lock)", async () => {
    mobile = true;
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("checkbox", { name: "Select Gala dinner" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    expect(bar.closest('[role="dialog"]')).not.toBeNull();
    await user.click(within(bar).getByRole("button", { name: "Delete 1" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(["a"]));
  });

  it("New template… opens the sheet route over the Jobs list", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "New template…" }));
    expect(push).toHaveBeenCalledWith("/projects?templates=new");
  });

  it("says when the list is capped", () => {
    state = { templates: [row("a", "Gala dinner", 3)], total: 250, truncated: true };
    open();
    expect(screen.getByText(/most recently updated of 250/)).toBeTruthy();
  });
});
