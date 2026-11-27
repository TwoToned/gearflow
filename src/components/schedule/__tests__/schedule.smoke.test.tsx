// @vitest-environment jsdom
//
// Schedule (UX Phase 18 slice 1, §9o). Rendered for real with every overlay
// OPENED: the job ⋯, the page ⋯, the job sheet, the day sheet, a filter word;
// the week and the real calendar month; the phone day list; the unchecked and
// truncated states. The query args come from the URL range (stable), never Date.now().
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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const NOW = Date.UTC(2026, 10, 11, 1); // Wed 11 Nov 2026
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/availability",
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
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => perms.all }));
vi.mock("@/hooks/use-member-roster", () => ({
  useMemberRoster: () => ({ nameOf: new Map([["me", "Alice"]]), options: [{ id: "me", name: "Alice" }] }),
}));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [{ id: "cat1", name: "Audio" }] }));
// The bulk verbs' writes are covered in schedule-bulk.smoke.test.tsx; here they are inert.
vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: () => ({ updateStatus: vi.fn() }),
  useProjectWrites: () => ({ updateSchedule: vi.fn(), undoUpdate: vi.fn() }),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const ms = (d: string) => Date.parse(`${d}T00:00:00.000Z`);
const mk = (id: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  id, projectNumber: `#${id}`, name: `Job ${id}`, status: "CONFIRMED", holds: true, clientId: null, clientName: "Hilton",
  projectManagerId: "me", rentalStart: ms(from), rentalEnd: ms(to), clash: "none", clashes: [], modelCount: 1, modelIds: ["m1"],
  lineCount: 2, unitCount: 4, ...over,
});
const jobs = [
  mk("2337", "2026-11-10", "2026-11-12", { clash: "clash", clashes: [{ layer: "hard", modelId: "m1", modelName: "EM4 receiver", short: 2, startMs: ms("2026-11-11"), endMs: ms("2026-11-11"), with: [{ id: "2342", projectNumber: "#2342" }] }] }),
  mk("2342", "2026-11-11", "2026-11-11"),
  mk("2350", "2026-11-13", "2026-11-14", { status: "QUOTED", holds: false, clash: "wouldClash", clashes: [{ layer: "pencilled", modelId: "m1", modelName: "EM4 receiver", short: 2, startMs: ms("2026-11-13"), endMs: ms("2026-11-14"), with: [{ id: "2337", projectNumber: "#2337" }] }] }),
  mk("2360", "2026-11-05", "2026-11-25", { status: "QUOTED", holds: false, clash: "unknown", modelCount: null, lineCount: null, unitCount: null }),
];
const cell = (over: Record<string, unknown> = {}) => ({ unknown: false, free: 2, held: 0, pencilled: 0, short: 0, atRisk: 0, ...over });
const days = [9, 10, 11, 12, 13, 14, 15].map((d) => ms(`2026-11-${String(d).padStart(2, "0")}`));
const claim = (id: string, layer: string, qty: number, from: string, to: string) => ({
  projectId: id, projectNumber: `#${id}`, name: `Job ${id}`, status: layer === "hard" ? "CONFIRMED" : "QUOTED", projectManagerId: "me", layer, qty, startMs: ms(from), endMs: ms(to),
});
const gearRows = [
  { modelId: "m1", name: "EM4 receiver", categoryId: "cat1", owned: 12, inService: 1, unknown: false,
    cells: [cell({ free: 12 }), cell({ free: 12 }), cell({ free: -2, held: 14, short: 2 }), cell({ free: 4, held: 8 }), cell({ free: 1, held: 0, pencilled: 3, atRisk: 2 }), cell({ free: 12, held: 0 }), cell({ free: 12 })],
    claims: [claim("2337", "hard", 10, "2026-11-11", "2026-11-11"), claim("2342", "hard", 4, "2026-11-11", "2026-11-11"), claim("2350", "pencilled", 3, "2026-11-13", "2026-11-13")],
    // the board's sweep: #2337 got there first and fits; only #2342 is short (2)
    shortSegments: [{ startMs: ms("2026-11-11"), endMs: ms("2026-11-11"), over: [{ projectId: "2342", qty: 2 }] }],
    riskSegments: [{ startMs: ms("2026-11-13"), endMs: ms("2026-11-13"), over: [{ projectId: "2350", qty: 2 }] }] },
  { modelId: "m2", name: "Beltpack", categoryId: null, owned: 8, inService: 0, unknown: true,
    cells: days.map(() => ({ unknown: true, free: 0, held: 0, pencilled: 0, short: 0, atRisk: 0 })), claims: [claim("2337", "hard", 2, "2026-11-11", "2026-11-12")], shortSegments: [], riskSegments: [] },
];
const q = vi.hoisted(() => ({ args: undefined as unknown, gearArgs: undefined as unknown, jobsCalled: 0, truncated: false, jobs: undefined as unknown[] | undefined, rows: undefined as unknown[] | undefined, dayStarts: undefined as number[] | undefined }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (f: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(f) === "scheduleBoard:grid") {
        q.gearArgs = args;
        return { truncated: q.truncated, claimsComplete: true, dayStarts: q.dayStarts ?? days, rows: q.rows ?? gearRows };
      }
      if (getFunctionName(f) === "scheduleBoard:jobs") {
        q.jobsCalled += 1;
        q.args = args;
        return { truncated: q.truncated, models: [{ id: "m1", name: "EM4 receiver", categoryId: "cat1" }], jobs: q.jobs ?? jobs };
      }
      return undefined;
    },
  };
});

