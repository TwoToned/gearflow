-- Drop every inbound FK constraint into the frozen Prisma `category` table.
--
-- Why: Equipment Categories were inverted to Convex-only (Phase B of the Convex
-- domain-only decommission). New/updated/deleted categories are written ONLY in
-- Convex; the Prisma `category` table is no longer written. Every live FK pointing
-- at it
--   model.categoryId  -> category(id)  (nullable, SetNull)
--   kit.categoryId    -> category(id)  (nullable, SetNull)
--   category.parentId -> category(id)  (self-ref, nullable, SetNull)
-- would otherwise reject any net-new Convex-only category (the referencing row
-- would have no Prisma `category` to point at). Each categoryId/parentId becomes a
-- plain external id holding the Convex cuid — matching how Convex itself stores FKs
-- (v.string()). Columns + indexes stay; only the constraints are dropped.
--
-- All three were SetNull, so NO cascade re-implementation is needed: deleting a
-- category just orphaned the referencing categoryId/parentId, and reads already
-- tolerate a missing category. The delete guard (no children / no models) is
-- re-implemented in app code (deleteCategory) against Convex counts. The self-ref
-- parent tree is rebuilt client-side in categories-read. See the decommission
-- runbook + FEATUREDOCS/54.
--
-- IF EXISTS keeps this idempotent across environments where a constraint may
-- already be absent.

ALTER TABLE "model" DROP CONSTRAINT IF EXISTS "model_categoryId_fkey";
ALTER TABLE "kit" DROP CONSTRAINT IF EXISTS "kit_categoryId_fkey";
ALTER TABLE "category" DROP CONSTRAINT IF EXISTS "category_parentId_fkey";
