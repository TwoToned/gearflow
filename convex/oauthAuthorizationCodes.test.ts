// @vitest-environment node
//
// The OAuth 2.1 authorization-code single-use guarantee (Phase 7, #1003). The
// thing that matters here isn't that `redeem` CAN reject a reused code — it's
// that the FIRST successful redemption is the only one that ever succeeds,
// even when both attempts race (this test drives them concurrently, not
// sequentially, so a naive "read then patch" implementation without Convex's
// transactional guarantee would show its cracks here).
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const SERVICE = { subject: "gearflow-service", svc: true };
const NOW = 1_700_000_000_000;

function makeT(): T {
  return convexTest(schema, modules);
}

const codeArgs = (over: Record<string, unknown> = {}) => ({
  codeHash: "hash-of-code-1",
  clientId: "client_1",
  redirectUri: "https://client.example.com/callback",
  codeChallenge: "abc123challenge",
  codeChallengeMethod: "S256" as const,
  scopes: JSON.stringify(["asset:read", "project:read"]),
  userId: "user_1",
  organizationId: "org_A",
  expiresAt: NOW + 120_000,
  createdAt: NOW,
  ...over,
});

describe("oauthAuthorizationCodes.redeem — single-use", () => {
  test("a fresh code redeems successfully and returns its stored fields", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.create, codeArgs());

    const result = await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, {
      codeHash: "hash-of-code-1",
      now: NOW + 1_000,
    });

    expect(result).toMatchObject({
      clientId: "client_1",
      redirectUri: "https://client.example.com/callback",
      codeChallenge: "abc123challenge",
      codeChallengeMethod: "S256",
      userId: "user_1",
      organizationId: "org_A",
    });
    expect(JSON.parse(result!.scopes)).toEqual(["asset:read", "project:read"]);
  });

  test("redeeming the SAME code twice — the second redemption is refused (null)", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.create, codeArgs());

    const first = await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, {
      codeHash: "hash-of-code-1",
      now: NOW + 1_000,
    });
    const second = await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, {
      codeHash: "hash-of-code-1",
      now: NOW + 2_000,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test("two CONCURRENT redemption attempts for the same code — exactly one succeeds", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.create, codeArgs());

    const [a, b] = await Promise.all([
      t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, { codeHash: "hash-of-code-1", now: NOW + 1_000 }),
      t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, { codeHash: "hash-of-code-1", now: NOW + 1_000 }),
    ]);

    const successes = [a, b].filter((r) => r !== null);
    expect(successes).toHaveLength(1);
  });

  test("an EXPIRED code is refused", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.create, codeArgs({ expiresAt: NOW + 100 }));

    const result = await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, {
      codeHash: "hash-of-code-1",
      now: NOW + 200,
    });

    expect(result).toBeNull();
  });

  test("an UNKNOWN code hash is refused", async () => {
    const t = makeT();
    const result = await t.withIdentity(SERVICE).mutation(api.oauthAuthorizationCodes.redeem, {
      codeHash: "never-issued",
      now: NOW,
    });
    expect(result).toBeNull();
  });
});
