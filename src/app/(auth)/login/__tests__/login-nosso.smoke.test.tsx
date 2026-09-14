// @vitest-environment jsdom
//
// `?nosso=1` escape hatch (see noSsoHref's docstring in page.tsx): when SSO
// itself is broken, resolveSSOProviderForEmail auto-redirects on Continue
// with no way to reach the password form. This smoke test actually renders
// the page (per CLAUDE.md's overlay-UI convention) to prove the bypass works
// end to end, not just that the helper function returns the right string.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

let currentSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/auth-client", () => ({
  signIn: { email: vi.fn() },
  organization: { setActive: vi.fn() },
  authClient: {
    signIn: { sso: vi.fn(), passkey: vi.fn() },
  },
}));

vi.mock("@/server/public-org", () => ({
  getMyOrganizations: vi.fn().mockResolvedValue([]),
  getSoloOrgBranding: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/sso", () => ({
  getOrgLoginInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/use-platform-name", () => ({
  usePlatformBranding: () => ({ name: "RVLT Flow" }),
}));

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ policy: "INVITE_ONLY" }),
  }),
);

import LoginPage from "../page";

describe("login page — ?nosso=1 SSO bypass", () => {
  it("shows the password form directly when nosso=1 is set, skipping the SSO auto-redirect", async () => {
    currentSearchParams = new URLSearchParams({ nosso: "1" });
    render(<LoginPage />);

    expect(await screen.findByLabelText("Password")).toBeTruthy();
    // The email-step "Continue" button (and the SSO-lookup path it drives)
    // must not render at all — nosso skips straight past it.
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("shows the understated bypass link on the plain email step, pointing at ?nosso=1", async () => {
    currentSearchParams = new URLSearchParams();
    render(<LoginPage />);

    const link = (await screen.findByRole("link", {
      name: "Trouble with SSO? Sign in with a password instead",
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/login?nosso=1");
  });

  it("preserves callbackUrl on the bypass link", async () => {
    currentSearchParams = new URLSearchParams({ callbackUrl: "/projects/123" });
    render(<LoginPage />);

    const link = (await screen.findByRole("link", {
      name: "Trouble with SSO? Sign in with a password instead",
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/login?nosso=1&callbackUrl=%2Fprojects%2F123");
  });
});
