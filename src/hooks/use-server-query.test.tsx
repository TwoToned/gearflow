// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useServerQuery } from "./use-server-query";

describe("useServerQuery", () => {
  it("fetches on mount and exposes the resolved data", async () => {
    const { result } = renderHook(() =>
      useServerQuery({ queryKey: ["k", 1], queryFn: async () => "value" })
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe("value");
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when disabled", async () => {
    const queryFn = vi.fn(async () => "value");
    const { result } = renderHook(() =>
      useServerQuery({ queryKey: ["k"], queryFn, enabled: false })
    );

    // Give any stray microtask a chance to run.
    await act(async () => {});
    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("refetches and clears data when the key changes (per-key isolation)", async () => {
    const queryFn = vi.fn(async (key: string) => `data-for-${key}`);
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) =>
        useServerQuery({ queryKey: ["item", k], queryFn: () => queryFn(k) }),
      { initialProps: { k: "a" } }
    );

    await waitFor(() => expect(result.current.data).toBe("data-for-a"));

    rerender({ k: "b" });
    // Data must clear immediately on key change — never surface "a" under "b".
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe("data-for-b"));
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("does NOT refetch when only queryFn identity changes (key is the cache id)", async () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useServerQuery({
          queryKey: ["stable"],
          queryFn: async () => {
            calls.push(tag);
            return tag;
          },
        }),
      { initialProps: { tag: "first" } }
    );

    await waitFor(() => expect(result.current.data).toBe("first"));
    rerender({ tag: "second" }); // new closure, same key
    await act(async () => {});
    expect(calls).toEqual(["first"]);
    expect(result.current.data).toBe("first");
  });

  it("captures fetch errors", async () => {
    const { result } = renderHook(() =>
      useServerQuery({
        queryKey: ["err"],
        queryFn: async () => {
          throw new Error("boom");
        },
      })
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("ignores a stale in-flight resolution after the key changes", async () => {
    let resolveA: (v: string) => void = () => {};
    const gateA = new Promise<string>((res) => {
      resolveA = res;
    });
    const queryFn = (k: string) =>
      k === "a" ? gateA : Promise.resolve(`data-${k}`);

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) =>
        useServerQuery({ queryKey: ["x", k], queryFn: () => queryFn(k) }),
      { initialProps: { k: "a" } }
    );

    rerender({ k: "b" });
    await waitFor(() => expect(result.current.data).toBe("data-b"));

    // The slow "a" fetch resolves late — it must NOT clobber "b".
    await act(async () => {
      resolveA("data-a");
    });
    expect(result.current.data).toBe("data-b");
  });

  it("refetch() re-runs the query function", async () => {
    let n = 0;
    const { result } = renderHook(() =>
      useServerQuery({ queryKey: ["count"], queryFn: async () => ++n })
    );

    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});
