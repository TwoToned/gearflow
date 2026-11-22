// @vitest-environment jsdom
//
// useDashboardLayout's Undo contract (UX Phase 11, Q6): each change hands back
// ONE restore, and a restore only applies while the board is still the one its
// change produced. Two stacked hides undone out of order: the older Undo
// refuses ("Layout changed since") instead of reverting the newer hide too.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const m = vi.hoisted(() => ({
  saved: null as unknown,
  save: vi.fn(async (_args: unknown) => ({ ok: true })),
}));

const defaultQuery = (_q: unknown, args: unknown) => (args === "skip" ? undefined : m.saved);
const mockedQuery = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: mockedQuery }));
vi.mock("convex/react", () => ({ useMutation: () => m.save }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));

import { useDashboardLayout, LAYOUT_CHANGED_SINCE, LAYOUT_OTHER_ORG } from "@/hooks/use-dashboard-layout";

const kinds = (ws: { kind: string }[]) => ws.map((w) => w.kind);

beforeEach(() => {
  m.saved = null;
  m.save.mockClear();
  mockedQuery.mockImplementation(defaultQuery);
});

describe("useDashboardLayout › Undo is tied to the layout its change produced", () => {
  it("undoing the newest change first, then the older one, restores both", () => {
    const { result } = renderHook(() => useDashboardLayout("org1"));
    let undoA: (() => void) | null = null;
    let undoB: (() => void) | null = null;
    act(() => { undoA = result.current.removeWidget("myTasks"); });
    act(() => { undoB = result.current.removeWidget("needsAttention"); });
    expect(kinds(result.current.widgets)).not.toContain("needsAttention");
    act(() => undoB!());
    act(() => undoA!());
    expect(kinds(result.current.widgets)).toEqual(expect.arrayContaining(["myTasks", "needsAttention"]));
  });

  it("undoing the older change while a newer one stands refuses and changes nothing", () => {
    const { result } = renderHook(() => useDashboardLayout("org1"));
    let undoA: (() => void) | null = null;
    act(() => { undoA = result.current.removeWidget("myTasks"); });
    act(() => { result.current.removeWidget("needsAttention"); });
    const before = result.current.widgets;
    expect(() => act(() => undoA!())).toThrow(LAYOUT_CHANGED_SINCE);
    expect(result.current.widgets).toBe(before);
    expect(kinds(result.current.widgets)).not.toContain("myTasks");
    expect(kinds(result.current.widgets)).not.toContain("needsAttention");
  });

  it("an org switch re-hydrates from the new org, drops the old org's pending save, and voids its Undo", () => {
    vi.useFakeTimers();
    try {
      const orgA = [{ id: "myTasks", kind: "myTasks", x: 0, y: 0, w: 6, h: 6 }];
      const orgB = [{ id: "needsAttention", kind: "needsAttention", x: 0, y: 0, w: 6, h: 6 }];
      const rows: Record<string, unknown> = { A: { id: "rowA", widgets: orgA, updatedAt: 1 }, B: { id: "rowB", widgets: orgB, updatedAt: 1 } };
      mockedQuery.mockImplementation((_q: unknown, args: unknown) => (args === "skip" ? undefined : rows[(args as { orgId: string }).orgId]));
      const { result, rerender } = renderHook(({ org }) => useDashboardLayout(org), { initialProps: { org: "A" } });
      expect(kinds(result.current.widgets)).toEqual(["myTasks"]);

      let undoA: (() => void) | null = null;
      act(() => { undoA = result.current.removeWidget("myTasks"); });
      rerender({ org: "B" });
      expect(kinds(result.current.widgets)).toEqual(["needsAttention"]);

      // The save org A scheduled never fires (it would have landed under B's token).
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(m.save).not.toHaveBeenCalled();

      // A's Undo writes nothing into B.
      expect(() => act(() => undoA!())).toThrow(LAYOUT_OTHER_ORG);
      expect(kinds(result.current.widgets)).toEqual(["needsAttention"]);

      // B's own change saves to B's row, naming B.
      act(() => { result.current.removeWidget("needsAttention"); });
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(m.save).toHaveBeenCalledTimes(1);
      expect(m.save.mock.calls[0][0]).toMatchObject({ id: "rowB", orgId: "B", widgets: [] });
    } finally {
      vi.useRealTimers();
      mockedQuery.mockImplementation(defaultQuery);
    }
  });

  it("a change that changes nothing returns no restore (so it never toasts)", () => {
    const { result } = renderHook(() => useDashboardLayout("org1"));
    let undo: unknown = "unset";
    act(() => { undo = result.current.resetToDefault(); });
    expect(undo).toBeNull();
  });
});
