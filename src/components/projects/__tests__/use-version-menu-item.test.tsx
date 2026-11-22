// @vitest-environment jsdom
//
// UX Phase 7: `New version from vN` keeps the old pill's pending guard. An
// ActionItem can't be disabled (absent, not disabled), so a double trigger
// must still create ONE version.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let resolveCreate: (v: { id: string; number: number }) => void = () => {};
const createVersion = vi.fn(
  () =>
    new Promise<{ id: string; number: number }>((r) => {
      resolveCreate = r;
    }),
);
vi.mock("@/hooks/use-project-version-writes", () => ({ useProjectVersionWrites: () => ({ createVersion }) }));

const LIVE = { id: "v3", number: 3, isLive: true, contentState: "ready" as const, createdAt: 1, createdById: "u1" };
const setViewingNumber = vi.fn();
vi.mock("@/components/projects/project-version-context", () => ({
  useProjectVersion: () => ({
    projectId: "p1",
    versions: [LIVE],
    liveVersion: LIVE,
    viewingNumber: null,
    setViewingNumber,
    openCompare: vi.fn(),
  }),
}));

import { useVersionMenuItem } from "@/components/projects/use-version-menu-item";

describe("useVersionMenuItem — New version", () => {
  it("a double trigger while the first create is in flight creates ONE version; it re-arms after", async () => {
    const { result } = renderHook(() => useVersionMenuItem(vi.fn()));
    const newVersion = () => result.current!.children!.find((c) => c.key === "version-new")!;

    act(() => {
      void newVersion().onSelect?.();
      void newVersion().onSelect?.();
    });
    expect(createVersion).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ id: "v4", number: 4 });
    });
    await waitFor(() => expect(setViewingNumber).toHaveBeenCalledWith(4));

    act(() => {
      void newVersion().onSelect?.();
    });
    expect(createVersion).toHaveBeenCalledTimes(2);
  });
});
