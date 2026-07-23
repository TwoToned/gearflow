import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportIfSlowConvexOp, withConvexOpTiming, SLOW_OP_MS, INCIDENT_OP_MS } from "./convex-op-timing";

const phCapture = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: (...args: unknown[]) => phCapture(...args),
}));

const getFunctionNameMock = vi.fn<(ref: unknown) => string>();
vi.mock("convex/server", () => ({
  getFunctionName: (ref: unknown) => getFunctionNameMock(ref),
}));

let ambientRequestId: string | undefined;
vi.mock("@/lib/request-context", () => ({
  getAmbientRequestId: () => ambientRequestId,
}));

describe("reportIfSlowConvexOp", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    phCapture.mockClear();
    ambientRequestId = undefined;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("correlates the PostHog event with the ambient x-request-id when present (R-8.9.6)", () => {
    ambientRequestId = "req-abc-123";
    reportIfSlowConvexOp("crewMembers:list", "query", SLOW_OP_MS + 1);
    expect(phCapture).toHaveBeenCalledWith("convex_op_latency", {
      name: "crewMembers:list",
      kind: "query",
      duration_ms: SLOW_OP_MS + 1,
      incident: false,
      request_id: "req-abc-123",
    });
  });

  it("does nothing for an op at or under the slow line", () => {
    reportIfSlowConvexOp("crewMembers:list", "query", SLOW_OP_MS);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(phCapture).not.toHaveBeenCalled();
  });

  it("warns + captures (non-incident) between the slow and incident lines", () => {
    reportIfSlowConvexOp("crewMembers:list", "query", SLOW_OP_MS + 1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(phCapture).toHaveBeenCalledWith("convex_op_latency", {
      name: "crewMembers:list",
      kind: "query",
      duration_ms: SLOW_OP_MS + 1,
      incident: false,
    });
  });

  it("errors + captures as an incident above the incident line", () => {
    reportIfSlowConvexOp("crewMembers:patchMember", "mutation", INCIDENT_OP_MS + 1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(phCapture).toHaveBeenCalledWith("convex_op_latency", {
      name: "crewMembers:patchMember",
      kind: "mutation",
      duration_ms: INCIDENT_OP_MS + 1,
      incident: true,
    });
  });
});

describe("withConvexOpTiming", () => {
  beforeEach(() => {
    phCapture.mockClear();
    getFunctionNameMock.mockReset();
  });

  it("wraps query/mutation, passes results through, and reports slowness", async () => {
    getFunctionNameMock.mockImplementation((ref) => ref as string);
    const rawQuery = vi.fn(() => Promise.resolve("query-result"));
    const rawMutation = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve("mutation-result"), SLOW_OP_MS + 5)),
    );
    const fakeClient = {
      query: rawQuery,
      mutation: rawMutation,
    };

    const wrapped = withConvexOpTiming(fakeClient as never);

    const queryResult = await wrapped.query("crewMembers:list" as never, {} as never);
    expect(queryResult).toBe("query-result");
    expect(rawQuery).toHaveBeenCalledWith("crewMembers:list", {});
    expect(phCapture).not.toHaveBeenCalled(); // fast — under SLOW_OP_MS

    const mutationResult = await wrapped.mutation("crewMembers:patchMember" as never, {} as never);
    expect(mutationResult).toBe("mutation-result");
    expect(phCapture).toHaveBeenCalledTimes(1);
    expect(phCapture.mock.calls[0]?.[1]).toMatchObject({
      name: "crewMembers:patchMember",
      kind: "mutation",
    });
  });

  it("still reports and rethrows when the wrapped call fails", async () => {
    getFunctionNameMock.mockImplementation((ref) => ref as string);
    const boom = new Error("boom");
    const rawQuery = vi.fn(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(boom), SLOW_OP_MS + 5),
        ),
    );
    const fakeClient = { query: rawQuery, mutation: vi.fn() };

    const wrapped = withConvexOpTiming(fakeClient as never);

    await expect(wrapped.query("crewMembers:list" as never, {} as never)).rejects.toThrow("boom");
    expect(phCapture).toHaveBeenCalledTimes(1);
    expect(phCapture.mock.calls[0]?.[1]).toMatchObject({ name: "crewMembers:list", kind: "query" });
  });
});
