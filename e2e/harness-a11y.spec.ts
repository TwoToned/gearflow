import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility on authenticated pages (POLICY.md R-8.1.7). Extends axe coverage
 * beyond /login to the signed-in surface. Runs against the seeded harness
 * (E2E_HARNESS=1). Fails on serious/critical WCAG 2 A/AA violations.
 */
test.describe("harness: a11y (authenticated)", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness");

  test("dashboard has no serious/critical WCAG 2 A/AA violations", async ({ page }) => {
    const email = `e2e+${Date.now()}@harness.local`;
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("A11y Test");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page.getByRole("button", { name: /create|register|sign up/i }).first().click();
    // A fresh registration with no org lands on the create-vs-join fork
    // (/welcome, #1092) rather than an authenticated dashboard directly.
    await expect(page).toHaveURL(/\/(dashboard|welcome)\b/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // ACCEPTED EXCEPTION (POLICY.md §15 — see docs/exceptions.md, R-8.1.7): the
      // RVLT brand red (--red #d8353b) fails the 4.5:1 AA contrast floor on the
      // authenticated surface too. The palette is accepted as-is per DESIGN.md;
      // baselined so this gate covers the authenticated surface for every OTHER
      // WCAG A/AA rule. Remove if the palette is re-toned.
      .disableRules(["color-contrast"])
      .analyze();
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (seriousOrCritical.length) {
      console.log(
        "axe:\n" +
          seriousOrCritical
            .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`)
            .join("\n"),
      );
    }
    expect(seriousOrCritical).toEqual([]);
  });
});
