// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * The org switcher (design doc §4.3.1, A2) — added to the always-mounted
 * sidebar-footer menu. Covers the two things a closed-trigger render can't
 * prove (CLAUDE.md, "Test menus by actually OPENING them"): the Organisations
 * group only shows with >=2 memberships, and picking one calls
 * organization.setActive() then navigates to a tenant-neutral root (never
 * stays on the current page — see convex-provider.tsx for why: it's the
 * re-authentication trigger, not just navigation UX).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const setActive = vi.fn(async (..._args: unknown[]) => ({}));
const signOutMock = vi.fn(async (..._args: unknown[]) => ({}));
let sessionData: { user: { id: string; name: string; email: string } } | null = {
  user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
};
let activeOrgData: { id: string; name: string } | undefined = {
  id: "org_1",
  name: "Org One",
};
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: sessionData }),
  useActiveOrganization: () => ({ data: activeOrgData }),
  organization: { setActive: (...a: unknown[]) => setActive(...a) },
  signOut: (...a: unknown[]) => signOutMock(...a),
}));

let myOrgsResult: { id: string; name: string; slug: string; role: string }[] = [];
vi.mock("@/server/public-org", () => ({
  getMyOrganizations: () => Promise.resolve(myOrgsResult),
}));

vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({ data: undefined }),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => null) }),
  useConvexAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ state: "expanded", isMobile: false }),
}));

import { UserNav } from "@/components/layout/user-nav";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  push.mockClear();
  setActive.mockClear();
  signOutMock.mockClear();
  sessionData = { user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" } };
  activeOrgData = { id: "org_1", name: "Org One" };
  myOrgsResult = [];
});

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("UserNav", () => {
  it("shows the active org name on the trigger's second line, not the email", () => {
    render(<UserNav />);
    expect(screen.getByText("Org One")).toBeTruthy();
    expect(screen.queryByText("ada@example.com")).toBeNull();
  });

  it("hides the Organisations group entirely with a single membership", async () => {
    myOrgsResult = [{ id: "org_1", name: "Org One", slug: "org-one", role: "OWNER" }];
    render(<UserNav />);
    openMenu();
    // The menu still opens (proves it isn't crashing), just without a switcher.
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    expect(screen.queryByText("Organisations")).toBeNull();
  });

  it("shows one item per membership, checked against the active org, once there are >=2", async () => {
    myOrgsResult = [
      { id: "org_1", name: "Org One", slug: "org-one", role: "OWNER" },
      { id: "org_2", name: "Org Two", slug: "org-two", role: "MEMBER" },
    ];
    render(<UserNav />);
    openMenu();
    const menu = within(await waitFor(() => screen.getByRole("menu")));
    expect(menu.getByText("Organisations")).toBeTruthy();
    expect(menu.getByText("Org One")).toBeTruthy();
    expect(menu.getByText("Org Two")).toBeTruthy();
    expect(menu.getByText("MEMBER")).toBeTruthy();
  });

  it("switching org calls setActive then navigates to /dashboard — never stays put", async () => {
    myOrgsResult = [
      { id: "org_1", name: "Org One", slug: "org-one", role: "OWNER" },
      { id: "org_2", name: "Org Two", slug: "org-two", role: "MEMBER" },
    ];
    render(<UserNav />);
    openMenu();
    const target = await waitFor(() => screen.getByText("Org Two"));
    fireEvent.click(target);

    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: "org_2" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("clicking the already-active org is a no-op — no redundant setActive/navigate", async () => {
    myOrgsResult = [
      { id: "org_1", name: "Org One", slug: "org-one", role: "OWNER" },
      { id: "org_2", name: "Org Two", slug: "org-two", role: "MEMBER" },
    ];
    render(<UserNav />);
    openMenu();
    const menu = within(await waitFor(() => screen.getByRole("menu")));
    const current = menu.getByText("Org One");
    fireEvent.click(current);

    expect(setActive).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
