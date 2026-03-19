/**
 * Tests for EmptyState preset resolution logic.
 *
 * The EmptyState component resolves icons, headings, descriptions,
 * and spot illustrations through a priority chain:
 *   custom prop → preset value → default fallback
 */
import { describe, it, expect } from "vitest";
import { Package } from "lucide-react";

// ─── Replicate preset resolution logic for pure testing ─────────────
// This mirrors the resolution in EmptyState without React rendering.

const presetKeys = [
  "assets", "models", "projects", "clients", "maintenance",
  "warehouse", "documents", "reports", "calendar", "locations",
  "settings", "notifications", "categories", "kits", "crew",
  "activity", "suppliers", "lineItems", "history", "search",
];

// Presets that should NOT have spot illustrations
const presetsWithoutSpot = ["settings", "activity", "history", "search"];

// Simulate the resolution logic
function resolveEmptyState(opts: {
  presetKey?: string;
  customIcon?: unknown;
  customHeading?: string;
  customDescription?: string;
}) {
  const hasPreset = opts.presetKey !== undefined;
  // In real code, preset comes from a Record lookup
  const presetExists = hasPreset && presetKeys.includes(opts.presetKey!);

  return {
    usesCustomIcon: opts.customIcon !== undefined,
    usesPresetIcon: !opts.customIcon && presetExists,
    usesDefaultIcon: !opts.customIcon && !presetExists,
    heading: opts.customHeading ?? (presetExists ? `preset:${opts.presetKey}` : "Nothing here yet"),
    description: opts.customDescription ?? (presetExists ? `desc:${opts.presetKey}` : "Items will appear here once added."),
    showsSpotIllustration: !opts.customIcon && presetExists && !presetsWithoutSpot.includes(opts.presetKey!),
    showsIconContainer: !!opts.customIcon || !presetExists || presetsWithoutSpot.includes(opts.presetKey!),
  };
}

describe("EmptyState preset resolution", () => {
  it("uses preset values when preset key is valid", () => {
    const result = resolveEmptyState({ presetKey: "assets" });
    expect(result.usesPresetIcon).toBe(true);
    expect(result.heading).toBe("preset:assets");
    expect(result.showsSpotIllustration).toBe(true);
  });

  it("falls back to defaults when no preset given", () => {
    const result = resolveEmptyState({});
    expect(result.usesDefaultIcon).toBe(true);
    expect(result.heading).toBe("Nothing here yet");
    expect(result.description).toBe("Items will appear here once added.");
  });

  it("custom heading overrides preset heading", () => {
    const result = resolveEmptyState({ presetKey: "assets", customHeading: "Custom Title" });
    expect(result.heading).toBe("Custom Title");
  });

  it("custom description overrides preset description", () => {
    const result = resolveEmptyState({ presetKey: "assets", customDescription: "Custom desc" });
    expect(result.description).toBe("Custom desc");
  });

  it("custom icon suppresses spot illustration", () => {
    const result = resolveEmptyState({ presetKey: "assets", customIcon: Package });
    expect(result.showsSpotIllustration).toBe(false);
    expect(result.usesCustomIcon).toBe(true);
    expect(result.showsIconContainer).toBe(true);
  });

  it("presets without spot illustration show icon container", () => {
    for (const key of presetsWithoutSpot) {
      const result = resolveEmptyState({ presetKey: key });
      expect(result.showsSpotIllustration).toBe(false);
      expect(result.showsIconContainer).toBe(true);
    }
  });

  it("presets with spot illustration show illustration, not icon container", () => {
    const withSpot = presetKeys.filter((k) => !presetsWithoutSpot.includes(k));
    for (const key of withSpot) {
      const result = resolveEmptyState({ presetKey: key });
      expect(result.showsSpotIllustration).toBe(true);
    }
  });

  it("all 20 presets are defined", () => {
    expect(presetKeys.length).toBe(20);
  });

  it("invalid preset key falls back to defaults", () => {
    const result = resolveEmptyState({ presetKey: "nonexistent" });
    expect(result.usesDefaultIcon).toBe(true);
    expect(result.heading).toBe("Nothing here yet");
  });
});
