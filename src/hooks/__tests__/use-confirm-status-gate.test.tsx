// @vitest-environment jsdom
//
// useConfirmStatusGate (WS3 #942, confirm-time gate) — non-blocking: only a
// transition INTO CONFIRMED previews impact; every other transition, and any
// transition when the preview finds nothing to warn about, proceeds
// immediately with no dialog. #1244: projectId/currentStatus moved to
// requestStatusChange's own arguments so one hook instance can serve many
// projects (the revived project board).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const queryMock = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: queryMock }),
}));

import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";

const ZERO_IMPACT = { hardOverbookingModelCount: 0, hardOverbookingQty: 0, unconfirmedCrewCount: 0 };
const NONZERO_IMPACT = { hardOverbookingModelCount: 1, hardOverbookingQty: 2, unconfirmedCrewCount: 3 };

describe("useConfirmStatusGate", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("proceeds immediately for a non-CONFIRMED transition, without previewing", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "ENQUIRY", "QUOTING");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("p1", "QUOTING");
    expect(result.current.pending).toBeNull();
  });

  it("proceeds immediately when the project is already CONFIRMED (re-selecting the same status)", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "CONFIRMED", "CONFIRMED");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("p1", "CONFIRMED");
  });

  it("previews impact on a QUOTED -> CONFIRMED transition, and proceeds immediately when impact is zero", async () => {
    queryMock.mockResolvedValue(ZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "QUOTED", "CONFIRMED");
    });

    expect(queryMock).toHaveBeenCalledWith(expect.anything(), { orgId: "org1", projectId: "p1" });
    expect(onProceed).toHaveBeenCalledWith("p1", "CONFIRMED");
    expect(result.current.pending).toBeNull();
  });

  it("holds for confirmation when impact is nonzero — does NOT call onProceed until confirmPending()", async () => {
    queryMock.mockResolvedValue(NONZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "QUOTED", "CONFIRMED");
    });

    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual({ projectId: "p1", status: "CONFIRMED", impact: NONZERO_IMPACT });

    act(() => result.current.confirmPending());
    expect(onProceed).toHaveBeenCalledWith("p1", "CONFIRMED");
    expect(result.current.pending).toBeNull();
  });

  it("cancelPending clears the pending state without ever calling onProceed", async () => {
    queryMock.mockResolvedValue(NONZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "QUOTED", "CONFIRMED");
    });
    expect(result.current.pending).not.toBeNull();

    act(() => result.current.cancelPending());
    expect(result.current.pending).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("fails OPEN (proceeds) if the preview query itself throws — advisory only, never blocks", async () => {
    queryMock.mockRejectedValue(new Error("network blip"));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "QUOTED", "CONFIRMED");
    });

    await waitFor(() => expect(onProceed).toHaveBeenCalledWith("p1", "CONFIRMED"));
    expect(result.current.pending).toBeNull();
  });

  it("serves two different projects from one hook instance without cross-talk", async () => {
    queryMock.mockResolvedValue(NONZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("p1", "QUOTED", "CONFIRMED");
    });
    expect(result.current.pending?.projectId).toBe("p1");
    act(() => result.current.cancelPending());

    await act(async () => {
      await result.current.requestStatusChange("p2", "ENQUIRY", "QUOTING");
    });
    expect(onProceed).toHaveBeenCalledWith("p2", "QUOTING");
  });
});
