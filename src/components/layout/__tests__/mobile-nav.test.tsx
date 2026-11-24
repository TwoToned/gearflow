// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { rolePermissions } from "@/lib/permissions";

/**
 * The phone bottom bar (D1/D65): Home · Jobs · Scan · Warehouse · More.
 *
 * Keeps the single-flight regression (tapping a tab, then a DIFFERENT tab before
 * the first navigation lands, must not fire two router.push calls —
 * vercel/next.js#83386), and OPENS the More sheet and the Scan camera/lookup for
 * real (CLAUDE.md: test overlays by opening them).
 */

const push = vi.fn();
let currentPathname = "/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPathname,
}));

let perms: Record<string, string[]> | null = null;
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: perms, isLoading: perms === null }),
  useCanDo: (resource: string, action: string) => (perms ? !!perms[resource]?.includes(action) : true),
}));

const signOut = vi.fn(async () => ({}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" } } }),
  useActiveOrganization: () => ({ data: { id: "org_1", name: "Two Toned" } }),
  signOut: () => signOut(),
  organization: { setActive: vi.fn() },
}));
vi.mock("@/hooks/use-profile", () => ({ useProfile: () => ({ data: undefined }) }));
const switchTo = vi.fn();
let orgList: { id: string; name: string; slug: string; role: string }[] = [];
vi.mock("@/hooks/use-org-switch", () => ({
  orgInitials: () => "TT",
  useOrgSwitch: () => ({ orgs: orgList, activeOrgId: "org_1", activeOrgName: "Two Toned", switchingId: null, switchTo }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));

const query = vi.fn();
vi.mock("convex/react", () => ({ useConvex: () => ({ query }) }));

// More-sheet counts (UX Phase 11, S4): navCounts.get per row, and the two reused counts queries.
const NAV_COUNTS: Record<string, { value: number; secondary?: number; truncated: boolean } | null> = {
  assets: { value: 605, truncated: false },
  testTagOverdue: { value: 4, truncated: false },
  maintenance: { value: 20, secondary: 5, truncated: false },
  returnsOverdue: { value: 2, truncated: false },
  clients: { value: 26, truncated: false },
  suppliers: { value: 13, truncated: false },
  locations: { value: 200, truncated: true },
};
const countReads: string[] = [];
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (_q: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const source = (args as { source: string }).source;
    countReads.push(source);
    return NAV_COUNTS[source] ?? null;
  },
}));
const reusedReads: string[] = [];
vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeOrgFinanceCounts: (orgId?: string) => {
    if (!orgId) return undefined;
    reusedReads.push("finance");
    return { overdueCount: 1, overdueTruncated: false };
  },
  useNativeOverbookingCounts: (orgId?: string) => {
    if (!orgId) return undefined;
    reusedReads.push("overbookings");
    return { hardCount: 5, pencilledCount: 0, saleStockCount: 0 };
  },
}));

// The camera engine has its own jsdom suite; here it is a stub that proves WHEN it mounts.
let cameraMounts = 0;
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({
  CameraScannerDialog: ({ onScan }: { onScan: (v: string) => void }) => {
    React.useEffect(() => {
      cameraMounts += 1;
    }, []);
    return <button onClick={() => onScan("AURA-01")}>camera-decode</button>;
  },
}));

import { MobileNav } from "@/components/layout/mobile-nav";
import { ScanTargetProvider, useScanTarget } from "@/components/scanner/scan-target";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  push.mockClear();
  signOut.mockClear();
  switchTo.mockClear();
  query.mockReset();
  cameraMounts = 0;
  currentPathname = "/dashboard";
  perms = null;
  orgList = [];
});

const renderNav = (extra?: React.ReactNode) =>
  render(
    <ScanTargetProvider>
      <MobileNav />
      {extra}
    </ScanTargetProvider>,
  );

