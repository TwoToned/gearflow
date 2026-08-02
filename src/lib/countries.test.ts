import { describe, it, expect } from "vitest";
import { COUNTRIES, getCountry, listEnabledCountries, isCountryEnabled } from "./countries";

describe("countries — the single source of truth (I1, #1079)", () => {
  it("US has no default tax rate — genuinely null, not 0 (#1088)", () => {
    expect(getCountry("US")?.defaultTaxRate).toBeNull();
  });

  it("every other launch market has a positive default tax rate", () => {
    for (const c of COUNTRIES) {
      if (c.code === "US") continue;
      expect(c.defaultTaxRate).not.toBeNull();
      expect(c.defaultTaxRate).toBeGreaterThan(0);
    }
  });

  it("decimal separator is keyed off locale, not currency — IE and NL both use EUR but disagree", () => {
    const ie = getCountry("IE")!;
    const nl = getCountry("NL")!;
    expect(ie.currency).toBe(nl.currency);
    expect(ie.decimalSeparator).not.toBe(nl.decimalSeparator);
    expect(ie.decimalSeparator).toBe(".");
    expect(nl.decimalSeparator).toBe(",");
  });

  it("the US is the only market with month-first dates, Sunday weeks, Letter paper and imperial units", () => {
    const nonUS = COUNTRIES.filter((c) => c.code !== "US");
    expect(nonUS.every((c) => c.dateOrder === "DMY")).toBe(true);
    expect(nonUS.every((c) => c.weekStart === "MON")).toBe(true);
    expect(nonUS.every((c) => c.paperSize === "A4")).toBe(true);
    expect(nonUS.every((c) => c.units === "METRIC")).toBe(true);

    const us = getCountry("US")!;
    expect(us.dateOrder).toBe("MDY");
    expect(us.weekStart).toBe("SUN");
    expect(us.paperSize).toBe("LETTER");
    expect(us.units).toBe("IMPERIAL");
  });

  it("Germany is the only market with a dotted date separator", () => {
    const nonDE = COUNTRIES.filter((c) => c.code !== "DE");
    expect(nonDE.every((c) => c.dateSeparator === "/")).toBe(true);
    expect(getCountry("DE")?.dateSeparator).toBe(".");
  });

  it("NL and DE ship in the table but are excluded from the enabled list (M7)", () => {
    expect(getCountry("NL")?.enabled).toBe(false);
    expect(getCountry("DE")?.enabled).toBe(false);
    expect(isCountryEnabled("NL")).toBe(false);
    expect(isCountryEnabled("DE")).toBe(false);

    const enabledCodes = listEnabledCountries().map((c) => c.code);
    expect(enabledCodes).toEqual(["AU", "NZ", "GB", "US", "IE"]);
  });

  it("every AU/NZ/UK/US/IE launch market is enabled", () => {
    for (const code of ["AU", "NZ", "GB", "US", "IE"] as const) {
      expect(isCountryEnabled(code)).toBe(true);
    }
  });

  it("getCountry returns undefined for an unknown or unset code, never a guessed default", () => {
    expect(getCountry("XX")).toBeUndefined();
    expect(getCountry(null)).toBeUndefined();
    expect(getCountry(undefined)).toBeUndefined();
  });

  it("every row has a unique code", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only AU/NZ use the 'TAX INVOICE' heading — everyone else gets the generic 'INVOICE' (I4, #1083)", () => {
    expect(getCountry("AU")?.invoiceHeading).toBe("TAX INVOICE");
    expect(getCountry("NZ")?.invoiceHeading).toBe("TAX INVOICE");
    for (const code of ["GB", "US", "IE", "NL", "DE"] as const) {
      expect(getCountry(code)?.invoiceHeading).toBe("INVOICE");
    }
  });
});
