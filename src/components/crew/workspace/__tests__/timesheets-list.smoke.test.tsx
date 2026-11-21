// @vitest-environment jsdom
//
// Crew › Timesheets on ListPage (UX Phase 15, §9h.4). Rendered for real and
// every overlay OPENED: page ⋯ (Columns, Export all…, Crew roles & rates…),
// the filter words, the row ⋯ (and its Delete confirm), Edit entry, Log time
// (both steps), Query… (Save disabled until a reason), and the bulk bar whose
// Undo is the forward result's own revert. Pay columns follow the SERVER's
// `payVisible`, never the client's role.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/crew/timesheets",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true, useIsManagerPlus: () => true }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn(async () => ({ crewMembers: 1, crewAssignments: 2, projectServices: 0 })) }) }));

const writes = vi.hoisted(() => ({
  submit: vi.fn(async (ids: string[]) => ({ count: ids.length, changed: ids, stamp: 111 })),
  approve: vi.fn(async (ids: string[]) => ({ count: 1, changed: ids.slice(0, 1), stamp: 222 })),
  query: vi.fn(async (ids: string[]) => ({ count: ids.length, changed: ids, stamp: 333 })),
  revert: vi.fn(async () => ({ count: 1 })),
  update: vi.fn(async () => ({ id: "e1" })),
  remove: vi.fn(async () => ({ id: "e1" })),
  createMany: vi.fn(async () => ({ created: ["c1"], errors: [], entryIds: ["new1"] })),
}));
vi.mock("@/hooks/use-crew-time-writes", () => ({ useCrewTimeWrites: () => writes }));
vi.mock("@/hooks/use-crew-role-writes", () => ({ useCrewRoleWrites: () => ({ create: vi.fn(), update: vi.fn(), archive: vi.fn(), move: vi.fn() }) }));
const exportCsv = vi.hoisted(() => vi.fn(async () => "Crew Member\n"));
vi.mock("@/server/crew-time", () => ({ exportTimesheetCSV: exportCsv }));
const announced = vi.hoisted(() => [] as { title: string; performUndo?: () => Promise<unknown> }[]);
vi.mock("@/lib/list-write-toast", async (orig) => ({
  ...(await orig<object>()),
  announceListWrite: (a: { title: string; performUndo?: () => Promise<unknown> }) => {
    announced.push(a);
    return undefined;
  },
}));

const entry = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, crewMemberId: "c1", assignmentId: "a1", description: "Bump in", date: "2026-11-07T00:00:00.000Z",
  startTime: "08:00", endTime: "17:00", breakMinutes: 30, totalHours: 8.5, status, notes: null, queryReason: null, updatedAtMs: 1,
  crewMember: { id: "c1", firstName: "Ana", lastName: "Ruiz" },
  assignment: { id: "a1", project: { id: "p1", name: "Hilton gala", projectNumber: "#2336" }, crewRole: { name: "Rigger" } },
  approvedBy: null, ...over,
});
const pay = { rate: 450, rateType: "DAILY", total: 450, rateIncluded: false };
const server = vi.hoisted(() => ({ payVisible: true }));
function page() {
  const p = server.payVisible;
  return {
    entries: [
      entry("e1", "SUBMITTED", p ? pay : {}),
      entry("e2", "DRAFT", { crewMember: { id: "c2", firstName: "Ben", lastName: "Lee" }, crewMemberId: "c2", ...(p ? pay : {}) }),
      entry("e3", "EXPORTED", { crewMember: { id: "c3", firstName: "Cy", lastName: "Fox" }, crewMemberId: "c3", ...(p ? pay : {}) }),
    ],
    total: 3,
    counts: { SUBMITTED: 10, APPROVED: 6, DISPUTED: 1, DRAFT: 2, EXPORTED: 1, all: 20 },
    totals: p ? { hours: 361, pay: 16962 } : { hours: 361 },
    payVisible: p,
  };
}
let lastArgs: Record<string, unknown> | undefined;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "crewTimeEntries:allEntries") {
        lastArgs = args as Record<string, unknown>;
        return page();
      }
      if (name === "crewDashboard:pickerList") {
        return [
          { id: "c1", firstName: "Ana", lastName: "Ruiz", department: null, crewRole: { name: "Rigger" }, assignments: [{ id: "a1", status: "CONFIRMED", project: { name: "Hilton gala", projectNumber: "#2336" }, crewRole: { name: "Rigger" } }] },
          { id: "c2", firstName: "Ben", lastName: "Lee", department: "Audio", crewRole: null, assignments: [] },
        ];
      }
      if (name === "crewRoles:listForSettings") return [{ id: "r1", name: "Rigger", sortOrder: 0, isActive: true, defaultRate: 600, rateType: "DAILY" }];
      return undefined;
    },
  };
});

import { TimesheetsList } from "../timesheets/timesheets-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  mobile.value = false;
  server.payVisible = true;
  announced.length = 0;
  Object.values(writes).forEach((f) => f.mockClear());
});

