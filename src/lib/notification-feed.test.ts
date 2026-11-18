import { describe, it, expect } from "vitest";
import { mergeShellFeed, selectVisibleNotifications } from "@/lib/notification-feed";
import type { AppNotification } from "@/server/notifications";

const n = (id: string, ts: string): AppNotification => ({
  id, type: "overdue_return", title: id, description: "d", href: "/x", severity: "warning", timestamp: ts,
});

describe("selectVisibleNotifications", () => {
  it("drops anything dismissed in ANY of the given sets (server ∪ local optimistic)", () => {
    const feed = [n("a", "2026-01-01"), n("b", "2026-01-01"), n("c", "2026-01-01")];
    const out = selectVisibleNotifications(feed, new Set(["a"]), new Set(["c"]));
    expect(out.map((x) => x.id)).toEqual(["b"]);
  });
  it("tolerates a feed that has not loaded", () => {
    expect(selectVisibleNotifications(undefined, new Set())).toEqual([]);
  });
});

describe("mergeShellFeed", () => {
  it("merges both sources newest-first and counts derived + unread mentions", () => {
    const { items, unreadCount } = mergeShellFeed(
      [n("a", "2026-01-02T00:00:00Z")],
      [
        { id: "m1", type: "mentioned", title: "t", href: "/m", createdAt: Date.parse("2026-01-03T00:00:00Z") },
        { id: "m2", type: "mentioned", title: "t", href: "/m", createdAt: Date.parse("2026-01-01T00:00:00Z"), readAt: 5 },
      ],
    );
    expect(items.map((i) => i.uid)).toEqual(["mention:m1", "derived:a", "mention:m2"]);
    expect(unreadCount).toBe(2);
    expect(items[2].unread).toBe(false);
  });
});