import { SchedulePage } from "../schedule-page";

beforeEach(() => {
  mobile.value = false;
  weekStart.value = 1;
  q.truncated = false;
  q.jobs = undefined;
  q.rows = undefined;
  q.dayStarts = undefined;
  q.jobsCalled = 0;
  q.gearArgs = undefined;
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  perms.all = true;
});

describe("Schedule (smoke)", () => {
  it("one Mon–Sun week: a bar per job on ONE row each, the clash words, the strip counts, no 3-lane cap", () => {
    render(<SchedulePage />);
    expect(screen.getByTestId("schedule-range").textContent).toBe("9 Nov – 15 Nov");
    const table = screen.getByRole("table", { name: "Jobs by day" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(table).getAllByRole("row")).toHaveLength(5); // header + 4 jobs
    expect(within(table).getByRole("button", { name: "#2337 Job 2337" }).textContent).toContain("clash");
    expect(within(table).getByRole("button", { name: "#2350 Job 2350" }).textContent).toContain("would clash");
    expect(within(table).getByRole("button", { name: "#2350 Job 2350" }).getAttribute("data-pencilled")).toBe("true");
    expect(screen.getByRole("tab", { name: /Clashes/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Pencilled/ }).textContent).toContain("2");
    expect(q.args).toEqual({ orgId: "org1", startMs: ms("2026-11-09"), endMs: ms("2026-11-16") - 1 });
  });

  it("a job whose check could not run says not checked, never nothing", () => {
    render(<SchedulePage />);
    expect(within(screen.getByRole("table")).getByRole("button", { name: "#2360 Job 2360" }).textContent).toContain("not checked");
  });

  it("Month is the real calendar month: 30 day columns in November, and the query covers it", () => {
    nav.search = "zoom=month";
    render(<SchedulePage />);
    expect(screen.getByTestId("schedule-range").textContent).toBe("November 2026");
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(30);
    expect(q.args).toEqual({ orgId: "org1", startMs: ms("2026-11-01"), endMs: ms("2026-12-01") - 1 });
  });

  it("a Sunday-start org gets a Sun–Sat week", () => {
    weekStart.value = 0;
    render(<SchedulePage />);
    expect(screen.getByTestId("schedule-range").textContent).toBe("8 Nov – 14 Nov");
  });

  it("‹ › write the URL and keep params the page does not own; Month writes zoom", async () => {
    nav.search = "ref=email";
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(nav.push).toHaveBeenCalledWith("/availability?ref=email&date=2026-11-16", { scroll: false });
    nav.push.mockClear();
    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(nav.push).toHaveBeenCalledWith("/availability?ref=email&zoom=month", { scroll: false });
  });

  it("clicking a bar opens the job sheet through the URL; ?job= renders it with the clash and who it is with", async () => {
    const user = userEvent.setup();
    const first = render(<SchedulePage />);
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "#2337 Job 2337" }));
    expect(nav.push).toHaveBeenCalledWith("/availability?job=2337", { scroll: false });
    first.unmount();

    nav.search = "job=2337";
    render(<SchedulePage />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("holds its gear")).toBeTruthy();
    expect(within(sheet).getByText(/short 2/)).toBeTruthy();
    expect(within(sheet).getByText(/with #2342/)).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Open job" }).getAttribute("href")).toBe("/projects/2337");
    expect(within(sheet).getByRole("link", { name: "Equipment ›" }).getAttribute("href")).toBe("/projects/2337?tab=equipment");
    expect(within(sheet).getByRole("link", { name: "Logistics ›" }).getAttribute("href")).toBe("/projects/2337?tab=logistics");
  });

  it("a pencilled job's sheet says it holds nothing and what it would be short; an unchecked one says so in words", async () => {
    nav.search = "job=2350";
    const first = render(<SchedulePage />);
    let sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("pencilled · holds nothing")).toBeTruthy();
    expect(within(sheet).getByText(/would be short 2/)).toBeTruthy();
    first.unmount();
    nav.search = "job=2360";
    render(<SchedulePage />);
    sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/can't be ruled out/)).toBeTruthy();
    expect(within(sheet).getByText("Not read")).toBeTruthy();
  });

  it("a day header opens the day sheet (?day=) listing that day's jobs", async () => {
    const user = userEvent.setup();
    const first = render(<SchedulePage />);
    await user.click(screen.getByRole("columnheader", { name: /Wed 11, 3 jobs, clash/ }));
    expect(nav.push).toHaveBeenCalledWith("/availability?day=2026-11-11", { scroll: false });
    first.unmount();
    nav.search = "day=2026-11-11";
    render(<SchedulePage />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("3 jobs")).toBeTruthy();
    expect(within(sheet).getByText("Job 2342")).toBeTruthy();
  });

  it("the job row ⋯ and the page ⋯ open with their verbs (Only my jobs, Overbookings ›, Crew planner ›, Export, Copy link)", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "#2337 actions" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Move dates…", "Open job", "Equipment ›", "Logistics ›", "Copy link"]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Schedule options" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual([
      "Only my jobs", "Overbookings ›", "Crew planner ›", "Copy link", "Export this range (CSV)",
    ]);
  });

  it("crew planner is absent, not disabled, without crew read", async () => {
    perms.all = false;
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "Schedule options" }));
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).not.toContain("Crew planner ›");
    expect(screen.queryByRole("button", { name: "+ New job" })).toBeNull();
  });

  it("a filter word opens and writes the URL; the strip narrows what is drawn, not what it counts", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Quoted" }));
    expect(nav.push).toHaveBeenCalledWith("/availability?status=QUOTED", { scroll: false });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: /Clashes/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/availability?seg=clashes", { scroll: false });
  });

  it("the Clashes strip draws only held clashes", () => {
    nav.search = "seg=clashes";
    render(<SchedulePage />);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toContain("4");
  });

  it("a global-search deep link ?search= is rewritten once into ?q=", () => {
    nav.search = "search=hilton&date=2026-11-12";
    render(<SchedulePage />);
    expect(nav.replace).toHaveBeenCalledWith("/availability?date=2026-11-12&q=hilton", { scroll: false });
  });

  it("says so when the read was cut, and when a filter leaves nothing", () => {
    q.truncated = true;
    nav.search = "q=zzz";
    render(<SchedulePage />);
    expect(screen.getByTestId("schedule-truncated")).toBeTruthy();
    expect(screen.getByText("No jobs match that")).toBeTruthy();
  });

  it("an empty week says so", () => {
    q.jobs = [];
    render(<SchedulePage />);
    expect(screen.getByText("Nothing booked this week")).toBeTruthy();
  });
});

