// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PeopleList, peopleSwitchMenu, type PeopleListModel } from "@/components/people/people-list";
import { CREW_SPEC, crewColumns, crewRowOf, crewSegments, type CrewSource } from "@/lib/list-views/people";
import { crewBulkActions, crewMemberActions } from "@/lib/row-actions/people";

/**
 * UX Phase 13: the ONE People renderer, rendered for real with the crew config. Opens the
 * row ⋯ and the bulk bar, and checks the phone's People switcher and the absent-not-
 * disabled rule for a read-only role.
 */
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/crew",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  mobile.value = false;
  nav.push.mockClear();
});

const member = (id: string, over: Partial<CrewSource> = {}): CrewSource => ({
  id, firstName: id, lastName: "Crew", listStatus: "UNCONFIRMED", next: null, daysThisWeek: 0, clashDay: null, email: `${id}@x.co`, ...over,
});

function model(over: { readOnly?: boolean; pay?: boolean } = {}): PeopleListModel {
  const onDeactivate = vi.fn();
  const rows = [member("sam", { defaultDayRate: 450 }), member("kim", { listStatus: "AVAILABLE" })].map((m) =>
    crewRowOf(m, crewMemberActions({ name: m.firstName, listStatus: m.listStatus, hasEmail: true }, { onOpen: vi.fn(), onDeactivate: over.readOnly ? undefined : onDeactivate })),
  );
  return {
    key: "crew",
    spec: CREW_SPEC,
    title: "Crew",
    noun: "crew",
    bulkNoun: "crew member",
    searchPlaceholder: "Search name, role, skill or tag",
    segments: crewSegments({ all: 2, available: 1, onjob: 0, unconfirmed: 1, inactive: 0 }),
    filters: [],
    columns: crewColumns(over.pay ?? true),
    rows,
    total: 2,
    loading: false,
    itemHeader: "Name",
    primary: { label: "New crew member", onSelect: vi.fn() },
    bulk: over.readOnly ? undefined : () => crewBulkActions({ onAddTag: vi.fn(), onDeactivate }),
    empty: { title: "No crew yet" },
  };
}

describe("PeopleList (crew config)", () => {
  it("renders the strip with counts, the rows and the one primary", () => {
    render(<PeopleList model={model()} />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Unconfirmed/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Available this week/ })).toBeTruthy();
    expect(screen.getByText("sam Crew")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New crew member" })).toBeTruthy();
  });

  it("OPENS a row ⋯ and finds Deactivate last", async () => {
    const user = userEvent.setup();
    render(<PeopleList model={model()} />);
    await user.click(screen.getByRole("button", { name: "sam Crew actions" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining(["Open"]));
    expect(items.at(-1)?.textContent).toMatch(/Deactivate/);
  });

  it("ticking a row shows the bulk bar with the count in the verb", () => {
    render(<PeopleList model={model()} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("Deactivate 1")).toBeTruthy();
  });

  it("a read-only role has no bulk bar and no Deactivate verb anywhere", async () => {
    const user = userEvent.setup();
    render(<PeopleList model={model({ readOnly: true })} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.queryByText(/Deactivate/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "sam Crew actions" }));
    expect(within(await screen.findByRole("menu")).queryByText(/Deactivate/)).toBeNull();
  });

  it("no Rate column without pay visibility", () => {
    render(<PeopleList model={model({ pay: false })} />);
    expect(screen.queryByText("Rate /day")).toBeNull();
  });

  it("phone: the title opens the People switcher with the OTHER two lists", () => {
    mobile.value = true;
    render(<PeopleList model={model()} />);
    fireEvent.click(screen.getByRole("button", { name: "Crew" }));
    fireEvent.click(screen.getByText("Clients"));
    expect(nav.push).toHaveBeenCalledWith("/clients");
  });
});

describe("peopleSwitchMenu", () => {
  it("lists the two other lists, never the current one", () => {
    expect(peopleSwitchMenu("clients", vi.fn()).items.map((i) => i.label)).toEqual(["Crew", "Suppliers"]);
  });
});
