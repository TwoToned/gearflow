// @vitest-environment jsdom
//
// The ⌘K palette (UX Phase 11, §6d.3), OPENED for real (CLAUDE.md: test overlays
// by opening them): the empty state (Recent, On #…, Actions, all gated), grouped
// results with `Show all n in X ›`, a date, the no-match copy, `@` pages and `/`
// actions kept from live, Recent recording + per-org reset, and the phone sheet.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rolePermissions } from "@/lib/permissions";
import { recentsKey } from "@/lib/palette/recents";
import type { SearchResult } from "@/lib/search-types";

const m = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/dashboard",
  orgId: "org_1",
  isMobile: false,
  permissions: null as Record<string, readonly string[]> | null,
  search: vi.fn(),
  trail: [{ label: "Home" }] as { label: string; href?: string }[],
  queries: [] as { kind: string; args: unknown }[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }), usePathname: () => m.pathname }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: m.orgId, name: "Two Toned" } }),
  useSession: () => ({ data: { user: { id: "u1" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => m.isMobile }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: m.permissions, isLoading: false }) }));
vi.mock("@/hooks/use-global-search", () => ({ useGlobalSearch: () => m.search }));
vi.mock("@/components/layout/breadcrumbs", () => ({ useTrail: () => m.trail }));
vi.mock("@/components/scanner/shell-scan", () => ({
  ShellScan: ({ open }: { open: boolean }) => (open ? <div>camera open</div> : null),
}));

/** Recent resolves only this org's refs (the server's org check, stubbed); the day query returns one job. */
const RECENT_ROWS: Record<string, { type: string; id: string; title: string; subtitle: string | null; href: string; status?: string }> = {
  "org_1:p1": { type: "project", id: "p1", title: "2341 — Hilton gala", subtitle: "CONFIRMED", href: "/projects/p1", status: "CONFIRMED" },
  "org_1:a1": { type: "asset", id: "a1", title: "AURA-01", subtitle: "Aura PXL", href: "/assets/registry/a1" },
};
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (_q: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const a = args as { orgId: string; refs?: { type: string; id: string }[]; dateFrom?: number };
    if (a.refs) {
      m.queries.push({ kind: "recents", args });
      return a.refs.map((r) => RECENT_ROWS[`${a.orgId}:${r.id}`]).filter(Boolean);
    }
    if (a.dateFrom !== undefined) {
      m.queries.push({ kind: "day", args });
      return { items: [{ id: "p9", projectNumber: "2350", name: "Qantas awards", status: "CONFIRMED", client: { name: "Qantas" } }], total: 7 };
    }
    return undefined;
  },
}));

import { CommandSearch } from "@/components/layout/command-search";

const res = (type: SearchResult["type"], id: string, title: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  id, type, title, subtitle: null, href: `/x/${id}`, relevance: 1, ...extra,
});

const AURA = {
  results: [
    res("model", "m1", "Aura PXL", { href: "/assets/models/m1" }),
    ...Array.from({ length: 6 }, (_, i) => res("asset", `x${i}`, `AURA-1${i} — Spare`, { href: `/assets/registry/x${i}` })),
    res("project", "p2", "2341 — Hilton gala", { href: "/projects/p2", status: "CONFIRMED" }),
  ],
  groups: [
    { type: "model", total: 1, truncated: false },
    { type: "asset", total: 7, truncated: false },
    { type: "project", total: 1, truncated: false },
  ],
};

beforeEach(() => {
  m.push.mockClear();
  m.pathname = "/dashboard";
  m.orgId = "org_1";
  m.isMobile = false;
  m.permissions = rolePermissions.admin;
  m.trail = [{ label: "Home" }];
  m.queries = [];
  m.search.mockReset().mockImplementation(async (q: string) => (q.trim().toLowerCase() === "aura" ? AURA : { results: [], groups: [] }));
  window.localStorage.clear();
  window.localStorage.setItem(recentsKey("org_1", "u1"), JSON.stringify([{ type: "asset", id: "a1" }, { type: "project", id: "p1" }]));
});

const openPalette = () => fireEvent.keyDown(document, { key: "k", metaKey: true });
const box = () => screen.getByRole("textbox", { name: "Search or jump to" }) as HTMLInputElement;
const groupNamed = (name: string) => screen.getByRole("group", { name });

