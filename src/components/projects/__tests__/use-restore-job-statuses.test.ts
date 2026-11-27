// @vitest-environment jsdom
//
// useRestoreJobStatuses: the ONE Undo for a status write on several jobs (the Jobs
// list's Set status / Cancel and the Schedule's Confirm n). It puts each row back to the
// status IT had (never a hard-coded one), only while the row's LIVE status is still
// what the write set, and NAMES the rows it left alone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const m = vi.hoisted(() => ({ updateStatus: vi.fn(async (_id: string, _s: string) => {}), live: vi.fn((): { id: string; status: string | null }[] => []) }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: async () => m.live() }) }));
vi.mock("@/hooks/use-native-project-writes", () => ({ useNativeProjectStatus: () => ({ updateStatus: m.updateStatus }) }));

import { useRestoreJobStatuses } from "../use-restore-job-statuses";

beforeEach(() => {
  m.updateStatus.mockClear();
  m.live.mockReset();
});

describe("useRestoreJobStatuses", () => {
  it("restores each row to the status it HAD (QUOTING, ENQUIRY, an absent one reads ENQUIRY), not a fixed one", async () => {
    m.live.mockReturnValue([{ id: "a", status: "CONFIRMED" }, { id: "b", status: "CONFIRMED" }, { id: "c", status: "CONFIRMED" }]);
    const { result } = renderHook(() => useRestoreJobStatuses("org1"));
    const undo = result.current([{ id: "a", status: "QUOTING" }, { id: "b", status: "ENQUIRY" }, { id: "c", status: null }], "CONFIRMED");
    expect(await undo()).toBeUndefined();
    expect(m.updateStatus.mock.calls).toEqual([["a", "QUOTING"], ["b", "ENQUIRY"], ["c", "ENQUIRY"]]);
  });

  it("leaves a row whose LIVE status moved on and names it by job number", async () => {
    m.live.mockReturnValue([{ id: "a", status: "CONFIRMED" }, { id: "b", status: "PREPPING" }, { id: "c", status: "CANCELLED" }]);
    const { result } = renderHook(() => useRestoreJobStatuses("org1"));
    const undo = result.current(
      [{ id: "a", status: "QUOTING", projectNumber: "#2350" }, { id: "b", status: "QUOTED", projectNumber: "#2351" }, { id: "c", status: "QUOTED", projectNumber: "#2352" }],
      "CONFIRMED",
    );
    expect(await undo()).toBe("2 jobs had moved on, left as they are (#2351, #2352)");
    expect(m.updateStatus.mock.calls).toEqual([["a", "QUOTING"]]);
  });
});
