// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { capture, AnalyticsEvent } from "./analytics";

describe("analytics.capture", () => {
  afterEach(() => {
    delete (window as { posthog?: unknown }).posthog;
  });

  it("no-ops when PostHog is not initialised (no window.posthog)", () => {
    // Should not throw — call sites never guard.
    expect(() => capture(AnalyticsEvent.PageView)).not.toThrow();
  });

  it("forwards event + properties to window.posthog.capture when present", () => {
    const spy = vi.fn();
    window.posthog = { capture: spy };

    capture(AnalyticsEvent.WebVital, { metric: "LCP", value: 1200 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(AnalyticsEvent.WebVital, {
      metric: "LCP",
      value: 1200,
    });
  });

  it("no-ops when window.posthog exists but lacks a capture fn", () => {
    (window as { posthog?: unknown }).posthog = {};
    expect(() => capture(AnalyticsEvent.PageView)).not.toThrow();
  });

  it("exposes stable canonical event names", () => {
    expect(AnalyticsEvent.PageView).toBe("$pageview");
    expect(AnalyticsEvent.WebVital).toBe("web_vital");
  });
});
