// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useStableNow } from "./use-stable-now";

afterEach(() => vi.useRealTimers());

describe("useStableNow", () => {
  it("returns the same timestamp across re-renders even as the clock advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));

    const { result, rerender } = renderHook(() => useStableNow());
    const first = result.current;
    expect(first).toBe(Date.parse("2026-09-19T09:00:00.000Z"));

    // The whole point: a re-render a full minute later must NOT produce a new
    // value, because the value is a Convex subscription key (see the hook's doc).
    vi.setSystemTime(new Date("2026-09-19T09:01:00.000Z"));
    rerender();
    expect(result.current).toBe(first);
    rerender();
    expect(result.current).toBe(first);
  });

  it("takes a fresh snapshot per mount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    const a = renderHook(() => useStableNow());
    vi.setSystemTime(new Date("2026-09-19T10:00:00.000Z"));
    const b = renderHook(() => useStableNow());

    expect(b.result.current).toBeGreaterThan(a.result.current);
  });
});
