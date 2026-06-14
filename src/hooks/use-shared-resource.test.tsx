// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createSharedResource } from "./use-shared-resource";

describe("createSharedResource", () => {
  it("fetches on mount and exposes the resolved data", async () => {
    const resource = createSharedResource(async () => "value");
    const { result } = renderHook(() => resource.use("org-1"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe("value");
  });

  it("does not fetch when orgId is undefined", async () => {
    const fetcher = vi.fn(async () => "value");
    const resource = createSharedResource(fetcher);
    const { result } = renderHook(() => resource.use(undefined));

    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("shares ONE in-flight fetch across concurrent subscribers of the same org", async () => {
    const fetcher = vi.fn(async () => "shared");
    const resource = createSharedResource(fetcher);

    const a = renderHook(() => resource.use("org-1"));
    const b = renderHook(() => resource.use("org-1"));

    await waitFor(() => expect(a.result.current.data).toBe("shared"));
    expect(b.result.current.data).toBe("shared");
    // The whole point of the shared store: both readers, one server round-trip.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("module-level refresh() pushes fresh data to every subscriber (the writer's invalidate analogue)", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const resource = createSharedResource(fetcher);

    // Two mounted readers (e.g. the always-mounted layout provider + a settings page).
    const reader = renderHook(() => resource.use("org-1"));
    const observer = renderHook(() => resource.use("org-1"));
    await waitFor(() => expect(reader.result.current.data).toBe(1));
    expect(observer.result.current.data).toBe(1);

    // A writer that does NOT read the datum triggers a refresh — both readers update.
    await act(async () => {
      resource.refresh("org-1");
      await Promise.resolve();
    });
    await waitFor(() => expect(reader.result.current.data).toBe(2));
    expect(observer.result.current.data).toBe(2);
  });

  it("keeps per-org isolation (a different orgId has its own store)", async () => {
    const fetcher = vi.fn(async (orgId: string) => `data-${orgId}`);
    const resource = createSharedResource(() => fetcher(currentOrg));
    let currentOrg = "a";

    const { result, rerender } = renderHook(({ org }: { org: string }) => resource.use(org), {
      initialProps: { org: "a" },
    });
    await waitFor(() => expect(result.current.data).toBe("data-a"));

    currentOrg = "b";
    rerender({ org: "b" });
    // Must never surface org "a"'s value under org "b".
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe("data-b"));
  });

  it("hook-level refresh() re-runs the fetcher", async () => {
    let n = 0;
    const resource = createSharedResource(async () => ++n);
    const { result } = renderHook(() => resource.use("org-1"));

    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("keeps last-known data when a refresh fails", async () => {
    let mode: "ok" | "fail" = "ok";
    const resource = createSharedResource(async () => {
      if (mode === "fail") throw new Error("boom");
      return "good";
    });
    const { result } = renderHook(() => resource.use("org-1"));
    await waitFor(() => expect(result.current.data).toBe("good"));

    mode = "fail";
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    // Stale-on-error: the prior value survives a failed refresh.
    expect(result.current.data).toBe("good");
  });
});
