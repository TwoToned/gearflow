// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221, design §5 D32) —
// proves `useNativeEquipmentTab`'s new `versionId` parameter reaches
// `equipmentTab.bundle`'s own query args unchanged (Phase 2, #1228, already
// added `versionId` server-side; this hook is the first UI caller to
// actually pass it through). Together with
// `equipment-add-menu-trigger.smoke.test.tsx`, this is the structural proof
// that `EquipmentTab` renders the SAME tree for a live and a non-live
// version apart from the one greyed trigger: the data path takes the same
// shape either way, parameterised only by which version's rows come back.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const authedQueryMock = vi.fn((..._args: unknown[]) => undefined);
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (...args: unknown[]) => authedQueryMock(...args),
}));

vi.mock("@/hooks/use-projects", () => ({
  useProject: () => undefined,
}));

import { useNativeEquipmentTab } from "@/hooks/use-native-equipment-tab";

describe("useNativeEquipmentTab — version-scoped read", () => {
  it("omits versionId (reads the live version) when none is passed", () => {
    authedQueryMock.mockClear();
    renderHook(() => useNativeEquipmentTab("p1", "org1"));

    const bundleCall = authedQueryMock.mock.calls[0];
    expect(bundleCall[1]).toEqual({ projectId: "p1", orgId: "org1", versionId: undefined });
  });

  it("threads an explicit versionId straight through to equipmentTab.bundle's own args", () => {
    authedQueryMock.mockClear();
    renderHook(() => useNativeEquipmentTab("p1", "org1", undefined, undefined, undefined, undefined, "ver-3"));

    const bundleCall = authedQueryMock.mock.calls[0];
    expect(bundleCall[1]).toEqual({ projectId: "p1", orgId: "org1", versionId: "ver-3" });
  });

  it("skips the subscription entirely without a projectId/orgId, regardless of versionId", () => {
    authedQueryMock.mockClear();
    renderHook(() => useNativeEquipmentTab(undefined, undefined, undefined, undefined, undefined, undefined, "ver-3"));

    const bundleCall = authedQueryMock.mock.calls[0];
    expect(bundleCall[1]).toBe("skip");
  });
});
