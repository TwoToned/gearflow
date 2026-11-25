// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Facts, HealthRows, RecordRows, RecordShell, resolveRecordTab, type RecordTab } from "@/components/people/record-shell";

/**
 * UX Phase 13: the §4.2 record shell, rendered for real. `?tab=` deep links with the job
 * page's fallback rule, the context rail on every tab but Overview, the Edit primary, and the
 * header ⋯ opened (destructive last).
 */
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/clients/k1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));

afterEach(() => {
  cleanup();
  nav.search = "";
  nav.replace.mockClear();
});

const tabs: RecordTab[] = [
  { value: "overview", label: "Overview", panel: <p>OVERVIEW-PANEL</p> },
  { value: "jobs", label: "Jobs", count: 2, panel: <p>JOBS-PANEL</p> },
];
const onEdit = vi.fn();
const del = vi.fn();
const shell = () => (
  <RecordShell
    crumb={{ label: "Clients", href: "/clients" }}
    title="Hilton"
    status={{ label: "Active", intent: "success" }}
    meta={["Venue", "Priya"]}
    onEdit={onEdit}
    menu={{ items: [{ key: "merge", label: "Merge…", group: "organise", onSelect: vi.fn() }, { key: "archive", label: "Archive…", group: "danger", danger: true, onSelect: del, confirm: { title: "Archive?", body: "b", confirmLabel: "Archive" } }] }}
    tabs={tabs}
    rail={<p>RAIL</p>}
  />
);

describe("resolveRecordTab", () => {
  it("falls back to the first tab for an unknown or missing key", () => {
    expect(resolveRecordTab("jobs", tabs)).toBe("jobs");
    expect(resolveRecordTab("nope", tabs)).toBe("overview");
    expect(resolveRecordTab(null, tabs)).toBe("overview");
  });
});

describe("RecordShell", () => {
  it("opens on Overview with no rail (the same facts are in its own columns), and Edit is the primary", () => {
    render(shell());
    expect(screen.getByText("OVERVIEW-PANEL")).toBeTruthy();
    expect(screen.queryByText("RAIL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Clients" }).getAttribute("href")).toBe("/clients");
  });

  it("?tab=jobs deep-links, shows the rail, and an unknown ?tab= falls back to Overview", () => {
    nav.search = "tab=jobs";
    const { unmount } = render(shell());
    expect(screen.getByText("JOBS-PANEL")).toBeTruthy();
    expect(screen.getByText("RAIL")).toBeTruthy();
    unmount();
    nav.search = "tab=ghost";
    render(shell());
    expect(screen.getByText("OVERVIEW-PANEL")).toBeTruthy();
  });

  it("selecting a tab writes ?tab= (Overview clears it)", async () => {
    const user = userEvent.setup();
    render(shell());
    await user.click(screen.getByRole("tab", { name: /Jobs/ }));
    expect(nav.replace).toHaveBeenCalledWith("/clients/k1?tab=jobs", { scroll: false });
  });

  it("OPENS the header ⋯: Merge… then the red Archive… last", async () => {
    const user = userEvent.setup();
    render(shell());
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.replace(/\s+/g, " ").trim())).toEqual([expect.stringContaining("Merge"), expect.stringContaining("Archive")]);
  });
});

describe("calm blocks", () => {
  it("HealthRows: nothing to show is one calm line; an item carries its one muted action", async () => {
    const act = vi.fn();
    const { rerender } = render(<HealthRows items={[]} allClear="Nothing needs a look." />);
    expect(screen.getByText("Nothing needs a look.")).toBeTruthy();
    rerender(<HealthRows items={[{ key: "a", text: "INV-1 overdue", tone: "error", action: { label: "Invoices", onSelect: act } }]} allClear="x" />);
    fireEvent.click(screen.getByRole("button", { name: /Invoices/ }));
    expect(act).toHaveBeenCalled();
  });
  it("Facts omits blank values instead of printing dashes; RecordRows has an empty sentence and a count footer", () => {
    render(<><Facts title="Contact" facts={[{ label: "Email", value: "a@b.co" }, { label: "Phone", value: null }, { label: "Fax", value: "" }]} /><RecordRows noun="job" empty="No jobs yet." rows={[]} /></>);
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.queryByText("Phone")).toBeNull();
    expect(screen.queryByText("Fax")).toBeNull();
    expect(screen.getByText("No jobs yet.")).toBeTruthy();
  });
});
