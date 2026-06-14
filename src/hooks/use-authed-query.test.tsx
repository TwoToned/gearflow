// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock convex/react so we can observe exactly what `useQuery` is called with for
// each auth state — that argument (real args vs the "skip" sentinel) IS the fix.
const useConvexAuth = vi.fn();
const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuth() as { isLoading: boolean; isAuthenticated: boolean },
  useQuery: (...args: unknown[]) => useQuery(...args) as unknown,
}));

import { useAuthedQuery } from "./use-authed-query";
import type { FunctionReference } from "convex/server";

// A stand-in FunctionReference — the wrapper only forwards it, never inspects it.
const ref = { __fakeQueryRef: true } as unknown as FunctionReference<"query">;

beforeEach(() => {
  useConvexAuth.mockReset();
  useQuery.mockReset();
});

describe("useAuthedQuery", () => {
  it("forces 'skip' while the Convex token is not attached (the crash guard)", () => {
    // Before the user token attaches, requireOrgRead* on the server would throw
    // "Unauthorized: authentication required." and crash the page. The wrapper
    // must NOT run the query — it must pass "skip" and ignore the real args.
    useConvexAuth.mockReturnValue({ isLoading: true, isAuthenticated: false });
    useQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useAuthedQuery(ref, { projectId: "p1" }));

    expect(useQuery).toHaveBeenCalledWith(ref, "skip");
    expect(result.current).toBeUndefined();
  });

  it("forwards the real args once authenticated (Convex re-runs on auth change)", () => {
    useConvexAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
    useQuery.mockReturnValue({ ok: true });

    const { result } = renderHook(() => useAuthedQuery(ref, { projectId: "p1" }));

    expect(useQuery).toHaveBeenCalledWith(ref, { projectId: "p1" });
    expect(result.current).toEqual({ ok: true });
  });

  it("re-skips if auth is later lost (mid-session token-refresh failure)", () => {
    useConvexAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
    useQuery.mockReturnValue({ ok: true });
    const { rerender } = renderHook(() => useAuthedQuery(ref, { projectId: "p1" }));
    expect(useQuery).toHaveBeenLastCalledWith(ref, { projectId: "p1" });

    // Convex de-auths the client when a token refresh fails; isAuthenticated flips
    // false. The query must drop back to "skip" rather than re-run and throw.
    useConvexAuth.mockReturnValue({ isLoading: false, isAuthenticated: false });
    rerender();
    expect(useQuery).toHaveBeenLastCalledWith(ref, "skip");
  });

  it("keeps a caller-supplied 'skip' skipped even when authenticated", () => {
    useConvexAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
    useQuery.mockReturnValue(undefined);

    renderHook(() => useAuthedQuery(ref, "skip"));

    expect(useQuery).toHaveBeenCalledWith(ref, "skip");
  });
});
