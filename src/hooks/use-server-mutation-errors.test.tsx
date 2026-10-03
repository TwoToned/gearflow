// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useServerMutation } from "./use-server-mutation";

describe("useServerMutation error normalisation", () => {
  it("hands onError the real reason, not the raw Convex wrapper", async () => {
    let seen = "";
    const { result } = renderHook(() =>
      useServerMutation<void, void>({
        mutationFn: async () => { throw new ConvexError("Insufficient stock: TTP00149 has 0 available"); },
        onError: (e) => { seen = e.message; },
      }),
    );
    await act(async () => { await result.current.mutateAsync().catch(() => {}); });
    expect(seen).toBe("Insufficient stock: TTP00149 has 0 available");
  });
});
