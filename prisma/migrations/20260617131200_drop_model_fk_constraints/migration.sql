-- Drop every inbound FK constraint into the frozen Prisma `model` table.
--
-- Why: Models were inverted to Convex-only (Phase B of the Convex domain-only
-- decommission). New/updated/archived models are written ONLY in Convex; the
-- Prisma `model` table is no longer written. Every live FK pointing at it
--   asset.modelId                 -> model(id)  (required, Restrict)
--   bulk_asset.modelId            -> model(id)  (required, Restrict)
--   project_line_item.modelId     -> model(id)  (nullable, SetNull)
--   supplier_order_item.modelId   -> model(id)  (nullable, SetNull)
--   sub_hire_item.modelId         -> model(id)  (nullable, SetNull)
--   model_media.modelId           -> model(id)  (required, Cascade)
--   model_check_item.modelId      -> model(id)  (required, Cascade)
--   model_bulk_accessory.modelId  -> model(id)  (required, Cascade)
--   group_template_item.modelId   -> model(id)  (nullable, Cascade)
--   supplier_model_rate.modelId   -> model(id)  (required, Cascade)
-- would otherwise reject any net-new Convex-only model (the referencing row
-- would have no Prisma `model` to point at). Each modelId becomes a plain
-- external id holding the Convex cuid — matching how Convex itself stores FKs
-- (v.string()). Columns + indexes stay; only the constraints are dropped.
--
-- Models are SOFT-archived only (isActive=false), never hard-deleted, so the
-- dropped Cascade behaviours (model_media / model_check_item /
-- model_bulk_accessory / group_template_item / supplier_model_rate) never fired
-- via a model delete and need no app-code re-implementation. archiveModel keeps
-- its existing asset/bulk-asset deletion side-effects (mirrored to Convex).
--
-- IF EXISTS keeps this idempotent across environments where a constraint may
-- already be absent.

ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "asset_modelId_fkey";
ALTER TABLE "bulk_asset" DROP CONSTRAINT IF EXISTS "bulk_asset_modelId_fkey";
ALTER TABLE "project_line_item" DROP CONSTRAINT IF EXISTS "project_line_item_modelId_fkey";
ALTER TABLE "supplier_order_item" DROP CONSTRAINT IF EXISTS "supplier_order_item_modelId_fkey";
ALTER TABLE "sub_hire_item" DROP CONSTRAINT IF EXISTS "sub_hire_item_modelId_fkey";
ALTER TABLE "model_media" DROP CONSTRAINT IF EXISTS "model_media_modelId_fkey";
ALTER TABLE "model_check_item" DROP CONSTRAINT IF EXISTS "model_check_item_modelId_fkey";
ALTER TABLE "model_bulk_accessory" DROP CONSTRAINT IF EXISTS "model_bulk_accessory_modelId_fkey";
ALTER TABLE "group_template_item" DROP CONSTRAINT IF EXISTS "group_template_item_modelId_fkey";
ALTER TABLE "supplier_model_rate" DROP CONSTRAINT IF EXISTS "supplier_model_rate_modelId_fkey";
