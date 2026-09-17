// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const playScanFeedbackMock = vi.fn();
const playScanHapticMock = vi.fn();
vi.mock("@/lib/scan-feedback", () => ({
  playScanFeedback: (...args: unknown[]) => playScanFeedbackMock(...args),
  playScanHaptic: (...args: unknown[]) => playScanHapticMock(...args),
}));

import { useScanFeedback } from "@/hooks/use-scan-feedback";

describe("useScanFeedback", () => {
  beforeEach(() => {
    localStorage.clear();
    playScanFeedbackMock.mockClear();
    playScanHapticMock.mockClear();
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

  it("play() calls playScanFeedback and playScanHaptic only when enabled", () => {
    const { result } = renderHook(() => useScanFeedback());

    act(() => result.current.play("success"));
    expect(playScanFeedbackMock).toHaveBeenCalledWith("success");
    expect(playScanHapticMock).toHaveBeenCalledWith("success");

    playScanFeedbackMock.mockClear();
    playScanHapticMock.mockClear();
    act(() => result.current.toggle()); // -> disabled
    act(() => result.current.play("error"));
    expect(playScanFeedbackMock).not.toHaveBeenCalled();
    expect(playScanHapticMock).not.toHaveBeenCalled();
  });

  it("survives malformed storage without throwing", () => {
    localStorage.setItem("rvlt.scanAudio", "{not json");
    const { result } = renderHook(() => useScanFeedback());
    expect(result.current.enabled).toBe(true);
  });

  // #1223 — scan history strip
  describe("entries", () => {
    it("an entry-less play() adds nothing", () => {
      const { result } = renderHook(() => useScanFeedback());
      act(() => result.current.play("success"));
      expect(result.current.entries).toEqual([]);
    });

    it("records an entry, newest first", () => {
      const { result } = renderHook(() => useScanFeedback());
      act(() => result.current.play("success", { label: "A", outcome: "Prepped" }));
      act(() => result.current.play("error", { label: "B", outcome: "Failed" }));
      expect(result.current.entries.map((e) => e.label)).toEqual(["B", "A"]);
      expect(result.current.entries[0].kind).toBe("error");
    });

    it("records regardless of the audio/haptic enabled flag", () => {
      const { result } = renderHook(() => useScanFeedback());
      act(() => result.current.toggle()); // -> disabled
      act(() => result.current.play("success", { label: "A", outcome: "Prepped" }));
      expect(result.current.entries).toHaveLength(1);
      expect(playScanFeedbackMock).not.toHaveBeenCalled();
    });

    it("caps at 5, dropping the oldest", () => {
      const { result } = renderHook(() => useScanFeedback());
      for (let i = 0; i < 7; i++) {
        act(() => result.current.play("success", { label: `#${i}`, outcome: "Prepped" }));
      }
      expect(result.current.entries).toHaveLength(5);
      expect(result.current.entries.map((e) => e.label)).toEqual(["#6", "#5", "#4", "#3", "#2"]);
    });

    it("exposes undo only on the newest carrier", () => {
      const { result } = renderHook(() => useScanFeedback());
      const olderUndo = { label: "Undo", run: vi.fn() };
      const newerUndo = { label: "Undo", run: vi.fn() };
      act(() => result.current.play("success", { label: "A", outcome: "Deployed", undo: olderUndo }));
      act(() => result.current.play("success", { label: "B", outcome: "Deployed", undo: newerUndo }));
      act(() => result.current.play("success", { label: "C", outcome: "Prepped" }));

      // Newest overall (C) has no undo of its own; the newest ENTRY that
      // carries one (B) keeps it, and the older one (A) has it stripped.
      const [c, b, a] = result.current.entries;
      expect(c.label).toBe("C");
      expect(c.undo).toBeUndefined();
      expect(b.label).toBe("B");
      expect(b.undo).toBe(newerUndo);
      expect(a.label).toBe("A");
      expect(a.undo).toBeUndefined();
    });
  });
});
