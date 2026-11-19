// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const query = vi.fn();
vi.mock("convex/react", () => ({ useConvex: () => ({ query }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org_1" } }) }));
let canLookUp = true;
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => canLookUp }));

import { useScanLookup, scanOpenLabel } from "@/hooks/use-scan-lookup";

describe("useScanLookup", () => {
  it("no permission: says so without calling the server", async () => {
    canLookUp = false;
    const { result } = renderHook(() => useScanLookup());
    await act(async () => result.current.run("AURA-01"));
    expect(result.current.state).toEqual({ status: "noPermission", value: "AURA-01" });
    expect(query).not.toHaveBeenCalled();
    canLookUp = true;
  });

  it("offline reads as the error state, not a hang", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useScanLookup());
    await act(async () => result.current.run("AURA-01"));
    expect(result.current.state.status).toBe("error");
    spy.mockRestore();
  });

  it("labels the open CTA by where the target lives", () => {
    expect(scanOpenLabel("/kits/k1")).toBe("Open kit ›");
    expect(scanOpenLabel("/assets/registry/a1")).toBe("Open asset ›");
    expect(scanOpenLabel("/test-and-tag/t1")).toBe("Open test record ›");
  });
});