describe("MobileNav tabs", () => {
  it("ignores a second tab tap while the first navigation is still in flight", () => {
    const { rerender } = render(
      <ScanTargetProvider>
        <MobileNav />
      </ScanTargetProvider>,
    );
    fireEvent.click(screen.getByText("Jobs"));
    fireEvent.click(screen.getByText("Warehouse"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/projects");

    currentPathname = "/projects";
    rerender(
      <ScanTargetProvider>
        <MobileNav />
      </ScanTargetProvider>,
    );
    fireEvent.click(screen.getByText("Warehouse"));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith("/warehouse");
  });

  it("does not navigate when tapping the already-active tab", () => {
    renderNav();
    fireEvent.click(screen.getByText("Home"));
    expect(push).not.toHaveBeenCalled();
  });

  it("is Home · Jobs · Scan · Warehouse · More, in that order", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const labels = Array.from(nav.querySelectorAll("a, button")).map((e) => e.textContent?.trim() || e.getAttribute("aria-label"));
    expect(labels.slice(0, 5)).toEqual(["Home", "Jobs", "Scan", "Warehouse", "More"]);
  });

  it("lights More on Crew, Assets and Settings routes", () => {
    for (const path of ["/crew", "/assets/registry", "/settings/team"]) {
      currentPathname = path;
      const { unmount } = renderNav();
      expect(screen.getByRole("button", { name: /More/ }).getAttribute("data-active")).toBe("true");
      unmount();
    }
  });

  it("a role without warehouse loses Scan and Warehouse (absent, not greyed)", () => {
    perms = { project: ["read"] };
    renderNav();
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.queryByText("Warehouse")).toBeNull();
    expect(screen.getByText("Jobs")).toBeTruthy();
  });
});

describe("More sheet", () => {
  const open = async () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    return screen.findByRole("dialog");
  };

  it("opens with the user head and the four groups, rows are real links to routes", async () => {
    const dialog = await open();
    for (const g of ["Plan", "Crew and gear", "People", "Account"]) {
      expect(within(dialog).getByRole("region", { name: g })).toBeTruthy();
    }
    expect(within(dialog).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(dialog).getByText("Job templates")).toBeTruthy(); // Jobs' sub-pages stay reachable
    expect(within(dialog).getByText("Returns")).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Clients"));
    expect(push).toHaveBeenCalledWith("/clients");
  });

  it("drills Crew to Open Crew + sub-pages and back", async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByText("Crew"));
    expect(within(dialog).getByText("Open Crew")).toBeTruthy();
    expect(within(dialog).getByText("Planner")).toBeTruthy();
    expect(within(dialog).getByText("Timesheets")).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Crew")); // the back header
    expect(within(dialog).getByText("Plan")).toBeTruthy();
  });

  it("holds Theme and Sign out; Organisation › appears only with 2+ memberships and switches", async () => {
    let dialog = await open();
    expect(within(dialog).getByRole("button", { name: "Light" })).toBeTruthy();
    expect(within(dialog).queryByText("Organisation")).toBeNull();
    fireEvent.click(within(dialog).getByText("Sign out"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/login");
    document.body.innerHTML = "";

    orgList = [
      { id: "org_1", name: "Two Toned", slug: "tt", role: "owner" },
      { id: "org_2", name: "Hire Co", slug: "hc", role: "viewer" },
    ];
    dialog = await open();
    fireEvent.click(within(dialog).getByText("Organisation"));
    fireEvent.click(within(dialog).getByText("Hire Co"));
    expect(switchTo).toHaveBeenCalledWith("org_2");
  });

  it("gates rows: a clients-only role sees no Crew or Finance", async () => {
    perms = { client: ["read"], warehouse: ["read"] };
    const dialog = await open();
    expect(within(dialog).queryByText("Crew")).toBeNull();
    expect(within(dialog).queryByText("Finance")).toBeNull();
    expect(within(dialog).getByText("Clients")).toBeTruthy();
  });

  it("S4: opened, each row carries its count (§6d.6), truncated reads as n+, nothing is read while closed", async () => {
    perms = rolePermissions.admin as unknown as Record<string, string[]>;
    countReads.length = 0;
    reusedReads.length = 0;
    renderNav();
    expect(countReads).toEqual([]);
    expect(reusedReads).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    const dialog = await screen.findByRole("dialog");
    const row = (label: string) => within(dialog).getByText(label).closest("[role='menuitem'], button, a, div")!.parentElement!.textContent;
    expect(row("Finance")).toContain("1 overdue");
    expect(row("Overbookings")).toContain("5 overbooked");
    expect(row("Assets")).toContain("605");
    expect(row("Test & Tag")).toContain("4 overdue");
    expect(row("Maintenance")).toContain("20 open · 5 overdue");
    expect(row("Returns")).toContain("2 overdue");
    expect(row("Clients")).toContain("26");
    expect(row("Locations")).toContain("200+");
    // Crew's row is Phase 15's to attach (Q10): no count source on it yet.
    expect(countReads).not.toContain("crew");
  });

  it("S4: a viewer (no warehouse) has no Returns row and so no Returns count read", async () => {
    perms = { project: ["read"], asset: ["read"], client: ["read"], invoice: ["read"], warehouse: [] };
    countReads.length = 0;
    const dialog = await open();
    expect(within(dialog).queryByText("Returns")).toBeNull();
    expect(countReads).not.toContain("returnsOverdue");
    expect(countReads).toContain("assets");
  });

  it("a count is a data read: a row shown for another action (invoice/asset 'create') reads and prints nothing", async () => {
    perms = { project: ["read"], invoice: ["create"], asset: ["create"], client: ["read"] };
    countReads.length = 0;
    reusedReads.length = 0;
    const dialog = await open();
    // The rows stay (nav visibility is any action, absent-not-greyed)…
    const row = (label: string) => within(dialog).getByText(label).closest("[role='menuitem'], button, a, div")!.parentElement!.textContent;
    expect(row("Finance")).not.toContain("overdue");
    expect(row("Assets")).not.toContain("605");
    // …but their reads never run.
    expect(reusedReads).not.toContain("finance");
    expect(countReads).not.toContain("assets");
    expect(countReads).toContain("clients");
    expect(row("Overbookings")).toContain("5 overbooked");
  });
});

