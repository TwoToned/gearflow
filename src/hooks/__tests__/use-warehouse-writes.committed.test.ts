// @vitest-environment jsdom
//
// ux-3 — the Undo action folded into every checkOut*/checkIn* toast. Covers
// the reverse-mapping table, succeeded-only batching (never the requested
// ids), the permission omission (no `action` when the reverse permission is
// out of reach), and the double-tap guard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";

// `api.warehouseWrites.foo` is backed by a Proxy (convex/server's `anyApi`) that
// mints a NEW object on every property access — reference identity doesn't
// survive round-tripping through `useMutation`, so spies are keyed by the
// function's resolved path name instead, read off the well-known
// `Symbol.for("functionName")` the proxy responds to (same symbol
// `convex/server`'s own `getFunctionName` reads — reimplemented inline here so
// this stays inside `vi.hoisted`, which can't reference other imports).
const { mutationSpies, spyFor, canDoMock, convexQueryMock } = vi.hoisted(() => {
  const FN_NAME = Symbol.for("functionName");
  const mutationSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const spyFor = (ref: unknown): ReturnType<typeof vi.fn> => {
    const key = String((ref as Record<symbol, unknown>)[FN_NAME]);
    if (!mutationSpies.has(key)) mutationSpies.set(key, vi.fn());
    return mutationSpies.get(key)!;
  };
  return {
    mutationSpies,
    spyFor,
    canDoMock: vi.fn((_resource: string, _action: string) => true),
    convexQueryMock: vi.fn(async () => null),
  };
});

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => spyFor(ref),
  useConvex: () => ({ query: convexQueryMock }),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Ash" } } }),
  useActiveOrganization: () => ({ data: { id: "org-1" } }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCanDo: (resource: string, action: string) => canDoMock(resource, action),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(
    (...args: unknown[]) => toastSuccessMock(...args),
    { success: (...args: unknown[]) => toastSuccessMock(...args), error: (...args: unknown[]) => toastErrorMock(...args) },
  ),
}));

vi.mock("@/lib/show-error", () => ({
  showError: vi.fn(),
}));

function lastToastAction(): { label: string; onClick: () => void } | undefined {
  return toastSuccessMock.mock.calls.at(-1)?.[1]?.action;
}

describe("useWarehouseWrites.announceCommitted (durable scans share the Undo closure)", () => {
  beforeEach(() => {
    mutationSpies.clear();
    canDoMock.mockReset().mockReturnValue(true);
    toastSuccessMock.mockReset();
    mutationSpies.set("warehouseWrites:undeployItems", vi.fn().mockResolvedValue({}));
    mutationSpies.set("warehouseWrites:unreturnKitsBatch", vi.fn().mockResolvedValue({ succeeded: [], errors: [] }));
  });

  it("deploy: toast folds the status, Undo reverses the item and the auto-advance, and scanUndo IS the toast action", async () => {
    const { result } = renderHook(() => useWarehouseWrites());
    const w = result.current.announceCommitted("p1", "deploy", { lineItemId: "li1", assetId: "a1" }, { autoStatus: "CHECKED_OUT", autoStatusAuditId: "aud" });
    const action = lastToastAction();
    expect(toastSuccessMock.mock.calls.at(-1)?.[0]).toMatch(/Deployed 1 item/);
    expect(action?.label).toBe("Undo");
    expect(w.scanUndo).toBe(action?.onClick);
    await act(async () => { await w.scanUndo?.(); await w.scanUndo?.(); });
    const spy = mutationSpies.get("warehouseWrites:undeployItems")!;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }], revertAutoAdvanceAuditId: "aud" });
  });

  it("kit return reverses through unreturnKitsBatch; no Undo without the reverse permission", async () => {
    const { result } = renderHook(() => useWarehouseWrites());
    const w = result.current.announceCommitted("p1", "return", { kitId: "k1" }, {});
    await act(async () => { await w.scanUndo?.(); });
    expect(mutationSpies.get("warehouseWrites:unreturnKitsBatch")!.mock.calls[0][0]).toMatchObject({ kitIds: ["k1"] });
    canDoMock.mockReturnValue(false);
    const r2 = renderHook(() => useWarehouseWrites()).result.current.announceCommitted("p1", "return", { kitId: "k1" }, {});
    expect(r2.scanUndo).toBeUndefined();
  });
});
