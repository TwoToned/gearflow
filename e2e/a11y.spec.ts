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
