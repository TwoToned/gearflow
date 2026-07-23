import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportVendorUsage,
  RESEND_MONTHLY_EMAIL_ALERT_LINE,
  MAPS_AUTOCOMPLETE_USD_PER_REQUEST,
  MAPS_PLACE_DETAILS_USD_PER_REQUEST,
  MAPS_MONTHLY_COST_ALERT_LINE_USD,
} from "./vendor-cost-tracking";

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

describe("target budget reference lines", () => {
  // Locks in the numbers the eventual 80%-alert should be wired against
  // (docs/exceptions.md R-9.12) so they can't silently drift out of sync
  // with what's documented in README.md / FEATUREDOCS/61.
  it("matches the documented 80%-of-budget targets", () => {
    expect(RESEND_MONTHLY_EMAIL_ALERT_LINE).toBe(2_400);
    expect(MAPS_AUTOCOMPLETE_USD_PER_REQUEST).toBe(0.00283);
    expect(MAPS_PLACE_DETAILS_USD_PER_REQUEST).toBe(0.005);
    expect(MAPS_MONTHLY_COST_ALERT_LINE_USD).toBe(12);
  });
});
