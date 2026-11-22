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

vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: (_q: unknown, args: unknown) => (args === "skip" ? undefined : m.saved) }));
vi.mock("convex/react", () => ({ useMutation: () => m.save }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));

import { useDashboardLayout, LAYOUT_CHANGED_SINCE } from "@/hooks/use-dashboard-layout";

const kinds = (ws: { kind: string }[]) => ws.map((w) => w.kind);

beforeEach(() => {
  m.saved = null;
  m.save.mockClear();
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

  it("a change that changes nothing returns no restore (so it never toasts)", () => {
    const { result } = renderHook(() => useDashboardLayout("org1"));
    let undo: unknown = "unset";
    act(() => { undo = result.current.resetToDefault(); });
    expect(undo).toBeNull();
  });
});
