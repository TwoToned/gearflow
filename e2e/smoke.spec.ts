import { expect, test } from "@playwright/test";

/**
 * Critical-flow #1 (docs/critical-flows.md): the login page loads for an
 * unauthenticated visitor and renders the sign-in entry form. This is the
 * minimal real E2E smoke — it needs the app serving but no seeded auth.
 *
 * The form is a two-step flow: the email step (email input + "Continue")
 * renders first; the password field only appears after a valid email advances
 * to step 2. This smoke asserts the initial email step. Flows 2+ (full sign-in,
 * revenue path) are pending a seeded user — see docs/critical-flows.md.
 */
test.describe("auth: login page", () => {
  test("renders the sign-in entry form for an unauthenticated visitor", async ({
    page,
  }) => {
    await page.goto("/login");

    // Heading is "Welcome back" (or "Sign in to {org}" when org-scoped).
    await expect(
      page.getByRole("heading", { name: /welcome back|sign in to/i }),
    ).toBeVisible();

    // Email step: email input + "Continue", plus the always-present passkey option.
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in with passkey/i }),
    ).toBeVisible();
  });
});
