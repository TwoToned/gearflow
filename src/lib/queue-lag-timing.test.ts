import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportIfQueueLagged, QUEUE_LAG_MS } from "./queue-lag-timing";

const phCapture = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: (...args: unknown[]) => phCapture(...args),
}));

describe("reportIfQueueLagged", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    phCapture.mockClear();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("does nothing when the oldest pending delivery is at or under the T-P7 threshold", () => {
    reportIfQueueLagged(QUEUE_LAG_MS, 3);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(phCapture).not.toHaveBeenCalled();
  });

  it("reports + captures once the oldest pending delivery crosses the threshold", () => {
    reportIfQueueLagged(QUEUE_LAG_MS + 1000, 7);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(phCapture).toHaveBeenCalledWith("queue_lag", {
      oldest_age_ms: QUEUE_LAG_MS + 1000,
      pending_count: 7,
    });
  });
});
