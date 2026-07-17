import { expect, test } from "@playwright/test";

/**
 * Critical-flow #1 (docs/critical-flows.md): the login page loads for an
 * unauthenticated visitor and renders the sign-in form. This is the minimal
 * real E2E smoke — it needs the app serving (Postgres + Convex reachable) but
 * no seeded auth. Flows 2+ (sign-in, revenue path) are pending a seeded user.
 */
test.describe("auth: login page", () => {
  test("renders the sign-in form for an unauthenticated visitor", async ({
    page,
  }) => {
    await page.goto("/login");

    // Heading is "Welcome back" (or "Sign in to {org}" when org-scoped).
    await expect(
      page.getByRole("heading", { name: /welcome back|sign in to/i }),
    ).toBeVisible();

    // Email + password fields and the submit button are present.
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(page.getByPlaceholder("Enter your password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });
});
