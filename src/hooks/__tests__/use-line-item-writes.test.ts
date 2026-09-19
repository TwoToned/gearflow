// @vitest-environment jsdom
//
// #1221 follow-up (parent #1221, closes Phase 5's "Equipment write-side
// gap" — FEATUREDOCS/78) — proves `useLineItemWrites`'s `add`/`addCustom`/
// `addKit` thread their new optional `versionId` straight through to the
// underlying `api.lineItemWrites.*` mutation args, unchanged, and that
// omitting it (the pre-#1221 call shape) sends `undefined` — the server
// resolves that to the project's live version (convex/lib/versionScope.ts's
// resolveWriteVersionId), matching every call site before this phase.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const addM = vi.fn(async (..._args: unknown[]) => ({ id: "new-line", merged: false }));
const addCustomM = vi.fn(async (..._args: unknown[]) => ({ id: "new-custom" }));
const addKitM = vi.fn(async (..._args: unknown[]) => ({ id: "new-kit" }));

vi.mock("convex/react", () => ({
  useMutation: (fn: unknown) => {
    // The api object's identity is opaque in this mock — dispatch by the
    // mutation's position isn't reliable, so useLineItemWrites' six other
    // useMutation calls (patch/remove/etc.) just get a harmless no-op.
    return (fn as { __mock?: string }).__mock === "add"
      ? addM
      : (fn as { __mock?: string }).__mock === "addCustom"
        ? addCustomM
        : (fn as { __mock?: string }).__mock === "addKit"
          ? addKitM
          : vi.fn();
  },
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    lineItemWrites: {
      addLineItemSmartNative: { __mock: "add" },
      addCustomNative: { __mock: "addCustom" },
      addKitNative: { __mock: "addKit" },
      updateAccessoryPlanNative: {},
      resyncProjectAccessoriesNative: {},
      resyncProjectKitsNative: {},
      patchNative: {},
      removeNative: {},
      removeManyNative: {},
      patchManyNative: {},
      reorderNative: {},
      unsellLineItemNative: {},
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }),
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));

import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import { lineItemSchema, customLineItemSchema } from "@/lib/validations/line-item";

describe("useLineItemWrites — #1221 versionId follow-up", () => {
  it("add(): omits versionId when not supplied (server resolves live)", async () => {
    addM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    const parsed = lineItemSchema.parse({ type: "EQUIPMENT", description: "PAR", quantity: 1 });
    await result.current.add("p1", parsed, { allowOverbook: false, forceSeparate: false, includeAccessories: false });
    expect(addM).toHaveBeenCalledTimes(1);
    expect(addM.mock.calls[0][0]).toMatchObject({ projectId: "p1", versionId: undefined });
  });

  it("add(): threads an explicit versionId straight through", async () => {
    addM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    const parsed = lineItemSchema.parse({ type: "EQUIPMENT", description: "PAR", quantity: 1 });
    await result.current.add("p1", parsed, {
      allowOverbook: false,
      forceSeparate: false,
      includeAccessories: false,
      versionId: "ver-nonlive",
    });
    expect(addM.mock.calls[0][0]).toMatchObject({ projectId: "p1", versionId: "ver-nonlive" });
  });

  it("addCustom(): threads an explicit versionId straight through", async () => {
    addCustomM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    const parsed = customLineItemSchema.parse({ description: "Rigging labour", quantity: 1 });
    await result.current.addCustom("p1", parsed, { versionId: "ver-nonlive" });
    expect(addCustomM.mock.calls[0][0]).toMatchObject({ projectId: "p1", versionId: "ver-nonlive" });
  });

  it("addCustom(): omits versionId when opts is absent entirely", async () => {
    addCustomM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    const parsed = customLineItemSchema.parse({ description: "Rigging labour", quantity: 1 });
    await result.current.addCustom("p1", parsed);
    expect(addCustomM.mock.calls[0][0]).toMatchObject({ projectId: "p1", versionId: undefined });
  });

  it("addKit(): threads an explicit versionId straight through", async () => {
    addKitM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    await result.current.addKit("p1", "kit1", { pricingMode: "KIT_PRICE", kitLabel: "KIT-1", versionId: "ver-nonlive" });
    expect(addKitM.mock.calls[0][0]).toMatchObject({ projectId: "p1", kitId: "kit1", versionId: "ver-nonlive" });
  });

  it("addKit(): omits versionId when not supplied", async () => {
    addKitM.mockClear();
    const { result } = renderHook(() => useLineItemWrites());
    await result.current.addKit("p1", "kit1", { pricingMode: "KIT_PRICE", kitLabel: "KIT-1" });
    expect(addKitM.mock.calls[0][0]).toMatchObject({ projectId: "p1", versionId: undefined });
  });
});
