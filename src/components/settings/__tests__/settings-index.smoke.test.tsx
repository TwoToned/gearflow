// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SettingsIndex } from "@/components/settings/settings-index";
import type { SettingsCaps } from "@/lib/settings-registry";

const state = vi.hoisted(() => ({
  q: "",
  replace: vi.fn(),
  caps: {} as SettingsCaps,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(state.q ? `q=${state.q}` : ""),
}));
vi.mock("@/hooks/use-settings-caps", () => ({ useSettingsCaps: () => state.caps }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org_1" } }) }));
vi.mock("@/hooks/use-org-members", () => ({ useOrgMembers: () => ({ data: [{}, {}, {}] }) }));
vi.mock("@/hooks/use-pending-invitations", () => ({ usePendingInvitations: () => ({ data: [{}] }) }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroIntegration: () => ({ isConnected: true }) }));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: { hasApiKey: true, writeAccessEnabled: false } }),
}));
vi.mock("@/server/mira-settings", () => ({ getMiraSettings: vi.fn() }));

const ADMIN: SettingsCaps = {
  orgSettingsRead: true,
  orgMembersRead: true,
  checkItemRead: true,
  projectManageLineItems: true,
  xeroManage: true,
};

afterEach(() => {
  cleanup();
  state.q = "";
  state.replace.mockClear();
});

describe("SettingsIndex", () => {
  it("lists every group, each row a link, with derived status words", () => {
    state.caps = ADMIN;
    render(<SettingsIndex />);
    for (const g of ["Organisation", "People & access", "Operations", "Money", "Integrations", "Developer", "Danger zone"]) {
      expect(screen.getByRole("heading", { name: g })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /^General/ }).getAttribute("href")).toBe("/settings/general");
    expect(screen.getByRole("link", { name: /^Billing/ }).getAttribute("href")).toBe("/settings/billing");
    expect(screen.getByText("3 members · 1 invited")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("On · read-only")).toBeTruthy();
    expect(screen.queryByText(/not shown for your role/i)).toBeNull();
  });

  it("search writes ?q= to the URL, and a query filters by the parts inside pages", () => {
    state.caps = ADMIN;
    const { rerender } = render(<SettingsIndex />);
    fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: "tax" } });
    expect(state.replace).toHaveBeenCalledWith("/settings?q=tax", { scroll: false });

    state.q = "tax";
    rerender(<SettingsIndex />);
    expect(screen.getByRole("link", { name: /^Billing/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Xero/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Team/ })).toBeNull();
  });

  it("a role that can't open a row never sees it, and one muted line names what is missing", () => {
    state.caps = { ...ADMIN, orgSettingsRead: false, xeroManage: false, checkItemRead: false, projectManageLineItems: false };
    render(<SettingsIndex />);
    expect(screen.getByRole("link", { name: /^Team/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^General/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Xero/ })).toBeNull();
    expect(screen.getByText(/not shown for your role:/i).textContent).toContain("General");
  });

  it("says so when nothing matches", () => {
    state.caps = ADMIN;
    state.q = "zzzz";
    render(<SettingsIndex />);
    expect(screen.getByText(/nothing in settings matches/i)).toBeTruthy();
  });
});
