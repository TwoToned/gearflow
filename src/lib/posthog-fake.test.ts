import { describe, expect, it } from "vitest";
import { createFakePostHog } from "@/lib/posthog-fake";

describe("createFakePostHog", () => {
  it("captures exceptions in order with their context", async () => {
    const posthog = createFakePostHog();
    const err1 = new Error("first");
    const err2 = new Error("second");

    await posthog.captureException(err1, { requestId: "req_1" });
    await posthog.captureException(err2);

    expect(posthog.exceptions).toHaveLength(2);
    expect(posthog.exceptions[0]).toEqual({ error: err1, context: { requestId: "req_1" } });
    expect(posthog.exceptions[1]).toEqual({ error: err2, context: undefined });
  });

  it("captures events in order with their properties", async () => {
    const posthog = createFakePostHog();

    await posthog.captureEvent("slow_query", { durationMs: 150 });
    await posthog.captureEvent("vendor_usage");

    expect(posthog.events).toEqual([
      { event: "slow_query", properties: { durationMs: 150 } },
      { event: "vendor_usage", properties: undefined },
    ]);
  });

  it("clear() resets both captured exceptions and events", async () => {
    const posthog = createFakePostHog();
    await posthog.captureException(new Error("x"));
    await posthog.captureEvent("x");

    posthog.clear();

    expect(posthog.exceptions).toHaveLength(0);
    expect(posthog.events).toHaveLength(0);
  });
});
