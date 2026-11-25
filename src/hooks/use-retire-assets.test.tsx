// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  assets: { archive: vi.fn(), reinstate: vi.fn(), undoRetire: vi.fn() },
  bulk: { archive: vi.fn(), reinstate: vi.fn(), undoRetire: vi.fn() },
  actions: [] as { label: string; onClick: () => void }[],
}));
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => h.assets }));
vi.mock("@/hooks/use-bulk-asset-writes", () => ({ useBulkAssetWrites: () => h.bulk }));
vi.mock("sonner", () => ({
  toast: {
    success: (_t: string, o?: { action?: { label: string; onClick: () => void } }) => {
      if (o?.action) h.actions.push(o.action);
    },
    error: vi.fn(),
  },
}));

import { useRetireAssets } from "@/hooks/use-retire-assets";

describe("useRetireAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.actions.length = 0;
    h.assets.archive.mockImplementation(async (id: string) => ({ ok: true, undoable: true, auditId: `aud-${id}` }));
    h.assets.undoRetire.mockResolvedValue({ restored: [] });
    h.bulk.archive.mockImplementation(async (id: string) => ({ id, undoable: true, auditId: `aud-${id}` }));
    h.bulk.undoRetire.mockResolvedValue({ restored: [] });
  });

  it("skips what is already retired and Undo reverses exactly the rows it changed, from their own audit ids", async () => {
    const { result } = renderHook(() => useRetireAssets());
    const out = await result.current.retireMany([
      { id: "a1", tag: "A-1", kind: "serialized", status: "AVAILABLE" },
      { id: "a2", tag: "A-2", kind: "serialized", status: "RETIRED" },
      { id: "b1", tag: "B-1", kind: "bulk", status: "ACTIVE" },
    ]);
    expect(out.done.map((r) => r.id)).toEqual(["a1", "b1"]);
    expect(out.skipped).toEqual([{ name: "A-2", why: "already retired" }]);
    expect(h.assets.archive).toHaveBeenCalledTimes(1);

    expect(h.actions).toHaveLength(1);
    h.actions[0].onClick();
    await vi.waitFor(() => expect(h.bulk.undoRetire).toHaveBeenCalledWith("b1", "aud-b1"));
    expect(h.assets.undoRetire).toHaveBeenCalledWith("a1", "aud-a1");
    expect(h.assets.undoRetire).toHaveBeenCalledTimes(1);

    // a second click does nothing (ONE guarded closure)
    h.actions[0].onClick();
    expect(h.assets.undoRetire).toHaveBeenCalledTimes(1);
  });

  it("offers no Undo when nothing changed", async () => {
    h.assets.archive.mockResolvedValue({ ok: true, undoable: false, auditId: "x" });
    const { result } = renderHook(() => useRetireAssets());
    await result.current.retireMany([{ id: "a1", tag: "A-1", kind: "serialized", status: "AVAILABLE" }]);
    expect(h.actions).toHaveLength(0);
  });
});
