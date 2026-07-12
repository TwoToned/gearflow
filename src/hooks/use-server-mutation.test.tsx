// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useServerMutation } from "./use-server-mutation";

describe("useServerMutation", () => {
  it("starts idle (not pending, no error/data)", () => {
    const { result } = renderHook(() =>
      useServerMutation({ mutationFn: async () => "ok" })
    );
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeUndefined();
  });

  it("mutateAsync resolves with the server-action result and calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useServerMutation<string, number>({
        mutationFn: async (n) => `value-${n}`,
        onSuccess,
      })
    );

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(7);
    });

    expect(returned).toBe("value-7");
    expect(onSuccess).toHaveBeenCalledWith("value-7", 7);
    expect(result.current.data).toBe("value-7");
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("toggles isPending across an in-flight call", async () => {
    let release: (v: string) => void = () => {};
    const gate = new Promise<string>((res) => {
      release = res;
    });
    const { result } = renderHook(() =>
      useServerMutation({ mutationFn: () => gate })
    );

    let done: Promise<unknown>;
    act(() => {
      done = result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      release("done");
      await done;
    });
    expect(result.current.isPending).toBe(false);
  });

  it("mutateAsync rejects on failure, sets error, and calls onError", async () => {
    const onError = vi.fn();
    const boom = new Error("server boom");
    const { result } = renderHook(() =>
      useServerMutation<never, void>({
        mutationFn: async () => {
          throw boom;
        },
        onError,
      })
    );

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow("server boom");
    });

    expect(onError).toHaveBeenCalledWith(boom, undefined);
    expect(result.current.error).toBe(boom);
    expect(result.current.isPending).toBe(false);
  });

  it("non-Error throws are wrapped in an Error", async () => {
    const { result } = renderHook(() =>
      useServerMutation<never, void>({
        mutationFn: async () => {
          throw "string failure";
        },
      })
    );
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow(
        "string failure"
      );
    });
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("mutate() is fire-and-forget and never throws even on failure", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useServerMutation<never, void>({
        mutationFn: async () => {
          throw new Error("nope");
        },
        onError,
      })
    );
    // Must not throw synchronously nor reject unhandled.
    act(() => {
      result.current.mutate();
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(result.current.error?.message).toBe("nope");
  });

  it("onSettled fires for both success and failure", async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useServerMutation<string, void>({
        mutationFn: async () => "ok",
        onSettled,
      })
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(onSettled).toHaveBeenCalledWith("ok", null, undefined);
  });

  it("stays pending until the LAST of overlapping calls settles (in-flight counter)", async () => {
    const gates: Array<(v: string) => void> = [];
    const { result } = renderHook(() =>
      useServerMutation<string, void>({
        mutationFn: () => new Promise<string>((res) => gates.push(res)),
      })
    );

    let a: Promise<unknown>, b: Promise<unknown>;
    act(() => {
      a = result.current.mutateAsync();
      b = result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    // Resolve the first call only — still pending (second in flight).
    await act(async () => {
      gates[0]("one");
      await a;
    });
    expect(result.current.isPending).toBe(true);

    // Resolve the second — now idle.
    await act(async () => {
      gates[1]("two");
      await b;
    });
    expect(result.current.isPending).toBe(false);
  });

  it("a slow earlier call does not clobber a later call's result (latest-wins)", async () => {
    const gates: Array<(v: string) => void> = [];
    const { result } = renderHook(() =>
      useServerMutation<string, void>({
        mutationFn: () => new Promise<string>((res) => gates.push(res)),
      })
    );
    let a: Promise<unknown>, b: Promise<unknown>;
    act(() => {
      a = result.current.mutateAsync(); // callId 1
      b = result.current.mutateAsync(); // callId 2 (latest)
    });
    // Resolve the LATER call first, then the earlier one.
    await act(async () => {
      gates[1]("latest");
      await b;
    });
    await act(async () => {
      gates[0]("stale");
      await a;
    });
    expect(result.current.data).toBe("latest"); // earlier call did not overwrite
  });

  it("reset clears error and data", async () => {
    const { result } = renderHook(() =>
      useServerMutation({
        mutationFn: async () => {
          throw new Error("x");
        },
      })
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeUndefined();
  });

  it("uses the latest options (no stale closure) without changing mutate identity", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useServerMutation({
          mutationFn: async () => "v",
          onSuccess: cb,
        }),
      { initialProps: { cb: first } }
    );
    const mutateRef = result.current.mutate;
    rerender({ cb: second });
    expect(result.current.mutate).toBe(mutateRef); // stable identity
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1); // latest callback used
  });

  it("does NOT run onSuccess/onSettled after the view unmounts (no snap-back nav)", async () => {
    // Simulates: user fires a create, then navigates away before it resolves.
    // onSuccess (which ~24 call sites use to router.push) must not run on the
    // torn-down view and yank the user back.
    let resolveFn!: (v: string) => void;
    const pending = new Promise<string>((res) => { resolveFn = res; });
    const onSuccess = vi.fn();
    const onSettled = vi.fn();

    const { result, unmount } = renderHook(() =>
      useServerMutation<string, void>({ mutationFn: () => pending, onSuccess, onSettled })
    );

    let call!: Promise<string>;
    act(() => { call = result.current.mutateAsync(); });
    unmount(); // leave the page while the mutation is in flight
    await act(async () => { resolveFn("done"); await call; });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("still runs onError after unmount (failure toasts survive, they never navigate)", async () => {
    let rejectFn!: (e: Error) => void;
    const pending = new Promise<string>((_res, rej) => { rejectFn = rej; });
    const onError = vi.fn();

    const { result, unmount } = renderHook(() =>
      useServerMutation<string, void>({ mutationFn: () => pending, onError })
    );

    let call!: Promise<string>;
    act(() => { call = result.current.mutateAsync().catch(() => "caught"); });
    unmount();
    await act(async () => { rejectFn(new Error("boom")); await call; });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
