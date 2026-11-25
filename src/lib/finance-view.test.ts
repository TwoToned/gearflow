// @vitest-environment node
import { describe, expect, test } from "vitest";
import { financeViewQuery, parseFinanceView } from "@/lib/finance-view";

describe("finance view (URL is the only state)", () => {
  test("Quotes is the default; only ?fin=invoices selects Invoices; junk falls back", () => {
    expect(parseFinanceView(null)).toBe("quotes");
    expect(parseFinanceView("invoices")).toBe("invoices");
    expect(parseFinanceView("nonsense")).toBe("quotes");
  });

  test("writes keep other params, pin tab=finance and omit the default", () => {
    const base = new URLSearchParams("v=abc&tab=finance");
    expect(financeViewQuery(base, "invoices")).toBe("v=abc&tab=finance&fin=invoices");
    expect(financeViewQuery(new URLSearchParams("fin=invoices"), "quotes")).toBe("tab=finance");
    expect(financeViewQuery(new URLSearchParams(), "invoices")).toBe("tab=finance&fin=invoices");
  });
});
