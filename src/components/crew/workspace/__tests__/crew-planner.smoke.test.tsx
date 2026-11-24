// @vitest-environment jsdom
//
// Crew › Planner (UX Phase 15 slice 3, §9h.3). Rendered for real and every
// overlay OPENED: the block ⋯ (and its Cancel confirm), the call sheet, the
// Offer a call sheet (from an empty cell, from the primary and from a Needs
// crew row) with its in-place send confirm, the Needs crew row ⋯, the filter
// words, the bulk bar's Offer n / Cancel n confirms and Confirm n's Undo
// (the forward result passed through unchanged).
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";
import { toast } from "sonner";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // Radix Switch measures its thumb.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const NOW = Date.UTC(2026, 10, 17, 1); // Tue 17 Nov 2026
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/crew/planner",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const weekStart = vi.hoisted(() => ({ value: 1 as 0 | 1 }));
vi.mock("@/lib/use-org-country", () => ({ useOrgWeekStartsOn: () => weekStart.value }));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "me", name: "Alice" } } }),
}));
const perms = vi.hoisted(() => ({ all: true }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => perms.all, useIsManagerPlus: () => true }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }) }));
vi.mock("@/hooks/use-crew-role-writes", () => ({ useCrewRoleWrites: () => ({}) }));

const asg = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "newCall" })),
  remove: vi.fn(async () => ({ id: "newCall" })),
  confirmMany: vi.fn(async (ids: string[]) => ({ confirmed: ids, skipped: [], stamp: 555 })),
  unconfirmMany: vi.fn(async () => ({ count: 1 })),
  cancelMany: vi.fn(async (ids: string[]) => ({ cancelled: ids, toTell: ids, skipped: [] })),
}));
vi.mock("@/hooks/use-crew-assignment-writes", () => ({ useCrewAssignmentWrites: () => asg }));
const mail = vi.hoisted(() => ({
  sendCrewOffers: vi.fn(async (i: { assignmentIds: string[] }) => ({ sent: i.assignmentIds.length, errors: [], total: i.assignmentIds.length })),
  sendCancellationEmails: vi.fn(async (i: { assignmentIds: string[] }) => ({ sent: i.assignmentIds.length, errors: [], total: i.assignmentIds.length })),
}));
vi.mock("@/server/crew-communication", () => mail);
const announced = vi.hoisted(() => [] as { title: string; performUndo?: () => Promise<unknown> }[]);
vi.mock("@/lib/list-write-toast", async (orig) => ({
  ...(await orig<object>()),
  announceListWrite: (a: { title: string; performUndo?: () => Promise<unknown> }) => {
    announced.push(a);
    return undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const day = (d: string) => `${d}T00:00:00.000Z`;
const job = { id: "p1", name: "Hilton gala", projectNumber: "#2341", status: "CONFIRMED", projectManagerId: "me" };
const call = (id: string, d: string, status: string, over: Record<string, unknown> = {}) => ({
  id, status, startDate: day(d), endDate: day(d), startTime: "08:00", endTime: "18:00", serviceId: `s-${id}`, crewRoleId: "r1",
  offeredAt: status === "OFFERED" ? "2026-11-13T00:00:00.000Z" : null, project: job, crewRole: { name: "Rigger" }, ...over,
});
const members = [
  { id: "c1", firstName: "Oli", lastName: "Martin", department: null, crewRole: { id: "r1", name: "Rigger" }, skillIds: ["k1"],
    assignments: [call("a1", "2026-11-17", "PENDING"), call("a2", "2026-11-18", "ACCEPTED"), call("a3", "2026-11-19", "OFFERED")],
    availability: [] },
  { id: "c2", firstName: "Dev", lastName: "Patel", department: null, crewRole: { id: "r1", name: "Rigger" }, skillIds: [],
    assignments: [],
    availability: [{ id: "v1", type: "UNAVAILABLE", startDate: day("2026-11-16"), endDate: day("2026-11-16"), reason: "Leave" },
      { id: "v2", type: "TENTATIVE", startDate: day("2026-11-20"), endDate: day("2026-11-20"), reason: "#2340 Launch" }] },
];
const open = [{
  serviceId: "svc1", projectId: "p1", projectName: "Hilton gala", projectNumber: "#2341", title: "Bump in", date: Date.parse(day("2026-11-18")),
  endDate: null, crewCountRequired: 3, assignedCount: 1, shortfall: 2, shortDays: [{ day: Date.parse(day("2026-11-18")), shortfall: 2 }], startTime: "08:00", endTime: "18:00", crewRoleId: "r1", crewRoleName: "Rigger", phase: "BUMP_IN",
}];
const queried = vi.hoisted(() => ({ planner: undefined as unknown, truncated: false, open: undefined as unknown[] | undefined, members: undefined as unknown[] | undefined }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (q: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(q);
      if (name === "crewAvailability:plannerData") { queried.planner = args; return queried.members ?? members; }
      if (name === "crewPlanner:openCalls") return { calls: queried.open ?? open, truncated: queried.truncated };
      if (name === "crewTimeEntries:approvedHoursByMember") return { c1: 9 };
      if (name === "crewRoles:listForSettings") return [{ id: "r1", name: "Rigger", isActive: true, defaultRate: 420, rateType: "DAILY", sortOrder: 0 }];
      if (name === "crewSkills:list") return [{ id: "k1", name: "Dante" }];
      return undefined;
    },
  };
});

import { CrewPlanner } from "../planner/crew-planner";

beforeEach(() => {
  mobile.value = false;
  weekStart.value = 1;
  queried.truncated = false;
  queried.open = undefined;
  queried.members = undefined;
  nav.search = "";
  nav.push.mockClear();
  perms.all = true;
  announced.length = 0;
  Object.values(asg).forEach((f) => f.mockClear());
  Object.values(mail).forEach((f) => f.mockClear());
});

describe("CrewPlanner (smoke)", () => {
  it("one week Mon–Sun with blocks, availability words, the Hours column, strip counts and the footer", () => {
    render(<CrewPlanner />);
    const grid = screen.getByRole("table", { name: /one week/ });
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Person", "Mon16", "Tue17", "Wed18", "Thu19", "Fri20", "Sat21", "Sun22", "Hours",
    ]);
    expect(screen.getByTestId("planner-week").textContent).toBe("16 Nov – 22 Nov");
    expect(within(grid).getAllByText("#2341").length).toBe(3);
    expect(within(grid).getByText("Unavailable")).toBeTruthy();
    expect(within(grid).getByText("Pencilled")).toBeTruthy();
    expect(within(grid).getByText("4d")).toBeTruthy(); // Offered age, amber from 3 days
    expect(within(grid).getByText("20h")).toBeTruthy(); // planned: accepted + offered, pending excluded
    expect(within(grid).getByText("/ 9h")).toBeTruthy(); // logged
    expect(screen.getByRole("tab", { name: /Needs crew/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Unconfirmed/ }).textContent).toContain("3");
    expect(screen.getByTestId("planner-footer").textContent).toBe("2 people · 0 of 3 confirmed · 1 accepted · 1 offered · 1 pending");
    // the query args come from the URL week (stable), never Date.now()
    expect(queried.planner).toEqual({ orgId: "org1", startMs: Date.parse(day("2026-11-16")), endMs: Date.parse(day("2026-11-23")) - 1 });
  });

  it("a Sunday-start org (#1086) gets a Sun–Sat week, and the query window follows it", () => {
    weekStart.value = 0;
    render(<CrewPlanner />);
    const grid = screen.getByRole("table", { name: /one week/ });
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent).slice(1, 8)).toEqual(["Sun15", "Mon16", "Tue17", "Wed18", "Thu19", "Fri20", "Sat21"]);
    expect(screen.getByTestId("planner-week").textContent).toBe("15 Nov – 21 Nov");
    expect(queried.planner).toMatchObject({ startMs: Date.parse(day("2026-11-15")) });
  });

  it("the #1246 find-cover deep link (?week=<ms>&role&avail=AVAILABLE) lands filtered, reading Free", () => {
    nav.search = `week=${Date.parse(day("2026-11-18"))}&role=r1&avail=AVAILABLE`;
    render(<CrewPlanner />);
    expect(screen.getByTestId("planner-week").textContent).toBe("16 Nov – 22 Nov");
    expect(screen.getByRole("button", { name: "Role: Rigger" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Availability: Free" })).toBeTruthy();
    // Free = no call this week and no Unavailable day: Oli is booked, Dev is off on Monday.
    expect(screen.queryByText("Oli Martin")).toBeNull();
    expect(screen.queryByText("Dev Patel")).toBeNull();
    expect(screen.getByText("No crew match that")).toBeTruthy();
  });

  it("‹ › step the week in the URL, keeping params it does not own", async () => {
    nav.search = "ref=email";
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(nav.push).toHaveBeenCalledWith("/crew/planner?ref=email&week=2026-11-23", { scroll: false });
  });

  it("a filter word opens and writes the URL", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Skill" }));
    await user.click(await screen.findByRole("checkbox", { name: "Dante" }));
    expect(nav.push).toHaveBeenCalledWith("/crew/planner?skill=k1", { scroll: false });
  });

  it("clicking an empty cell opens Offer a call for that person and day; sending asks once more, then offers", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Offer Dev Patel a call on 2026-11-18" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Offer a call")).toBeTruthy();
    expect(within(sheet).getByText("Dev Patel · Wed, 18 Nov")).toBeTruthy();
    expect(within(sheet).getByRole("combobox", { name: "Job service" }).textContent).toMatch(/#2341 Bump in · Rigger · needs 2/);
    expect(within(sheet).getByText(/Cost rate \$420/)).toBeTruthy();
    expect(within(sheet).getByTestId("offer-day-state").textContent).toContain("Free");
    await user.click(within(sheet).getByRole("button", { name: "Offer call" }));
    expect(within(sheet).getByRole("alert").textContent).toMatch(/can't be unsent/);
    await user.click(within(sheet).getByRole("button", { name: "Send offer" }));
    await waitFor(() => expect(asg.create).toHaveBeenCalledTimes(1));
    expect(asg.create).toHaveBeenCalledWith("p1", expect.objectContaining({ crewMemberId: "c2", serviceId: "svc1", status: "PENDING", phase: "BUMP_IN", startDate: "2026-11-18", startTime: "08:00" }));
    expect(mail.sendCrewOffers).toHaveBeenCalledWith({ assignmentIds: ["newCall"] });
    expect(announced).toHaveLength(0); // sent mail: a toast with no Undo
  });

  it("Save as pending (send off) offers its Undo: delete the created call", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Offer call" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("combobox", { name: "Person" }));
    await user.click(await screen.findByRole("option", { name: /Dev Patel/ }));
    await user.click(within(sheet).getByRole("switch", { name: "Send the offer now" }));
    await user.click(within(sheet).getByRole("button", { name: "Save as pending" }));
    await waitFor(() => expect(announced).toHaveLength(1));
    expect(mail.sendCrewOffers).not.toHaveBeenCalled();
    await announced[0].performUndo!();
    expect(asg.remove).toHaveBeenCalledWith("newCall");
  });

  it("a block opens the call sheet; its ⋯ opens with the status's verbs, and Cancel call… confirms first", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Oli Martin · #2341 Rigger, 2026-11-18" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Oli Martin")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: /Logistics tab/ }).getAttribute("href")).toBe("/projects/p1?tab=logistics");
    await user.keyboard("{Escape}");
    await user.click(screen.getAllByRole("button", { name: "#2341 Rigger actions" })[0]);
    expect(await screen.findByRole("menuitem", { name: /^Offer/ })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: /Cancel call/ }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText("Cancel 1 call?")).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Cancel 1 call" }));
    await waitFor(() => expect(asg.cancelMany).toHaveBeenCalledWith(["a1"]));
  });

  it("bulk: tick calls → Offer n / Confirm n / Cancel n with their own counts; Confirm's Undo is unconfirmMany(result)", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).getByText("3 calls selected")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Offer 1" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Cancel 3" })).toBeTruthy();
    await user.click(within(bar).getByRole("button", { name: "Confirm 1" }));
    await waitFor(() => expect(asg.confirmMany).toHaveBeenCalledWith(["a2"]));
    await announced[0].performUndo!();
    expect(asg.unconfirmMany).toHaveBeenCalledWith({ confirmed: ["a2"], skipped: [], stamp: 555 });
  });

  it("bulk Offer n and Cancel n confirm first; Cancel mails exactly toTell", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Offer 1" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Send 1 offer?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Send 1 offer" }));
    await waitFor(() => expect(mail.sendCrewOffers).toHaveBeenCalledWith({ assignmentIds: ["a1"] }));
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Cancel 3" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 people have been offered or confirmed/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel 3 calls" }));
    await waitFor(() => expect(mail.sendCancellationEmails).toHaveBeenCalledWith({ assignmentIds: ["a1", "a2", "a3"] }));
  });

  describe("S5: bulk Offer and Cancel over 150 calls email every recipient exactly once", () => {
    const many = Array.from({ length: 150 }, (_, i) => call(`b${i}`, "2026-11-17", "PENDING"));
    // The server action refuses more than 100 ids, exactly as the real one does.
    const strict = async (i: { assignmentIds: string[] }) => {
      if (i.assignmentIds.length > 100) throw new Error("Too many");
      return { sent: i.assignmentIds.length, errors: [], total: i.assignmentIds.length };
    };
    const sentIds = (fn: typeof mail.sendCrewOffers) => fn.mock.calls.flatMap(([i]) => i.assignmentIds);
    const ids = many.map((c) => c.id);

    it("Offer 150 → sendCrewOffers in batches of ≤ 100, each id once", async () => {
      queried.members = [{ ...members[1], assignments: many }];
      mail.sendCrewOffers.mockImplementation(strict);
      const user = userEvent.setup();
      render(<CrewPlanner />);
      await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
      await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Offer 150" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Send 150 offers" }));
      await waitFor(() => expect(sentIds(mail.sendCrewOffers)).toHaveLength(150));
      expect(mail.sendCrewOffers.mock.calls.every(([i]) => i.assignmentIds.length <= 100)).toBe(true);
      expect([...sentIds(mail.sendCrewOffers)].sort()).toEqual([...ids].sort());
    });

    it("Cancel 150 → sendCancellationEmails(toTell) in batches of ≤ 100, each id once", async () => {
      queried.members = [{ ...members[1], assignments: many }];
      mail.sendCancellationEmails.mockImplementation(strict);
      const user = userEvent.setup();
      render(<CrewPlanner />);
      await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
      await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Cancel 150" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel 150 calls" }));
      await waitFor(() => expect(sentIds(mail.sendCancellationEmails)).toHaveLength(150));
      expect(mail.sendCancellationEmails.mock.calls.every(([i]) => i.assignmentIds.length <= 100)).toBe(true);
      expect([...sentIds(mail.sendCancellationEmails)].sort()).toEqual([...ids].sort());
    });

    it("a later batch failing says `100 sent, 50 not sent`, and Retry sends exactly the 50", async () => {
      queried.members = [{ ...members[1], assignments: many }];
      let down = true;
      mail.sendCrewOffers.mockImplementation(async (i: { assignmentIds: string[] }) => {
        if (down && i.assignmentIds.includes("b120")) throw new Error("Mail is down");
        return strict(i);
      });
      const err = vi.mocked(toast.error);
      err.mockClear();
      const user = userEvent.setup();
      render(<CrewPlanner />);
      await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
      await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Offer 150" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Send 150 offers" }));
      await waitFor(() => expect(err).toHaveBeenCalled());
      const [title, opts] = err.mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }];
      expect(title).toMatch(/^100 sent, 50 not sent · Mail is down/);
      expect(opts.action.label).toBe("Retry");
      const before = sentIds(mail.sendCrewOffers).length;
      down = false;
      opts.action.onClick();
      await waitFor(() => expect(sentIds(mail.sendCrewOffers).length).toBe(before + 50));
      const retried = mail.sendCrewOffers.mock.calls.at(-1)![0].assignmentIds;
      expect(new Set(retried)).toEqual(new Set(ids.filter((id) => !sentIds(mail.sendCrewOffers).slice(0, 100).includes(id))));
      mail.sendCrewOffers.mockImplementation(strict);
    });
  });

  it("shift-click ticks a range", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select #2341 Rigger, 2026-11-17" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select #2341 Rigger, 2026-11-19" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 calls selected")).toBeTruthy();
  });

  it("Needs crew: open calls by day with suggestions; the row ⋯ opens; a row opens Offer a call with the first suggestion; Offer to suggested n", async () => {
    nav.search = "seg=needs";
    const user = userEvent.setup();
    render(<CrewPlanner />);
    const list = screen.getByRole("table", { name: "Calls that need crew" });
    expect(within(list).getByText("Wed, 18 Nov")).toBeTruthy();
    expect(within(list).getByText("needs 2")).toBeTruthy();
    await user.click(within(list).getByRole("button", { name: "#2341 Bump in actions" }));
    expect(await screen.findByRole("menuitem", { name: /Offer to…/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Offer to suggested/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(list).getByText("Bump in"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Dev Patel · Wed, 18 Nov")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(list).getByRole("checkbox", { name: "Select #2341 Bump in" }));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Offer to suggested 1" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send 1 offer" }));
    await waitFor(() => expect(mail.sendCrewOffers).toHaveBeenCalledWith({ assignmentIds: ["newCall"] }));
    // S2: the call books exactly the day the suggestion was judged on.
    expect(asg.create).toHaveBeenCalledWith("p1", expect.objectContaining({ crewMemberId: "c2", serviceId: "svc1", startDate: "2026-11-18", endDate: "2026-11-18" }));
  });

  it("without crew:create / update: no primary, cells are not buttons, blocks have no verbs", () => {
    perms.all = false;
    render(<CrewPlanner />);
    expect(screen.queryByRole("button", { name: "Offer call" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Offer Dev Patel a call/ })).toBeNull();
  });

  it("phone: day chips (open count), one day as Needs crew · Booked · Free · Unavailable, the sticky Offer call", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<CrewPlanner />);
    expect(screen.queryByRole("table", { name: /one week/ })).toBeNull(); // no sideways-scrolling grid on a phone
    const chips = screen.getByRole("tablist", { name: "Day" });
    expect(within(chips).getByRole("tab", { name: /Wed 18/ }).textContent).toContain("2 open");
    expect(within(chips).getByRole("tab", { name: /Tue 17/ }).getAttribute("aria-selected")).toBe("true"); // today
    expect(screen.getByRole("region", { name: "Booked" }).textContent).toContain("Oli Martin");
    expect(screen.getByRole("region", { name: "Free" }).textContent).toContain("Dev Patel");
    // The phone primary is the sticky button, not the head's
    expect(screen.getAllByRole("button", { name: "Offer call" })).toHaveLength(1);
    await user.click(within(chips).getByRole("tab", { name: /Mon 16/ }));
    expect(screen.getByRole("region", { name: "Unavailable" }).textContent).toContain("Dev Patel");
    await user.click(within(chips).getByRole("tab", { name: /Wed 18/ }));
    expect(screen.getByRole("region", { name: "Needs crew" }).textContent).toContain("#2341 Bump in");
    await user.click(screen.getByRole("button", { name: "Offer Dev Patel a call on 2026-11-18" }));
    expect(within(await screen.findByRole("dialog")).getByText("Offer a call")).toBeTruthy();
  });

  it("phone: a booked card opens the call sheet; its ⋯ opens as a bottom sheet; ticking swaps the primary for the bulk bar", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(within(screen.getByRole("region", { name: "Booked" })).getByText("Oli Martin"));
    expect(within(await screen.findByRole("dialog")).getByRole("button", { name: /^Offer/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Oli Martin #2341 actions" }));
    expect(await screen.findByRole("button", { name: /Cancel call/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("checkbox", { name: "Select Oli Martin #2341" }));
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Offer call" })).toBeNull();
  });

  it("phone: the Needs crew strip lists the week's open calls by day", () => {
    mobile.value = true;
    nav.search = "seg=needs";
    render(<CrewPlanner />);
    expect(screen.getByRole("region", { name: "Wed, 18 Nov" }).textContent).toContain("needs 2");
  });

  it("select-all skips calls dimmed by the Job filter; a bulk confirm over two jobs names them", async () => {
    const agm = { id: "p2", name: "AGM", projectNumber: "#2350", status: "CONFIRMED", projectManagerId: "you" };
    const withTwoJobs = [{ ...members[0], assignments: [...members[0].assignments, call("x1", "2026-11-20", "PENDING", { project: agm })] }, members[1]];
    queried.members = withTwoJobs;
    const user = userEvent.setup();
    // Job: #2341 — the #2350 block is dimmed, so select-all never reaches it.
    nav.search = "job=p1";
    const { unmount } = render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    expect(screen.getByText("3 calls selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select #2350 Rigger, 2026-11-20" }).getAttribute("data-state")).toBe("unchecked");
    unmount();
    // No filter: all four, across two jobs — Cancel's confirm names both.
    nav.search = "";
    render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Cancel 4" }));
    expect(within(await screen.findByRole("dialog")).getByText(/Jobs: #2341, #2350\./)).toBeTruthy();
  });

  it("a ticked call that disappears from the live data drops out of the bulk counts", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CrewPlanner />);
    await user.click(screen.getByRole("checkbox", { name: "Select every call shown" }));
    expect(screen.getByText("3 calls selected")).toBeTruthy();
    // a1 (the PENDING one) is cancelled in another tab: the subscription no longer returns it.
    queried.members = [{ ...members[0], assignments: members[0].assignments.filter((c) => c.id !== "a1") }, members[1]];
    rerender(<CrewPlanner />);
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).getByText("2 calls selected")).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: /^Offer/ })).toBeNull();
    expect(within(bar).getByRole("button", { name: "Cancel 2" })).toBeTruthy();
  });

  it("Offer a call: the Day, Job service and Role Selects open and pick", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Offer Dev Patel a call on 2026-11-18" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("combobox", { name: "Day" }));
    await user.click(await screen.findByRole("option", { name: /Thu, 19 Nov/ }));
    expect(within(sheet).getByRole("combobox", { name: "Day" }).textContent).toMatch(/Thu, 19 Nov/);
    // No open service on Thursday: the sheet says so instead of a Select.
    expect(within(sheet).getByText(/No call is short of people this day/)).toBeTruthy();
    await user.click(within(sheet).getByRole("combobox", { name: "Day" }));
    await user.click(await screen.findByRole("option", { name: /Wed, 18 Nov/ }));
    await user.click(within(sheet).getByRole("combobox", { name: "Job service" }));
    expect(await screen.findByRole("option", { name: /#2341 Bump in · Rigger · needs 2/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(sheet).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Rigger" }));
    expect(within(sheet).getByRole("combobox", { name: "Role" }).textContent).toBe("Rigger");
  });

  it("the call sheet follows the live call: a new status shows, and a cancelled call closes it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Oli Martin · #2341 Rigger, 2026-11-18" }));
    let sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Accepted")).toBeTruthy();
    // Confirmed in another tab: the subscription returns the new status.
    queried.members = [{ ...members[0], assignments: members[0].assignments.map((c) => (c.id === "a2" ? { ...c, status: "CONFIRMED" } : c)) }, members[1]];
    rerender(<CrewPlanner />);
    sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Confirmed")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Confirm" })).toBeNull();
    // Cancelled: the call leaves the planner data, so the sheet closes.
    queried.members = [{ ...members[0], assignments: members[0].assignments.filter((c) => c.id !== "a2") }, members[1]];
    rerender(<CrewPlanner />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("phone: a person whose only call that day was DECLINED is Free, not Booked", () => {
    mobile.value = true;
    queried.members = [members[0], { ...members[1], assignments: [call("d1", "2026-11-17", "DECLINED")] }];
    render(<CrewPlanner />);
    expect(screen.getByRole("region", { name: "Booked" }).textContent).not.toContain("Dev Patel");
    expect(screen.getByRole("region", { name: "Free" }).textContent).toContain("Dev Patel");
  });

  it("a multi-day run is offerable from an empty cell on any day it covers; the call takes that day only, or the whole run", async () => {
    const short = ["2026-11-17", "2026-11-18", "2026-11-19"].map((d) => ({ day: Date.parse(day(d)), shortfall: 2 }));
    queried.open = [{ ...open[0], serviceId: "run", title: "Install", date: Date.parse(day("2026-11-17")), endDate: Date.parse(day("2026-11-19")), shortDays: short }];
    const user = userEvent.setup();
    render(<CrewPlanner />);
    // Thursday: the run started Tuesday, and is still listed on Thursday.
    await user.click(screen.getByRole("button", { name: "Offer Dev Patel a call on 2026-11-19" }));
    let sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("combobox", { name: "Job service" }).textContent).toMatch(/#2341 Install/);
    const span = within(sheet).getByRole("radiogroup", { name: "Call covers" });
    expect(within(span).getByRole("radio", { name: /This day only/ }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(sheet).getByRole("switch", { name: "Send the offer now" }));
    await user.click(within(sheet).getByRole("button", { name: "Save as pending" }));
    await waitFor(() => expect(asg.create).toHaveBeenCalledWith("p1", expect.objectContaining({ startDate: "2026-11-19", endDate: "2026-11-19" })));
    // The whole run takes the service's own dates.
    await user.click(screen.getByRole("button", { name: "Offer Dev Patel a call on 2026-11-18" }));
    sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("radio", { name: /Whole run/ }));
    await user.click(within(sheet).getByRole("switch", { name: "Send the offer now" }));
    await user.click(within(sheet).getByRole("button", { name: "Save as pending" }));
    await waitFor(() => expect(asg.create).toHaveBeenLastCalledWith("p1", expect.objectContaining({ startDate: "2026-11-17", endDate: "2026-11-19" })));
  });

  it("B1: a run filled on Tue (a this-day-only call) is open only on Wed and Thu, and says so", async () => {
    const short = ["2026-11-18", "2026-11-19"].map((d) => ({ day: Date.parse(day(d)), shortfall: 1 }));
    queried.open = [{ ...open[0], serviceId: "run", title: "Install", date: Date.parse(day("2026-11-17")), endDate: Date.parse(day("2026-11-19")), shortfall: 1, shortDays: short }];
    nav.search = "seg=needs";
    const { unmount } = render(<CrewPlanner />);
    const list = screen.getByRole("table", { name: "Calls that need crew" });
    expect(within(list).getByText("Wed, 18 Nov")).toBeTruthy(); // listed under its first SHORT day, not Tue
    expect(within(list).queryByText("Tue, 17 Nov")).toBeNull();
    expect(within(list).getByText(/Wed, Thu short/)).toBeTruthy();
    unmount();
    nav.search = "";
    mobile.value = true;
    const user = userEvent.setup();
    render(<CrewPlanner />);
    const chips = screen.getByRole("tablist", { name: "Day" });
    expect(within(chips).getByRole("tab", { name: /Tue 17/ }).textContent).not.toContain("open");
    expect(within(chips).getByRole("tab", { name: /Thu 19/ }).textContent).toContain("1 open");
    expect(screen.queryByRole("region", { name: "Needs crew" })).toBeNull(); // Tue (today) is filled
    await user.click(within(chips).getByRole("tab", { name: /Wed 18/ }));
    expect(screen.getByRole("region", { name: "Needs crew" }).textContent).toContain("needs 1");
  });

  it("S3: on a phone, an open run tapped on Thursday offers Thursday — not the run's first day", async () => {
    const short = ["2026-11-17", "2026-11-18", "2026-11-19"].map((d) => ({ day: Date.parse(day(d)), shortfall: 1 }));
    queried.open = [{ ...open[0], serviceId: "run", title: "Install", date: Date.parse(day("2026-11-17")), endDate: Date.parse(day("2026-11-19")), shortfall: 1, shortDays: short }];
    mobile.value = true;
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(within(screen.getByRole("tablist", { name: "Day" })).getByRole("tab", { name: /Thu 19/ }));
    await user.click(within(screen.getByRole("region", { name: "Needs crew" })).getByText("#2341 Install"));
    let sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Dev Patel · Thu, 19 Nov")).toBeTruthy();
    expect(within(sheet).getByRole("combobox", { name: "Day" }).textContent).toMatch(/Thu, 19 Nov/);
    await user.keyboard("{Escape}");
    // The card's ⋯ › Offer to… offers the viewed day too.
    await user.click(screen.getByRole("button", { name: "#2341 Install actions" }));
    await user.click(await screen.findByRole("button", { name: /Offer to…/ }));
    sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Dev Patel · Thu, 19 Nov")).toBeTruthy();
  });

  it("Needs crew says `n+` when the server's read stopped at its cap (desktop and phone)", () => {
    queried.truncated = true;
    nav.search = "seg=needs";
    const { unmount } = render(<CrewPlanner />);
    const note = screen.getByTestId("needs-truncated").textContent ?? "";
    expect(note).toMatch(/^2\+ open slots/);
    // S4: it states the cap; a client-side filter can't narrow the server read, so it never suggests one.
    expect(note).not.toMatch(/filter|Role|Job/);
    unmount();
    mobile.value = true;
    render(<CrewPlanner />);
    expect(screen.getByTestId("needs-truncated").textContent).toMatch(/^2\+/);
  });

  it("page ⋯ holds Crew list and Crew roles & rates… (the roles sheet is URL state)", async () => {
    const user = userEvent.setup();
    render(<CrewPlanner />);
    await user.click(screen.getByRole("button", { name: "Crew options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Crew roles & rates/ }));
    expect(nav.replace).toHaveBeenCalledWith("/crew/planner?sheet=roles", { scroll: false });
  });
});
