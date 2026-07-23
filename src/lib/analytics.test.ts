// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { capture, identify, resetAnalyticsIdentity, AnalyticsEvent } from "./analytics";

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

describe("analytics.identify / resetAnalyticsIdentity (R-8.9.4)", () => {
  afterEach(() => {
    delete (window as { posthog?: unknown }).posthog;
  });

  it("forwards the opaque distinctId to window.posthog.identify", () => {
    const spy = vi.fn();
    window.posthog = { capture: vi.fn(), identify: spy };
    identify("member_abc123");
    expect(spy).toHaveBeenCalledExactlyOnceWith("member_abc123");
  });

  it("no-ops identify() when PostHog is not initialised", () => {
    expect(() => identify("member_abc123")).not.toThrow();
  });

  it("forwards to window.posthog.reset on sign-out", () => {
    const spy = vi.fn();
    window.posthog = { capture: vi.fn(), reset: spy };
    resetAnalyticsIdentity();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("no-ops resetAnalyticsIdentity() when PostHog is not initialised", () => {
    expect(() => resetAnalyticsIdentity()).not.toThrow();
  });
});
