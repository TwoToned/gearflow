// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import SettingsLayout from "@/app/(app)/settings/layout";
import type { SettingsCaps, SettingsCapsLoad } from "@/lib/settings-registry";

const state = vi.hoisted(() => ({
  path: "/settings/xero",
  caps: {} as SettingsCaps & SettingsCapsLoad,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/hooks/use-settings-caps", () => ({ useSettingsCaps: () => state.caps }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { name: "Acme Rentals" } }) }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));

const OPEN: SettingsCaps & SettingsCapsLoad = {
  orgSettingsRead: true,
  orgMembersRead: true,
  checkItemRead: true,
  projectManageLineItems: true,
  xeroManage: true,
  rolesLoaded: true,
  xeroLoaded: true,
};

afterEach(() => {
  cleanup();
  state.path = "/settings/xero";
});

const child = <p>page body</p>;

describe("SettingsLayout gate", () => {
  it("a deep link to /settings/xero shows no Access denied while the caps query is still loading", () => {
    // The Xero capability is false only because the deployment query hasn't answered.
    state.caps = { ...OPEN, xeroManage: false, xeroLoaded: false };
    render(<SettingsLayout>{child}</SettingsLayout>);
    expect(screen.queryByText(/access denied/i)).toBeNull();
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.getByLabelText("Loading settings")).toBeTruthy();
  });

  it("shows nothing decisive while the role itself is loading", () => {
    state.caps = { ...OPEN, orgSettingsRead: false, orgMembersRead: false, rolesLoaded: false };
    render(<SettingsLayout>{child}</SettingsLayout>);
    expect(screen.queryByText(/access denied/i)).toBeNull();
  });

  it("once loaded, a role without Xero is denied, and one with it sees the page", () => {
    state.caps = { ...OPEN, xeroManage: false };
    const { unmount } = render(<SettingsLayout>{child}</SettingsLayout>);
    expect(screen.getByText(/access denied/i)).toBeTruthy();
    unmount();

    state.caps = OPEN;
    render(<SettingsLayout>{child}</SettingsLayout>);
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("a non-Xero page does not wait on the Xero query", () => {
    state.path = "/settings/billing";
    state.caps = { ...OPEN, xeroLoaded: false };
    render(<SettingsLayout>{child}</SettingsLayout>);
    expect(screen.getByText("page body")).toBeTruthy();
  });
});
