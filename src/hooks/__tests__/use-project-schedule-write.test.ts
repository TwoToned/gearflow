// @vitest-environment jsdom
//
// useProjectWrites().updateSchedule is the Schedule's date-move write. With
// `lockDates` it must FORWARD the flag to the mutation (the server refuses a job
// whose gear is out); without it the call is byte-for-byte what Logistics always
// sent. It returns the audit id the exact Undo needs.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const calls = vi.hoisted(() => ({ byName: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      const fn = calls.byName[name] ?? (calls.byName[name] = vi.fn(async () => ({ id: "p1" })));
      return Object.assign(fn, { withOptimisticUpdate: () => fn });
    },
  };
});
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }) }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));

import { useProjectWrites } from "@/hooks/use-native-project-writes";

beforeEach(() => {
  for (const f of Object.values(calls.byName)) f.mockClear();
});

describe("updateSchedule", () => {
  it("forwards lockDates: true to updateNative, with the same patch and an audit id it returns", async () => {
    const { result } = renderHook(() => useProjectWrites("org1"));
    const out = await result.current.updateSchedule("p1", { rentalStartDate: "2026-11-17", rentalEndDate: "2026-11-19" }, { lockDates: true });
    const update = calls.byName["projectWrites:updateNative"];
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0][0] as { id: string; orgId: string; set: Record<string, number>; clear: string[]; auditId: string; lockDates?: boolean };
    expect(args).toMatchObject({ id: "p1", orgId: "org1", lockDates: true, clear: [] });
    expect(args.set.rentalStartDate).toBe(Date.parse("2026-11-17"));
    expect(out.auditId).toBe(args.auditId);
    expect(out.auditId).toBeTruthy();
  });

  it("without the option it sends no lockDates at all (Logistics and the job sheet are unchanged)", async () => {
    const { result } = renderHook(() => useProjectWrites("org1"));
    await result.current.updateSchedule("p1", { rentalStartDate: "2026-11-17" });
    const args = calls.byName["projectWrites:updateNative"].mock.calls[0][0] as Record<string, unknown>;
    expect("lockDates" in args).toBe(false);
  });
});
