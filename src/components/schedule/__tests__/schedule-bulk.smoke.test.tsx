// @vitest-environment jsdom
//
// Schedule bulk verbs (UX Phase 18 slice 3, §9o.5). Rendered for real with every
// overlay OPENED: the bulk bar, Move dates dialog, the existing confirm-impact and
// date-move-impact heads-ups (the gates' single onProceed), the row ⋯ and the job
// sheet. Every write is the EXISTING per-job mutation; the toast carries ONE Undo.
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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const NOW = Date.UTC(2026, 10, 11, 1);
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/availability",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/use-org-country", () => ({ useOrgWeekStartsOn: () => 1 }));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "me", name: "Alice" } } }),
}));
const perms = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => !perms.deny.has(`${r}:${a}`) }));
vi.mock("@/hooks/use-member-roster", () => ({ useMemberRoster: () => ({ nameOf: new Map([["me", "Alice"]]), options: [{ id: "me", name: "Alice" }] }) }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

// The EXISTING writes and reads: nothing here is a new mutation.
const w = vi.hoisted(() => ({
  updateStatus: vi.fn(async (_id: string, _s: string) => {}),
  updateSchedule: vi.fn(async (_id: string, _p: unknown, _o?: unknown) => ({ auditId: "aud" })),
  undoUpdate: vi.fn(async (_id: string, _a: string) => {}),
  impact: vi.fn((_projectId: string) => ({ hardOverbookingModelCount: 0, hardOverbookingQty: 0, unconfirmedCrewCount: 0 })),
  dateImpact: vi.fn((_projectId: string) => ({ rows: [] as unknown[], windowMoved: true })),
  live: vi.fn((): { id: string; status: string }[] => []),
}));
vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: () => ({ updateStatus: w.updateStatus }),
  useProjectWrites: () => ({ updateSchedule: w.updateSchedule, undoUpdate: w.undoUpdate }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useConvex: () => ({
      query: async (f: FunctionReference<"query">, args: { projectId?: string }) => {
        const name = getFunctionName(f);
        if (name === "overbookingBoard:confirmImpact") return w.impact(args.projectId!);
        if (name === "overbookingBoard:dateMoveImpact") return w.dateImpact(args.projectId!);
        if (name === "projects:listByIds") return w.live();
        return undefined;
      },
    }),
  };
});

const ms = (d: string) => Date.parse(`${d}T00:00:00.000Z`);
const mk = (id: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  id, projectNumber: `#${id}`, name: `Job ${id}`, status: "CONFIRMED", holds: true, clientId: null, clientName: "Hilton",
  projectManagerId: "me", rentalStart: ms(from), rentalEnd: ms(to), windowStart: null, windowEnd: null, clash: "none", clashes: [],
  modelCount: 1, modelIds: ["m1"], lineCount: 2, unitCount: 4, ...over,
});
const jobs = [
  mk("2350", "2026-11-10", "2026-11-12", { status: "QUOTED", holds: false }),
  mk("2351", "2026-11-11", "2026-11-12", { status: "QUOTED", holds: false }),
  mk("2337", "2026-11-10", "2026-11-11", { status: "CONFIRMED" }),
  mk("2370", "2026-11-09", "2026-11-15", { status: "CHECKED_OUT" }),
];
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (f: FunctionReference<"query">, args: unknown) => {
      if (args === "skip" || getFunctionName(f) !== "scheduleBoard:jobs") return undefined;
      return { truncated: false, models: [{ id: "m1", name: "EM4", categoryId: null }], jobs };
    },
  };
});

import { SchedulePage } from "../schedule-page";

/** The toast the batch announced: its title and its ONE Undo closure. */
function lastToast() {
  const call = vi.mocked(toast.success).mock.calls.at(-1)!;
  const opts = call[1] as { action?: { label: string; onClick: () => void } } | undefined;
  return { title: call[0] as string, undo: opts?.action?.onClick };
}

beforeEach(() => {
  mobile.value = false;
  nav.search = "";
  nav.push.mockClear();
  perms.deny = new Set();
  vi.mocked(toast.success).mockClear();
  w.updateStatus.mockClear();
  w.updateSchedule.mockClear();
  w.updateSchedule.mockImplementation(async () => ({ auditId: "aud" }));
  w.undoUpdate.mockClear();
  w.impact.mockReset().mockReturnValue({ hardOverbookingModelCount: 0, hardOverbookingQty: 0, unconfirmedCrewCount: 0 });
  w.dateImpact.mockReset().mockReturnValue({ rows: [], windowMoved: true });
  w.live.mockReset().mockReturnValue([]);
});

