// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * The user menu is personal (D69): account, crew profile, admin, Theme words,
 * Keyboard shortcuts, Sign out LAST. The org list moved to the sidebar head
 * (see org-switcher.test.tsx). Opened for real (CLAUDE.md).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const signOutMock = vi.fn(async (..._args: unknown[]) => ({}));
let sessionData: { user: { id: string; name: string; email: string; role?: string } } | null;
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: sessionData }),
  useActiveOrganization: () => ({ data: { id: "org_1", name: "Org One" } }),
  signOut: (...a: unknown[]) => signOutMock(...a),
}));
vi.mock("@/hooks/use-profile", () => ({ useProfile: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: crewId }) }));
let crewId: string | null = null;
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => null) }),
  useConvexAuth: () => ({ isAuthenticated: true }),
}));
const setTheme = vi.fn();
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme }) }));
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: "expanded", isMobile: false }) }));

import { UserNav } from "@/components/layout/user-nav";
import { ShortcutsDialog } from "@/components/layout/shortcuts-dialog";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  push.mockClear();
  signOutMock.mockClear();
  setTheme.mockClear();
  crewId = null;
  sessionData = { user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" } };
});

async function openMenu() {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return within(await waitFor(() => screen.getByRole("menu")));
}

describe("UserNav", () => {
  it("shows the active org on the trigger's second line, not the email", () => {
    render(<UserNav />);
    expect(screen.getByText("Org One")).toBeTruthy();
    expect(screen.queryByText("ada@example.com")).toBeNull();
  });

  it("no longer carries the org list", async () => {
    render(<UserNav />);
    const menu = await openMenu();
    expect(menu.queryByText("Organisations")).toBeNull();
  });

  it("is ordered account → crew profile → admin → Theme → shortcuts → Sign out last", async () => {
    crewId = "crew_9";
    sessionData = { user: { id: "u", name: "Ada", email: "a@x.com", role: "admin" } };
    render(<UserNav />);
    const menu = await openMenu();
    const items = menu.getAllByRole("menuitem").map((i) => i.textContent?.trim());
    expect(items).toEqual(["Account settings", "My crew profile", "Admin panel", "Keyboard shortcuts", "Sign out"]);
    expect(menu.getByRole("button", { name: "Light" })).toBeTruthy();
    expect(menu.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Theme words switch the theme", async () => {
    render(<UserNav />);
    const menu = await openMenu();
    fireEvent.click(menu.getByRole("button", { name: "Light" }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("Keyboard shortcuts opens the overlay", async () => {
    render(
      <>
        <UserNav />
        <ShortcutsDialog />
      </>,
    );
    const menu = await openMenu();
    fireEvent.click(menu.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(await screen.findByText("Collapse or expand the sidebar (desktop)")).toBeTruthy();
  });

  it("Sign out signs out and goes to /login", async () => {
    render(<UserNav />);
    const menu = await openMenu();
    fireEvent.click(menu.getByRole("menuitem", { name: /Sign out/ }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