describe("⌘K palette (smoke)", () => {
  it("⌘K opens it; empty shows Recent (resolved, this org's) then Actions, gated", async () => {
    render(<CommandSearch />);
    openPalette();
    const recent = await screen.findByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("AURA-01"),
      expect.stringContaining("2341Hilton gala"),
    ]);
    const actions = groupNamed("Actions");
    expect(within(actions).getAllByRole("option").map((o) => o.textContent)).toEqual(["New job", "Scan a tag", "New asset", "New client"]);
  });

  it("a Recent ref the server no longer resolves is pruned from storage", async () => {
    window.localStorage.setItem(
      recentsKey("org_1", "u1"),
      JSON.stringify([{ type: "asset", id: "a1" }, { type: "client", id: "gone" }, { type: "project", id: "p1" }]),
    );
    render(<CommandSearch />);
    openPalette();
    await screen.findByRole("group", { name: "Recent" });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(recentsKey("org_1", "u1"))!)).toEqual([
        { type: "asset", id: "a1" },
        { type: "project", id: "p1" },
      ]),
    );
  });

  it("a viewer gets no New job / New asset / New client and no Scan", async () => {
    m.permissions = rolePermissions.viewer;
    render(<CommandSearch />);
    openPalette();
    await screen.findByRole("group", { name: "Recent" });
    expect(screen.queryByRole("group", { name: "Actions" })).toBeNull();
  });

  it("Enter opens the highlighted row and moves it to the top of Recent", async () => {
    render(<CommandSearch />);
    openPalette();
    await screen.findByRole("group", { name: "Recent" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(m.push).toHaveBeenCalledWith("/projects/p1");
    expect(JSON.parse(window.localStorage.getItem(recentsKey("org_1", "u1"))!)).toEqual([
      { type: "project", id: "p1" },
      { type: "asset", id: "a1" },
    ]);
  });

  it("typing groups the results, four per group, with `Show all 7 in Assets ›`", async () => {
    const user = userEvent.setup();
    render(<CommandSearch />);
    openPalette();
    await user.type(box(), "aura");
    const assets = await screen.findByRole("group", { name: "Assets" }, { timeout: 2000 });
    const rows = within(assets).getAllByRole("option");
    expect(rows).toHaveLength(5);
    expect(rows[4].textContent).toContain("Show all 7 in Assets ›");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Models", "Assets", "Jobs"]);
    await user.click(rows[4]);
    expect(m.push).toHaveBeenCalledWith("/assets/registry?q=aura");
  });

  it("nothing matching says so, with the next step", async () => {
    const user = userEvent.setup();
    render(<CommandSearch />);
    openPalette();
    await user.type(box(), "zzz");
    expect(await screen.findByText("Nothing matches “zzz”", {}, { timeout: 2000 })).toBeDefined();
    expect(screen.getByText(/Try a job number, an asset tag or a client name/)).toBeDefined();
  });

  it("a date lists that day's jobs through the Jobs list query, plus the Schedule", async () => {
    const user = userEvent.setup();
    render(<CommandSearch />);
    openPalette();
    await user.type(box(), "14/11");
    const jobs = await screen.findByRole("group", { name: /^Jobs on 14 Nov · 7$/ });
    expect(within(jobs).getByRole("option").textContent).toContain("Qantas awards");
    const day = m.queries.find((q) => q.kind === "day")!.args as { dateFrom: number; dateTo: number; pageSize: number };
    expect(new Date(day.dateFrom).getDate()).toBe(14);
    expect(day.dateTo - day.dateFrom).toBe(86_400_000 - 1);
    expect(day.pageSize).toBe(4);
    expect(within(groupNamed("Schedule")).getByRole("option").textContent).toContain("Schedule at 14 Nov ›");
    // A date never switches the plain search off: the whole string is searched too.
    await waitFor(() => expect(m.search).toHaveBeenCalledWith("14/11"));
  });

  it("a decimal or a fraction is a search, not a date: `1/4 inch jack` lists its search hits and no day", async () => {
    const user = userEvent.setup();
    m.search.mockImplementation(async (q: string) =>
      q === "1/4 inch jack" ? { results: [res("model", "mj", "1/4 inch jack lead", { href: "/assets/models/mj" })], groups: [{ type: "model", total: 1, truncated: false }] } : { results: [], groups: [] },
    );
    render(<CommandSearch />);
    openPalette();
    await user.type(box(), "1/4 inch jack");
    expect(await screen.findByRole("group", { name: "Models" }, { timeout: 2000 })).toBeDefined();
    expect(screen.queryByRole("group", { name: /^Jobs on/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Schedule" })).toBeNull();
  });

  it("`/` and `@` still work: page actions + Global; pages", async () => {
    const user = userEvent.setup();
    render(<CommandSearch />);
    fireEvent.keyDown(document, { key: "/" });
    expect(box().value).toBe("/");
    expect(await screen.findByRole("group", { name: "Global" })).toBeDefined();
    await user.clear(box());
    await user.type(box(), "@jobs");
    expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("Jobs"))).toBe(true);
  });

  it("on a job page the empty state has an `On #2341 …` group of that page's actions", async () => {
    m.pathname = "/projects/cm1abcdefghijklmnopqrstuv";
    m.trail = [{ label: "Jobs", href: "/projects" }, { label: "#2341 Hilton gala" }];
    render(<CommandSearch />);
    openPalette();
    const onPage = await screen.findByRole("group", { name: "On #2341 Hilton gala" });
    expect(within(onPage).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("an org switch drops the query and results; Recent is the new org's (none here)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommandSearch />);
    openPalette();
    await user.type(box(), "aura");
    await screen.findByRole("group", { name: "Assets" }, { timeout: 2000 });
    m.orgId = "org_2";
    rerender(<CommandSearch />);
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.queryByRole("group", { name: "Assets" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    // org_1's refs were never sent under org_2.
    expect(m.queries.filter((q) => q.kind === "recents" && (q.args as { orgId: string }).orgId === "org_2")).toEqual([]);
  });

  it("phone: a full-screen sheet with Cancel and the `@ Pages · / Actions · Scan a tag` chips; Scan opens the camera", async () => {
    m.isMobile = true;
    const user = userEvent.setup();
    render(<CommandSearch />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Pages/ })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Scan a tag" }));
    expect(screen.getByText("camera open")).toBeDefined();
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
