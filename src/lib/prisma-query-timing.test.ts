import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportIfSlow,
  withQueryTiming,
  SLOW_QUERY_MS,
  INCIDENT_QUERY_MS,
} from "./prisma-query-timing";

const phCapture = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: (...args: unknown[]) => phCapture(...args),
}));

describe("reportIfSlow", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    phCapture.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does nothing for a query at or under the slow-query line", () => {
    reportIfSlow("user", "findFirst", SLOW_QUERY_MS);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(phCapture).not.toHaveBeenCalled();
  });

  it("warns + captures (non-incident) between the slow and incident lines", () => {
    reportIfSlow("user", "findMany", SLOW_QUERY_MS + 1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(phCapture).toHaveBeenCalledWith("slow_query", {
      model: "user",
      operation: "findMany",
      duration_ms: SLOW_QUERY_MS + 1,
      incident: false,
    });
  });

  it("errors + captures as an incident above the incident line", () => {
    reportIfSlow("session", "create", INCIDENT_QUERY_MS + 1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(phCapture).toHaveBeenCalledWith("slow_query", {
      model: "session",
      operation: "create",
      duration_ms: INCIDENT_QUERY_MS + 1,
      incident: true,
    });
  });
});

describe("withQueryTiming", () => {
  it("passes the query result through unchanged and still reports slowness", async () => {
    phCapture.mockClear();
    const fakeClient = {
      $extends(config: {
        query: {
          $allModels: {
            $allOperations: (args: {
              model?: string;
              operation: string;
              args: unknown;
              query: (args: unknown) => Promise<unknown>;
            }) => Promise<unknown>;
          };
        };
      }) {
        return config; // capture the extension config for direct invocation below
      },
    };

    const extended = withQueryTiming(fakeClient as never) as unknown as {
      query: { $allModels: { $allOperations: (args: never) => Promise<unknown> } };
    };
    const slowQuery = () =>
      new Promise((resolve) => setTimeout(() => resolve("ok"), SLOW_QUERY_MS + 5));

    const result = await extended.query.$allModels.$allOperations({
      model: "asset",
      operation: "update",
      args: {},
      query: slowQuery,
    } as never);

    expect(result).toBe("ok");
    expect(phCapture).toHaveBeenCalledTimes(1);
    expect(phCapture.mock.calls[0]?.[1]).toMatchObject({ model: "asset", operation: "update" });
  });
});
