import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatLabel,
  roundCurrency,
  formatConfigFromOrgSettings,
  DEFAULT_FORMAT_CONFIG,
} from "./formatters";

describe("formatCurrency", () => {
  it("formats positive whole number", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats decimal value", () => {
    expect(formatCurrency(99.5)).toBe("$99.50");
  });

  it("formats negative value", () => {
    // en-AU locale places minus after currency symbol: $-250.00
    expect(formatCurrency(-250)).toBe("$-250.00");
  });

  it("returns em dash for null", () => {
    expect(formatCurrency(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatCurrency(undefined)).toBe("\u2014");
  });

  it("formats large number with comma separators", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(99.999)).toBe("$100.00");
  });

  it("pads single decimal place", () => {
    expect(formatCurrency(50.1)).toBe("$50.10");
  });
});

describe("formatCurrency — locale-aware (I2, #1081)", () => {
  it("defaults to the exact pre-#1081 AU behaviour when no config is passed", () => {
    expect(formatCurrency(1500)).toBe(formatCurrency(1500, DEFAULT_FORMAT_CONFIG));
  });

  it("renders GBP with the £ symbol", () => {
    expect(formatCurrency(1234.5, { locale: "en-GB", currency: "GBP" })).toBe("£1,234.50");
  });

  it("renders USD with the $ symbol", () => {
    expect(formatCurrency(1234.5, { locale: "en-US", currency: "USD" })).toBe("$1,234.50");
  });

  it("renders EUR with the € symbol, grouped per the locale (Ireland vs Germany)", () => {
    expect(formatCurrency(1234.5, { locale: "en-IE", currency: "EUR" })).toBe("€1,234.50");
    // German locale: decimal comma, thousands dot — the exact "1.234,56" case
    // that motivated keeping decimalSeparator locale-keyed, not currency-keyed.
    expect(formatCurrency(1234.5, { locale: "de-DE", currency: "EUR" })).toBe("€1.234,50");
  });

  it("falls back to the ISO code for an unrecognised currency rather than guessing a symbol", () => {
    expect(formatCurrency(10, { locale: "en-US", currency: "JPY" })).toBe("JPY 10.00");
  });

  it("still returns the em dash for null/undefined regardless of config", () => {
    expect(formatCurrency(null, { locale: "en-US", currency: "USD" })).toBe("—");
    expect(formatCurrency(undefined, { locale: "en-US", currency: "USD" })).toBe("—");
  });
});

describe("formatDate", () => {
  it("formats Date object", () => {
    const d = new Date("2024-07-15T00:00:00Z");
    const result = formatDate(d);
    // Accept locale-specific format — just verify it contains the parts
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jul/);
    expect(result).toMatch(/2024/);
  });

  it("formats date string", () => {
    const result = formatDate("2024-12-25");
    expect(result).toMatch(/25/);
    expect(result).toMatch(/Dec/);
    expect(result).toMatch(/2024/);
  });

  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatDate(undefined)).toBe("\u2014");
  });

  it("returns em dash for empty string", () => {
    expect(formatDate("")).toBe("\u2014");
  });
});

describe("formatDate \u2014 locale-aware (I2, #1081)", () => {
  it("defaults to the exact pre-#1081 AU behaviour when no config is passed", () => {
    const d = new Date("2024-07-15T00:00:00Z");
    expect(formatDate(d)).toBe(formatDate(d, DEFAULT_FORMAT_CONFIG));
  });

  it("US locale renders month-first \u2014 the whole point of threading locale through", () => {
    const d = new Date("2024-07-15T00:00:00Z");
    const result = formatDate(d, { locale: "en-US", currency: "USD" });
    // en-US with {day, month: "short", year}: "Jul 15, 2024" \u2014 month before day.
    expect(result.indexOf("Jul")).toBeLessThan(result.indexOf("15"));
  });

  it("still returns the em dash for null/undefined/empty regardless of config", () => {
    const config = { locale: "en-US", currency: "USD" };
    expect(formatDate(null, config)).toBe("\u2014");
    expect(formatDate(undefined, config)).toBe("\u2014");
    expect(formatDate("", config)).toBe("\u2014");
  });
});

describe("formatConfigFromOrgSettings", () => {
  it("falls back to DEFAULT_FORMAT_CONFIG for an org with no country set", () => {
    expect(formatConfigFromOrgSettings({})).toEqual(DEFAULT_FORMAT_CONFIG);
    expect(formatConfigFromOrgSettings(null)).toEqual(DEFAULT_FORMAT_CONFIG);
    expect(formatConfigFromOrgSettings(undefined)).toEqual(DEFAULT_FORMAT_CONFIG);
  });

  it("derives locale + currency from the country table", () => {
    expect(formatConfigFromOrgSettings({ country: "GB" })).toEqual({ locale: "en-GB", currency: "GBP" });
    expect(formatConfigFromOrgSettings({ country: "US" })).toEqual({ locale: "en-US", currency: "USD" });
  });

  it("an explicit settings.currency overrides the country default currency, keeping its locale", () => {
    // An IE org that's been manually set to bill in USD, say \u2014 locale stays
    // Ireland's (date order etc.), only the currency symbol changes.
    expect(formatConfigFromOrgSettings({ country: "IE", currency: "USD" })).toEqual({
      locale: "en-IE",
      currency: "USD",
    });
  });

  it("falls back to DEFAULT_FORMAT_CONFIG for an unknown country code", () => {
    expect(formatConfigFromOrgSettings({ country: "ZZ" })).toEqual(DEFAULT_FORMAT_CONFIG);
  });
});

describe("formatLabel", () => {
  it("converts SCREAMING_SNAKE_CASE to Title Case", () => {
    expect(formatLabel("CHECKED_OUT")).toBe("Checked Out");
  });

  it("converts single word", () => {
    expect(formatLabel("ENQUIRY")).toBe("Enquiry");
  });

  it("handles multiple underscores", () => {
    expect(formatLabel("DRY_HIRE_EXTENDED")).toBe("Dry Hire Extended");
  });

  it("handles already-lowercase input", () => {
    expect(formatLabel("daily")).toBe("Daily");
  });

  it("handles empty string", () => {
    expect(formatLabel("")).toBe("");
  });
});

describe("roundCurrency", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundCurrency(10.255)).toBe(10.26);
  });

  it("preserves exact 2 decimal values", () => {
    expect(roundCurrency(99.99)).toBe(99.99);
  });

  it("rounds down when appropriate", () => {
    expect(roundCurrency(10.254)).toBe(10.25);
  });

  it("handles zero", () => {
    expect(roundCurrency(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(roundCurrency(-5.555)).toBe(-5.55);
  });

  it("handles whole numbers", () => {
    expect(roundCurrency(100)).toBe(100);
  });

  it("handles very small fractions", () => {
    expect(roundCurrency(0.001)).toBe(0);
  });

  it("handles floating point edge case (0.1 + 0.2)", () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });
});
