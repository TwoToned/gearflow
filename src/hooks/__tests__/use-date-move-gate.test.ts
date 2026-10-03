// @vitest-environment jsdom
//
// useDateMoveGate (#1227, Q3 of the QOL sweep) — non-blocking: only previews
// when the resolved window actually moved AND the project is CONFIRMED or
// later; every other case, and any case where the preview finds nothing to
// warn about, proceeds immediately with no dialog.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const queryMock = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: queryMock }),
}));

import { useDateMoveGate } from "@/hooks/use-date-move-gate";

const NO_ROWS = { rows: [], windowMoved: true };
const WITH_ROWS = { rows: [{ modelId: "m1", modelName: "SM58", qty: 2, projectNumbers: ["P-1042"] }], windowMoved: true };

const WINDOW_A = { start: 1_000, end: 2_000 };
const WINDOW_B = { start: 3_000, end: 4_000 };

describe("useDateMoveGate", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("proceeds immediately, without previewing, when the window didn't move", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_A, "payload");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("payload");
    expect(result.current.pending).toBeNull();
  });

  it("proceeds immediately, without previewing, when the project is below CONFIRMED", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "QUOTED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("payload");
  });

  it("previews on a moved window for a CONFIRMED-or-later project, and proceeds when there's nothing to warn about", async () => {
    queryMock.mockResolvedValue(NO_ROWS);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });

    expect(queryMock).toHaveBeenCalledWith(expect.anything(), { orgId: "org1", projectId: "p1", start: WINDOW_B.start, end: WINDOW_B.end });
    expect(onProceed).toHaveBeenCalledWith("payload");
    expect(result.current.pending).toBeNull();
  });

  it("also previews for a status past CONFIRMED (e.g. PREPPING)", async () => {
    queryMock.mockResolvedValue(NO_ROWS);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "PREPPING", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });

    expect(queryMock).toHaveBeenCalled();
  });

  it("holds for confirmation when the preview finds a shortage — does NOT call onProceed until confirmPending()", async () => {
    queryMock.mockResolvedValue(WITH_ROWS);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });

    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual({ data: "payload", rows: WITH_ROWS.rows });

    act(() => result.current.confirmPending());
    expect(onProceed).toHaveBeenCalledWith("payload");
    expect(result.current.pending).toBeNull();
  });

  it("cancelPending clears the pending state without ever calling onProceed", async () => {
    queryMock.mockResolvedValue(WITH_ROWS);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });
    expect(result.current.pending).not.toBeNull();

    act(() => result.current.cancelPending());
    expect(result.current.pending).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("fails OPEN (proceeds) if the preview query itself throws — advisory only, never blocks a real edit", async () => {
    queryMock.mockRejectedValue(new Error("network blip"));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave(WINDOW_B, "payload");
    });

    await waitFor(() => expect(onProceed).toHaveBeenCalledWith("payload"));
    expect(result.current.pending).toBeNull();
  });

  it("skips the preview when a window side is still unset (dateless target)", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useDateMoveGate("org1", "p1", "CONFIRMED", WINDOW_A, onProceed));

    await act(async () => {
      await result.current.requestSave({ start: WINDOW_B.start, end: null }, "payload");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("payload");
  });
});