describe("Schedule selection and the bulk bar", () => {
  it("always-on checkboxes: the header ticks every job shown, shift-click ticks a range, and the verbs carry the count of the jobs they apply to", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
    // reading order is start date, then number: 2370, 2337, 2350, 2351
    await user.click(screen.getByRole("checkbox", { name: "Select #2337" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select #2351" }));
    await user.keyboard("{/Shift}");
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(bar.textContent).toContain("3 jobs selected"); // the range 2337..2351
    await user.click(screen.getByRole("checkbox", { name: "Select every job shown" }));
    expect(screen.getByRole("toolbar", { name: "Bulk actions" }).textContent).toContain("4 jobs selected");
    // Confirm counts only the Quoted jobs; Move dates counts the ones whose dates are not locked (CHECKED_OUT is not)
    expect(within(bar).getByRole("button", { name: "Confirm 2" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Move dates 3…" })).toBeTruthy();
  });

  it("a verb that applies to none of the ticked jobs is absent, not disabled; no project:update means no verbs at all", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("checkbox", { name: "Select #2370" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).queryByRole("button", { name: /Confirm/ })).toBeNull();
    expect(within(bar).queryByRole("button", { name: /Move dates/ })).toBeNull();
  });

  it("no project:update: no bulk verbs, no row Confirm / Move, and no sheet verbs", async () => {
    perms.deny = new Set(["project:update"]);
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("checkbox", { name: "Select #2350" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).queryByRole("button", { name: /Confirm|Move dates/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "#2350 actions" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Open job", "Equipment ›", "Logistics ›", "Copy link"]);
  });

  it("on a phone the ticked jobs replace the sticky + New job with the bulk bar", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<SchedulePage />);
    expect(screen.getByRole("button", { name: "+ New job" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Select #2337" }));
    expect(screen.queryByRole("button", { name: "+ New job" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" }).textContent).toContain("1 job selected");
  });
});

describe("Confirm n: the existing confirm gate, its ONE onProceed, ONE Undo", () => {
  it("confirms the Quoted jobs with no UI change when nothing clashes, names what it skipped, and the toast's Undo restores exactly those rows", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("checkbox", { name: "Select every job shown" }));
    await user.click(screen.getByRole("button", { name: "Confirm 2" }));
    await waitFor(() => expect(w.updateStatus).toHaveBeenCalledTimes(2));
    expect(w.updateStatus.mock.calls).toEqual([["2350", "CONFIRMED"], ["2351", "CONFIRMED"]]);
    expect(screen.queryByText("Confirming this job will create a gap")).toBeNull();
    await waitFor(() => expect(lastToast().title).toBe("Confirmed 2 jobs · skipped #2370, #2337: not Quoted"));
    // ONE Undo closure for the whole batch: it reads the LIVE status and puts back only rows still Confirmed
    w.live.mockReturnValue([{ id: "2350", status: "CONFIRMED" }, { id: "2351", status: "PREPPING" }]);
    w.updateStatus.mockClear();
    lastToast().undo!();
    await waitFor(() => expect(w.updateStatus.mock.calls).toEqual([["2350", "QUOTED"]]));
    await waitFor(() => expect(lastToast().title).toBe("1 job had moved on, left as it is"));
  });

  it("a clash raises the existing heads-up for that row: Cancel keeps it Quoted and names it, Confirm anyway proceeds, and the batch carries on", async () => {
    w.impact.mockImplementation((id) => (id === "2350" ? { hardOverbookingModelCount: 1, hardOverbookingQty: 2, unconfirmedCrewCount: 0 } : { hardOverbookingModelCount: 0, hardOverbookingQty: 0, unconfirmedCrewCount: 0 }));
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("checkbox", { name: "Select #2350" }));
    await user.click(screen.getByRole("checkbox", { name: "Select #2351" }));
    await user.click(screen.getByRole("button", { name: "Confirm 2" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Confirming this job will create a gap")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(w.updateStatus.mock.calls).toEqual([["2351", "CONFIRMED"]]));
    await waitFor(() => expect(lastToast().title).toBe("Confirmed 1 job · skipped #2350: kept as Quoted"));
  });

  it("Confirm anyway runs the same write the gate would have run with no dialog", async () => {
    w.impact.mockReturnValue({ hardOverbookingModelCount: 1, hardOverbookingQty: 1, unconfirmedCrewCount: 0 });
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "#2350 actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Confirm…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm anyway" }));
    await waitFor(() => expect(w.updateStatus.mock.calls).toEqual([["2350", "CONFIRMED"]]));
    await waitFor(() => expect(lastToast().title).toBe("Confirmed 1 job"));
  });

  it("a server refusal names the row with the server's own reason and the rest still confirm (per-row gating is the server's)", async () => {
    w.updateStatus.mockImplementationOnce(async () => {
      throw new Error("Accept a quote first");
    });
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("checkbox", { name: "Select #2350" }));
    await user.click(screen.getByRole("checkbox", { name: "Select #2351" }));
    await user.click(screen.getByRole("button", { name: "Confirm 2" }));
    await waitFor(() => expect(lastToast().title).toBe("Confirmed 1 job · skipped #2350: Accept a quote first"));
  });
});

describe("Move dates: the existing date-move gate, its ONE onProceed, the server's lock, ONE Undo", () => {
  async function openMove(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("checkbox", { name: "Select every job shown" }));
    await user.click(screen.getByRole("button", { name: "Move dates 3…" }));
    return await screen.findByRole("dialog");
  }

  it("Move by a week: old → new per job, the locked job is listed as skipped with the server's reason, Move n writes with lockDates, and ONE Undo reverses exactly the recorded edits", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    const dialog = await openMove(user);
    expect(within(dialog).getByRole("button", { name: "Move 3" }).hasAttribute("disabled")).toBe(true); // choose a distance first
    await user.click(within(dialog).getByRole("button", { name: "1 week later" }));
    const rows = within(dialog).getByRole("list", { name: "Jobs to move" });
    expect(rows.textContent).toContain("10 Nov – 12 Nov → 17 Nov – 19 Nov");
    expect(rows.textContent).toContain("skipped: Dates are locked while the gear is out.");
    await user.click(within(dialog).getByRole("button", { name: "Move 3" }));
    await waitFor(() => expect(w.updateSchedule).toHaveBeenCalledTimes(3));
    expect(w.updateSchedule).toHaveBeenCalledWith("2350", { rentalStartDate: "2026-11-17", rentalEndDate: "2026-11-19" }, { lockDates: true });
    await waitFor(() => expect(lastToast().title).toBe("Moved 3 jobs by +7 days · skipped #2370: Dates are locked while the gear is out"));
    lastToast().undo!();
    await waitFor(() => expect(w.undoUpdate.mock.calls).toEqual([["2337", "aud"], ["2350", "aud"], ["2351", "aud"]]));
  });

  it("a Confirmed job's move previews the gear impact through the existing heads-up (Move anyway), and Cancel skips just that row", async () => {
    w.dateImpact.mockImplementation(() => ({ rows: [{ modelId: "m1", modelName: "EM4", qty: 2, projectNumbers: ["#2342"] }], windowMoved: true }));
    const user = userEvent.setup();
    render(<SchedulePage />);
    const dialog = await openMove(user);
    await user.click(within(dialog).getByRole("button", { name: "1 day later" }));
    await user.click(within(dialog).getByRole("button", { name: "Move 3" }));
    const heads = await screen.findByRole("dialog");
    expect(within(heads).getByText("Moving these dates creates a shortage")).toBeTruthy();
    await user.click(within(heads).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(w.updateSchedule).toHaveBeenCalledTimes(2)); // the two Quoted jobs moved with no preview
    await waitFor(() => expect(lastToast().title).toBe("Moved 2 jobs by +1 day · skipped #2370: Dates are locked while the gear is out; #2337: kept its dates"));
  });

  it("the SERVER's refusal (DATES_LOCKED) skips the row with its message even if the menus offered the move", async () => {
    w.updateSchedule.mockImplementationOnce(async () => {
      throw new Error("Dates are locked while the gear is out.");
    });
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "#2350 actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move dates…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "1 week earlier" }));
    await user.click(within(dialog).getByRole("button", { name: "Move 1" }));
    await waitFor(() => expect(lastToast().title).toBe("Moved 0 jobs by -7 days · skipped #2350: Dates are locked while the gear is out"));
    expect(lastToast().undo).toBeUndefined(); // nothing changed, nothing to undo
  });
});

describe("the row ⋯ and the job sheet", () => {
  it("Confirm… and Move dates… lead the row ⋯ for a Quoted job; a CHECKED_OUT job offers neither", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "#2350 actions" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Confirm…", "Move dates…", "Open job", "Equipment ›", "Logistics ›", "Copy link"]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "#2370 actions" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Open job", "Equipment ›", "Logistics ›", "Copy link"]);
  });

  it("the job sheet says in words that deployed dates are locked and offers no Move; a Quoted job's sheet offers both verbs", async () => {
    nav.search = "job=2370";
    const first = render(<SchedulePage />);
    let sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Dates are locked while the gear is out.")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Move dates…" })).toBeNull();
    first.unmount();
    nav.search = "job=2350";
    render(<SchedulePage />);
    sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Confirm…" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Move dates…" })).toBeTruthy();
  });
});
