// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const playScanFeedbackMock = vi.fn();
vi.mock("@/lib/scan-feedback", () => ({
  playScanFeedback: (...args: unknown[]) => playScanFeedbackMock(...args),
}));

import { useScanFeedback } from "@/hooks/use-scan-feedback";

describe("useScanFeedback", () => {
  beforeEach(() => {
    localStorage.clear();
    playScanFeedbackMock.mockClear();
  });

  it("defaults to enabled when nothing is persisted", () => {
    const { result } = renderHook(() => useScanFeedback());
    expect(result.current.enabled).toBe(true);
  });

  it("persists the toggle under the rvlt.scanAudio key, per-device (not user-scoped)", () => {
    const { result } = renderHook(() => useScanFeedback());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem("rvlt.scanAudio")).toBe("false");

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem("rvlt.scanAudio")).toBe("true");
  });

  it("a fresh mount reads the persisted value back", () => {
    const first = renderHook(() => useScanFeedback());
    act(() => first.result.current.toggle()); // -> disabled

    const second = renderHook(() => useScanFeedback());
    expect(second.result.current.enabled).toBe(false);
  });

  it("play() calls playScanFeedback only when enabled", () => {
    const { result } = renderHook(() => useScanFeedback());

    act(() => result.current.play("success"));
    expect(playScanFeedbackMock).toHaveBeenCalledWith("success");

    playScanFeedbackMock.mockClear();
    act(() => result.current.toggle()); // -> disabled
    act(() => result.current.play("error"));
    expect(playScanFeedbackMock).not.toHaveBeenCalled();
  });

  it("survives malformed storage without throwing", () => {
    localStorage.setItem("rvlt.scanAudio", "{not json");
    const { result } = renderHook(() => useScanFeedback());
    expect(result.current.enabled).toBe(true);
  });
});