describe("TimesheetsList (smoke)", () => {
  it("renders the Crew head with its words, the strip counts, rows and the Log time primary", () => {
    render(<TimesheetsList />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Timesheets" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("tab", { name: /Submitted 10/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Queried 1/ })).toBeTruthy();
    expect(screen.getByText("Ana Ruiz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log time" })).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", filters: { status: ["SUBMITTED"] }, pageSize: 25, sortBy: "date", sortOrder: "desc" });
  });

  it("manager (server payVisible): Rate (pay) and Total columns and the money in the totals line", () => {
    render(<TimesheetsList />);
    expect(screen.getByRole("columnheader", { name: "Rate (pay)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeTruthy();
    expect(screen.getAllByText("$450/day").length).toBeGreaterThan(0);
    expect(screen.getByText("Totals · 361h · $16,962")).toBeTruthy();
  });

  it("below manager (server sends no pay): no pay columns and no money anywhere", () => {
    server.payVisible = false;
    render(<TimesheetsList />);
    expect(screen.queryByRole("columnheader", { name: "Rate (pay)" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Total" })).toBeNull();
    expect(screen.getByText("Totals · 361h")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("an Exported row has no ⋯; a Submitted row's ⋯ opens with its verbs and Delete confirms first", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    expect(screen.queryByRole("button", { name: "Cy Fox actions" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ana Ruiz actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit entry/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Approve/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Query…/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Submit/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Delete entry/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Delete Ana Ruiz/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete entry" }));
    expect(writes.remove).toHaveBeenCalledWith("e1");
  });

  it("Edit entry opens as a sheet with the entry's fields; Save goes through ONE update and offers its snapshot as Undo", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("button", { name: "Ana Ruiz actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit entry/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Edit time entry")).toBeTruthy();
    expect((within(sheet).getByLabelText("Start") as HTMLInputElement).value).toBe("08:00");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(writes.update).toHaveBeenCalledTimes(1);
    await announced[0].performUndo!();
    expect(writes.update).toHaveBeenCalledTimes(2);
  });

  it("Query… keeps Save disabled until a reason is typed, then queries with it", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("button", { name: "Ana Ruiz actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Query…/ }));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Query 1" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("What needs checking"), "No break on a 9h day");
    expect(go.disabled).toBe(false);
    await user.click(go);
    expect(writes.query).toHaveBeenCalledWith(["e1"], { reason: "No break on a 9h day" });
  });

  it("bulk: labels count what each verb changes; Approve's Undo is revert of its own result", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Ben Lee" }));
    expect(await screen.findByText("2 lines selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Query…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Approve 1" }));
    expect(writes.approve).toHaveBeenCalledWith(["e1", "e2"]);
    expect(announced[0].title).toMatch(/Approved 1 entry · skipped Ben Lee/);
    await announced[0].performUndo!();
    expect(writes.revert).toHaveBeenCalledWith({ count: 1, changed: ["e1"], stamp: 222 });
  });

  it("bulk Export goes through the server CSV with the ticked ids", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    await user.click(await screen.findByRole("button", { name: "Export" }));
    expect(exportCsv).toHaveBeenCalledWith({ ids: ["e1"] });
  });

  it("Log time: tick people, then one set of hours for all of them", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("button", { name: "Log time" }));
    const sheet = await screen.findByRole("dialog");
    const next = within(sheet).getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await user.click(within(sheet).getByRole("checkbox", { name: "Ana Ruiz" }));
    await user.click(within(sheet).getByRole("button", { name: "Next · 1 ticked" }));
    expect(await within(sheet).findByLabelText("Start")).toBeTruthy();
    await user.type(within(sheet).getByLabelText("Start"), "08:00");
    await user.type(within(sheet).getByLabelText("End"), "16:00");
    await user.click(within(sheet).getByRole("button", { name: "Log time" }));
    expect(writes.createMany).toHaveBeenCalledTimes(1);
    expect((writes.createMany.mock.calls[0] as unknown[])[1]).toEqual(["c1"]);
  });

  it("page ⋯ holds Crew list, Crew roles & rates…, Columns and Export all…; each opens", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    await user.click(screen.getByRole("button", { name: "Crew options" }));
    expect(await screen.findByRole("menuitem", { name: /Crew list/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Columns/ })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: /Export all…/ }));
    expect(await screen.findByText("Export timesheets")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Crew options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Crew roles & rates…/ }));
    expect(nav.replace).toHaveBeenCalledWith("/crew/timesheets?sheet=roles", { scroll: false });
  });

  it("?sheet=roles opens the Crew roles & rates sheet over the list", async () => {
    nav.search = "sheet=roles";
    render(<TimesheetsList />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Crew roles & rates")).toBeTruthy();
    expect(within(sheet).getByText("Rigger")).toBeTruthy();
  });

  it("the Person and Status filter words open; Views is in the toolbar", async () => {
    const user = userEvent.setup();
    render(<TimesheetsList />);
    // The filter words are popover triggers (the Person / Status column heads are sort buttons).
    const word = (name: string) => screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-haspopup"))!;
    await user.click(word("Person"));
    expect(await screen.findByRole("checkbox", { name: "Ben Lee" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(word("Status"));
    expect(await screen.findByRole("checkbox", { name: "Exported" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Views" })).toBeTruthy();
  });

  it("phone: cards with the total on the right and the sticky Log time; head words on their own row", () => {
    mobile.value = true;
    render(<TimesheetsList />);
    expect(screen.getByText("#2336 · Sat 7 Nov · 8.5h · Submitted")).toBeTruthy();
    expect(screen.getAllByText("$450").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Log time" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Planner" }).className).toContain("min-h-11");
  });
});
