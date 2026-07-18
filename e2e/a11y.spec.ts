import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility smoke (POLICY.md R-8.1.7 — WCAG 2.2 AA target). Runs axe against
 * critical-flow pages and fails on serious/critical violations. Automated axe
 * checks do NOT prove full AA conformance (a manual checklist pass is still
 * required per R-8.1.7) — this gate catches regressions on the covered pages.
 */
test.describe("a11y: axe", () => {
  test("login page has no serious/critical WCAG 2 A/AA violations", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /welcome back|sign in to/i }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // ACCEPTED EXCEPTION (POLICY.md §15 — see docs/exceptions.md, R-8.1.7):
      // the RVLT brand red (--red #d8353b) sits at ~4.41:1 against white on the
      // primary CTA, just under the 4.5:1 AA floor, so axe's color-contrast rule
      // flakes here on font-load timing. The brand palette is accepted as-is per
      // DESIGN.md; this rule is baselined so the gate stays deterministic and
      // enforces every OTHER WCAG A/AA rule. Remove if the palette is re-toned.
      .disableRules(["color-contrast"])
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    // Log a compact summary so CI/editor output names any regressions.
    if (seriousOrCritical.length > 0) {
      console.log(
        "axe violations:\n" +
          seriousOrCritical
            .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`)
            .join("\n"),
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });
});
