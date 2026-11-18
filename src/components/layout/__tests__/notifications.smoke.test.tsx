// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

/**
 * The bell (D70): one merged feed (derived scan minus dismissals + stored mentions),
 * a mono count, dated rows, Open = mark read, `Mark all read` + Undo. OPENED for real,
 * on desktop (dropdown) and on a phone (bottom sheet).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org_1" } }) }));

const NOW = Date.now();
let derived: unknown[] = [];
vi.mock("@/hooks/use-notifications-feed", () => ({ useNotificationsFeed: () => ({ data: derived, isLoading: false, refresh: vi.fn() }) }));

const dismissMany = vi.fn(async (_k: string[]) => {});
const undismissMany = vi.fn(async (_k: string[]) => {});
let dismissed: string[] = [];
vi.mock("@/hooks/use-notification-dismissals", () => ({
  useNotificationDismissals: () => ({ dismissedKeys: dismissed, dismissMany, undismissMany }),
}));

const markRead = vi.fn(async (_id: string) => {});
const markAllRead = vi.fn(async () => {});
const markUnreadMany = vi.fn(async (_ids: string[]) => {});
let mentions: unknown[] = [];
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({ notifications: mentions, markRead, markAllRead, markUnreadMany }),
}));

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => toastFn(...a), { error: vi.fn() }) }));

let phone = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone }));

import { Notifications } from "@/components/layout/notifications";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  for (const f of [push, dismissMany, undismissMany, markRead, markAllRead, markUnreadMany, toastFn]) f.mockClear();
  phone = false;
  dismissed = [];
  derived = [
    { id: "ret-1", type: "overdue_return", title: "Return overdue", description: "Hilton gala", href: "/projects/p1", severity: "error", timestamp: new Date(NOW - 3_600_000).toISOString() },
    { id: "k-gone", type: "overdue_maintenance", title: "Dismissed already", description: "x", href: "/maintenance", severity: "warning", timestamp: new Date(NOW).toISOString() },
  ];
  dismissed = ["k-gone"];
  mentions = [
    { id: "m1", type: "mentioned", title: "Sam mentioned you", body: "on #2341", href: "/projects/p2", createdAt: NOW - 60_000 },
    { id: "m2", type: "mentioned", title: "Old mention", href: "/projects/p3", createdAt: NOW - 86_400_000, readAt: NOW - 1000 },
  ];
});

async function openBell() {
  const bell = screen.getByRole("button", { name: /Notifications/ });
  await act(async () => {
    fireEvent.pointerDown(bell, { button: 0, ctrlKey: false });
    if (phone) fireEvent.click(bell);
  });
  return bell;
}

describe("Bell", () => {
  it("counts the merged feed: visible derived rows + unread mentions (dismissed and read excluded)", () => {
    render(<Notifications />);
    const bell = screen.getByRole("button", { name: /Notifications/ });
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 2 unread");
    expect(bell.textContent).toBe("2");
  });

  it("lists both sources newest first, dated, with the type word and no dismissed row", async () => {
    render(<Notifications />);
    await openBell();
    const menu = within(await screen.findByRole("menu"));
    const titles = menu.getAllByRole("menuitem").map((i) => i.textContent ?? "");
    expect(titles[0]).toContain("Sam mentioned you");
    expect(titles[0]).toContain("Mention");
    expect(titles[1]).toContain("Return overdue");
    expect(titles[1]).toContain("Overdue return");
    expect(menu.queryByText("Dismissed already")).toBeNull();
    expect(menu.getByText("All notifications ›")).toBeTruthy();
  });

  it("Open marks a mention read and navigates; Open on a derived row only navigates", async () => {
    render(<Notifications />);
    await openBell();
    fireEvent.click(await screen.findByText("Sam mentioned you"));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("m1"));
    expect(push).toHaveBeenCalledWith("/projects/p2");

    await openBell();
    fireEvent.click(await screen.findByText("Return overdue"));
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith("/projects/p1");
  });

  it("Mark all read writes both sources, toasts, and Undo reverses exactly those ids", async () => {
    render(<Notifications />);
    await openBell();
    fireEvent.click(await screen.findByText("Mark all read"));
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(dismissMany).toHaveBeenCalledWith(["ret-1"]);

    const [title, opts] = toastFn.mock.calls[0] as [string, { action: { label: string; onClick: () => Promise<void> } }];
    expect(title).toBe("Marked 2 read");
    await act(async () => {
      await opts.action.onClick();
      await opts.action.onClick(); // second tap is a no-op
    });
    expect(markUnreadMany).toHaveBeenCalledTimes(1);
    expect(markUnreadMany).toHaveBeenCalledWith(["m1"]); // m2 was read before; never resurrected
    expect(undismissMany).toHaveBeenCalledWith(["ret-1"]);
  });

  it("all clear: no Mark all read, an empty state, count 0", async () => {
    derived = [];
    mentions = [];
    render(<Notifications />);
    const bell = await openBell();
    expect(await screen.findByText(/All clear/)).toBeTruthy();
    expect(screen.queryByText("Mark all read")).toBeNull();
    expect(bell.textContent).toBe("0");
  });

  it("on a phone it is a bottom sheet with 48 px rows", async () => {
    phone = true;
    render(<Notifications />);
    await openBell();
    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getAllByRole("button").filter((b) => b.className.includes("min-h-12"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(within(dialog).getByText("Sam mentioned you"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p2"));
  });
});
