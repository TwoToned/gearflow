// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * The org switcher moved into the sidebar head (D69). Opens the menu for real
 * (CLAUDE.md), switches, lands on Home, and the toast's Undo re-runs the SAME
 * setActive closure with the previous org.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const setActive = vi.fn(async (..._a: unknown[]) => ({}));
let activeId = "org_1";
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1" } } }),
  useActiveOrganization: () => ({ data: { id: activeId, name: activeId === "org_1" ? "Two Toned" : "Hire Co" } }),
  organization: { setActive: (...a: unknown[]) => setActive(...a) },
}));

let orgs: { id: string; name: string; slug: string; role: string }[] = [];
vi.mock("@/server/public-org", () => ({ getMyOrganizations: () => Promise.resolve(orgs) }));

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => toastFn(...a), { error: vi.fn(), success: vi.fn() }) }));

import { OrgSwitcher } from "@/components/layout/org-switcher";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  push.mockClear();
  setActive.mockClear();
  toastFn.mockClear();
  activeId = "org_1";
  orgs = [];
});

const renderIt = (compact?: boolean) => render(<OrgSwitcher compact={compact} />);

describe("OrgSwitcher", () => {
  it("is a plain label with one membership (nothing to switch)", async () => {
    orgs = [{ id: "org_1", name: "Two Toned", slug: "tt", role: "owner" }];
    renderIt();
    await waitFor(() => expect(screen.getByLabelText("Organisation: Two Toned")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Organisation/ })).toBeNull();
  });

  it("the rail shows initials, not the name", async () => {
    renderIt(true);
    expect(screen.getByText("TT")).toBeTruthy();
    expect(screen.queryByText("Two Toned")).toBeNull();
  });

  it("opens, switches, lands on Home and Undo restores the previous org", async () => {
    orgs = [
      { id: "org_1", name: "Two Toned", slug: "tt", role: "owner" },
      { id: "org_2", name: "Hire Co", slug: "hc", role: "viewer" },
    ];
    renderIt();
    const trigger = await screen.findByRole("button", { name: "Organisation: Two Toned" });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Hire Co/ }));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: "org_2" }));
    expect(push).toHaveBeenCalledWith("/dashboard");

    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    const [title, opts] = toastFn.mock.calls[0] as [string, { action: { label: string; onClick: () => Promise<void> } }];
    expect(title).toBe("Switched to Hire Co");
    expect(opts.action.label).toBe("Undo");
    await act(async () => {
      await opts.action.onClick();
      await opts.action.onClick(); // a second tap is a no-op
    });
    expect(setActive).toHaveBeenCalledTimes(2);
    expect(setActive).toHaveBeenLastCalledWith({ organizationId: "org_1" });
  });
});
