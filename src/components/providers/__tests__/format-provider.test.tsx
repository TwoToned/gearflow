// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * I2 (#1081) — the client half of the locale-aware formatting lever.
 * `FormatProvider` derives a `FormatConfig` from the active org's settings
 * (already loaded by the always-mounted layout, same store `BrandingProvider`
 * reads) and `useFormatters()` exposes locale-bound `formatCurrency`/
 * `formatDate`. Outside the provider, `useFormatters()` must still work —
 * it falls back to the AU default context value, never throws.
 */

const activeOrgData: { id: string } | undefined = { id: "org_1" };
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: activeOrgData }),
}));

let orgData: { settings: Record<string, unknown> } | undefined;
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: orgData }),
}));

import { FormatProvider, useFormatters } from "../format-provider";

function Probe() {
  const { formatCurrency, formatDate, formatDateWithTime, formatMonthYear, config } = useFormatters();
  return (
    <div>
      <span data-testid="currency">{formatCurrency(1234.5)}</span>
      <span data-testid="date">{formatDate("2024-07-15")}</span>
      <span data-testid="date-with-time">{formatDateWithTime("2024-07-15T14:32:00Z")}</span>
      <span data-testid="month-year">{formatMonthYear("2024-07-15")}</span>
      <span data-testid="locale">{config.locale}</span>
    </div>
  );
}

describe("FormatProvider / useFormatters", () => {
  it("renders AU defaults for an org with no country configured", () => {
    orgData = { settings: {} };
    render(
      <FormatProvider>
        <Probe />
      </FormatProvider>,
    );
    expect(screen.getByTestId("currency").textContent).toBe("$1,234.50");
    expect(screen.getByTestId("locale").textContent).toBe("en-AU");
  });

  it("renders in the org's own country/currency once settings.country is set", () => {
    orgData = { settings: { country: "US" } };
    render(
      <FormatProvider>
        <Probe />
      </FormatProvider>,
    );
    expect(screen.getByTestId("currency").textContent).toBe("$1,234.50");
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
    // en-US month-first: "Jul 15, 2024" — "Jul" precedes "15".
    const date = screen.getByTestId("date").textContent ?? "";
    expect(date.indexOf("Jul")).toBeLessThan(date.indexOf("15"));
  });

  it("renders GBP with the £ symbol for a GB org", () => {
    orgData = { settings: { country: "GB" } };
    render(
      <FormatProvider>
        <Probe />
      </FormatProvider>,
    );
    expect(screen.getByTestId("currency").textContent).toBe("£1,234.50");
  });

  it("useFormatters() outside any provider falls back to the AU default, never throws", () => {
    render(<Probe />);
    expect(screen.getByTestId("currency").textContent).toBe("$1,234.50");
    expect(screen.getByTestId("locale").textContent).toBe("en-AU");
  });

  it("exposes the I3 named date-format roles bound to the same locale", () => {
    orgData = { settings: { country: "US" } };
    render(
      <FormatProvider>
        <Probe />
      </FormatProvider>,
    );
    // en-US: month-first, and pinned to a 24-hour clock regardless of locale.
    expect(screen.getByTestId("date-with-time").textContent).toMatch(/14:32/);
    expect(screen.getByTestId("date-with-time").textContent).not.toMatch(/pm|PM/);
    expect(screen.getByTestId("month-year").textContent).not.toMatch(/15/);
    expect(screen.getByTestId("month-year").textContent).toMatch(/2024/);
  });
});
