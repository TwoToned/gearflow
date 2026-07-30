/**
 * src/components/settings/xero-coding-fields.tsx — `revenueApplicableTaxRates`,
 * the pure filter behind the Settings -> Xero tax-type picker. Split out of a
 * .test.tsx so this doesn't need to render the picker or mock
 * useXeroIntegration.
 *
 * Regression (live bug): a push failed with "The TaxType code 'INPUT' cannot
 * be used with account code '200'" because the org-default tax type picker
 * offered every cached Xero tax rate — income AND expense side — with no
 * filtering, even though this integration only ever creates ACCREC (sales)
 * invoices. An expenses-only rate is never a valid choice for any push.
 */
import { describe, test, expect } from "vitest";
import { revenueApplicableTaxRates } from "./xero-coding-fields";

describe("revenueApplicableTaxRates", () => {
  test("drops a rate explicitly marked CanApplyToRevenue: false", () => {
    const rates = [
      { Name: "GST on Income", TaxType: "OUTPUT2", CanApplyToRevenue: true },
      { Name: "GST on Expenses", TaxType: "INPUT2", CanApplyToRevenue: false },
    ];
    expect(revenueApplicableTaxRates(rates).map((r) => r.TaxType)).toEqual(["OUTPUT2"]);
  });

  // A cache written before CanApplyToRevenue was modeled (src/lib/xero-client.ts)
  // has no such field on any rate — treat "unknown" as still-offerable rather
  // than hiding every option until the next Settings -> Xero "Refresh".
  test("keeps a rate with CanApplyToRevenue absent (pre-fix cache)", () => {
    const rates: { Name: string; TaxType: string; CanApplyToRevenue?: boolean }[] = [{ Name: "GST on Income", TaxType: "OUTPUT2" }];
    expect(revenueApplicableTaxRates(rates).map((r) => r.TaxType)).toEqual(["OUTPUT2"]);
  });

  test("empty input returns empty output", () => {
    expect(revenueApplicableTaxRates([])).toEqual([]);
  });
});
