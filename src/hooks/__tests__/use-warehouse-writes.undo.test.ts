// @vitest-environment jsdom
//
// #1222 — the Undo action folded into every checkOut*/checkIn* toast. Covers
// the reverse-mapping table, succeeded-only batching (never the requested
// ids), the permission omission (no `action` when the reverse permission is
// out of reach), and the double-tap guard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { api } from "../../../convex/_generated/api";
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
  const call = toastSuccessMock.mock.calls.at(-1);
  return call?.[1]?.action;
}

describe("useWarehouseWrites — undo (#1222)", () => {
  beforeEach(() => {
    mutationSpies.clear();
    canDoMock.mockReset().mockReturnValue(true);
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    convexQueryMock.mockClear().mockResolvedValue(null);

    spyFor(api.warehouseWrites.checkOutItems).mockResolvedValue({
      updatedLineIds: ["li1", "li2"],
      autoStatus: null,
      autoStatusAuditId: null,
    });
    spyFor(api.warehouseWrites.undeployItems).mockResolvedValue({ updatedLineIds: ["li1", "li2"] });
    spyFor(api.warehouseWrites.checkOutKitsBatch).mockResolvedValue({
      succeeded: ["k1", "k2"],
      errors: [{ kitId: "ghost", message: "not found" }],
      autoStatus: "CHECKED_OUT",
      autoStatusAuditId: "audit-1",
    });
    spyFor(api.warehouseWrites.undeployKitsBatch).mockResolvedValue({ succeeded: ["k1", "k2"], errors: [] });
  });

  it("reverse mapping: undo of checkOutItems calls undeployItems with the same items + the captured auditId", async () => {
    const { result } = renderHook(() => useWarehouseWrites());

    await act(async () => {
      await result.current.checkOutItems("p1", [{ lineItemId: "li1" }, { lineItemId: "li2", assetId: "a2" }]);
    });

    const undeploySpy = spyFor(api.warehouseWrites.undeployItems);
    expect(undeploySpy).not.toHaveBeenCalled();

    const action = lastToastAction();
    expect(action?.label).toBe("Undo");
    await act(async () => {
      await action!.onClick();
    });

    expect(undeploySpy).toHaveBeenCalledTimes(1);
    const call = undeploySpy.mock.calls[0][0];
    expect(call.projectId).toBe("p1");
    expect(call.items).toEqual([{ lineItemId: "li1", assetId: undefined, quantity: undefined }, { lineItemId: "li2", assetId: "a2", quantity: undefined }]);
    expect(call.revertAutoAdvanceAuditId).toBeUndefined(); // forward call had no autoStatus this time
  });

  it("succeeded-only batching: undo of checkOutKitsBatch reverses res.succeeded, never the requested ids", async () => {
    const { result } = renderHook(() => useWarehouseWrites());

    await act(async () => {
      await result.current.checkOutKitsBatch("p1", ["k1", "k2", "ghost"]);
    });

    const action = lastToastAction();
    await act(async () => {
      await action!.onClick();
    });

    const undeployBatchSpy = spyFor(api.warehouseWrites.undeployKitsBatch);
    expect(undeployBatchSpy).toHaveBeenCalledTimes(1);
    const call = undeployBatchSpy.mock.calls[0][0];
    expect(call.kitIds).toEqual(["k1", "k2"]); // succeeded only — "ghost" never moved
    expect(call.revertAutoAdvanceAuditId).toBe("audit-1"); // the captured forward auditId
  });

  it("permission omission: no Undo action when the reverse permission is out of reach", async () => {
    canDoMock.mockImplementation((_resource: string, action: string) => action !== "check_in");
    const { result } = renderHook(() => useWarehouseWrites());

    await act(async () => {
      await result.current.checkOutItems("p1", [{ lineItemId: "li1" }]);
    });

    expect(lastToastAction()).toBeUndefined();
  });

  it("double-tap: a second Undo click does not fire a second reverse", async () => {
    const { result } = renderHook(() => useWarehouseWrites());

    await act(async () => {
      await result.current.checkOutItems("p1", [{ lineItemId: "li1" }, { lineItemId: "li2" }]);
    });

    const action = lastToastAction();
    await act(async () => {
      await Promise.all([action!.onClick(), action!.onClick()]);
    });

    expect(spyFor(api.warehouseWrites.undeployItems)).toHaveBeenCalledTimes(1);
  });
});