describe("Schedule on a phone (D82: day mode is the agenda)", () => {
  beforeEach(() => {
    mobile.value = true;
  });

  it("shows day chips for one week and the jobs of ONE day as cards, with no grid and no zoom", async () => {
    render(<SchedulePage />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Month" })).toBeNull();
    const chips = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") !== null && /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(t.textContent ?? ""));
    expect(chips).toHaveLength(7);
    // Today (Wed 11) is selected: #2337, #2342 and the unchecked #2360 are on it.
    const list = screen.getByRole("list", { name: /Jobs on 2026-11-11/ });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("clash")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ New job" })).toBeTruthy();
  });

  it("a day chip chooses the day; a card opens the job sheet", async () => {
    const user = userEvent.setup();
    render(<SchedulePage />);
    await user.click(screen.getByRole("tab", { name: /Fri 13/ }));
    expect(nav.push).toHaveBeenCalledWith("/availability?day=2026-11-13", { scroll: false });
    await user.click(within(screen.getByRole("list")).getAllByRole("button", { name: /Job 2337/ })[0]);
    expect(nav.push).toHaveBeenLastCalledWith("/availability?job=2337", { scroll: false });
  });
});

describe("Schedule, Gear view (D81)", () => {
  beforeEach(() => {
    nav.search = "view=gear";
  });

  it("head words Jobs / Gear, the Gear strip, models grouped by category, one grid read and NO jobs read", () => {
    render(<SchedulePage />);
    expect(screen.getByRole("link", { name: "Gear" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe("/availability");
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Short/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /At risk/ }).textContent).toContain("1");
    const table = screen.getByRole("table", { name: "Free gear by day" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(table).getByRole("rowgroup", { name: "Audio" })).toBeTruthy();
    expect(within(table).getByRole("rowgroup", { name: "Uncategorised" })).toBeTruthy();
    expect(within(table).getByText("12 owned · 1 in service")).toBeTruthy();
    expect(q.gearArgs).toEqual({ orgId: "org1", startMs: ms("2026-11-09"), endMs: ms("2026-11-16") - 1 });
    expect(q.jobsCalled).toBe(0);
  });

  it("a shortfall is a red flag-word with held under it, a pencilled risk is amber, a not-checked cell has no number", () => {
    render(<SchedulePage />);
    const short = screen.getByRole("button", { name: "EM4 receiver, 2026-11-11: short 2, held 14" });
    expect(short.textContent).toContain("short 2");
    expect(short.textContent).toContain("held 14");
    expect(screen.getByRole("button", { name: "EM4 receiver, 2026-11-13: 1, pencilled −2" }).textContent).toContain("pencilled −2");
    const unknown = screen.getByRole("button", { name: "Beltpack, 2026-11-11: —, not checked" });
    expect(unknown.textContent).not.toMatch(/[0-9]/);
    expect(within(screen.getByRole("table")).getAllByText("1 short")).toHaveLength(1);
  });

  it("Month shrinks a cell to the number, -2 for a shortfall", () => {
    nav.search = "view=gear&zoom=month&date=2026-11-01";
    q.rows = gearRows.slice(0, 1).map((r) => ({ ...r, cells: Array.from({ length: 30 }, (_, i) => (i === 10 ? cell({ free: -2, short: 2, held: 14 }) : cell({ free: 12 }))) }));
    q.dayStarts = Array.from({ length: 30 }, (_, i) => ms("2026-11-01") + i * 86_400_000);
    render(<SchedulePage />);
    expect(within(screen.getByRole("table")).getAllByText("−2")).toHaveLength(1);
  });

  it("a cell click opens the model-day sheet through the URL; ?cell= renders the numbers, Held by, and the verbs", async () => {
    const user = userEvent.setup();
    const first = render(<SchedulePage />);
    await user.click(screen.getByRole("button", { name: "EM4 receiver, 2026-11-11: short 2, held 14" }));
    expect(nav.push).toHaveBeenCalledWith("/availability?view=gear&cell=m1%3A2026-11-11", { scroll: false });
    first.unmount();

    nav.search = "view=gear&cell=m1:2026-11-11";
    render(<SchedulePage />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Serviceable").nextSibling?.textContent).toBe("11");
    expect(within(sheet).getByText("Held").nextSibling?.textContent).toBe("14");
    expect(within(sheet).getByText("Free").nextSibling?.textContent).toBe("-2");
    const heldBy = within(sheet).getByRole("region", { name: "Held by" });
    expect(within(heldBy).getAllByRole("button").map((b) => b.textContent)).toEqual(["#2337Job 2337× 10", "#2342Job 2342× 4"]);
    expect(within(sheet).getByRole("link", { name: "Overbookings ›" }).getAttribute("href")).toBe("/overbookings");
    expect(within(sheet).getByRole("link", { name: "Open model ›" }).getAttribute("href")).toBe("/assets/models/m1");
    await userEvent.setup().click(within(heldBy).getAllByRole("button")[0]);
    expect(nav.push).toHaveBeenLastCalledWith("/availability?view=gear&job=2337", { scroll: false });
  });

  it("a pencilled-risk cell says what it would take if confirmed; Sub-hire opens the existing dialog for a hard shortfall", async () => {
    nav.search = "view=gear&cell=m1:2026-11-13";
    const first = render(<SchedulePage />);
    expect((await screen.findByRole("dialog")).textContent).toContain("would be short 2 if #2350 confirms");
    expect(within(screen.getByRole("region", { name: "Pencilled, holds nothing" })).getByText("#2350")).toBeTruthy();
    first.unmount();

    nav.search = "view=gear&cell=m1:2026-11-11";
    render(<SchedulePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sub-hire 2…" }));
    const dialogs = await screen.findAllByRole("dialog");
    const dialog = dialogs.find((d) => d.textContent?.includes("Sub-hire EM4 receiver?"))!;
    expect(dialog).toBeTruthy();
    // only the job the board leaves short, with its own shortfall: #2337 fits and is NOT listed
    expect(within(dialog).getByText(/#2342 — Job 2342 · short 2/)).toBeTruthy();
    expect(within(dialog).queryByText(/#2337/)).toBeNull();
  });

  it("an unknown cell's sheet says what it lists may be incomplete; a model that was never loaded is labelled neutrally", async () => {
    nav.search = "view=gear&cell=m2:2026-11-11";
    q.rows = [{ ...gearRows[1], name: "Model not loaded" }];
    render(<SchedulePage />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("region", { name: "Held by (may be incomplete)" })).toBeTruthy();
    expect(within(sheet).getByText("Model not loaded")).toBeTruthy();
  });

  it("a cut read with nothing to show says it could not check, never that nothing is booked", () => {
    q.rows = [];
    q.truncated = true;
    render(<SchedulePage />);
    expect(screen.getByText("Couldn't check this range in full")).toBeTruthy();
    expect(screen.queryByText("No gear is booked in this range")).toBeNull();
  });

  it("an uncut empty grid says no gear is booked", () => {
    q.rows = [];
    render(<SchedulePage />);
    expect(screen.getByText("No gear is booked in this range")).toBeTruthy();
  });

  it("a not-checked cell's sheet shows no number, and the verbs a caller cannot use are absent", async () => {
    perms.all = false;
    nav.search = "view=gear&cell=m2:2026-11-11";
    render(<SchedulePage />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/Not checked/)).toBeTruthy();
    expect(within(sheet).queryByText("Serviceable")).toBeNull();
    expect(within(sheet).queryByRole("link", { name: "Open model ›" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /Sub-hire/ })).toBeNull();
  });

  it("the strip narrows rows (Short), Status narrows to models those jobs hold, and a filter that leaves nothing says so", () => {
    nav.search = "view=gear&seg=short";
    const first = render(<SchedulePage />);
    expect(within(screen.getByRole("table")).queryByText("Beltpack")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("EM4 receiver")).toBeTruthy();
    first.unmount();
    nav.search = "view=gear&status=ENQUIRY";
    render(<SchedulePage />);
    expect(screen.getByText("No models match that")).toBeTruthy();
  });

  it("a Jobs-only strip word in a Gear link reads as All, and the Jobs word drops the strip and the sheets", () => {
    nav.search = "view=gear&seg=clashes&cell=m1:2026-11-11&q=em4";
    render(<SchedulePage />);
    // the open sheet hides the page from the a11y tree, so these read with `hidden`
    expect(screen.getByRole("tab", { name: /All/, hidden: true }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Jobs", hidden: true }).getAttribute("href")).toBe("/availability?q=em4");
  });

  it("on a phone: day chips and the models of ONE day as cards, short 2 or N free", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<SchedulePage />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: /Gear on 2026-11-11/ });
    expect(within(list).getByText("short 2")).toBeTruthy();
    expect(within(list).getByText("not checked")).toBeTruthy();
    await user.click(within(list).getByRole("button", { name: /EM4 receiver/ }));
    expect(nav.push).toHaveBeenCalledWith("/availability?view=gear&cell=m1%3A2026-11-11", { scroll: false });
    await user.click(screen.getByRole("tab", { name: /Fri 13/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/availability?view=gear&day=2026-11-13", { scroll: false });
  });

  it("says so when the read was cut", () => {
    q.truncated = true;
    render(<SchedulePage />);
    expect(screen.getByTestId("schedule-truncated").textContent).toContain("not checked");
  });
});
