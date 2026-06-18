-- Drop the inbound FK constraints INTO the `test_profile` table.
--
-- Why: Test profiles were write-inverted to Convex (Phase B of the domain-only
-- decommission — the Convex `testProfiles` doc is now the sole source of truth;
-- net-new profiles are created ONLY in Convex, no Prisma `test_profile` row). The
-- three inbound SetNull FKs
--   model.defaultTestProfileId      -> test_profile(id)   (SetNull)
--   test_tag_asset.testProfileId    -> test_profile(id)   (SetNull)
--   test_tag_record.testProfileId   -> test_profile(id)   (SetNull)
-- would therefore reject any net-new Convex-only profile (the referencing row has
-- no Prisma `test_profile` to point at). Each *Id column becomes a plain external
-- id holding the Convex cuid — matching how Convex itself stores FKs (v.string()).
-- The columns + indexes stay; only the constraints are dropped. See FEATUREDOCS/54
-- and docs/designs/convex-decommission-RUNBOOK.md.
--
-- IF EXISTS guards keep this idempotent across environments where the constraint
-- may already be absent.

ALTER TABLE "model" DROP CONSTRAINT IF EXISTS "model_defaultTestProfileId_fkey";

ALTER TABLE "test_tag_asset" DROP CONSTRAINT IF EXISTS "test_tag_asset_testProfileId_fkey";

ALTER TABLE "test_tag_record" DROP CONSTRAINT IF EXISTS "test_tag_record_testProfileId_fkey";
