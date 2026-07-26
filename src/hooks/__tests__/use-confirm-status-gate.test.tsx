// @vitest-environment jsdom
//
// useConfirmStatusGate (WS3 #942, confirm-time gate) — non-blocking: only a
// transition INTO CONFIRMED previews impact; every other transition, and any
// transition when the preview finds nothing to warn about, proceeds
// immediately with no dialog.
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
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "ENQUIRY", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("QUOTING");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("QUOTING");
    expect(result.current.pending).toBeNull();
  });

  it("proceeds immediately when the project is already CONFIRMED (re-selecting the same status)", async () => {
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "CONFIRMED", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("CONFIRMED");
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledWith("CONFIRMED");
  });

  it("previews impact on a QUOTED -> CONFIRMED transition, and proceeds immediately when impact is zero", async () => {
    queryMock.mockResolvedValue(ZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "QUOTED", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("CONFIRMED");
    });

    expect(queryMock).toHaveBeenCalledWith(expect.anything(), { orgId: "org1", projectId: "p1" });
    expect(onProceed).toHaveBeenCalledWith("CONFIRMED");
    expect(result.current.pending).toBeNull();
  });

  it("holds for confirmation when impact is nonzero — does NOT call onProceed until confirmPending()", async () => {
    queryMock.mockResolvedValue(NONZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "QUOTED", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("CONFIRMED");
    });

    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual({ status: "CONFIRMED", impact: NONZERO_IMPACT });

    act(() => result.current.confirmPending());
    expect(onProceed).toHaveBeenCalledWith("CONFIRMED");
    expect(result.current.pending).toBeNull();
  });

  it("cancelPending clears the pending state without ever calling onProceed", async () => {
    queryMock.mockResolvedValue(NONZERO_IMPACT);
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "QUOTED", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("CONFIRMED");
    });
    expect(result.current.pending).not.toBeNull();

    act(() => result.current.cancelPending());
    expect(result.current.pending).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("fails OPEN (proceeds) if the preview query itself throws — advisory only, never blocks", async () => {
    queryMock.mockRejectedValue(new Error("network blip"));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useConfirmStatusGate("org1", "p1", "QUOTED", onProceed));

    await act(async () => {
      await result.current.requestStatusChange("CONFIRMED");
    });

    await waitFor(() => expect(onProceed).toHaveBeenCalledWith("CONFIRMED"));
    expect(result.current.pending).toBeNull();
  });
});
