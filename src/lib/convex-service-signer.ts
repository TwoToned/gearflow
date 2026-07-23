import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";
import { CONVEX_JWT_AUDIENCE, USER_TOKEN_TTL, JWKS_ALG } from "./convex-auth-constants";

/**
 * Minimal Better Auth instance dedicated to minting the Convex SERVICE token
 * (used by `convex-auth.ts`'s `getConvexServiceToken`). Deliberately carries
 * ONLY the `jwt` plugin — none of the organization/2FA/passkey/SSO/admin
 * plugins or `databaseHooks` that `src/lib/auth.ts`'s main `auth` instance
 * has.
 *
 * Those hooks mirror data into Convex via `convex-client.ts`, which needs the
 * SERVICE token from `convex-auth.ts`, which would need `auth` — a circular
 * dependency (POLICY.md R-3.5) if this signer imported the full instance
 * instead of standing alone.
 *
 * Signs against the SAME JWKS keys as `auth` — both read/write the shared
 * Postgres `jwks` table via `getJwksAdapter`, and both resolve `secret` from
 * `BETTER_AUTH_SECRET` identically (better-auth falls back to
 * `env.BETTER_AUTH_SECRET` when `secret` isn't passed explicitly — see
 * better-auth's `create-context.mjs`), so the private-key decryption matches.
 * Same issuer/audience/expiry too, so Convex's customJwt provider validates
 * SERVICE and USER tokens interchangeably regardless of which instance minted
 * them, and the `auth` instance's `/jwks` route (which Convex fetches) serves
 * keys either instance created.
 *
 * NEVER mounted as an HTTP route (unlike `auth`, which is wired into
 * `src/app/api/auth/[...all]/route.ts`) — only `.api.signJWT()` is called,
 * in-process, exactly like the existing service-token path already does with
 * the main instance.
 */
export const convexServiceSigner = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [
    jwt({
      jwks: {
        keyPairConfig: { alg: JWKS_ALG },
      },
      disableSettingJwtHeader: true,
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: CONVEX_JWT_AUDIENCE,
        expirationTime: USER_TOKEN_TTL,
      },
    }),
  ],
});
