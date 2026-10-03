// @vitest-environment jsdom
//
// Sizing-floor follow-up: a saved board can predate a later registry
// `minSize` change (the stat tiles' floor moving from h:2 to h:4 once the
// old default turned out to crush them under <DashboardCard>'s title bar).
// Proves `useDashboardLayout` clamps every widget up to its CURRENT
// registry minSize (and down to maxSize where one exists) on load, and
// persists the healed layout exactly once — never on every render, never
// when nothing needed healing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const saveNativeM = vi.fn(async (..._args: unknown[]) => ({ id: "row1" }));
let savedRow: { id: string; widgets: unknown[] } | null | undefined;

vi.mock("convex/react", () => ({
  useMutation: () => saveNativeM,
}));

vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: () => savedRow,
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: { dashboardLayouts: { get: {}, saveNative: {} } },
}));

import { useDashboardLayout } from "@/hooks/use-dashboard-layout";

describe("useDashboardLayout — heal-on-load", () => {
  beforeEach(() => {
    saveNativeM.mockClear();
  });

  it("no saved row: uses the default layout, never calls saveNative", async () => {
    savedRow = null;
    const { result } = renderHook(() => useDashboardLayout("org1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.widgets.length).toBeGreaterThan(0);
    expect(saveNativeM).not.toHaveBeenCalled();
  });

  it("saved widget already within bounds: left untouched, no heal write", async () => {
    savedRow = {
      id: "row1",
      widgets: [{ id: "statActiveJobs", kind: "statActiveJobs", x: 0, y: 0, w: 3, h: 4 }],
    };
    const { result } = renderHook(() => useDashboardLayout("org1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.widgets).toEqual([
      { id: "statActiveJobs", kind: "statActiveJobs", x: 0, y: 0, w: 3, h: 4 },
    ]);
    expect(saveNativeM).not.toHaveBeenCalled();
  });

  it("saved widget below the current registry floor: clamped up and persisted once", async () => {
    savedRow = {
      id: "row1",
      // The pre-fix default/min for a stat tile — smaller than the current
      // registry's minSize: { w: 2, h: 4 }.
      widgets: [{ id: "statActiveJobs", kind: "statActiveJobs", x: 0, y: 0, w: 3, h: 2 }],
    };
    const { result } = renderHook(() => useDashboardLayout("org1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.widgets[0]).toMatchObject({ w: 3, h: 4 });
    await waitFor(() => expect(saveNativeM).toHaveBeenCalledTimes(1));
    const persisted = saveNativeM.mock.calls[0]![0] as { widgets: { h: number }[] };
    expect(persisted.widgets[0]!.h).toBe(4);
  });

  it("saved widget above a registry maxSize: clamped down", async () => {
    savedRow = {
      id: "row1",
      // Stat tiles cap at maxSize: { w: 4, h: 5 }.
      widgets: [{ id: "statActiveJobs", kind: "statActiveJobs", x: 0, y: 0, w: 8, h: 9 }],
    };
    const { result } = renderHook(() => useDashboardLayout("org1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.widgets[0]).toMatchObject({ w: 4, h: 5 });
  });
});
