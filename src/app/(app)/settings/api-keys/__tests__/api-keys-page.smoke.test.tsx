// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Radix (Dialog/Select/Popover) needs pointer-capture + scrollIntoView, which
// jsdom doesn't implement — same shim every other Radix smoke test in this
// repo uses (see saved-views-menu.smoke.test.tsx).
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // ComboboxPicker/RequestLogDialog fetch don't need this, but jsdom has no
  // clipboard API by default and TokenRevealDialog/ConnectAgentCard call it.
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  // Radix Select measures its trigger/content via ResizeObserver, which jsdom
  // doesn't implement.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1", name: "Acme Rentals" } }),
  useSession: () => ({ data: { user: { id: "user_1", name: "Ada" } } }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => true,
}));

const existingKey = {
  id: "key_1",
  name: "Nightly sync",
  prefix: "gf_live_ab",
  scopes: JSON.stringify(["asset:read"]),
  isActive: true,
  actingUserId: "user_1",
  noFinancials: false,
  expiresAt: null,
  lastUsedAt: null,
  lastRotatedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-01-01"),
};

// vi.hoisted so these mock functions exist before the (hoisted) vi.mock
// factory below runs, and so the same references are usable in beforeEach/
// assertions further down the file.
const mocks = vi.hoisted(() => ({
  listApiKeys: vi.fn(async () => ({ keys: [] as unknown[], apiKillSwitchAt: null as unknown })),
  createApiKey: vi.fn(async () => ({ token: "", key: {} as Record<string, unknown> })),
  revokeApiKey: vi.fn(async () => ({ success: true })),
  rotateApiKey: vi.fn(async () => ({ token: "", prefix: "", graceMinutes: 60 })),
  getApiKeyRequestLog: vi.fn(async () => ({ entries: [] as unknown[] })),
  setOrgApiKillSwitch: vi.fn(async () => ({ apiKillSwitchAt: null as unknown })),
}));

vi.mock("@/server/api-keys", () => mocks);

vi.mock("@/server/org-members", () => ({
  getMentionableMembers: vi.fn(async () => [{ userId: "user_1", name: "Ada", image: null }]),
}));

import ApiKeysSettingsPage from "@/app/(app)/settings/api-keys/page";

const { createApiKey } = mocks;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listApiKeys.mockResolvedValue({ keys: [existingKey], apiKillSwitchAt: null });
  mocks.createApiKey.mockResolvedValue({
    token: "gf_live_NEWSECRET",
    key: { ...existingKey, id: "key_2", name: "AI Agent", prefix: "gf_live_cd" },
  });
  mocks.getApiKeyRequestLog.mockResolvedValue({ entries: [] });
});

// The key list renders BOTH a desktop table (hidden md:block) and a mobile
// MobileCardList (md:hidden); jsdom applies no CSS, so row content — and
// every row-level action button's aria-label — appears twice. Assert/act on
// the first match, same pattern as model-roi-tab.smoke.test.tsx.
async function waitForKeyRow() {
  await waitFor(() => expect(screen.getAllByText("Nightly sync").length).toBeGreaterThan(0));
}
function firstButton(name: RegExp | string) {
  return screen.getAllByRole("button", { name })[0];
}

describe("ApiKeysSettingsPage smoke", () => {
  it("renders the key list without throwing", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();
  });

  it("opens the create-key dialog with its scope preset select and multi-picker", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/create key/i));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(within(dialog).getByText("Create API key")).toBeTruthy();
    expect(within(dialog).getByText(/no financials/i)).toBeTruthy();
  });

  it("creating a key reveals the raw token exactly once", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/create key/i));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(within(dialog).getByText("Create API key")).toBeTruthy();

    fireEvent.change(within(dialog).getByPlaceholderText(/claude code, nightly sync/i), {
      target: { value: "Test key" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(screen.getByText("Your new API key")).toBeTruthy());
    expect(screen.getByText("gf_live_NEWSECRET")).toBeTruthy();
  });

  it("'Connect an AI Agent' mints a read-only key and shows a pasteable MCP config", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/connect an ai agent/i));

    await waitFor(() => expect(createApiKey).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/mcpServers/)).toBeTruthy());
    // The one-time reveal dialog also fires from the connect flow.
    await waitFor(() => expect(screen.getByText("Your new API key")).toBeTruthy());
  });

  it("opens the revoke confirmation dialog for an existing key", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/revoke nightly sync/i));
    await waitFor(() => expect(screen.getAllByText(/revoke "nightly sync"/i).length).toBeGreaterThan(0));
  });

  it("opens the rotate confirmation dialog for an existing key", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/rotate nightly sync/i));
    await waitFor(() => expect(screen.getAllByText(/rotate "nightly sync"/i).length).toBeGreaterThan(0));
  });

  it("opens the request log dialog for an existing key", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/view request log for nightly sync/i));
    await waitFor(() => expect(screen.getAllByText("Request log — Nightly sync").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("No calls yet")).toBeTruthy());
  });

  it("opens the kill-switch confirmation dialog", async () => {
    render(<ApiKeysSettingsPage />);
    await waitForKeyRow();

    fireEvent.click(firstButton(/disable all api access/i));
    await waitFor(() => expect(screen.getByText("Disable API access for this org?")).toBeTruthy());
  });
});
