// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1", name: "Acme Rentals" } }),
}));

const perms = vi.hoisted(() => ({ canUpdate: true }));
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => perms.canUpdate,
}));

const mocks = vi.hoisted(() => ({
  listApiKeys: vi.fn(async () => ({ keys: [] as unknown[], apiKillSwitchAt: null as unknown })),
  setOrgApiKillSwitch: vi.fn(async () => ({ apiKillSwitchAt: new Date() as unknown })),
}));
vi.mock("@/server/api-keys", () => mocks);

import DangerZoneSettingsPage from "@/app/(app)/settings/danger-zone/page";

beforeEach(() => {
  vi.clearAllMocks();
  perms.canUpdate = true;
  mocks.listApiKeys.mockResolvedValue({ keys: [], apiKillSwitchAt: null });
});

describe("Danger zone smoke (D61)", () => {
  it("holds the kill switch and opens its confirmation dialog", async () => {
    render(<DangerZoneSettingsPage />);
    const btn = await waitFor(() => screen.getByRole("button", { name: /disable all api access/i }));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("Disable API access for this org?")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /disable all api access/i }).at(-1)!);
    await waitFor(() => expect(mocks.setOrgApiKillSwitch).toHaveBeenCalledWith(true));
  });

  it("offers re-enable when the switch is already on", async () => {
    mocks.listApiKeys.mockResolvedValue({ keys: [], apiKillSwitchAt: new Date("2026-01-02") });
    render(<DangerZoneSettingsPage />);
    const btn = await waitFor(() => screen.getByRole("button", { name: /re-enable api access/i }));
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.setOrgApiKillSwitch).toHaveBeenCalledWith(false));
  });

  it("shows no switch to a role that cannot update settings", async () => {
    perms.canUpdate = false;
    render(<DangerZoneSettingsPage />);
    expect(screen.queryByRole("button", { name: /api access/i })).toBeNull();
    expect(screen.getByText(/only people who can change organisation settings/i)).toBeTruthy();
  });
});
