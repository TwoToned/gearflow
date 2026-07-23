import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportVendorUsage } from "./vendor-cost-tracking";

const phCapture = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: (...args: unknown[]) => phCapture(...args),
}));

describe("reportVendorUsage", () => {
  beforeEach(() => {
    phCapture.mockClear();
  });

  it("captures one billable unit by default", () => {
    reportVendorUsage("resend", "send");
    expect(phCapture).toHaveBeenCalledWith("vendor_usage", {
      vendor: "resend",
      operation: "send",
      units: 1,
    });
  });

  it("captures an explicit unit count", () => {
    reportVendorUsage("maps", "autocomplete", 3);
    expect(phCapture).toHaveBeenCalledWith("vendor_usage", {
      vendor: "maps",
      operation: "autocomplete",
      units: 3,
    });
  });
});
