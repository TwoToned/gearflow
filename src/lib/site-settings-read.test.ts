/**
 * src/lib/site-settings-read.ts. The one regression test that matters here
 * (Phase B, B3/#1095, design doc §5.3 pt.2): `orgCreationCode` /
 * `orgCreationCodeEnabled` must NEVER reach `SiteSettingsRow` — that shape
 * feeds `/api/registration-policy`-style public routes and
 * `usePlatformBranding()`. A field that reaches `mapDoc()` reaches every
 * browser on the instance. The secret lives only in
 * src/lib/org-creation-gate.ts (see its own test file).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => convexMock),
  withConvexReadRetry: (fn: () => unknown) => fn(),
}));

import { getSiteSettingsFromConvex, DEFAULT_SITE_SETTINGS } from "./site-settings-read";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSiteSettingsFromConvex", () => {
  it("never surfaces orgCreationCode or orgCreationCodeEnabled, even when set on the underlying doc", async () => {
    convexMock.query.mockResolvedValue({
      id: "site_1",
      platformName: "RVLT Flow",
      allowOrgCreation: false,
      orgCreationCode: "super-secret-signup-code",
      orgCreationCodeEnabled: true,
    });

    const row = await getSiteSettingsFromConvex();

    expect(row).not.toHaveProperty("orgCreationCode");
    expect(row).not.toHaveProperty("orgCreationCodeEnabled");
    expect(JSON.stringify(row)).not.toContain("super-secret-signup-code");
    // The non-secret toggle is still expected to pass through as-is.
    expect(row.allowOrgCreation).toBe(false);
  });

  it("falls back to defaults (which also carry no secret field) when no row exists", async () => {
    convexMock.query.mockResolvedValue(null);
    const row = await getSiteSettingsFromConvex();
    expect(row).toEqual(DEFAULT_SITE_SETTINGS);
    expect(row).not.toHaveProperty("orgCreationCode");
  });
});

describe("DEFAULT_SITE_SETTINGS", () => {
  it("has no orgCreationCode-shaped keys in its own shape", () => {
    expect(Object.keys(DEFAULT_SITE_SETTINGS)).not.toContain("orgCreationCode");
    expect(Object.keys(DEFAULT_SITE_SETTINGS)).not.toContain("orgCreationCodeEnabled");
  });
});
