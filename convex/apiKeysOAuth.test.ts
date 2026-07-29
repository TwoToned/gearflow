// @vitest-environment node
//
// OAuth grant minting + refresh-token rotation (Phase 7, #1003). An
// OAuth-issued grant is a plain `apiKeys` row (`origin: "oauth"`) — the point
// of the design is that it needs NO new auth machinery, only a mint/rotate
// path. What actually needs proving here: refresh rotation is single-use (no
// grace window, unlike the manual-key `rotate`), and a revoked/foreign-org
// grant can never be refreshed back to life.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const SERVICE = { subject: "gearflow-service", svc: true };
// `rotateOAuthTokens` checks `refreshTokenExpiresAt` against the REAL wall
// clock (`Date.now()`, per Convex guidelines — mutations may read it), so
// this must be real "now", not an arbitrary fixed historical timestamp.
const NOW = Date.now();

function makeT(): T {
  return convexTest(schema, modules);
}

const grantArgs = (over: Record<string, unknown> = {}) => ({
  id: "key_oauth_1",
  organizationId: "org_A",
  name: "OAuth: Test Client",
  prefix: "gf_oauth_ab12cd",
  tokenHash: "access-hash-1",
  scopes: JSON.stringify(["asset:read"]),
  isActive: true,
  actingUserId: "user_1",
  createdById: "user_1",
  expiresAt: NOW + 3_600_000,
  createdAt: NOW,
  origin: "oauth" as const,
  oauthClientId: "client_1",
  refreshTokenHash: "refresh-hash-1",
  refreshTokenExpiresAt: NOW + 30 * 24 * 3_600_000,
  ...over,
});

describe("apiKeys.mintOAuthGrant", () => {
  test("requires origin: \"oauth\"", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs({ origin: "manual" })),
    ).rejects.toThrow();
  });

  test("creates a row findable by its refresh token hash", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs());
    const found = await t.withIdentity(SERVICE).query(api.apiKeys.getByRefreshTokenHash, {
      refreshTokenHash: "refresh-hash-1",
    });
    expect(found).toMatchObject({ id: "key_oauth_1", organizationId: "org_A", origin: "oauth" });
  });
});

describe("apiKeys.rotateOAuthTokens", () => {
  test("rotates the access + refresh token pair on a valid presented refresh hash", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs());

    const rotated = await t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
      id: "key_oauth_1",
      organizationId: "org_A",
      presentedRefreshTokenHash: "refresh-hash-1",
      tokenHash: "access-hash-2",
      prefix: "gf_oauth_ef34gh",
      accessTokenExpiresAt: NOW + 7_200_000,
      refreshTokenHash: "refresh-hash-2",
      refreshTokenExpiresAt: NOW + 60 * 24 * 3_600_000,
    });
    expect(rotated).toMatchObject({ id: "key_oauth_1" });

    // The OLD refresh hash is dead immediately — no grace window (unlike the
    // manual-key rotate's previousTokenHash).
    const byOldHash = await t.withIdentity(SERVICE).query(api.apiKeys.getByRefreshTokenHash, {
      refreshTokenHash: "refresh-hash-1",
    });
    expect(byOldHash).toBeNull();

    const byNewHash = await t.withIdentity(SERVICE).query(api.apiKeys.getByRefreshTokenHash, {
      refreshTokenHash: "refresh-hash-2",
    });
    expect(byNewHash).toMatchObject({ id: "key_oauth_1", tokenHash: "access-hash-2" });
  });

  test("a replayed (already-rotated) refresh token is rejected — single-use, no grace window", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs());
    await t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
      id: "key_oauth_1",
      organizationId: "org_A",
      presentedRefreshTokenHash: "refresh-hash-1",
      tokenHash: "access-hash-2",
      prefix: "gf_oauth_ef34gh",
      accessTokenExpiresAt: NOW + 7_200_000,
      refreshTokenHash: "refresh-hash-2",
      refreshTokenExpiresAt: NOW + 60 * 24 * 3_600_000,
    });

    await expect(
      t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
        id: "key_oauth_1",
        organizationId: "org_A",
        presentedRefreshTokenHash: "refresh-hash-1", // the now-superseded hash
        tokenHash: "access-hash-3",
        prefix: "gf_oauth_ij56kl",
        accessTokenExpiresAt: NOW + 10_800_000,
        refreshTokenHash: "refresh-hash-3",
        refreshTokenExpiresAt: NOW + 90 * 24 * 3_600_000,
      }),
    ).rejects.toThrow();
  });

  test("a REVOKED grant can never be refreshed back to life", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs());
    await t.withIdentity(SERVICE).mutation(api.apiKeys.revoke, { id: "key_oauth_1", orgId: "org_A" });

    await expect(
      t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
        id: "key_oauth_1",
        organizationId: "org_A",
        presentedRefreshTokenHash: "refresh-hash-1",
        tokenHash: "access-hash-2",
        prefix: "gf_oauth_ef34gh",
        accessTokenExpiresAt: NOW + 7_200_000,
        refreshTokenHash: "refresh-hash-2",
        refreshTokenExpiresAt: NOW + 60 * 24 * 3_600_000,
      }),
    ).rejects.toThrow();
  });

  test("a refresh token belonging to a DIFFERENT org's grant is rejected even with the right hash string", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiKeys.mintOAuthGrant, grantArgs());

    await expect(
      t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
        id: "key_oauth_1",
        organizationId: "org_B", // wrong org
        presentedRefreshTokenHash: "refresh-hash-1",
        tokenHash: "access-hash-2",
        prefix: "gf_oauth_ef34gh",
        accessTokenExpiresAt: NOW + 7_200_000,
        refreshTokenHash: "refresh-hash-2",
        refreshTokenExpiresAt: NOW + 60 * 24 * 3_600_000,
      }),
    ).rejects.toThrow();
  });

  test("an EXPIRED refresh token is rejected", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(
      api.apiKeys.mintOAuthGrant,
      grantArgs({ refreshTokenExpiresAt: NOW - 1_000 }),
    );

    await expect(
      t.withIdentity(SERVICE).mutation(api.apiKeys.rotateOAuthTokens, {
        id: "key_oauth_1",
        organizationId: "org_A",
        presentedRefreshTokenHash: "refresh-hash-1",
        tokenHash: "access-hash-2",
        prefix: "gf_oauth_ef34gh",
        accessTokenExpiresAt: NOW + 7_200_000,
        refreshTokenHash: "refresh-hash-2",
        refreshTokenExpiresAt: NOW + 60 * 24 * 3_600_000,
      }),
    ).rejects.toThrow();
  });
});
