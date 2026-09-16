-- Production incident (2026-09-16): the `better-auth` package bumped from
-- 1.6.25 to ^1.7.4 (deps-group bump, Release 0.28.0) without `prisma/schema.prisma`
-- being regenerated to match. The `admin()`, `twoFactor()`, and `jwt()` plugins
-- in 1.7.x each require a new column that never existed in the DB; Better
-- Auth's Prisma adapter validates its schema at request time and throws
-- SCHEMA_MISMATCH, so every auth-touching route (get-session, get-full-organization,
-- etc.) 500'd from the first deploy that shipped the bumped dependency.
--
-- admin() plugin — temporary bans + impersonation tracking.
ALTER TABLE "user" ADD COLUMN "banExpires" TIMESTAMP(3);
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;

-- twoFactor() plugin — per-method verification + brute-force lockout on the
-- TOTP challenge. Existing rows predate this tracking and were already
-- functioning 2FA setups, so they're backfilled as verified rather than
-- forced through re-enrollment.
ALTER TABLE "twoFactor" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" TIMESTAMP(3);
UPDATE "twoFactor" SET "verified" = true;

-- jwt() plugin — multi-algorithm JWKS support. This app has only ever
-- configured ES256 (JWKS_ALG in convex-auth-constants.ts), so every
-- pre-existing key row is backfilled to the curve/algorithm it was actually
-- generated with.
ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;
UPDATE "jwks" SET "alg" = 'ES256', "crv" = 'P-256' WHERE "alg" IS NULL;
