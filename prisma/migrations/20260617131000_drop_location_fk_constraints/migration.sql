-- Drop every inbound FK constraint into the frozen Prisma `location` table.
--
-- Why: Locations were inverted to Convex-only (Phase B of the Convex domain-only
-- decommission). New/updated/deleted locations are written ONLY in Convex; the
-- Prisma `location` table is no longer written. Every live FK pointing at it
--   asset.locationId                     -> location(id)  (nullable)
--   bulk_asset.locationId                -> location(id)  (nullable)
--   kit.locationId                       -> location(id)  (nullable)
--   project.locationId                   -> location(id)  (nullable)
--   location.parentId                    -> location(id)  (self-ref, nullable)
--   location_media.locationId            -> location(id)  (required, Cascade)
--   warehouse_dashboard_token.locationId -> location(id)  (nullable, SetNull)
-- would otherwise reject any net-new Convex-only location (the referencing row
-- would have no Prisma `location` to point at). Each locationId/parentId becomes a
-- plain external id holding the Convex cuid — matching how Convex itself stores FKs
-- (v.string()). Columns + indexes stay; only the constraints are dropped.
--
-- The dropped Cascade (location_media) and SetNull (warehouse_dashboard_token)
-- behaviours are re-implemented in app code (deleteLocation) against Convex counts.
-- The self-ref parent tree is rebuilt client-side in locations-read. See the
-- decommission runbook + FEATUREDOCS/54.
--
-- IF EXISTS keeps this idempotent across environments where a constraint may
-- already be absent.

ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "asset_locationId_fkey";
ALTER TABLE "bulk_asset" DROP CONSTRAINT IF EXISTS "bulk_asset_locationId_fkey";
ALTER TABLE "kit" DROP CONSTRAINT IF EXISTS "kit_locationId_fkey";
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_locationId_fkey";
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_parentId_fkey";
ALTER TABLE "location_media" DROP CONSTRAINT IF EXISTS "location_media_locationId_fkey";
ALTER TABLE "warehouse_dashboard_token" DROP CONSTRAINT IF EXISTS "warehouse_dashboard_token_locationId_fkey";