describe("Scan", () => {
  const scanThenDecode = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.click(await screen.findByText("camera-decode"));
  };

  it("mounts the camera only after the tap, and unmounts it when closed", async () => {
    renderNav();
    expect(cameraMounts).toBe(0);
    expect(screen.queryByText("camera-decode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText("camera-decode")).toBeTruthy();
    expect(cameraMounts).toBe(1);
  });

  it("outside a job: found → Open asset ›", async () => {
    query.mockResolvedValue({ url: "/assets/registry/a1", label: "Asset AURA-01" });
    renderNav();
    await scanThenDecode();
    expect(await screen.findByText("Open asset ›")).toBeTruthy();
    expect(query).toHaveBeenCalledWith(expect.anything(), { orgId: "org_1", value: "AURA-01" });
  });

  it("outside a job: a kit shows Open kit ›", async () => {
    query.mockResolvedValue({ url: "/kits/k1", label: "Kit K-1" });
    renderNav();
    await scanThenDecode();
    expect(await screen.findByText("Open kit ›")).toBeTruthy();
  });

  it("outside a job: not found, error and no-permission each say so", async () => {
    query.mockResolvedValueOnce({ url: null, label: null });
    const first = renderNav();
    await scanThenDecode();
    expect((await screen.findByRole("alert")).textContent).toContain('Nothing matches "AURA-01"');
    first.unmount();

    query.mockRejectedValueOnce(new Error("offline"));
    const second = renderNav();
    await scanThenDecode();
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't look that up");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    second.unmount();

    perms = { warehouse: [] , project: ["read"] };
    // No warehouse read at all → the bar hides Scan, so drive the lookup hook's own guard:
    // (the Scan button is absent for such a role; the guard covers a permissions change mid-session)
    renderNav();
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
  });

  it("a page's registered ScanTarget handler receives the value and the lookup is skipped", async () => {
    const handler = vi.fn();
    function Page() {
      useScanTarget(handler);
      return null;
    }
    renderNav(<Page />);
    await scanThenDecode();
    expect(handler).toHaveBeenCalledWith("AURA-01");
    await act(async () => {});
    expect(query).not.toHaveBeenCalled();
    expect(screen.queryByText("Open asset ›")).toBeNull();
  });
});
